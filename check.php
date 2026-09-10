<?php
/**
 * Diagnostik lingkungan hosting.
 * Buka https://<domain-anda>/check.php setelah deploy, lalu HAPUS file ini.
 */
header('Content-Type: text/plain; charset=utf-8');

$dbPath = __DIR__ . '/ocs_inventory.sqlite';
$line = str_repeat('=', 58);

echo "$line\nDIAGNOSTIK OCS WMS\n$line\n\n";

echo "PHP version        : " . PHP_VERSION . "\n";
echo "Direktori aplikasi : " . __DIR__ . "\n\n";

echo "-- Ekstensi PDO --\n";
$drivers = class_exists('PDO') ? PDO::getAvailableDrivers() : [];
echo "Driver tersedia    : " . ($drivers ? implode(', ', $drivers) : 'TIDAK ADA') . "\n";
echo "pdo_sqlite         : " . (in_array('sqlite', $drivers) ? 'AKTIF' : 'TIDAK AKTIF -> aplikasi tidak bisa jalan') . "\n";
echo "pdo_mysql          : " . (in_array('mysql', $drivers) ? 'AKTIF' : 'tidak aktif') . "\n\n";

echo "-- Hak tulis (dibutuhkan SQLite) --\n";
echo "Folder writable    : " . (is_writable(__DIR__) ? 'YA' : 'TIDAK -> SQLite gagal bikin file journal') . "\n";
echo "File DB ada        : " . (file_exists($dbPath) ? 'YA (' . number_format(filesize($dbPath) / 1024) . ' KB)' : 'TIDAK -> akan dibuat otomatis') . "\n";
if (file_exists($dbPath)) {
    echo "File DB writable   : " . (is_writable($dbPath) ? 'YA' : 'TIDAK -> hanya bisa baca') . "\n";
}
echo "\n";

echo "-- Koneksi database aplikasi --\n";
try {
    require_once __DIR__ . '/db.php';
    $pdo = Database::getConnection();
    echo "Status             : BERHASIL (driver: " . Database::getDriverType() . ")\n";
    foreach (['users', 'sku_rack_locations', 'stock_master', 'replenish_requests'] as $t) {
        $n = $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn();
        echo str_pad("  $t", 21) . ": $n baris\n";
    }
} catch (Throwable $e) {
    echo "Status             : GAGAL\n";
    echo "Pesan              : " . $e->getMessage() . "\n";
}
echo "\n";

echo "-- Koneksi keluar ke OCS Cloud (dibutuhkan tombol Sync) --\n";
if (!function_exists('curl_init')) {
    echo "cURL               : TIDAK TERSEDIA -> Sync OCS tidak bisa jalan\n";
} else {
    $ch = curl_init('https://ocs.iegsystem.id');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_NOBODY         => true,
    ]);
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($code > 0) {
        echo "cURL ke OCS        : BERHASIL (HTTP $code) -> Sync bisa jalan\n";
    } else {
        echo "cURL ke OCS        : DIBLOKIR / GAGAL\n";
        echo "Pesan              : " . ($err ?: 'tidak ada respons') . "\n";
        echo "Catatan            : hosting gratis umumnya memblokir koneksi keluar.\n";
    }
}
echo "\n";

echo "-- Batas eksekusi (Sync OCS butuh waktu lama) --\n";
echo "max_execution_time : " . ini_get('max_execution_time') . " detik\n";
echo "memory_limit       : " . ini_get('memory_limit') . "\n\n";

echo "$line\nSelesai. HAPUS file check.php ini setelah dibaca.\n$line\n";
