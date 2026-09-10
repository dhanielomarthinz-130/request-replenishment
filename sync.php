<?php
if (function_exists('date_default_timezone_set')) {
    date_default_timezone_set('Asia/Jakarta');
}
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$action = $_GET['action'] ?? $_POST['action'] ?? 'sync';

if ($action === 'test_login') {
    $db = $_POST['companydb'] ?? 'EJI_WMS';
    $user = $_POST['username'] ?? 'ADMIN';
    $pass = $_POST['password'] ?? 'ADMIN';
    
    $token = ocsLogin($db, $user, $pass);
    if ($token) {
        echo json_encode(['status' => 'success', 'token' => $token]);
    } else {
        echo json_encode(['status' => 'error', 'message' => 'Gagal login ke OCS system']);
    }
    exit;
}

if ($action === 'sync') {
    $db = $_POST['companydb'] ?? 'EJI_WMS';
    $user = $_POST['username'] ?? 'ADMIN';
    $pass = $_POST['password'] ?? 'ADMIN';
    $webAppUrl = $_POST['webapp_url'] ?? '';

    // Step 1: Login
    $token = ocsLogin($db, $user, $pass);
    if (!$token) {
        echo json_encode(['status' => 'error', 'message' => 'Gagal Otentikasi/Login ke OCS system.']);
        exit;
    }

    // Step 2: Fetch Stock
    $stockItems = ocsFetchStock($token);
    if (empty($stockItems)) {
        echo json_encode(['status' => 'error', 'message' => 'Gagal mengambil data stok dari OCS.']);
        exit;
    }

    // If Web App URL is provided, push to Google Apps Script
    $googleResponse = null;
    if (!empty($webAppUrl)) {
        $googleResponse = pushToGoogleAppsScript($webAppUrl, $stockItems);
    }

    echo json_encode([
        'status' => 'success',
        'total_items' => count($stockItems),
        'pushed_to_google' => !empty($webAppUrl),
        'google_response' => $googleResponse,
        'items' => array_slice($stockItems, 0, 100), // Preview 100 items
        'timestamp' => date('Y-m-d H:i:s')
    ]);
    exit;
}

function ocsLogin($companydb, $username, $password) {
    $url = 'https://ocs.iegsystem.id/Auth/Login';
    $payload = json_encode([
        'companydb' => $companydb,
        'username' => $username,
        'password' => $password
    ]);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Accept: application/json'
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $json = json_decode($response, true);
        return $json['Token'] ?? $json['token'] ?? null;
    }
    return null;
}

function ocsFetchStock($token) {
    $url = 'https://ocs.iegsystem.id/odata/DTO_WmsItemStockLiteV2?$count=true&$top=5000';

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Bearer ' . $token,
        'Accept: application/json'
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $json = json_decode($response, true);
        return $json['value'] ?? [];
    }
    return [];
}

function pushToGoogleAppsScript($webAppUrl, $items) {
    $payload = json_encode(['items' => $items]);

    $ch = curl_init($webAppUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json'
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $response = curl_exec($ch);
    curl_close($ch);

    return json_decode($response, true) ?? $response;
}
