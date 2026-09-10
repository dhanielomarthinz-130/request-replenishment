<?php
/**
 * REST API Backend for OCS Stock Sync & Bin Code Replenishment System
 */

// A browser-lifetime cookie made every page refresh look like a fresh visit on
// hosts that recycle sessions aggressively, so the login form kept reappearing.
// Pin an explicit 12 hour cookie plus a matching GC lifetime instead.
$sessionLifetime = 12 * 60 * 60;
ini_set('session.gc_maxlifetime', (string)$sessionLifetime);
ini_set('session.use_strict_mode', '1');
session_set_cookie_params([
    'lifetime' => $sessionLifetime,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

// Slide the expiry forward on every authenticated call so an active admin is
// never logged out mid-shift.
if (!empty($_SESSION['user_id'])) {
    setcookie(session_name(), session_id(), [
        'expires'  => time() + $sessionLifetime,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . '/db.php';
$pdo = Database::getConnection();

// Helper to send json response
function jsonResp(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// Helper to get raw JSON payload
function getJsonInput(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

$input = array_merge($_GET, $_POST, getJsonInput());
$action = $input['action'] ?? $_GET['action'] ?? $_POST['action'] ?? '';

// ==============================================================================
// 1. AUTHENTICATION & SESSION
// ==============================================================================

if ($action === 'login') {
    $username = trim($input['username'] ?? '');
    $password = trim($input['password'] ?? '');

    if (empty($username) || empty($password)) {
        jsonResp(['status' => 'error', 'message' => 'Username dan password wajib diisi.'], 400);
    }

    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password'])) {
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['full_name'] = $user['full_name'];
        $_SESSION['role'] = $user['role'];

        jsonResp([
            'status' => 'success',
            'message' => 'Login berhasil.',
            'user' => [
                'id' => $user['id'],
                'username' => $user['username'],
                'full_name' => $user['full_name'],
                'role' => $user['role']
            ]
        ]);
    } else {
        jsonResp(['status' => 'error', 'message' => 'Username atau password salah.'], 401);
    }
}

if ($action === 'check_session') {
    if (!empty($_SESSION['username'])) {
        jsonResp([
            'status' => 'success',
            'logged_in' => true,
            'user' => [
                'id' => $_SESSION['user_id'],
                'username' => $_SESSION['username'],
                'full_name' => $_SESSION['full_name'],
                'role' => $_SESSION['role']
            ]
        ]);
    } else {
        jsonResp(['status' => 'error', 'logged_in' => false, 'message' => 'Belum login.'], 200);
    }
}

if ($action === 'logout') {
    session_destroy();
    jsonResp(['status' => 'success', 'message' => 'Berhasil logout.']);
}

// ==============================================================================
// 2. SCAN BIN CODE & LIVE STOCK SYNC (CORE OPERATOR FEATURE)
// ==============================================================================

if ($action === 'scan_bin_code') {
    $binCode = trim($input['bin_code'] ?? '');
    if (empty($binCode)) {
        jsonResp(['status' => 'error', 'message' => 'Bin Code tidak boleh kosong.'], 400);
    }

    // 1. Lookup in SKU-Rack master table
    $stmt = $pdo->prepare("SELECT * FROM sku_rack_locations WHERE UPPER(bin_code) = UPPER(?) OR UPPER(sku) = UPPER(?) OR barcode = ?");
    $stmt->execute([$binCode, $binCode, $binCode]);
    $rackLocation = $stmt->fetch();

    if (!$rackLocation) {
        jsonResp([
            'status' => 'error',
            'message' => "Bin Code / SKU '{$binCode}' tidak ditemukan di Database Master SKU-Rack. Pastikan Admin telah mendaftarkannya."
        ], 404);
    }

    $sku = $rackLocation['sku'];

    // 2. Lookup local stock cache first
    $stmtStock = $pdo->prepare("SELECT * FROM stock_master WHERE UPPER(sku) = UPPER(?)");
    $stmtStock->execute([$sku]);
    $localStock = $stmtStock->fetch();

    // 3. Attempt live sync from OCS API for real-time accuracy
    $syncedLive = false;
    $liveStock = fetchOcsStockBySku($sku);

    if ($liveStock) {
        $syncedLive = true;
        $qtyOnHand = (int)($liveStock['QtyOnHand'] ?? 0);
        $qtyAvail = (int)($liveStock['AvailableQty'] ?? 0);
        $qtyBesar = (int)($liveStock['QtyGudangBesar'] ?? 0);
        $qtyKecil = (int)($liveStock['QtyGudangKecil'] ?? 0);
        $areaId = $liveStock['AreaId'] ?? 'Area-Utama';
        $sapCode = $liveStock['SapCode'] ?? '';
        $barcode = $rackLocation['barcode'] ?: ($liveStock['Barcode'] ?? '');
        $productName = $liveStock['Name'] ?: $rackLocation['product_name'];

        // If OCS returns 0 for Gudang Besar/Kecil specifically, derive from AvailableQty & OnHand
        if ($qtyBesar === 0 && $qtyKecil === 0 && $qtyOnHand > 0) {
            $qtyBesar = max(0, $qtyOnHand - 10);
            $qtyKecil = min($qtyOnHand, 10);
        }

        // Upsert into stock_master
        if ($localStock) {
            $update = $pdo->prepare("UPDATE stock_master SET product_name = ?, barcode = ?, area_id = ?, sap_code = ?, qty_on_hand = ?, qty_available = ?, qty_gudang_kecil = ?, qty_gudang_besar = ?, last_synced_at = CURRENT_TIMESTAMP WHERE UPPER(sku) = UPPER(?)");
            $update->execute([$productName, $barcode, $areaId, $sapCode, $qtyOnHand, $qtyAvail, $qtyKecil, $qtyBesar, $sku]);
        } else {
            $insert = $pdo->prepare("INSERT INTO stock_master (sku, barcode, product_name, area_id, sap_code, qty_on_hand, qty_available, qty_gudang_kecil, qty_gudang_besar, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)");
            $insert->execute([$sku, $barcode, $productName, $areaId, $sapCode, $qtyOnHand, $qtyAvail, $qtyKecil, $qtyBesar]);
        }

        // Re-read updated local stock
        $stmtStock->execute([$sku]);
        $localStock = $stmtStock->fetch();
    }

    // Prepare unified response
    $result = [
        'bin_code' => $rackLocation['bin_code'],
        'rack_name' => $rackLocation['rack_name'],
        'sku' => $rackLocation['sku'],
        'barcode' => $rackLocation['barcode'] ?: ($localStock['barcode'] ?? '-'),
        'product_name' => $rackLocation['product_name'] ?: ($localStock['product_name'] ?? '-'),
        'category' => $rackLocation['category'] ?? 'General',
        'qty_gudang_kecil' => (int)($localStock['qty_gudang_kecil'] ?? 0),
        'qty_gudang_besar' => (int)($localStock['qty_gudang_besar'] ?? 0),
        'qty_on_hand' => (int)($localStock['qty_on_hand'] ?? 0),
        'qty_available' => (int)($localStock['qty_available'] ?? 0),
        'sap_code' => $localStock['sap_code'] ?? '-',
        'area_id' => $localStock['area_id'] ?? 'Pusat',
        'synced_live' => $syncedLive,
        'last_synced_at' => $localStock['last_synced_at'] ?? date('Y-m-d H:i:s')
    ];

    jsonResp(['status' => 'success', 'data' => $result]);
}

// ==============================================================================
// 3. REPLENISHMENT REQUESTS (OPERATOR SUBMIT & ADMIN ACTIONS)
// ==============================================================================

if ($action === 'submit_replenish') {
    $binCode = trim($input['bin_code'] ?? '');
    $sku = trim($input['sku'] ?? '');
    $productName = trim($input['product_name'] ?? '');
    $barcode = trim($input['barcode'] ?? '');
    $qtyKecil = (int)($input['qty_gudang_kecil'] ?? 0);
    $qtyBesar = (int)($input['qty_gudang_besar'] ?? 0);
    $qtyRequest = (int)($input['qty_request'] ?? 0);
    $requestedBy = trim($input['requested_by'] ?? $_SESSION['username'] ?? 'Operator');
    $notes = trim($input['notes'] ?? '');

    if (empty($binCode) || empty($sku)) {
        jsonResp(['status' => 'error', 'message' => 'Bin Code dan SKU tidak valid.'], 400);
    }
    if ($qtyRequest <= 0) {
        jsonResp(['status' => 'error', 'message' => 'Qty Request harus lebih besar dari 0.'], 400);
    }

    // Verify stock from database
    $stmtStock = $pdo->prepare("SELECT qty_gudang_besar, qty_gudang_kecil FROM stock_master WHERE UPPER(sku) = UPPER(?)");
    $stmtStock->execute([$sku]);
    $currentStock = $stmtStock->fetch();
    if ($currentStock) {
        $qtyBesar = (int)$currentStock['qty_gudang_besar'];
        $qtyKecil = (int)$currentStock['qty_gudang_kecil'];
    }

    if ($qtyBesar <= 0) {
        jsonResp(['status' => 'error', 'message' => "Stok di Gudang Besar kosong (0 Pcs). Tidak dapat mengajukan request replenish."], 400);
    }
    if ($qtyRequest > $qtyBesar) {
        jsonResp(['status' => 'error', 'message' => "Jumlah yang diajukan ({$qtyRequest} Pcs) tidak boleh melebihi stok yang ada di Gudang Besar ({$qtyBesar} Pcs)."], 400);
    }

    $requestNo = 'REP-' . date('Ymd') . '-' . strtoupper(substr(uniqid(), -4));

    $stmt = $pdo->prepare("INSERT INTO replenish_requests (request_no, bin_code, sku, product_name, barcode, qty_gudang_kecil, qty_gudang_besar, qty_request, requested_by, status, admin_notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, CURRENT_TIMESTAMP)");
    $stmt->execute([
        $requestNo, $binCode, $sku, $productName, $barcode, $qtyKecil, $qtyBesar, $qtyRequest, $requestedBy, $notes
    ]);

    jsonResp([
        'status' => 'success',
        'message' => "Request Replenish #{$requestNo} berhasil diajukan dan menunggu persetujuan Admin.",
        'request_no' => $requestNo
    ]);
}

if ($action === 'get_replenish_requests') {
    $statusFilter = trim($input['status'] ?? '');
    $userFilter = trim($input['requested_by'] ?? '');
    $limit = (int)($input['limit'] ?? 100);

    $sql = "SELECT * FROM replenish_requests WHERE 1=1";
    $params = [];

    if (!empty($statusFilter) && $statusFilter !== 'ALL') {
        $sql .= " AND status = ?";
        $params[] = $statusFilter;
    }
    if (!empty($userFilter)) {
        $sql .= " AND requested_by = ?";
        $params[] = $userFilter;
    }

    $sql .= " ORDER BY id DESC LIMIT $limit";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    jsonResp(['status' => 'success', 'data' => $rows]);
}

if ($action === 'update_replenish_status') {
    $id = (int)($input['id'] ?? 0);
    $newStatus = strtoupper(trim($input['status'] ?? ''));
    $adminNotes = trim($input['admin_notes'] ?? '');
    $processedBy = trim($_SESSION['username'] ?? 'Admin');

    if (!$id || !in_array($newStatus, ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'])) {
        jsonResp(['status' => 'error', 'message' => 'Data status tidak valid.'], 400);
    }

    $stmt = $pdo->prepare("SELECT * FROM replenish_requests WHERE id = ?");
    $stmt->execute([$id]);
    $req = $stmt->fetch();

    if (!$req) {
        jsonResp(['status' => 'error', 'message' => 'Permintaan tidak ditemukan.'], 404);
    }

    // If marked as COMPLETED, adjust stock quantities locally
    if ($newStatus === 'COMPLETED' && $req['status'] !== 'COMPLETED') {
        $sku = $req['sku'];
        $qty = (int)$req['qty_request'];
        
        $pdo->prepare("UPDATE stock_master SET 
            qty_gudang_kecil = qty_gudang_kecil + ?,
            qty_gudang_besar = CASE WHEN qty_gudang_besar >= ? THEN qty_gudang_besar - ? ELSE 0 END,
            last_synced_at = CURRENT_TIMESTAMP
            WHERE sku = ?")->execute([$qty, $qty, $qty, $sku]);
    }

    $update = $pdo->prepare("UPDATE replenish_requests SET status = ?, admin_notes = ?, processed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    $update->execute([$newStatus, $adminNotes, $processedBy, $id]);

    jsonResp([
        'status' => 'success',
        'message' => "Permintaan #{$req['request_no']} berhasil diubah statusnya menjadi {$newStatus}."
    ]);
}

// ==============================================================================
// 4. SKU-RACK & BIN CODE MASTER (ADMIN FEATURE)
// ==============================================================================

if ($action === 'sync_sku_racks_from_ocs') {
    set_time_limit(300);
    $token = ocsApiLogin();
    if (!$token) {
        jsonResp(['status' => 'error', 'message' => 'Gagal login ke OCS Cloud API.'], 500);
    }

    // 1. Fetch Barcode Map from DTO_LookupStockDetailedData (paginated)
    $barcodeMap = ocsApiFetchBarcodeMap($token);

    // 2. Fetch all SKU-Rack items from DTO_WmsItems with pagination
    $allWmsItems = [];
    $pageSize = 100;
    $skip = 0;
    for ($page = 0; $page < 20; $page++) {
        $url = "https://ocs.iegsystem.id/odata/DTO_WmsItems?\$count=true&\$top={$pageSize}&\$skip={$skip}";
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $token, 'Accept: application/json']);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 200 || empty($res)) break;
        $json = json_decode($res, true);
        $items = $json['value'] ?? [];
        if (empty($items)) break;

        $allWmsItems = array_merge($allWmsItems, $items);
        $skip += count($items);
        if (count($items) < $pageSize) break;
    }

    if (empty($allWmsItems)) {
        jsonResp(['status' => 'error', 'message' => 'Tidak ada data SKU-Rack yang ditemukan di OCS.'], 500);
    }

    $countSaved = 0;
    $countSkipped = 0;
    $firstError = null;
    $pdo->beginTransaction();
    try {
        $stmtCheck = $pdo->prepare("SELECT id FROM sku_rack_locations WHERE UPPER(bin_code) = ? AND UPPER(sku) = ?");
        $stmtUpdate = $pdo->prepare("UPDATE sku_rack_locations SET rack_name = ?, barcode = ?, product_name = ?, category = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE UPPER(bin_code) = ? AND UPPER(sku) = ?");
        $stmtInsert = $pdo->prepare("INSERT INTO sku_rack_locations (bin_code, rack_name, sku, barcode, product_name, category, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)");

        foreach ($allWmsItems as $wItem) {
            $sku = trim($wItem['SkuId'] ?? '');
            if (empty($sku)) continue;

            $area = trim($wItem['AreaId'] ?? '') ?: 'Pusat';
            $binCode = trim($wItem['BinCode'] ?? '');
            $isMapped = $binCode !== '';
            if (!$isMapped) {
                // OCS has no physical bin for this SKU yet. A synthetic key still
                // has to exist so the row is addressable, but it must not be
                // dressed up as a real rack name.
                $binCode = 'BIN-' . $sku;
            }

            $binName = trim($wItem['BinName'] ?? '');
            if ($binName === '' || strcasecmp($binName, $binCode) === 0) {
                $binName = $isMapped ? ('Rak ' . $binCode) : ('Belum Dipetakan - Area ' . $area);
            }
            $productName = trim($wItem['SkuName'] ?? '') ?: $sku;
            $category = trim($wItem['ShopCode'] ?? '') ?: 'General';
            $barcode = $barcodeMap[strtoupper($sku)] ?? '';
            $notes = 'Area: ' . $area;

            // A single rejected row must never discard the whole batch, so each
            // upsert is isolated and only counted as skipped when it fails.
            try {
                $stmtCheck->execute([strtoupper($binCode), strtoupper($sku)]);
                if ($stmtCheck->fetch()) {
                    $stmtUpdate->execute([$binName, $barcode, $productName, $category, $notes, strtoupper($binCode), strtoupper($sku)]);
                } else {
                    $stmtInsert->execute([$binCode, $binName, $sku, $barcode, $productName, $category, $notes]);
                }
                $countSaved++;
            } catch (Exception $rowErr) {
                $countSkipped++;
                if ($firstError === null) {
                    $firstError = "{$binCode}/{$sku}: " . $rowErr->getMessage();
                }
            }
        }

        // Push the freshly mapped barcodes onto the stock cache so the
        // "Data Stok OCS" table resolves them by SKU straight away.
        $stmtBackfill = $pdo->prepare("UPDATE stock_master SET barcode = ? WHERE UPPER(sku) = ? AND (barcode IS NULL OR barcode = '')");
        $countBarcodeFilled = 0;
        foreach ($barcodeMap as $mapSku => $mapBarcode) {
            $stmtBackfill->execute([$mapBarcode, $mapSku]);
            $countBarcodeFilled += $stmtBackfill->rowCount();
        }

        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResp(['status' => 'error', 'message' => 'Gagal menyimpan ke database: ' . $e->getMessage()], 500);
    }

    $message = "Berhasil menyinkronkan {$countSaved} pemetaan Lokasi SKU-Rack dari OCS Cloud (https://ocs.iegsystem.id/master/sku-rack).";
    if ($countBarcodeFilled > 0) {
        $message .= " {$countBarcodeFilled} barcode diisikan ke Data Stok OCS.";
    }
    if ($countSkipped > 0) {
        $message .= " {$countSkipped} baris dilewati ({$firstError}).";
    }

    jsonResp([
        'status' => 'success',
        'message' => $message,
        'total_synced' => $countSaved,
        'total_skipped' => $countSkipped,
        'total_barcode_filled' => $countBarcodeFilled,
        'timestamp' => date('Y-m-d H:i:s')
    ]);
}

if ($action === 'get_sku_racks') {
    $search = trim($input['search'] ?? '');
    $sql = "SELECT * FROM sku_rack_locations";
    $params = [];

    if (!empty($search)) {
        $sql .= " WHERE bin_code LIKE ? OR sku LIKE ? OR barcode LIKE ? OR product_name LIKE ? OR rack_name LIKE ?";
        $term = "%$search%";
        $params = [$term, $term, $term, $term, $term];
    }

    $sql .= " ORDER BY bin_code ASC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $data = $stmt->fetchAll();

    jsonResp(['status' => 'success', 'data' => $data]);
}

if ($action === 'save_sku_rack') {
    $id = (int)($input['id'] ?? 0);
    $binCode = strtoupper(trim($input['bin_code'] ?? ''));
    $rackName = trim($input['rack_name'] ?? '');
    $sku = strtoupper(trim($input['sku'] ?? ''));
    $barcode = trim($input['barcode'] ?? '');
    $productName = trim($input['product_name'] ?? '');
    $category = trim($input['category'] ?? 'General');
    $notes = trim($input['notes'] ?? '');

    if (empty($binCode) || empty($sku) || empty($productName)) {
        jsonResp(['status' => 'error', 'message' => 'Bin Code, SKU, dan Nama Produk wajib diisi.'], 400);
    }

    if ($id > 0) {
        $stmt = $pdo->prepare("UPDATE sku_rack_locations SET bin_code = ?, rack_name = ?, sku = ?, barcode = ?, product_name = ?, category = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        $stmt->execute([$binCode, $rackName, $sku, $barcode, $productName, $category, $notes, $id]);
        $msg = "Lokasi Bin Code '{$binCode}' berhasil diperbarui.";
    } else {
        // Check uniqueness of (bin_code, sku)
        $check = $pdo->prepare("SELECT id FROM sku_rack_locations WHERE UPPER(bin_code) = ? AND UPPER(sku) = ?");
        $check->execute([$binCode, $sku]);
        if ($check->fetch()) {
            jsonResp(['status' => 'error', 'message' => "Pemetaan Bin Code '{$binCode}' untuk SKU '{$sku}' sudah terdaftar."], 400);
        }

        $stmt = $pdo->prepare("INSERT INTO sku_rack_locations (bin_code, rack_name, sku, barcode, product_name, category, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)");
        $stmt->execute([$binCode, $rackName, $sku, $barcode, $productName, $category, $notes]);
        $msg = "Lokasi Bin Code '{$binCode}' berhasil ditambahkan ke master SKU-Rack.";

        // Also add or sync in stock_master if not exists
        $checkStock = $pdo->prepare("SELECT id FROM stock_master WHERE UPPER(sku) = ?");
        $checkStock->execute([$sku]);
        if (!$checkStock->fetch()) {
            $insStock = $pdo->prepare("INSERT INTO stock_master (sku, barcode, product_name, category, qty_on_hand, qty_available, qty_gudang_kecil, qty_gudang_besar) VALUES (?, ?, ?, ?, 50, 50, 5, 45)");
            $insStock->execute([$sku, $barcode, $productName, $category]);
        }
    }

    jsonResp(['status' => 'success', 'message' => $msg]);
}

if ($action === 'delete_sku_rack') {
    $id = (int)($input['id'] ?? 0);
    if (!$id) jsonResp(['status' => 'error', 'message' => 'ID tidak valid.'], 400);

    $stmt = $pdo->prepare("DELETE FROM sku_rack_locations WHERE id = ?");
    $stmt->execute([$id]);

    jsonResp(['status' => 'success', 'message' => 'Data Bin Code berhasil dihapus.']);
}

// ==============================================================================
// 5. STOCK INVENTORY & FULL SYNC OCS
// ==============================================================================

if ($action === 'get_stocks') {
    $search = trim($input['search'] ?? '');

    // A SKU can sit in several bins, so the joined rack columns are aggregated:
    // a bare column under GROUP BY would pick an arbitrary row and could return
    // an empty barcode even when another bin for the same SKU carries one.
    $sql = "SELECT s.id, s.sku,
                   COALESCE(NULLIF(s.barcode, ''), NULLIF(MAX(r.barcode), ''), '-') as barcode,
                   s.product_name, s.area_id, s.sap_code, s.qty_on_hand, s.qty_available,
                   s.qty_gudang_kecil, s.qty_gudang_besar, s.is_active, s.last_synced_at,
                   MAX(r.bin_code) as bin_code, MAX(r.rack_name) as rack_name
            FROM stock_master s
            LEFT JOIN sku_rack_locations r ON UPPER(s.sku) = UPPER(r.sku)";
    $params = [];

    if (!empty($search)) {
        $sql .= " WHERE s.sku LIKE ? OR s.barcode LIKE ? OR s.product_name LIKE ? OR s.sap_code LIKE ? OR r.bin_code LIKE ? OR r.barcode LIKE ?";
        $term = "%$search%";
        $params = [$term, $term, $term, $term, $term, $term];
    }

    $sql .= " GROUP BY s.id ORDER BY s.sku ASC LIMIT 500";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    jsonResp(['status' => 'success', 'data' => $rows]);
}

if ($action === 'get_negative_stocks') {
    $search = trim($input['search'] ?? '');
    // Anything at or below the threshold counts as "minus" for the operator:
    // 0 already blocks picking, so it is surfaced next to the true negatives.
    $threshold = isset($input['threshold']) ? (int)$input['threshold'] : 0;

    $sql = "SELECT s.id, s.sku,
                   COALESCE(NULLIF(s.barcode, ''), NULLIF(MAX(r.barcode), ''), '-') as barcode,
                   s.product_name, s.area_id, s.qty_on_hand, s.qty_available,
                   s.qty_gudang_kecil, s.qty_gudang_besar, s.last_synced_at,
                   MAX(r.bin_code) as bin_code, MAX(r.rack_name) as rack_name
            FROM stock_master s
            LEFT JOIN sku_rack_locations r ON UPPER(s.sku) = UPPER(r.sku)
            WHERE s.qty_gudang_kecil <= ?";
    $params = [$threshold];

    if (!empty($search)) {
        $sql .= " AND (s.sku LIKE ? OR s.barcode LIKE ? OR s.product_name LIKE ? OR r.bin_code LIKE ?)";
        $term = "%$search%";
        array_push($params, $term, $term, $term, $term);
    }

    $sql .= " GROUP BY s.id ORDER BY s.qty_gudang_kecil ASC, s.sku ASC LIMIT 500";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $trueMinus = 0;
    foreach ($rows as $row) {
        if ((int)$row['qty_gudang_kecil'] < 0) $trueMinus++;
    }

    jsonResp([
        'status' => 'success',
        'threshold' => $threshold,
        'total_minus' => $trueMinus,
        'total_rows' => count($rows),
        'data' => $rows
    ]);
}

if ($action === 'sync_all_stock') {
    set_time_limit(300);
    $token = ocsApiLogin();
    if (!$token) {
        jsonResp(['status' => 'error', 'message' => 'Gagal login ke OCS Cloud API. Pastikan internet aktif dan kredensial valid.'], 500);
    }

    // Pre-load Barcode map from sku_rack_locations and DTO_LookupStockDetailedData.
    // DTO_WmsItemStockLiteV2 carries no Barcode field, so without this map every
    // synced row lands with an empty barcode and renders as "-" in the UI.
    $barcodeMap = [];
    try {
        $racks = $pdo->query("SELECT sku, barcode FROM sku_rack_locations WHERE barcode IS NOT NULL AND barcode != ''")->fetchAll();
        foreach ($racks as $rk) {
            $barcodeMap[strtoupper(trim($rk['sku']))] = trim($rk['barcode']);
        }
    } catch (Exception $e) {}

    // OCS is the source of truth, so it overrides anything cached locally.
    foreach (ocsApiFetchBarcodeMap($token) as $ocsSku => $ocsBarcode) {
        $barcodeMap[$ocsSku] = $ocsBarcode;
    }

    $items = ocsApiFetchAllStock($token);
    if (empty($items)) {
        jsonResp(['status' => 'error', 'message' => 'Tidak ada data stok yang dapat diunduh dari OCS.'], 500);
    }

    $countUpdated = 0;
    $driver = Database::getDriverType();
    
    // Process in chunks of 100 items for high performance
    $chunks = array_chunk($items, 100);
    
    $pdo->beginTransaction();
    try {
        if ($driver === 'mysql') {
            foreach ($chunks as $chunk) {
                $values = [];
                $placeholders = [];
                foreach ($chunk as $item) {
                    $sku = trim($item['Sku'] ?? '');
                    if (empty($sku)) continue;

                    $productName = $item['Name'] ?? '-';
                    $barcode = trim($item['Barcode'] ?? '') ?: ($barcodeMap[strtoupper($sku)] ?? '');
                    $areaId = $item['AreaId'] ?? 'Pusat';
                    $sapCode = $item['SapCode'] ?? '';
                    $qtyOnHand = (int)($item['QtyOnHand'] ?? 0);
                    $qtyAvail = (int)($item['AvailableQty'] ?? 0);
                    $qtyBesar = (int)($item['QtyGudangBesar'] ?? 0);
                    $qtyKecil = (int)($item['QtyGudangKecil'] ?? 0);

                    if ($qtyBesar === 0 && $qtyKecil === 0 && $qtyOnHand > 0) {
                        $qtyBesar = max(0, $qtyOnHand - 10);
                        $qtyKecil = min($qtyOnHand, 10);
                    }

                    $placeholders[] = "(?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)";
                    $values[] = $sku;
                    $values[] = $barcode;
                    $values[] = $productName;
                    $values[] = $areaId;
                    $values[] = $sapCode;
                    $values[] = $qtyOnHand;
                    $values[] = $qtyAvail;
                    $values[] = $qtyKecil;
                    $values[] = $qtyBesar;
                    $countUpdated++;
                }

                if (!empty($placeholders)) {
                    $sql = "INSERT INTO stock_master (sku, barcode, product_name, area_id, sap_code, qty_on_hand, qty_available, qty_gudang_kecil, qty_gudang_besar, last_synced_at) VALUES " . implode(", ", $placeholders) . " ON DUPLICATE KEY UPDATE product_name = VALUES(product_name), barcode = COALESCE(NULLIF(VALUES(barcode), ''), barcode), area_id = VALUES(area_id), sap_code = VALUES(sap_code), qty_on_hand = VALUES(qty_on_hand), qty_available = VALUES(qty_available), qty_gudang_kecil = VALUES(qty_gudang_kecil), qty_gudang_besar = VALUES(qty_gudang_besar), last_synced_at = CURRENT_TIMESTAMP";
                    $stmt = $pdo->prepare($sql);
                    $stmt->execute($values);
                }
            }
        } else {
            // SQLite upsert
            $stmtCheck = $pdo->prepare("SELECT id FROM stock_master WHERE UPPER(sku) = ?");
            $stmtUpdate = $pdo->prepare("UPDATE stock_master SET product_name = ?, barcode = COALESCE(NULLIF(?, ''), barcode), area_id = ?, sap_code = ?, qty_on_hand = ?, qty_available = ?, qty_gudang_kecil = ?, qty_gudang_besar = ?, last_synced_at = CURRENT_TIMESTAMP WHERE UPPER(sku) = ?");
            $stmtInsert = $pdo->prepare("INSERT INTO stock_master (sku, barcode, product_name, area_id, sap_code, qty_on_hand, qty_available, qty_gudang_kecil, qty_gudang_besar, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)");

            foreach ($items as $item) {
                $sku = trim($item['Sku'] ?? '');
                if (empty($sku)) continue;

                $productName = $item['Name'] ?? '-';
                $barcode = trim($item['Barcode'] ?? '') ?: ($barcodeMap[strtoupper($sku)] ?? '');
                $areaId = $item['AreaId'] ?? 'Pusat';
                $sapCode = $item['SapCode'] ?? '';
                $qtyOnHand = (int)($item['QtyOnHand'] ?? 0);
                $qtyAvail = (int)($item['AvailableQty'] ?? 0);
                $qtyBesar = (int)($item['QtyGudangBesar'] ?? 0);
                $qtyKecil = (int)($item['QtyGudangKecil'] ?? 0);

                if ($qtyBesar === 0 && $qtyKecil === 0 && $qtyOnHand > 0) {
                    $qtyBesar = max(0, $qtyOnHand - 10);
                    $qtyKecil = min($qtyOnHand, 10);
                }

                $stmtCheck->execute([strtoupper($sku)]);
                if ($stmtCheck->fetch()) {
                    $stmtUpdate->execute([$productName, $barcode, $areaId, $sapCode, $qtyOnHand, $qtyAvail, $qtyKecil, $qtyBesar, strtoupper($sku)]);
                } else {
                    $stmtInsert->execute([$sku, $barcode, $productName, $areaId, $sapCode, $qtyOnHand, $qtyAvail, $qtyKecil, $qtyBesar]);
                }
                $countUpdated++;
            }
        }
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResp(['status' => 'error', 'message' => 'Gagal menyimpan ke database: ' . $e->getMessage()], 500);
    }

    jsonResp([
        'status' => 'success',
        'message' => "Berhasil sinkronisasi {$countUpdated} data stok dari OCS Cloud ke database.",
        'total_synced' => $countUpdated,
        'timestamp' => date('Y-m-d H:i:s')
    ]);
}

// ==============================================================================
// 6. DASHBOARD STATISTICS
// ==============================================================================

if ($action === 'get_dashboard_stats') {
    $totalSku = (int)($pdo->query("SELECT COUNT(*) as cnt FROM stock_master")->fetch()['cnt'] ?? 0);
    $totalRacks = (int)($pdo->query("SELECT COUNT(*) as cnt FROM sku_rack_locations")->fetch()['cnt'] ?? 0);
    $pendingReplenish = (int)($pdo->query("SELECT COUNT(*) as cnt FROM replenish_requests WHERE status = 'PENDING'")->fetch()['cnt'] ?? 0);
    $completedReplenish = (int)($pdo->query("SELECT COUNT(*) as cnt FROM replenish_requests WHERE status = 'COMPLETED'")->fetch()['cnt'] ?? 0);
    $lowStockCount = (int)($pdo->query("SELECT COUNT(*) as cnt FROM stock_master WHERE qty_gudang_kecil <= 5")->fetch()['cnt'] ?? 0);
    $minusStockCount = (int)($pdo->query("SELECT COUNT(*) as cnt FROM stock_master WHERE qty_gudang_kecil < 0")->fetch()['cnt'] ?? 0);
    $emptyStockCount = (int)($pdo->query("SELECT COUNT(*) as cnt FROM stock_master WHERE qty_gudang_kecil = 0")->fetch()['cnt'] ?? 0);

    jsonResp([
        'status' => 'success',
        'data' => [
            'total_sku' => $totalSku,
            'total_racks' => $totalRacks,
            'pending_replenish' => $pendingReplenish,
            'completed_replenish' => $completedReplenish,
            'low_stock_count' => $lowStockCount,
            'minus_stock_count' => $minusStockCount,
            'empty_stock_count' => $emptyStockCount
        ]
    ]);
}

// ==============================================================================
// 7. USER MANAGEMENT (ADMIN)
// ==============================================================================

if ($action === 'get_users') {
    $stmt = $pdo->query("SELECT id, username, full_name, role, created_at FROM users ORDER BY role ASC, username ASC");
    jsonResp(['status' => 'success', 'data' => $stmt->fetchAll()]);
}

if ($action === 'save_user') {
    $id = (int)($input['id'] ?? 0);
    $username = trim($input['username'] ?? '');
    $fullName = trim($input['full_name'] ?? '');
    $role = trim($input['role'] ?? 'operator');
    $password = trim($input['password'] ?? '');

    if (empty($username) || empty($fullName)) {
        jsonResp(['status' => 'error', 'message' => 'Username dan nama lengkap wajib diisi.'], 400);
    }

    if ($id > 0) {
        if (!empty($password)) {
            $stmt = $pdo->prepare("UPDATE users SET username = ?, full_name = ?, role = ?, password = ? WHERE id = ?");
            $stmt->execute([$username, $fullName, $role, password_hash($password, PASSWORD_DEFAULT), $id]);
        } else {
            $stmt = $pdo->prepare("UPDATE users SET username = ?, full_name = ?, role = ? WHERE id = ?");
            $stmt->execute([$username, $fullName, $role, $id]);
        }
        $msg = "Pengguna '{$username}' berhasil diperbarui.";
    } else {
        if (empty($password)) {
            jsonResp(['status' => 'error', 'message' => 'Password wajib diisi untuk user baru.'], 400);
        }
        $check = $pdo->prepare("SELECT id FROM users WHERE username = ?");
        $check->execute([$username]);
        if ($check->fetch()) {
            jsonResp(['status' => 'error', 'message' => "Username '{$username}' sudah digunakan."], 400);
        }
        $stmt = $pdo->prepare("INSERT INTO users (username, full_name, role, password, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)");
        $stmt->execute([$username, $fullName, $role, password_hash($password, PASSWORD_DEFAULT)]);
        $msg = "Pengguna '{$username}' berhasil ditambahkan.";
    }

    jsonResp(['status' => 'success', 'message' => $msg]);
}

// Default fallback
if (empty($action)) {
    jsonResp(['status' => 'error', 'message' => 'Parameter action tidak ditemukan.'], 400);
}

// ==============================================================================
// HELPER FUNCTIONS FOR OCS API INTEGRATION
// ==============================================================================


/**
 * Builds a SKU => Barcode map from DTO_LookupStockDetailedData.
 *
 * This is the only OCS endpoint that carries barcodes: DTO_WmsItemStockLiteV2
 * (used by the stock sync) has no Barcode field at all, which is why stock rows
 * showed "-" until the map was wired in. Paginated so it never silently stops
 * at the first page the server decides to return.
 */
function ocsApiFetchBarcodeMap(string $token): array
{
    $map = [];
    $pageSize = 500;
    $skip = 0;

    for ($page = 0; $page < 40; $page++) {
        $url = "https://ocs.iegsystem.id/odata/DTO_LookupStockDetailedData?\$top={$pageSize}&\$skip={$skip}";

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $token, 'Accept: application/json']);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 200 || empty($res)) break;

        $json = json_decode($res, true);
        $items = $json['value'] ?? [];
        if (empty($items)) break;

        foreach ($items as $item) {
            $sku = strtoupper(trim($item['SellerSku'] ?? ''));
            $barcode = trim($item['Barcode'] ?? '');
            if ($sku !== '' && $barcode !== '') {
                $map[$sku] = $barcode;
            }
        }

        $skip += count($items);
        if (count($items) < $pageSize) break;
    }

    return $map;
}
function ocsApiLogin(): ?string {
    $url = 'https://ocs.iegsystem.id/Auth/Login';
    $payload = json_encode([
        'companydb' => 'EJI_WMS',
        'username' => 'ADMIN',
        'password' => 'ADMIN'
    ]);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json', 'Accept: application/json']);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $json = json_decode($response, true);
        return $json['Token'] ?? $json['token'] ?? null;
    }
    return null;
}

function fetchOcsStockBySku(string $sku): ?array {
    $token = ocsApiLogin();
    if (!$token) return null;

    $filter = rawurlencode("Sku eq '{$sku}' or SellerSku eq '{$sku}'");
    $url = "https://ocs.iegsystem.id/odata/DTO_WmsItemStockLiteV2?\$filter={$filter}&\$top=1";

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Bearer ' . $token,
        'Accept: application/json'
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $json = json_decode($response, true);
        $val = $json['value'] ?? [];
        if (!empty($val[0])) return $val[0];
    }
    return null;
}

function ocsApiFetchAllStock(string $token, callable $progressCallback = null): array {
    $allItems = [];
    $pageSize = 100;
    $skip = 0;
    $maxPages = 60; // Up to 6,000 items

    for ($page = 0; $page < $maxPages; $page++) {
        $url = "https://ocs.iegsystem.id/odata/DTO_WmsItemStockLiteV2?\$count=true&\$top={$pageSize}&\$skip={$skip}";

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . $token,
            'Accept: application/json'
        ]);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200 || empty($response)) {
            break;
        }

        $json = json_decode($response, true);
        $items = $json['value'] ?? [];
        $totalCount = $json['@odata.count'] ?? $json['count'] ?? 0;

        if (empty($items)) {
            break;
        }

        $allItems = array_merge($allItems, $items);
        $skip += count($items);

        if ($progressCallback) {
            $progressCallback(count($allItems), $totalCount);
        }

        // If we have fetched all items according to @odata.count or received less than page size
        if (($totalCount > 0 && count($allItems) >= $totalCount) || count($items) < $pageSize) {
            break;
        }
    }

    return $allItems;
}
