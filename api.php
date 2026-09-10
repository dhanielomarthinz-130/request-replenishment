<?php
/**
 * REST API Backend for OCS Stock Sync & Bin Code Replenishment System
 */

// Prevent notices/warnings from polluting JSON responses
ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_NOTICE & ~E_WARNING);

// Robust session handling with 12-hour persistence
$sessionLifetime = 12 * 60 * 60;
ini_set('session.gc_maxlifetime', (string)$sessionLifetime);
session_set_cookie_params([
    'lifetime' => $sessionLifetime,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin) {
    header("Access-Control-Allow-Origin: $origin");
    header("Access-Control-Allow-Credentials: true");
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Content-Type: application/json');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Session-Token');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . '/db.php';
$pdo = Database::getConnection();

// Helper to generate a tamper-evident session token
function generateSessionToken(array $user): string {
    $loc = $user['work_location'] ?? $user['role'] ?? 'gudang_kecil';
    $role = $user['role'] ?? 'operator';
    $payload = [
        'uid' => $user['id'],
        'u'   => $user['username'],
        'r'   => $role,
        'loc' => $loc,
        'exp' => time() + (12 * 60 * 60)
    ];
    $payload['sig'] = hash_hmac('sha256', $payload['uid'] . '|' . $payload['u'] . '|' . $payload['loc'] . '|' . $payload['exp'], 'ocs_auth_secret_2026');
    return base64_encode(json_encode($payload));
}

// Helper to verify and decode session token
function verifySessionToken(string $token): ?array {
    $raw = base64_decode($token);
    if (!$raw) return null;
    $data = json_decode($raw, true);
    if (!$data || !isset($data['uid'], $data['u'], $data['exp'], $data['sig'])) return null;
    if ($data['exp'] < time()) return null;
    $loc = $data['loc'] ?? '';
    $expected = hash_hmac('sha256', $data['uid'] . '|' . $data['u'] . '|' . $loc . '|' . $data['exp'], 'ocs_auth_secret_2026');
    return hash_equals($expected, $data['sig']) ? $data : null;
}

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

// Auto restore session from session_token if session cookie is missing or new worker
if (empty($_SESSION['username'])) {
    $token = trim($input['session_token'] ?? $_SERVER['HTTP_X_SESSION_TOKEN'] ?? '');
    if ($token) {
        $verified = verifySessionToken($token);
        if ($verified) {
            $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
            $stmt->execute([$verified['uid']]);
            $user = $stmt->fetch();
            if ($user) {
                $_SESSION['user_id'] = $user['id'];
                $_SESSION['username'] = $user['username'];
                $_SESSION['full_name'] = $user['full_name'];
                $loc = $verified['loc'] ?? $user['role'];
                $_SESSION['role'] = (in_array($user['role'], ['admin', 'superadmin'])) ? $user['role'] : ($loc ?: $user['role']);
                $_SESSION['work_location'] = $loc ?: $_SESSION['role'];
            }
        }
    }
}

// Slide session cookie expiry forward if already active
if (!empty($_SESSION['user_id'])) {
    setcookie(session_name(), session_id(), [
        'expires'  => time() + $sessionLifetime,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

// ==============================================================================
// 1. AUTHENTICATION & SESSION
// ==============================================================================

if ($action === 'login') {
    $username = trim($input['username'] ?? '');
    $password = trim($input['password'] ?? '');
    $warehouse = trim($input['warehouse'] ?? $input['work_location'] ?? '');

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

        // Determine effective role and work location
        if (in_array($user['role'], ['admin', 'superadmin'])) {
            $_SESSION['role'] = $user['role'];
            $_SESSION['work_location'] = 'admin';
        } else {
            $effectiveLoc = in_array($warehouse, ['gudang_kecil', 'gudang_besar']) 
                ? $warehouse 
                : ($user['role'] === 'gudang_besar' ? 'gudang_besar' : 'gudang_kecil');
            $_SESSION['role'] = $effectiveLoc;
            $_SESSION['work_location'] = $effectiveLoc;
        }

        setcookie(session_name(), session_id(), [
            'expires'  => time() + $sessionLifetime,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);

        $userObj = [
            'id' => $user['id'],
            'username' => $user['username'],
            'full_name' => $user['full_name'],
            'role' => $_SESSION['role'],
            'work_location' => $_SESSION['work_location']
        ];

        $sessionToken = generateSessionToken($userObj);

        jsonResp([
            'status' => 'success',
            'message' => 'Login berhasil.',
            'session_token' => $sessionToken,
            'user' => $userObj
        ]);
    } else {
        jsonResp(['status' => 'error', 'message' => 'Username atau password salah.'], 401);
    }
}

if ($action === 'check_session') {
    if (!empty($_SESSION['username'])) {
        $userObj = [
            'id' => $_SESSION['user_id'],
            'username' => $_SESSION['username'],
            'full_name' => $_SESSION['full_name'],
            'role' => $_SESSION['role'] ?? 'operator',
            'work_location' => $_SESSION['work_location'] ?? $_SESSION['role'] ?? 'gudang_kecil'
        ];
        jsonResp([
            'status' => 'success',
            'logged_in' => true,
            'session_token' => generateSessionToken($userObj),
            'user' => $userObj
        ]);
    } else {
        jsonResp(['status' => 'error', 'logged_in' => false, 'message' => 'Belum login.'], 200);
    }
}

if ($action === 'switch_work_location') {
    $targetLoc = trim($input['warehouse'] ?? $input['work_location'] ?? '');
    if (!in_array($targetLoc, ['gudang_kecil', 'gudang_besar'])) {
        jsonResp(['status' => 'error', 'message' => 'Pilihan lokasi gudang tidak valid.'], 400);
    }
    if (empty($_SESSION['username'])) {
        jsonResp(['status' => 'error', 'message' => 'Sesi login tidak aktif.'], 401);
    }

    if (!in_array($_SESSION['role'] ?? '', ['admin', 'superadmin'])) {
        $_SESSION['role'] = $targetLoc;
    }
    $_SESSION['work_location'] = $targetLoc;

    $userObj = [
        'id' => $_SESSION['user_id'],
        'username' => $_SESSION['username'],
        'full_name' => $_SESSION['full_name'],
        'role' => $_SESSION['role'],
        'work_location' => $targetLoc
    ];

    $locName = $targetLoc === 'gudang_besar' ? 'Gudang Besar (Main Storage)' : 'Gudang Kecil (Picking Rack)';
    jsonResp([
        'status' => 'success',
        'message' => "Lokasi kerja berhasil dialihkan ke {$locName}.",
        'session_token' => generateSessionToken($userObj),
        'user' => $userObj
    ]);
}

if ($action === 'logout') {
    $_SESSION = [];
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }
    @session_destroy();
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

if ($action === 'submit_replenish' || $action === 'assign_replenish_task') {
    $binCode = trim($input['bin_code'] ?? '');
    $sku = trim($input['sku'] ?? '');
    $productName = trim($input['product_name'] ?? '');
    $barcode = trim($input['barcode'] ?? '');
    $qtyKecil = (int)($input['qty_gudang_kecil'] ?? 0);
    $qtyBesar = (int)($input['qty_gudang_besar'] ?? 0);
    $qtyRequest = (int)($input['qty_request'] ?? 0);
    $requestedBy = trim($input['requested_by'] ?? $_SESSION['username'] ?? 'Operator');
    $assignedTo = trim($input['assigned_to'] ?? '');
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

    $stmt = $pdo->prepare("INSERT INTO replenish_requests (request_no, bin_code, sku, product_name, barcode, qty_gudang_kecil, qty_gudang_besar, qty_request, requested_by, assigned_to, status, admin_notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, CURRENT_TIMESTAMP)");
    $stmt->execute([
        $requestNo, $binCode, $sku, $productName, $barcode, $qtyKecil, $qtyBesar, $qtyRequest, $requestedBy, (!empty($assignedTo) ? $assignedTo : null), $notes
    ]);

    $assignMsg = !empty($assignedTo) ? " dan ditugaskan ke {$assignedTo}" : "";
    jsonResp([
        'status' => 'success',
        'message' => "Request Replenish #{$requestNo} berhasil diajukan{$assignMsg}.",
        'request_no' => $requestNo,
        'assigned_to' => $assignedTo
    ]);
}

if ($action === 'batch_assign_replenish_task') {
    $items = $input['items'] ?? [];
    $assignedTo = trim($input['assigned_to'] ?? '');
    $notes = trim($input['notes'] ?? '');
    $requestedBy = trim($_SESSION['full_name'] ?? $_SESSION['username'] ?? 'Admin');

    if (!is_array($items) || empty($items)) {
        jsonResp(['status' => 'error', 'message' => 'Tidak ada item SKU yang dipilih untuk di-assign.'], 400);
    }
    if (empty($assignedTo)) {
        jsonResp(['status' => 'error', 'message' => 'Pilih Operator Gudang Besar yang ditugaskan.'], 400);
    }

    $created = [];
    $pdo->beginTransaction();
    try {
        $insert = $pdo->prepare("INSERT INTO replenish_requests 
            (request_no, bin_code, sku, product_name, barcode, qty_gudang_kecil, qty_gudang_besar, qty_request, requested_by, assigned_to, status, admin_notes, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, CURRENT_TIMESTAMP)");

        $stockStmt = $pdo->prepare("SELECT qty_gudang_besar, qty_gudang_kecil, product_name, barcode FROM stock_master WHERE UPPER(sku) = UPPER(?)");
        $binStmt = $pdo->prepare("SELECT bin_code FROM sku_rack_locations WHERE UPPER(sku) = UPPER(?) LIMIT 1");

        foreach ($items as $idx => $item) {
            $sku = trim($item['sku'] ?? '');
            if (empty($sku)) continue;

            $stockStmt->execute([$sku]);
            $stock = $stockStmt->fetch();

            $qtyKecil = $stock ? (int)$stock['qty_gudang_kecil'] : (int)($item['qty_gudang_kecil'] ?? 0);
            $qtyBesar = $stock ? (int)$stock['qty_gudang_besar'] : (int)($item['qty_gudang_besar'] ?? 0);
            $prodName = $stock ? $stock['product_name'] : ($item['product_name'] ?? $sku);
            $barcode = $stock ? $stock['barcode'] : ($item['barcode'] ?? '');

            $binCode = trim($item['bin_code'] ?? '');
            if (empty($binCode) || strpos($binCode, 'BIN-') === 0) {
                $binStmt->execute([$sku]);
                $binRow = $binStmt->fetch();
                if ($binRow && !empty($binRow['bin_code'])) {
                    $binCode = $binRow['bin_code'];
                } else if (empty($binCode)) {
                    $binCode = 'BIN-' . $sku;
                }
            }

            $qtyReq = (int)($item['qty_request'] ?? 0);
            if ($qtyReq <= 0) {
                if ($qtyKecil < 0) {
                    $qtyReq = abs($qtyKecil) + 5;
                } else {
                    $qtyReq = 10;
                }
            }
            if ($qtyBesar > 0 && $qtyReq > $qtyBesar) {
                $qtyReq = $qtyBesar;
            }

            $requestNo = 'REP-' . date('Ymd') . '-' . strtoupper(substr(uniqid(), -4)) . ($idx + 1);
            $itemNote = !empty($notes) ? $notes : ($qtyKecil < 0 ? "Stok minus {$qtyKecil} Pcs di rak Gudang Kecil, mohon segera direplenish." : "Replenish stok Gudang Kecil");

            $insert->execute([
                $requestNo, $binCode, $sku, $prodName, $barcode, $qtyKecil, $qtyBesar, $qtyReq, $requestedBy, $assignedTo, $itemNote
            ]);

            $created[] = [
                'request_no' => $requestNo,
                'sku' => $sku,
                'qty_request' => $qtyReq,
                'assigned_to' => $assignedTo
            ];
        }

        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResp(['status' => 'error', 'message' => 'Gagal menyimpan batch penugasan: ' . $e->getMessage()], 500);
    }

    $count = count($created);
    jsonResp([
        'status' => 'success',
        'message' => "Berhasil menugaskan {$count} SKU ke Operator Gudang Besar ({$assignedTo}).",
        'total_assigned' => $count,
        'assigned_to' => $assignedTo,
        'data' => $created
    ]);
}

if ($action === 'get_replenish_requests') {
    $statusFilter = trim($input['status'] ?? '');
    $userFilter = trim($input['requested_by'] ?? '');
    $today = !empty($input['today']) && ($input['today'] === '1' || $input['today'] === 'true');
    $limit = (int)($input['limit'] ?? 100);

    $sql = "SELECT r.*, COALESCE(NULLIF(r.qty_gudang_besar, 0), sm.qty_gudang_besar, 0) AS qty_gudang_besar 
            FROM replenish_requests r 
            LEFT JOIN stock_master sm ON UPPER(r.sku) = UPPER(sm.sku) 
            WHERE 1=1";
    $params = [];

    if (!empty($statusFilter) && $statusFilter !== 'ALL') {
        $sql .= " AND r.status = ?";
        $params[] = $statusFilter;
    }
    if (!empty($userFilter)) {
        $sql .= " AND r.requested_by = ?";
        $params[] = $userFilter;
    }
    if ($today) {
        $sql .= " AND (DATE(r.created_at) = ? OR DATE(r.picked_at) = ?)";
        $params[] = date('Y-m-d');
        $params[] = date('Y-m-d');
    }

    $sql .= " ORDER BY r.id DESC LIMIT $limit";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    jsonResp(['status' => 'success', 'data' => $rows]);
}

if ($action === 'update_replenish_status') {
    $id = (int)($input['id'] ?? 0);
    $newStatus = strtoupper(trim($input['status'] ?? ''));
    $adminNotes = trim($input['admin_notes'] ?? '');
    $processedBy = trim($_SESSION['full_name'] ?? $_SESSION['username'] ?? 'Admin');

    if (!$id || !in_array($newStatus, ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'])) {
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

if ($action === 'edit_replenish_request') {
    $id = (int)($input['id'] ?? 0);
    $qtyRequest = (int)($input['qty_request'] ?? 0);
    $notes = trim($input['admin_notes'] ?? $input['notes'] ?? '');

    if (!$id || $qtyRequest <= 0) {
        jsonResp(['status' => 'error', 'message' => 'ID dan Qty Request harus lebih besar dari 0.'], 400);
    }

    $stmt = $pdo->prepare("SELECT * FROM replenish_requests WHERE id = ?");
    $stmt->execute([$id]);
    $req = $stmt->fetch();

    if (!$req) {
        jsonResp(['status' => 'error', 'message' => 'Permintaan replenish tidak ditemukan.'], 404);
    }

    if ($req['status'] === 'COMPLETED') {
        jsonResp(['status' => 'error', 'message' => 'Permintaan yang sudah selesai (COMPLETED) tidak dapat diedit.'], 400);
    }

    // Check Gudang Besar capacity
    $sku = $req['sku'];
    $stmtStock = $pdo->prepare("SELECT qty_gudang_besar FROM stock_master WHERE UPPER(sku) = UPPER(?)");
    $stmtStock->execute([$sku]);
    $stock = $stmtStock->fetch();
    $qtyBesar = $stock ? (int)$stock['qty_gudang_besar'] : (int)$req['qty_gudang_besar'];

    if ($qtyRequest > $qtyBesar && $qtyBesar > 0) {
        jsonResp(['status' => 'error', 'message' => "Qty request ({$qtyRequest} Pcs) melebihi stok Gudang Besar ({$qtyBesar} Pcs)."], 400);
    }

    $update = $pdo->prepare("UPDATE replenish_requests SET qty_request = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    $update->execute([$qtyRequest, $notes, $id]);

    jsonResp([
        'status' => 'success',
        'message' => "Permintaan #{$req['request_no']} berhasil diperbarui (Qty: {$qtyRequest} Pcs).",
        'id' => $id,
        'qty_request' => $qtyRequest,
        'admin_notes' => $notes
    ]);
}

if ($action === 'cancel_replenish_request') {
    $id = (int)($input['id'] ?? 0);
    $reason = trim($input['reason'] ?? $input['admin_notes'] ?? 'Dibatalkan oleh Admin');
    $processedBy = trim($_SESSION['full_name'] ?? $_SESSION['username'] ?? 'Admin');

    if (!$id) {
        jsonResp(['status' => 'error', 'message' => 'ID permintaan tidak valid.'], 400);
    }

    $stmt = $pdo->prepare("SELECT * FROM replenish_requests WHERE id = ?");
    $stmt->execute([$id]);
    $req = $stmt->fetch();

    if (!$req) {
        jsonResp(['status' => 'error', 'message' => 'Permintaan replenish tidak ditemukan.'], 404);
    }

    if ($req['status'] === 'CANCELLED') {
        jsonResp(['status' => 'error', 'message' => "Permintaan #{$req['request_no']} sudah dibatalkan sebelumnya."], 400);
    }

    // If request was completed, revert stock quantities locally
    if ($req['status'] === 'COMPLETED') {
        $sku = $req['sku'];
        $qty = (int)($req['picked_qty'] ?? $req['qty_request']);
        $pdo->prepare("UPDATE stock_master SET 
            qty_gudang_kecil = CASE WHEN qty_gudang_kecil >= ? THEN qty_gudang_kecil - ? ELSE 0 END,
            qty_gudang_besar = qty_gudang_besar + ?,
            last_synced_at = CURRENT_TIMESTAMP
            WHERE sku = ?")->execute([$qty, $qty, $qty, $sku]);
    }

    $cancelNote = !empty($req['admin_notes']) ? ($req['admin_notes'] . " | Cancel: " . $reason) : ("Cancel: " . $reason);
    $update = $pdo->prepare("UPDATE replenish_requests SET status = 'CANCELLED', admin_notes = ?, processed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    $update->execute([$cancelNote, $processedBy, $id]);

    jsonResp([
        'status' => 'success',
        'message' => "Permintaan #{$req['request_no']} berhasil DIBATALKAN.",
        'id' => $id,
        'new_status' => 'CANCELLED'
    ]);
}

if ($action === 'delete_replenish_request') {
    $id = (int)($input['id'] ?? 0);
    if (!$id) {
        jsonResp(['status' => 'error', 'message' => 'ID permintaan tidak valid.'], 400);
    }

    $stmt = $pdo->prepare("SELECT id, request_no FROM replenish_requests WHERE id = ?");
    $stmt->execute([$id]);
    $req = $stmt->fetch();

    if (!$req) {
        jsonResp(['status' => 'error', 'message' => 'Permintaan replenish tidak ditemukan.'], 404);
    }

    $del = $pdo->prepare("DELETE FROM replenish_requests WHERE id = ?");
    $del->execute([$id]);

    jsonResp([
        'status' => 'success',
        'message' => "Permintaan #{$req['request_no']} berhasil dihapus.",
        'id' => $id
    ]);
}

if ($action === 'toggle_cut_stock') {
    $id = (int)($input['id'] ?? 0);
    $type = strtolower(trim($input['type'] ?? '')); // 'ocs' or 'wms'
    $status = isset($input['status']) ? (int)$input['status'] : null;

    if (!$id || !in_array($type, ['ocs', 'wms'])) {
        jsonResp(['status' => 'error', 'message' => 'Parameter tidak valid. Diperlukan id dan type (ocs/wms).'], 400);
    }

    $stmt = $pdo->prepare("SELECT id, request_no, done_ocs, done_wms FROM replenish_requests WHERE id = ?");
    $stmt->execute([$id]);
    $req = $stmt->fetch();

    if (!$req) {
        jsonResp(['status' => 'error', 'message' => 'Data permintaan replenish tidak ditemukan.'], 404);
    }

    $col = $type === 'ocs' ? 'done_ocs' : 'done_wms';
    $timeCol = $type === 'ocs' ? 'done_ocs_at' : 'done_wms_at';

    $currentVal = (int)($req[$col] ?? 0);
    $newVal = ($status !== null) ? ($status ? 1 : 0) : ($currentVal ? 0 : 1);
    $timeVal = $newVal ? date('Y-m-d H:i:s') : null;

    $updateSql = "UPDATE replenish_requests SET {$col} = ?, {$timeCol} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    $stmtUpd = $pdo->prepare($updateSql);
    $stmtUpd->execute([$newVal, $timeVal, $id]);

    $typeLabel = strtoupper($type);
    $statusText = $newVal ? "Sudah Potong Stok ({$typeLabel})" : "Belum Potong Stok ({$typeLabel})";

    jsonResp([
        'status' => 'success',
        'message' => "Status {$typeLabel} untuk #{$req['request_no']} berhasil diubah: {$statusText}.",
        'id' => $id,
        'type' => $type,
        'new_status' => $newVal,
        'done_ocs' => ($type === 'ocs' ? $newVal : (int)$req['done_ocs']),
        'done_wms' => ($type === 'wms' ? $newVal : (int)$req['done_wms'])
    ]);
}

if ($action === 'batch_complete_replenish') {
    $ids = $input['ids'] ?? [];
    $actionType = trim($input['action_type'] ?? 'complete_and_cut'); // 'complete_and_cut', 'done_ocs', 'done_wms'
    $processedBy = trim($_SESSION['full_name'] ?? $_SESSION['username'] ?? 'Admin');

    if (!is_array($ids) || empty($ids)) {
        jsonResp(['status' => 'error', 'message' => 'Pilih setidaknya 1 permohonan replenish.'], 400);
    }

    $sanitizedIds = array_values(array_unique(array_filter(array_map('intval', $ids))));
    if (empty($sanitizedIds)) {
        jsonResp(['status' => 'error', 'message' => 'ID permintaan tidak valid.'], 400);
    }

    $pdo->beginTransaction();
    try {
        $placeholders = implode(',', array_fill(0, count($sanitizedIds), '?'));

        if ($actionType === 'done_ocs') {
            $stmt = $pdo->prepare("UPDATE replenish_requests SET done_ocs = 1, done_ocs_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id IN ($placeholders)");
            $stmt->execute($sanitizedIds);
            $msg = "Berhasil menandai Done OCS untuk " . count($sanitizedIds) . " permintaan replenish.";
        } elseif ($actionType === 'done_wms') {
            $stmt = $pdo->prepare("UPDATE replenish_requests SET done_wms = 1, done_wms_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id IN ($placeholders)");
            $stmt->execute($sanitizedIds);
            $msg = "Berhasil menandai Done WMS untuk " . count($sanitizedIds) . " permintaan replenish.";
        } else {
            // 'complete_and_cut': mark COMPLETED + done_ocs=1 + done_wms=1 + adjust stock
            $fetchStmt = $pdo->prepare("SELECT id, sku, qty_request, status FROM replenish_requests WHERE id IN ($placeholders)");
            $fetchStmt->execute($sanitizedIds);
            $reqs = $fetchStmt->fetchAll();

            $stockUpdate = $pdo->prepare("UPDATE stock_master SET 
                qty_gudang_kecil = qty_gudang_kecil + ?,
                qty_gudang_besar = CASE WHEN qty_gudang_besar >= ? THEN qty_gudang_besar - ? ELSE 0 END,
                last_synced_at = CURRENT_TIMESTAMP
                WHERE UPPER(sku) = UPPER(?)");

            foreach ($reqs as $rq) {
                if ($rq['status'] !== 'COMPLETED') {
                    $qty = (int)$rq['qty_request'];
                    $stockUpdate->execute([$qty, $qty, $qty, $rq['sku']]);
                }
            }

            $updateStmt = $pdo->prepare("UPDATE replenish_requests SET 
                status = 'COMPLETED',
                done_ocs = 1,
                done_wms = 1,
                done_ocs_at = COALESCE(done_ocs_at, CURRENT_TIMESTAMP),
                done_wms_at = COALESCE(done_wms_at, CURRENT_TIMESTAMP),
                picked_at = COALESCE(picked_at, CURRENT_TIMESTAMP),
                processed_by = ?,
                updated_at = CURRENT_TIMESTAMP
                WHERE id IN ($placeholders)");
            $updateParams = array_merge([$processedBy], $sanitizedIds);
            $updateStmt->execute($updateParams);

            $msg = "Berhasil menyelesaikan & memotong stok (" . count($sanitizedIds) . " permintaan bertanda Selesai, Done OCS & Done WMS).";
        }

        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResp(['status' => 'error', 'message' => 'Gagal memproses batch: ' . $e->getMessage()], 500);
    }

    jsonResp([
        'status' => 'success',
        'message' => $msg,
        'action_type' => $actionType,
        'total_processed' => count($sanitizedIds)
    ]);
}

// ==============================================================================
// 3B. TASK PICK FOR OPERATOR GUDANG BESAR
// ==============================================================================

if ($action === 'complete_pick_task') {
    $id = (int)($input['id'] ?? 0);
    $rackGudangBesar = trim($input['rack_gudang_besar'] ?? '');
    $batchNumber = trim($input['batch_number'] ?? '');
    $pickedQty = (int)($input['picked_qty'] ?? 0);
    $notes = trim($input['notes'] ?? '');
    $pickedBy = trim($_SESSION['full_name'] ?? $_SESSION['username'] ?? ($input['picked_by'] ?? 'Operator Gudang Besar'));

    if (!$id) {
        jsonResp(['status' => 'error', 'message' => 'ID Task Replenish tidak valid.'], 400);
    }
    if (empty($rackGudangBesar)) {
        jsonResp(['status' => 'error', 'message' => 'Lokasi Rack Gudang Besar wajib diisi.'], 400);
    }
    if (empty($batchNumber)) {
        jsonResp(['status' => 'error', 'message' => 'Batch Number barang wajib diisi.'], 400);
    }

    $stmt = $pdo->prepare("SELECT * FROM replenish_requests WHERE id = ?");
    $stmt->execute([$id]);
    $req = $stmt->fetch();

    if (!$req) {
        jsonResp(['status' => 'error', 'message' => 'Permintaan task tidak ditemukan.'], 404);
    }
    if ($req['status'] === 'COMPLETED') {
        jsonResp(['status' => 'error', 'message' => "Task #{$req['request_no']} sudah selesai di-pick sebelumnya."], 400);
    }

    if ($pickedQty <= 0) {
        $pickedQty = (int)$req['qty_request'];
    }

    // Cek stok gudang besar saat ini
    $sku = $req['sku'];
    $stmtStock = $pdo->prepare("SELECT qty_gudang_besar, qty_gudang_kecil FROM stock_master WHERE UPPER(sku) = UPPER(?)");
    $stmtStock->execute([$sku]);
    $currentStock = $stmtStock->fetch();

    $qtyBesar = $currentStock ? (int)$currentStock['qty_gudang_besar'] : 0;
    if ($qtyBesar < $pickedQty) {
        jsonResp(['status' => 'error', 'message' => "Stok Gudang Besar tidak cukup ({$qtyBesar} Pcs tersedia, ingin pick {$pickedQty} Pcs)."], 400);
    }

    // Mutasi stok lokal: kurangi Gudang Besar, tambahkan Gudang Kecil
    $pdo->prepare("UPDATE stock_master SET 
        qty_gudang_besar = CASE WHEN qty_gudang_besar >= ? THEN qty_gudang_besar - ? ELSE 0 END,
        qty_gudang_kecil = qty_gudang_kecil + ?,
        last_synced_at = CURRENT_TIMESTAMP
        WHERE UPPER(sku) = UPPER(?)")->execute([$pickedQty, $pickedQty, $pickedQty, $sku]);

    // Update data task replenish
    $updateStmt = $pdo->prepare("UPDATE replenish_requests SET 
        status = 'COMPLETED',
        rack_gudang_besar = ?,
        batch_number = ?,
        picked_qty = ?,
        picked_by = ?,
        picked_at = CURRENT_TIMESTAMP,
        admin_notes = CASE WHEN ? != '' THEN ? ELSE admin_notes END,
        processed_by = ?,
        updated_at = CURRENT_TIMESTAMP
        WHERE id = ?");
    $updateStmt->execute([
        $rackGudangBesar,
        $batchNumber,
        $pickedQty,
        $pickedBy,
        $notes,
        $notes,
        $pickedBy,
        $id
    ]);

    jsonResp([
        'status' => 'success',
        'message' => "Task Pick #{$req['request_no']} BERHASIL diselesaikan! Barang telah diambil dari Rak {$rackGudangBesar} (Batch: {$batchNumber}) dan ditransfer ke Gudang Kecil.",
        'request_no' => $req['request_no'],
        'rack_gudang_besar' => $rackGudangBesar,
        'batch_number' => $batchNumber,
        'picked_qty' => $pickedQty
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
    $pageSize = 1000;
    $skip = 0;
    for ($page = 0; $page < 10; $page++) {
        $url = "https://ocs.iegsystem.id/odata/DTO_WmsItems?\$count=true&\$top={$pageSize}&\$skip={$skip}";
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $token, 'Accept: application/json']);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 25);
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
    $assignedFilter = strtoupper(trim($input['assigned_filter'] ?? 'ALL'));

    $sql = "SELECT s.id, s.sku,
                   COALESCE(NULLIF(s.barcode, ''), NULLIF(MAX(r.barcode), ''), '-') as barcode,
                   s.product_name, s.area_id, s.qty_on_hand, s.qty_available,
                   s.qty_gudang_kecil, s.qty_gudang_besar, s.last_synced_at,
                   MAX(r.bin_code) as bin_code, MAX(r.rack_name) as rack_name,
                   MAX(CASE WHEN req.status IN ('PENDING', 'APPROVED') AND req.assigned_to IS NOT NULL AND req.assigned_to != '' THEN req.assigned_to ELSE NULL END) as active_assigned_to,
                   MAX(CASE WHEN req.status IN ('PENDING', 'APPROVED') AND req.assigned_to IS NOT NULL AND req.assigned_to != '' THEN req.request_no ELSE NULL END) as active_request_no
            FROM stock_master s
            LEFT JOIN sku_rack_locations r ON UPPER(s.sku) = UPPER(r.sku)
            LEFT JOIN replenish_requests req ON UPPER(s.sku) = UPPER(req.sku) AND req.status IN ('PENDING', 'APPROVED')
            WHERE s.qty_gudang_kecil <= ?";
    $params = [$threshold];

    if (!empty($search)) {
        $sql .= " AND (s.sku LIKE ? OR s.barcode LIKE ? OR s.product_name LIKE ? OR r.bin_code LIKE ?)";
        $term = "%$search%";
        array_push($params, $term, $term, $term, $term);
    }

    $sql .= " GROUP BY s.id, s.sku";

    if ($assignedFilter === 'ASSIGNED') {
        $sql .= " HAVING active_assigned_to IS NOT NULL";
    } elseif ($assignedFilter === 'UNASSIGNED') {
        $sql .= " HAVING active_assigned_to IS NULL";
    }

    $sql .= " ORDER BY s.qty_gudang_kecil ASC, s.sku ASC LIMIT 500";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $trueMinus = 0;
    $totalAssigned = 0;
    $totalUnassigned = 0;
    foreach ($rows as $row) {
        if ((int)$row['qty_gudang_kecil'] < 0) $trueMinus++;
        if (!empty($row['active_assigned_to'])) $totalAssigned++;
        else $totalUnassigned++;
    }

    jsonResp([
        'status' => 'success',
        'threshold' => $threshold,
        'assigned_filter' => $assignedFilter,
        'total_minus' => $trueMinus,
        'total_assigned' => $totalAssigned,
        'total_unassigned' => $totalUnassigned,
        'total_rows' => count($rows),
        'data' => $rows
    ]);
}

function ocsUpsertStockItems(PDO $pdo, array $items, array $barcodeMap = []): int {
    if (empty($items)) return 0;
    $countUpdated = 0;
    $driver = Database::getDriverType();

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
        throw $e;
    }
    return $countUpdated;
}

function recordLastOcsSync(PDO $pdo, ?string $time = null): string {
    $nowStr = $time ?: date('Y-m-d H:i:s');
    try {
        if (Database::getDriverType() === 'mysql') {
            $pdo->prepare("INSERT INTO system_settings (key_name, key_value, updated_at) VALUES ('last_ocs_sync', ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value), updated_at = CURRENT_TIMESTAMP")->execute([$nowStr]);
        } else {
            $pdo->prepare("INSERT OR REPLACE INTO system_settings (key_name, key_value, updated_at) VALUES ('last_ocs_sync', ?, CURRENT_TIMESTAMP)")->execute([$nowStr]);
        }
    } catch (Throwable $e) {}
    return $nowStr;
}

function getLastOcsSync(PDO $pdo): ?string {
    try {
        $st = $pdo->query("SELECT key_value FROM system_settings WHERE key_name = 'last_ocs_sync'");
        $r = $st->fetch();
        if ($r && !empty($r['key_value'])) {
            return $r['key_value'];
        }
    } catch (Throwable $e) {}

    try {
        $st = $pdo->query("SELECT MAX(last_synced_at) as last_sync FROM stock_master");
        $r = $st->fetch();
        if ($r && !empty($r['last_sync'])) {
            return $r['last_sync'];
        }
    } catch (Throwable $e) {}

    return null;
}

// ------------------------------------------------------------------------------
// MODULAR / PROGRESS-BASED SYNC ACTIONS
// ------------------------------------------------------------------------------

if ($action === 'sync_init') {
    @set_time_limit(60);
    $token = ocsApiLogin();
    if (!$token) {
        jsonResp(['status' => 'error', 'message' => 'Gagal login ke OCS Cloud API. Periksa koneksi internet.'], 500);
    }

    // Hitung total stok cepat
    $ch = curl_init('https://ocs.iegsystem.id/odata/DTO_WmsItemStockLiteV2?$count=true&$top=1');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Accept: application/json'],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => 15
    ]);
    $resStock = curl_exec($ch);
    curl_close($ch);
    $jStock = json_decode($resStock, true);
    $totalStock = (int)($jStock['@odata.count'] ?? $jStock['count'] ?? 0);

    // Hitung total rak cepat
    $ch2 = curl_init('https://ocs.iegsystem.id/odata/DTO_WmsItems?$count=true&$top=1');
    curl_setopt_array($ch2, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Accept: application/json'],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => 15
    ]);
    $resRacks = curl_exec($ch2);
    curl_close($ch2);
    $jRacks = json_decode($resRacks, true);
    $totalRacks = (int)($jRacks['@odata.count'] ?? $jRacks['count'] ?? 0);

    jsonResp([
        'status' => 'success',
        'token' => $token,
        'total_stock' => $totalStock ?: 2525,
        'total_racks' => $totalRacks ?: 684,
        'page_size' => 1000
    ]);
}

if ($action === 'sync_sku_racks_step') {
    @set_time_limit(240);
    @ignore_user_abort(true);
    $token = trim($input['token'] ?? $_GET['token'] ?? '') ?: ocsApiLogin();
    if (!$token) {
        jsonResp(['status' => 'error', 'message' => 'Sesi OCS tidak valid.'], 401);
    }

    $barcodeMap = ocsApiFetchBarcodeMap($token);

    $allWmsItems = [];
    $pageSize = 1000;
    $skip = 0;
    for ($page = 0; $page < 5; $page++) {
        $url = "https://ocs.iegsystem.id/odata/DTO_WmsItems?\$count=true&\$top={$pageSize}&\$skip={$skip}";
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Accept: application/json'],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_TIMEOUT => 15
        ]);
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
            }
        }

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

    jsonResp([
        'status' => 'success',
        'message' => "Berhasil menyinkronkan {$countSaved} lokasi rak & barcode.",
        'total_synced' => $countSaved,
        'barcode_filled' => $countBarcodeFilled
    ]);
}

if ($action === 'sync_stock_step') {
    @set_time_limit(240);
    @ignore_user_abort(true);
    $token = trim($input['token'] ?? $_GET['token'] ?? '') ?: ocsApiLogin();
    if (!$token) {
        jsonResp(['status' => 'error', 'message' => 'Sesi OCS tidak valid.'], 401);
    }

    $skip = (int)($input['skip'] ?? $_GET['skip'] ?? 0);
    $top = (int)($input['top'] ?? $_GET['top'] ?? 1000);
    if ($top <= 0 || $top > 1000) $top = 1000;

    $url = "https://ocs.iegsystem.id/odata/DTO_WmsItemStockLiteV2?\$count=true&\$top={$top}&\$skip={$skip}";
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Accept: application/json'],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 8
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || empty($response)) {
        jsonResp(['status' => 'error', 'message' => 'Gagal mengambil data stok dari OCS (HTTP ' . $httpCode . ')'], 500);
    }

    $json = json_decode($response, true);
    $items = $json['value'] ?? [];
    $totalCount = (int)($json['@odata.count'] ?? $json['count'] ?? 0);

    $barcodeMap = [];
    try {
        $racks = $pdo->query("SELECT sku, barcode FROM sku_rack_locations WHERE barcode IS NOT NULL AND barcode != ''")->fetchAll();
        foreach ($racks as $rk) {
            $barcodeMap[strtoupper(trim($rk['sku']))] = trim($rk['barcode']);
        }
    } catch (Exception $e) {}

    try {
        $countUpdated = ocsUpsertStockItems($pdo, $items, $barcodeMap);
    } catch (Exception $e) {
        jsonResp(['status' => 'error', 'message' => 'Gagal menyimpan stok ke database: ' . $e->getMessage()], 500);
    }

    $nextSkip = $skip + count($items);
    $hasMore = !empty($items) && ($totalCount > 0 ? ($nextSkip < $totalCount) : (count($items) >= $top));

    $lastSyncTime = null;
    if (!$hasMore) {
        $lastSyncTime = recordLastOcsSync($pdo);
    }

    jsonResp([
        'status' => 'success',
        'batch_count' => count($items),
        'total_synced' => $countUpdated,
        'skip' => $skip,
        'next_skip' => $nextSkip,
        'total_count' => $totalCount,
        'has_more' => $hasMore,
        'last_synced_at' => $lastSyncTime
    ]);
}

if ($action === 'sync_all_stock') {
    @set_time_limit(300);
    $token = ocsApiLogin();
    if (!$token) {
        jsonResp(['status' => 'error', 'message' => 'Gagal login ke OCS Cloud API. Pastikan internet aktif dan kredensial valid.'], 500);
    }

    $barcodeMap = [];
    try {
        $racks = $pdo->query("SELECT sku, barcode FROM sku_rack_locations WHERE barcode IS NOT NULL AND barcode != ''")->fetchAll();
        foreach ($racks as $rk) {
            $barcodeMap[strtoupper(trim($rk['sku']))] = trim($rk['barcode']);
        }
    } catch (Exception $e) {}

    if (empty($barcodeMap)) {
        foreach (ocsApiFetchBarcodeMap($token) as $ocsSku => $ocsBarcode) {
            $barcodeMap[$ocsSku] = $ocsBarcode;
        }
    }

    $items = ocsApiFetchAllStock($token);
    if (empty($items)) {
        jsonResp(['status' => 'error', 'message' => 'Tidak ada data stok yang dapat diunduh dari OCS.'], 500);
    }

    try {
        $countUpdated = ocsUpsertStockItems($pdo, $items, $barcodeMap);
    } catch (Exception $e) {
        jsonResp(['status' => 'error', 'message' => 'Gagal menyimpan ke database: ' . $e->getMessage()], 500);
    }

    $lastSyncTime = recordLastOcsSync($pdo);

    jsonResp([
        'status' => 'success',
        'message' => "Berhasil sinkronisasi {$countUpdated} data stok dari OCS Cloud ke database.",
        'total_synced' => $countUpdated,
        'last_synced_at' => $lastSyncTime,
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

    $lastSync = getLastOcsSync($pdo);

    jsonResp([
        'status' => 'success',
        'data' => [
            'total_sku' => $totalSku,
            'total_racks' => $totalRacks,
            'pending_replenish' => $pendingReplenish,
            'completed_replenish' => $completedReplenish,
            'low_stock_count' => $lowStockCount,
            'minus_stock_count' => $minusStockCount,
            'empty_stock_count' => $emptyStockCount,
            'last_synced_at' => $lastSync
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

if ($action === 'delete_user') {
    $id = (int)($input['id'] ?? 0);
    if (!$id) {
        jsonResp(['status' => 'error', 'message' => 'ID user tidak valid.'], 400);
    }

    $stmt = $pdo->prepare("SELECT id, username, role FROM users WHERE id = ?");
    $stmt->execute([$id]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonResp(['status' => 'error', 'message' => 'User tidak ditemukan.'], 404);
    }

    if (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === $id) {
        jsonResp(['status' => 'error', 'message' => 'Tidak dapat menghapus akun yang sedang Anda gunakan.'], 400);
    }

    $del = $pdo->prepare("DELETE FROM users WHERE id = ?");
    $del->execute([$id]);

    jsonResp(['status' => 'success', 'message' => "Pengguna '{$user['username']}' berhasil dihapus."]);
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
    $pageSize = 1000;
    $skip = 0;

    for ($page = 0; $page < 3; $page++) {
        $url = "https://ocs.iegsystem.id/odata/DTO_LookupStockDetailedData?\$top={$pageSize}&\$skip={$skip}";

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Accept: application/json'],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_CONNECTTIMEOUT => 5
        ]);
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
    $pageSize = 1000;
    $skip = 0;
    $maxPages = 10; // Up to 10,000 items

    for ($page = 0; $page < $maxPages; $page++) {
        $url = "https://ocs.iegsystem.id/odata/DTO_WmsItemStockLiteV2?\$count=true&\$top={$pageSize}&\$skip={$skip}";

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . $token,
            'Accept: application/json'
        ]);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);

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
