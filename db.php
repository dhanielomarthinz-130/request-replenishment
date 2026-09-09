<?php
/**
 * Database Connection & Migration Handler
 * Supports MySQL PDO with automatic SQLite fallback for zero-friction setup.
 */

class Database {
    private static ?PDO $pdo = null;
    private static string $driverType = 'mysql';

    public static function getConnection(): PDO {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $host = '127.0.0.1';
        $port = '3306';
        $dbName = 'ocs_inventory';
        $username = 'root';
        $password = '';

        // Try MySQL First
        try {
            // First connect without DB to create database if not exists
            $initPdo = new PDO("mysql:host=$host;port=$port", $username, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT => 2
            ]);
            $initPdo->exec("CREATE DATABASE IF NOT EXISTS `$dbName` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
            
            // Connect to database
            self::$pdo = new PDO("mysql:host=$host;port=$port;dbname=$dbName;charset=utf8mb4", $username, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]);
            self::$driverType = 'mysql';
        } catch (Exception $e) {
            // Fallback to SQLite if MySQL is offline
            $sqlitePath = __DIR__ . '/ocs_inventory.sqlite';
            self::$pdo = new PDO("sqlite:" . $sqlitePath, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]);
            self::$driverType = 'sqlite';
        }

        self::migrateTables();
        return self::$pdo;
    }

    public static function getDriverType(): string {
        return self::$driverType;
    }

    private static function migrateTables(): void {
        $pdo = self::$pdo;

        if (self::$driverType === 'mysql') {
            // Table: users
            $pdo->exec("CREATE TABLE IF NOT EXISTS `users` (
                `id` INT AUTO_INCREMENT PRIMARY KEY,
                `username` VARCHAR(50) NOT NULL UNIQUE,
                `password` VARCHAR(255) NOT NULL,
                `full_name` VARCHAR(100) NOT NULL,
                `role` ENUM('admin', 'operator') NOT NULL DEFAULT 'operator',
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

            // Table: sku_rack_locations (Mapping Bin Code -> SKU)
            $pdo->exec("CREATE TABLE IF NOT EXISTS `sku_rack_locations` (
                `id` INT AUTO_INCREMENT PRIMARY KEY,
                `bin_code` VARCHAR(50) NOT NULL UNIQUE,
                `rack_name` VARCHAR(50) NOT NULL,
                `sku` VARCHAR(100) NOT NULL,
                `barcode` VARCHAR(100) DEFAULT NULL,
                `product_name` VARCHAR(255) NOT NULL,
                `category` VARCHAR(100) DEFAULT NULL,
                `notes` TEXT DEFAULT NULL,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX (`sku`),
                INDEX (`bin_code`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

            // Table: stock_master (Synced stock cache from OCS)
            $pdo->exec("CREATE TABLE IF NOT EXISTS `stock_master` (
                `id` INT AUTO_INCREMENT PRIMARY KEY,
                `sku` VARCHAR(100) NOT NULL UNIQUE,
                `barcode` VARCHAR(100) DEFAULT NULL,
                `product_name` VARCHAR(255) NOT NULL,
                `area_id` VARCHAR(50) DEFAULT 'Pusat',
                `sap_code` VARCHAR(100) DEFAULT NULL,
                `category` VARCHAR(100) DEFAULT NULL,
                `qty_on_hand` INT DEFAULT 0,
                `qty_available` INT DEFAULT 0,
                `qty_gudang_kecil` INT DEFAULT 0,
                `qty_gudang_besar` INT DEFAULT 0,
                `is_active` TINYINT(1) DEFAULT 1,
                `last_synced_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

            // Table: replenish_requests
            $pdo->exec("CREATE TABLE IF NOT EXISTS `replenish_requests` (
                `id` INT AUTO_INCREMENT PRIMARY KEY,
                `request_no` VARCHAR(50) NOT NULL UNIQUE,
                `bin_code` VARCHAR(50) NOT NULL,
                `sku` VARCHAR(100) NOT NULL,
                `product_name` VARCHAR(255) NOT NULL,
                `barcode` VARCHAR(100) DEFAULT NULL,
                `qty_gudang_kecil` INT DEFAULT 0,
                `qty_gudang_besar` INT DEFAULT 0,
                `qty_request` INT NOT NULL,
                `requested_by` VARCHAR(100) NOT NULL,
                `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
                `admin_notes` TEXT DEFAULT NULL,
                `processed_by` VARCHAR(100) DEFAULT NULL,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

            // Table: system_settings
            $pdo->exec("CREATE TABLE IF NOT EXISTS `system_settings` (
                `key_name` VARCHAR(50) PRIMARY KEY,
                `key_value` TEXT NOT NULL,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

        } else {
            // SQLite Syntax
            $pdo->exec("CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'operator',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );");

            $pdo->exec("CREATE TABLE IF NOT EXISTS sku_rack_locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bin_code TEXT NOT NULL UNIQUE,
                rack_name TEXT NOT NULL,
                sku TEXT NOT NULL,
                barcode TEXT,
                product_name TEXT NOT NULL,
                category TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );");

            $pdo->exec("CREATE TABLE IF NOT EXISTS stock_master (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sku TEXT NOT NULL UNIQUE,
                barcode TEXT,
                product_name TEXT NOT NULL,
                area_id TEXT DEFAULT 'Pusat',
                sap_code TEXT,
                category TEXT,
                qty_on_hand INTEGER DEFAULT 0,
                qty_available INTEGER DEFAULT 0,
                qty_gudang_kecil INTEGER DEFAULT 0,
                qty_gudang_besar INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );");

            $pdo->exec("CREATE TABLE IF NOT EXISTS replenish_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_no TEXT NOT NULL UNIQUE,
                bin_code TEXT NOT NULL,
                sku TEXT NOT NULL,
                product_name TEXT NOT NULL,
                barcode TEXT,
                qty_gudang_kecil INTEGER DEFAULT 0,
                qty_gudang_besar INTEGER DEFAULT 0,
                qty_request INTEGER NOT NULL,
                requested_by TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                admin_notes TEXT,
                processed_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );");

            $pdo->exec("CREATE TABLE IF NOT EXISTS system_settings (
                key_name TEXT PRIMARY KEY,
                key_value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );");
        }

        // Seed default users if empty
        $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM users");
        $userCount = (int)($stmt->fetch()['cnt'] ?? 0);
        if ($userCount === 0) {
            $insertUser = $pdo->prepare("INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)");
            $insertUser->execute(['admin', password_hash('admin123', PASSWORD_DEFAULT), 'Administrator Inventory', 'admin']);
            $insertUser->execute(['operator', password_hash('operator123', PASSWORD_DEFAULT), 'Operator Gudang 1', 'operator']);
            $insertUser->execute(['operator2', password_hash('operator123', PASSWORD_DEFAULT), 'Operator Gudang 2', 'operator']);
        }

        // Seed initial SKU-Rack demo data if empty
        $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM sku_rack_locations");
        $rackCount = (int)($stmt->fetch()['cnt'] ?? 0);
        if ($rackCount === 0) {
            $insertRack = $pdo->prepare("INSERT INTO sku_rack_locations (bin_code, rack_name, sku, barcode, product_name, category) VALUES (?, ?, ?, ?, ?, ?)");
            $sampleRacks = [
                ['BIN-A01-01', 'Rak A - Level 1', 'SKU-EJI-001', '899123456001', 'Oli Mesin Synth 10W-40 1L', 'Oli & Pelumas'],
                ['BIN-A01-02', 'Rak A - Level 1', 'SKU-EJI-002', '899123456002', 'Filter Udara Matic 125cc', 'Sparepart Fast Moving'],
                ['BIN-B02-01', 'Rak B - Level 2', 'SKU-EJI-003', '899123456003', 'Busi Super Iridium CR7', 'Pengapian'],
                ['BIN-B02-02', 'Rak B - Level 2', 'SKU-EJI-004', '899123456004', 'Kampas Rem Depan Cakram', 'Pengereman'],
                ['BIN-C03-01', 'Rak C - Level 3', 'SKU-EJI-005', '899123456005', 'V-Belt Drive Pulley Set', 'Transmisi CVT'],
                ['BIN-C03-02', 'Rak C - Level 3', 'SKU-EJI-006', '899123456006', 'Aki Kering Maintenance Free 12V 5Ah', 'Kelistrikan'],
            ];
            foreach ($sampleRacks as $r) {
                $insertRack->execute($r);
            }

            // Seed initial stock master
            $insertStock = $pdo->prepare("INSERT INTO stock_master (sku, barcode, product_name, area_id, sap_code, qty_on_hand, qty_available, qty_gudang_kecil, qty_gudang_besar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $sampleStocks = [
                ['SKU-EJI-001', '899123456001', 'Oli Mesin Synth 10W-40 1L', 'Area-Utama', 'SAP-1001', 150, 140, 15, 125],
                ['SKU-EJI-002', '899123456002', 'Filter Udara Matic 125cc', 'Area-Utama', 'SAP-1002', 80, 75, 8, 67],
                ['SKU-EJI-003', '899123456003', 'Busi Super Iridium CR7', 'Area-Utama', 'SAP-1003', 300, 280, 20, 260],
                ['SKU-EJI-004', '899123456004', 'Kampas Rem Depan Cakram', 'Area-Utama', 'SAP-1004', 45, 40, 5, 35],
                ['SKU-EJI-005', '899123456005', 'V-Belt Drive Pulley Set', 'Area-Utama', 'SAP-1005', 60, 50, 6, 44],
                ['SKU-EJI-006', '899123456006', 'Aki Kering Maintenance Free 12V 5Ah', 'Area-Utama', 'SAP-1006', 25, 20, 3, 17],
            ];
            foreach ($sampleStocks as $s) {
                $insertStock->execute($s);
            }
        }
    }
}
