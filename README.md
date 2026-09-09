# OCS Warehouse Replenishment & Stock Sync System

A modern Warehouse Management Web Application (WMS) built with PHP, MySQL, and Vanilla JavaScript/CSS. Features dual roles for **Operator Inventory** (Pure Mobile PDA Web App) and **Admin Inventory** (Full ERP Dashboard), with live OCS Cloud stock and Bin Code synchronization.

## 🚀 Key Features

1. **Operator Inventory (Mobile PDA View)**:
   - Optimized for mobile screens (Android / iOS) without frames/mockups.
   - Scan / input Bin Code to sync real-time stock from OCS Cloud.
   - Dual stock metrics: **Gudang Kecil (Picking)** vs **Gudang Besar (Bulk)**.
   - Replenish Request validation (cannot exceed Gudang Besar stock).
   - Audio feedback (beep) on successful scan.
   - Auto-reset form after submission and instant focus return.

2. **Admin Inventory Management Portal**:
   - Dashboard KPI metrics and low-stock alerts.
   - Full Master SKU-Rack & Bin Code mapping.
   - Data Stok OCS Live Inventory table with automatic barcode mapping.
   - Replenish Request Approval Workflow (Pending $\rightarrow$ Approved $\rightarrow$ Completed / Rejected).
   - User Management (Admin & Operator accounts).
   - Full OCS Cloud API integration with automatic OData `$skip` looping.

## 🛠️ Tech Stack
- **Backend:** PHP 8.x + PDO MySQL / SQLite fallback
- **Frontend:** Single Page Application (HTML5, Vanilla CSS3, Vanilla JS ES6+)
- **Integration:** OCS Cloud REST / OData APIs (`DTO_WmsItemStockLiteV2`, `DTO_WmsItems`, `DTO_LookupStockDetailedData`)

## 🔑 Default Accounts
- **Administrator:** `admin` / `admin123`
- **Operator:** `operator` / `operator123`

## ⚙️ Setup & Installation
1. Place project in `htdocs` folder (e.g., `C:/xampp/htdocs/sync.stock.ocs/`).
2. Ensure MySQL server is running on `127.0.0.1:3306`.
3. Open `http://localhost/sync.stock.ocs/` in your browser. Database `ocs_inventory` and tables will be auto-migrated and seeded.
