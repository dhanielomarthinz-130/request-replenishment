/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT - SINKRONISASI LENGKAP SEMUA RIWAYAT & STOK OCS (EJI_WMS)
 * ==============================================================================
 * Mengambil data riwayat lengkap & stok langsung dari OCS Cloud ke Google Sheets:
 * 
 * 1. "Mutasi Stok"             - Log Pergerakan Fisik Stok In & Out per SKU (Picking / Cut)
 * 2. "Stock In (Penerimaan PO)" - Riwayat Penerimaan Barang Masuk / Inbound dari PO & SAP GRPO
 * 3. "Jurnal Stok"             - Aliran Transaksi Kuota Stok (GENESIS, GUDANG, RESERVED, dll)
 * 4. "Orders V1"               - Pesanan Keluar / Outbound (Breakdown SKU, Due Date, Toko)
 * 5. "Replenish"               - Mutasi Antar Gudang (Gudang Besar -> Gudang Kecil)
 * 6. "Stock Adjustment"        - Riwayat Penyesuaian & Opname Stok (SKU, Bin Rak, IN/OUT & Qty)
 * 7. "Pergerakan Gudang"       - Riwayat Pergerakan Stok Antar Lokasi Gudang (Movement)
 * 8. "Transfer Area Log"       - Riwayat Pemindahan Pesanan Antar Area (Lengkap SKU & Qty)
 * 9. "Stok OCS"                - Snapshot Saldo Stok Real-time (On Hand, Available, Reserve)
 * ==============================================================================
 */

// Konfigurasi Kredensial & Endpoint OCS System
const OCS_CONFIG = {
  LOGIN_URL: 'https://ocs.iegsystem.id/Auth/Login',
  STOCK_URL: 'https://ocs.iegsystem.id/odata/DTO_WmsItemStockLiteV2',
  MUTATION_URL: 'https://ocs.iegsystem.id/odata/DTO_WmsItemMutationLog',
  STOCK_JOURNAL_URL: 'https://ocs.iegsystem.id/odata/DTO_StockJournalLog',
  RECEIVE_STOCK_URL: 'https://ocs.iegsystem.id/odata/DTO_ReceiveStockLog',
  REPLENISH_HEAD_URL: 'https://ocs.iegsystem.id/odata/DTO_HistoryReplenishITHead',
  REPLENISH_DETAIL_URL: 'https://ocs.iegsystem.id/Stock/ReplenishHistory',
  ORDERS_V1_URL: 'https://ocs.iegsystem.id/odata/DTO_Orders',
  ADJUSTMENT_URL: 'https://ocs.iegsystem.id/odata/DTO_HistoryReplenish',
  WHS_MOVEMENT_URL: 'https://ocs.iegsystem.id/odata/DTO_LogWhsMvmtItem',
  TRANSFER_AREA_URL: 'https://ocs.iegsystem.id/odata/DTO_LogTransferOrderArea',
  
  COMPANY_DB: 'EJI_WMS',
  USERNAME: 'ADMIN',
  PASSWORD: 'ADMIN',
  
  SHEET_STOCK: 'Stok OCS',
  SHEET_MUTATION: 'Mutasi Stok',
  SHEET_RECEIVE: 'Stock In (Penerimaan PO)',
  SHEET_JOURNAL: 'Jurnal Stok',
  SHEET_REPLENISH: 'Replenish',
  SHEET_ORDERS: 'Orders V1',
  SHEET_ADJUSTMENT: 'Stock Adjustment',
  SHEET_MOVEMENT: 'Pergerakan Gudang',
  SHEET_TRANSFER_AREA: 'Transfer Area Log'
};

/**
 * Menu Kustom di Google Sheets saat dokumen dibuka
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('OCS Sync')
    .addItem('🚀 SYNC ALL (Semua Riwayat & Stok OCS)', 'syncAllOcs')
    .addSeparator()
    .addItem('📊 1. Sync Mutasi Stok (Fisik In/Out per SKU)', 'syncOcsMutationHistory')
    .addItem('📥 2. Sync Stock In (Penerimaan PO / GRPO)', 'syncOcsReceiveStockHistory')
    .addItem('📝 3. Sync Jurnal Stok (Aliran IN / OUT)', 'syncOcsStockJournalHistory')
    .addItem('🛒 4. Sync Orders V1 (Pesanan Keluar / Outbound)', 'syncOcsOrdersV1Today')
    .addItem('🔄 5. Sync Replenish (Mutasi Antar Gudang)', 'syncOcsReplenishToday')
    .addItem('⚖️ 6. Sync Stock Adjustment (SKU & Qty Penyesuaian)', 'syncOcsAdjustmentHistory')
    .addItem('📦 7. Sync Pergerakan Gudang (Whs Movement)', 'syncOcsWhsMovementHistory')
    .addItem('🚚 8. Sync Transfer Area Log (Pesanan, SKU & Qty)', 'syncOcsTransferAreaHistory')
    .addItem('📋 9. Sync Stok OCS (Snapshot Full Semua SKU)', 'syncOcsStock')
    .addSeparator()
    .addItem('⏰ Pasang Auto Sync (Setiap 1 Jam)', 'setupHourlyTrigger')
    .addItem('❌ Hapus Auto Sync', 'removeTriggers')
    .addToUi();
}

/**
 * MASTER TRIGGER: SYNC ALL SEMUA MODUL
 */
function syncAllOcs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('🚀 Memulai SYNC ALL Semua Riwayat & Stok OCS...', '🔄 OCS SYNC ALL', -1);
  
  // 1. Sync Mutasi Stok Fisik
  syncOcsMutationHistory();
  
  // 2. Sync Stock In / Penerimaan PO
  syncOcsReceiveStockHistory();

  // 3. Sync Jurnal Stok
  syncOcsStockJournalHistory();

  // 4. Sync Orders V1 (Incremental)
  syncOcsOrdersV1Today();
  
  // 5. Sync Replenish (Incremental)
  syncOcsReplenishToday();

  // 6. Sync Stock Adjustment (Lengkap SKU & Qty)
  syncOcsAdjustmentHistory();

  // 7. Sync Pergerakan Gudang
  syncOcsWhsMovementHistory();

  // 8. Sync Transfer Area Log (Lengkap SKU & Qty)
  syncOcsTransferAreaHistory();

  // 9. Sync Stok View (Full Snapshot)
  syncOcsStock();
  
  ss.toast('🎉 SYNC ALL Selesai! Seluruh riwayat transaksi & stok telah diperbarui langsung dari OCS.', '✅ OCS SYNC ALL Sukses', 8);
  SpreadsheetApp.getUi().alert(
    'SINKRONISASI SUKSES',
    '🎉 SYNC ALL SUKSES!\n\nSeluruh data Mutasi Stok, Stock In PO, Jurnal Stok, Orders, Replenish, Adjustment (SKU & Qty), Movement, Transfer Area (SKU & Qty), & Saldo Stok Real-time telah berhasil disinkronkan langsung dari OCS Cloud.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ==============================================================================
// 1. SYNC MUTASI STOK FISIK IN & OUT (DTO_WmsItemMutationLog)
// ==============================================================================
function syncOcsMutationHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_MUTATION) || ss.insertSheet(OCS_CONFIG.SHEET_MUTATION);

  ss.toast('Mencoba otentikasi ke OCS System...', '📊 Mutasi Stok Sync', -1);
  const token = getOcsToken();
  if (!token) {
    ss.toast('❌ Login Gagal!', 'Error OCS', 5);
    return;
  }

  const latestDate = getLatestDateFromSheet(sheet, 2);
  let filterParam = "";
  if (latestDate) {
    const bufferMs = 5 * 60 * 1000;
    const safeDate = new Date(latestDate.getTime() - bufferMs);
    filterParam = `CreatedAt ge ${safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
    ss.toast(`Mengambil data mutasi stok sejak ${filterParam}...`, '📊 Mutasi Stok Sync', -1);
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    filterParam = `CreatedAt ge ${d.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
    ss.toast('Sheet baru. Mengambil data mutasi stok 30 hari terakhir...', '📊 Mutasi Stok Sync', -1);
  }

  const dataList = fetchOData(token, `${OCS_CONFIG.MUTATION_URL}?$filter=${encodeURIComponent(filterParam)}&$count=true&$top=5000&$orderby=CreatedAt asc`);
  if (!dataList || dataList.length === 0) {
    ss.toast('ℹ️ Tidak ada data mutasi baru.', '📊 Mutasi Stok Sync', 5);
    return;
  }

  const added = appendMutationToSheet(sheet, dataList);
  ss.toast(`✅ Sukses! ${added} baris log mutasi stok baru ditambahkan.`, '✅ Mutasi Stok Selesai', 5);
}

function appendMutationToSheet(sheet, dataList) {
  const headers = [
    "ID Log", "Waktu Mutasi", "SKU Item", "Area", "Shop / Brand",
    "Arah Mutasi", "Stok Awal", "Qty Masuk (IN)", "Qty Keluar (OUT)", "Sisa Stok Akhir",
    "Tipe Transaksi", "No. Referensi (Ref ID)", "Catatan / Keterangan", "PIC / User", "Waktu Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#0f172a')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  const existingIds = getExistingColumnValues(sheet, 1);
  const nowSyncStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const newRows = [];

  dataList.forEach(item => {
    const id = String(item.Id || '').trim();
    if (id && !existingIds.has(id)) {
      const createdAt = item.CreatedAt ? item.CreatedAt.replace('T', ' ').substring(0, 19) : '-';
      const stokAwal = Number(item.QtyBefore || 0);
      const stokAkhir = Number(item.QtyAfter || 0);
      const rawMutationQty = Number(item.MutationQty || 0);
      const operation = String(item.Operation || '').toUpperCase();

      let arahMutasi = "MUTASI";
      let qtyIn = 0;
      let qtyOut = 0;

      if (operation === 'PLUS' || rawMutationQty > 0) {
        arahMutasi = "MASUK (IN)";
        qtyIn = rawMutationQty > 0 ? rawMutationQty : Math.abs(stokAkhir - stokAwal);
        qtyOut = 0;
      } else if (operation === 'MINUS' || rawMutationQty < 0) {
        arahMutasi = "KELUAR (OUT)";
        qtyIn = 0;
        qtyOut = rawMutationQty < 0 ? Math.abs(rawMutationQty) : Math.abs(stokAwal - stokAkhir);
      } else {
        if (stokAkhir > stokAwal) {
          arahMutasi = "ADJUST (IN)";
          qtyIn = stokAkhir - stokAwal;
          qtyOut = 0;
        } else if (stokAkhir < stokAwal) {
          arahMutasi = "ADJUST (OUT)";
          qtyIn = 0;
          qtyOut = stokAwal - stokAkhir;
        } else {
          arahMutasi = "NO CHANGE";
          qtyIn = 0;
          qtyOut = 0;
        }
      }

      newRows.push([
        id,
        createdAt,
        item.SellerSku || '-',
        item.AreaId || 'Pusat',
        item.ShopCode || '-',
        arahMutasi,
        stokAwal,
        qtyIn,
        qtyOut,
        stokAkhir,
        item.RefType || '-',
        item.RefId || '-',
        item.ExecutionNote || '-',
        item.CreatedBy || '-',
        nowSyncStr
      ]);
      existingIds.add(id);
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, 7, newRows.length, 4).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(startRow, 10, newRows.length, 1).setFontWeight('bold');
    sheet.getRange(startRow, 1, newRows.length, 2).setHorizontalAlignment('center');
    sheet.getRange(startRow, 3, newRows.length, 1).setFontWeight('bold');
    sheet.getRange(startRow, 4, newRows.length, 3).setHorizontalAlignment('center');
    sheet.getRange(startRow, 11, newRows.length, 2).setHorizontalAlignment('center');
    sheet.getRange(startRow, 14, newRows.length, 2).setHorizontalAlignment('center');

    if (sheet.getFilter() !== null) sheet.getFilter().remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
  return newRows.length;
}

// ==============================================================================
// 2. SYNC STOCK IN / PENERIMAAN PO / GRPO (DTO_ReceiveStockLog)
// ==============================================================================
function syncOcsReceiveStockHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_RECEIVE) || ss.insertSheet(OCS_CONFIG.SHEET_RECEIVE);

  ss.toast('Mencoba otentikasi ke OCS System...', '📥 Stock In Sync', -1);
  const token = getOcsToken();
  if (!token) return;

  const latestDate = getLatestDateFromSheet(sheet, 2);
  let filterParam = "";
  if (latestDate) {
    const bufferMs = 5 * 60 * 1000;
    const safeDate = new Date(latestDate.getTime() - bufferMs);
    filterParam = `CreatedAt ge ${safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 60);
    filterParam = `CreatedAt ge ${d.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  }

  const dataList = fetchOData(token, `${OCS_CONFIG.RECEIVE_STOCK_URL}?$filter=${encodeURIComponent(filterParam)}&$count=true&$top=3000&$orderby=CreatedAt asc`);
  if (!dataList || dataList.length === 0) {
    ss.toast('ℹ️ Tidak ada data Stock In PO baru.', '📥 Stock In Sync', 5);
    return;
  }

  const added = appendReceiveStockToSheet(sheet, dataList);
  ss.toast(`✅ Sukses! ${added} baris item penerimaan PO baru ditambahkan.`, '✅ Stock In Selesai', 5);
}

function appendReceiveStockToSheet(sheet, dataList) {
  const headers = [
    "ID Transaksi", "Waktu Penerimaan", "No. Dokumen PO", "No. GRPO SAP", "Status",
    "SKU Item", "Nama Barang", "Batch No", "Qty Masuk (Good)", "Qty Rusak (Bad)",
    "Catatan / Remark", "PIC Penerima", "Pesan Error (Jika Gagal)", "Waktu Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#15803d')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  const existingKeys = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    existing.forEach(r => {
      const id = String(r[0]).trim();
      const sku = String(r[5]).trim();
      if (id) existingKeys.add(`${id}|${sku}`);
    });
  }

  const nowSyncStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const newRows = [];

  dataList.forEach(item => {
    const id = String(item.Id || '').trim();
    const createdAt = item.CreatedAt ? item.CreatedAt.replace('T', ' ').substring(0, 19) : '-';
    const docNum = item.DocNum || '-';
    const grpoDocNum = item.GrpoDocNum || '-';
    const status = item.Status || '-';
    const remark = item.Remark || '-';
    const createdBy = item.CreatedBy || '-';
    const errorMsg = item.ErrorMessage || '-';

    let itemsArray = [];
    if (item.RequestPayloadRaw) {
      try {
        const payload = JSON.parse(item.RequestPayloadRaw);
        itemsArray = payload.Items || [];
      } catch (e) {}
    }

    if (itemsArray.length > 0) {
      itemsArray.forEach(sub => {
        const sku = String(sub.SellerSku || sub.ItemCode || '-').trim();
        const key = `${id}|${sku}`;
        if (!existingKeys.has(key)) {
          newRows.push([
            id, createdAt, docNum, grpoDocNum, status,
            sku, sub.ItemName || '-', sub.BatchNum || '-',
            Number(sub.GoodQty || 0), Number(sub.BadQty || 0),
            remark, createdBy, errorMsg, nowSyncStr
          ]);
          existingKeys.add(key);
        }
      });
    } else {
      const key = `${id}|-`;
      if (!existingKeys.has(key)) {
        newRows.push([
          id, createdAt, docNum, grpoDocNum, status,
          '-', '-', '-', 0, 0,
          remark, createdBy, errorMsg, nowSyncStr
        ]);
        existingKeys.add(key);
      }
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, 9, newRows.length, 2).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(startRow, 1, newRows.length, 5).setHorizontalAlignment('center');
    sheet.getRange(startRow, 8, newRows.length, 1).setHorizontalAlignment('center');
    sheet.getRange(startRow, 12, newRows.length, 1).setHorizontalAlignment('center');
    sheet.getRange(startRow, 14, newRows.length, 1).setHorizontalAlignment('center');

    if (sheet.getFilter() !== null) sheet.getFilter().remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
  return newRows.length;
}

// ==============================================================================
// 3. SYNC JURNAL STOK ALIRAN IN & OUT (DTO_StockJournalLog)
// ==============================================================================
function syncOcsStockJournalHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_JOURNAL) || ss.insertSheet(OCS_CONFIG.SHEET_JOURNAL);

  ss.toast('Mencoba otentikasi ke OCS System...', '📝 Jurnal Stok Sync', -1);
  const token = getOcsToken();
  if (!token) return;

  const latestDate = getLatestDateFromSheet(sheet, 2);
  let filterParam = "";
  if (latestDate) {
    const bufferMs = 5 * 60 * 1000;
    const safeDate = new Date(latestDate.getTime() - bufferMs);
    filterParam = `CreatedAt ge ${safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    filterParam = `CreatedAt ge ${d.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  }

  const dataList = fetchOData(token, `${OCS_CONFIG.STOCK_JOURNAL_URL}?$filter=${encodeURIComponent(filterParam)}&$count=true&$top=5000&$orderby=CreatedAt asc`);
  if (!dataList || dataList.length === 0) {
    ss.toast('ℹ️ Tidak ada data jurnal stok baru.', '📝 Jurnal Stok Sync', 5);
    return;
  }

  const added = appendStockJournalToSheet(sheet, dataList);
  ss.toast(`✅ Sukses! ${added} baris jurnal stok baru ditambahkan.`, '✅ Jurnal Stok Selesai', 5);
}

function appendStockJournalToSheet(sheet, dataList) {
  const headers = [
    "ID Log", "Waktu Transaksi", "SKU Item", "Area", "Shop / Brand",
    "Arah (Direction)", "Tipe Mutasi", "Posisi Stok (Type)", "Qty",
    "No. Pesanan / Ref", "PIC / User", "Waktu Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#7c3aed')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  const existingIds = getExistingColumnValues(sheet, 1);
  const nowSyncStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const newRows = [];

  dataList.forEach(item => {
    const id = String(item.Id || '').trim();
    if (id && !existingIds.has(id)) {
      const createdAt = item.CreatedAt ? item.CreatedAt.replace('T', ' ').substring(0, 19) : '-';
      newRows.push([
        id,
        createdAt,
        item.SellerSku || '-',
        item.AreaId || 'Pusat',
        item.ShopCode || '-',
        item.Direction || '-',
        item.MutationType || '-',
        item.TransactionType || '-',
        Number(item.Qty || 0),
        item.OrderId || item.RefId || '-',
        item.CreatedBy || '-',
        nowSyncStr
      ]);
      existingIds.add(id);
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, 9, newRows.length, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(startRow, 1, newRows.length, 2).setHorizontalAlignment('center');
    sheet.getRange(startRow, 4, newRows.length, 5).setHorizontalAlignment('center');
    sheet.getRange(startRow, 11, newRows.length, 2).setHorizontalAlignment('center');

    if (sheet.getFilter() !== null) sheet.getFilter().remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
  return newRows.length;
}

// ==============================================================================
// 4. SYNC ORDERS V1 (OUTBOUND PESANAN)
// ==============================================================================
function syncOcsOrdersV1Today() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_ORDERS) || ss.insertSheet(OCS_CONFIG.SHEET_ORDERS);

  ss.toast('Mencoba otentikasi ke OCS System...', '🛒 Orders V1 Sync', -1);
  const token = getOcsToken();
  if (!token) return;

  const latestDate = getLatestDateFromSheet(sheet, 2);
  let filterParam = "";
  if (latestDate) {
    const bufferMs = 10 * 60 * 1000;
    const safeDate = new Date(latestDate.getTime() - bufferMs);
    filterParam = `CreatedAt ge ${safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    filterParam = `CreatedAt ge ${d.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  }

  const dataList = fetchOData(token, `${OCS_CONFIG.ORDERS_V1_URL}?$filter=${encodeURIComponent(filterParam)}&$count=true&$top=5000&$orderby=CreatedAt asc`);
  if (!dataList || dataList.length === 0) {
    ss.toast('ℹ️ Tidak ada data Orders baru.', '🛒 Orders V1 Sync', 5);
    return;
  }

  const added = appendOrdersV1ToSheet(sheet, dataList);
  ss.toast(`✅ Sukses! ${added} baris item order baru ditambahkan.`, '✅ Orders V1 Selesai', 5);
}

function appendOrdersV1ToSheet(sheet, dataList) {
  const headers = [
    "Order ID", "Waktu Order (Created)", "Sumber", "No. Pesanan", "No. Picklist", "Status Order", "Tipe Order",
    "Toko / Shop", "Gudang (Area)", "Kurir / Expedisi", "No. Resi (Tracking)",
    "SKU Item", "Nama Produk", "Qty", "Harga Satuan", "Total Harga", "Waktu Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#c2410c')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  const existingKeys = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
    existing.forEach(r => {
      const orderId = String(r[0]).trim();
      const sku = String(r[11]).trim();
      if (orderId) existingKeys.add(`${orderId}|${sku}`);
    });
  }

  const nowSyncStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const newRows = [];

  dataList.forEach(order => {
    const orderId = String(order.OrderId || '').trim();
    const createdAt = order.CreatedAt ? order.CreatedAt.replace('T', ' ').substring(0, 19) : '-';
    const source = order.CommercePlatform || '-';
    const orderNo = order.OrderNumber || orderId;
    const picklistNo = order.PickListNo || order.PicklistNo || '-';
    const status = order.OrderStatus || '-';
    const orderType = order.OrderType || '-';
    const shop = order.ShopName || '-';
    const area = order.AreaId || '-';
    const courier = order.Courier || '-';
    const tracking = order.TrackingNumber || '-';

    let items = [];
    if (order.Items && Array.isArray(order.Items) && order.Items.length > 0) {
      items = order.Items;
    } else if (order.OrderItems && Array.isArray(order.OrderItems)) {
      items = order.OrderItems;
    }

    if (items.length > 0) {
      items.forEach(it => {
        const sku = String(it.SellerSku || it.Sku || '-').trim();
        const key = `${orderId}|${sku}`;
        if (!existingKeys.has(key)) {
          const qty = Number(it.Qty || it.Quantity || 1);
          const price = Number(it.Price || 0);
          newRows.push([
            orderId, createdAt, source, orderNo, picklistNo, status, orderType,
            shop, area, courier, tracking,
            sku, it.ProductName || it.ItemName || '-', qty, price, (qty * price), nowSyncStr
          ]);
          existingKeys.add(key);
        }
      });
    } else {
      const key = `${orderId}|-`;
      if (!existingKeys.has(key)) {
        newRows.push([
          orderId, createdAt, source, orderNo, picklistNo, status, orderType,
          shop, area, courier, tracking,
          '-', order.ProductName || '-', Number(order.TotalQtyOrder || 1), 0, 0, nowSyncStr
        ]);
        existingKeys.add(key);
      }
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, 14, newRows.length, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(startRow, 1, newRows.length, 11).setHorizontalAlignment('center');
    sheet.getRange(startRow, 17, newRows.length, 1).setHorizontalAlignment('center');

    if (sheet.getFilter() !== null) sheet.getFilter().remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
  return newRows.length;
}

// ==============================================================================
// 5. SYNC REPLENISH / MUTASI ANTAR GUDANG (DTO_HistoryReplenishITHead)
// ==============================================================================
function syncOcsReplenishToday() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_REPLENISH) || ss.insertSheet(OCS_CONFIG.SHEET_REPLENISH);

  ss.toast('Mencoba otentikasi ke OCS System...', '🔄 Replenish Sync', -1);
  const token = getOcsToken();
  if (!token) return;

  const latestDate = getLatestDateFromSheet(sheet, 2);
  let filterParam = "";
  if (latestDate) {
    const bufferMs = 10 * 60 * 1000;
    const safeDate = new Date(latestDate.getTime() - bufferMs);
    filterParam = `CreatedAt ge ${safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    filterParam = `CreatedAt ge ${d.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  }

  const headList = fetchOData(token, `${OCS_CONFIG.REPLENISH_HEAD_URL}?$filter=${encodeURIComponent(filterParam)}&$count=true&$top=1000&$orderby=CreatedAt asc`);
  if (!headList || headList.length === 0) {
    ss.toast('ℹ️ Tidak ada data Replenish baru.', '🔄 Replenish Sync', 5);
    return;
  }

  const existingDocNums = getExistingReplenishDocNums(sheet);
  const nowSyncStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const rawRows = [];

  headList.forEach(head => {
    const headId = head.Id;
    if (!headId) return;

    const detail = fetchReplenishDetail(token, headId);
    const docDate = head.DocDate ? head.DocDate.replace('T', ' ').substring(0, 10) : '-';
    const createdAt = head.CreatedAt ? head.CreatedAt.replace('T', ' ').substring(0, 19) : '-';
    const docNum = head.DocNum || '-';
    const remark = head.Remark || '-';
    const createdBy = head.CreatedBy || '-';
    const status = head.Status || '-';
    const fromWhs = head.FromWhs || '-';
    const toWhs = head.ToWhs || '-';

    if (detail && detail.Details && detail.Details.length > 0) {
      detail.Details.forEach(item => {
        rawRows.push([
          docDate, createdAt, docNum, remark, item.SellerSku || '', item.KodeBarang || '',
          Number(item.Jumlah || 0), fromWhs, toWhs, createdBy, status, nowSyncStr
        ]);
      });
    } else {
      rawRows.push([docDate, createdAt, docNum, remark, '-', '-', 0, fromWhs, toWhs, createdBy, status, nowSyncStr]);
    }
  });

  const addedCount = appendReplenishToSheet(sheet, rawRows);
  ss.toast(`✅ Sukses! ${addedCount} item Replenish baru disinkronkan.`, '✅ Replenish Selesai', 5);
}

function fetchReplenishDetail(token, headId) {
  try {
    const url = `${OCS_CONFIG.REPLENISH_DETAIL_URL}/${headId}`;
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      muteHttpExceptions: true
    });
    return JSON.parse(response.getContentText());
  } catch (e) { return null; }
}

function appendReplenishToSheet(sheet, rows) {
  const headers = [
    "Tgl Dokumen", "Waktu Dibuat", "No. Order / DocNum", "Remark / Catatan",
    "SKU Item", "Kode Barang (SAP)", "Qty Replenish",
    "Warehouse Asal", "Warehouse Tujuan", "Created By / PIC Process", "Status", "Waktu Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#0f766e')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  const existingKeys = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existingData = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    existingData.forEach(r => {
      const docNum = String(r[2]).trim();
      const sku = String(r[4]).trim();
      if (docNum && sku) existingKeys.add(`${docNum}|${sku}`);
    });
  }

  const newRows = rows.filter(r => {
    const docNum = String(r[2]).trim();
    const sku = String(r[4]).trim();
    const key = `${docNum}|${sku}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      return true;
    }
    return false;
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, 7, newRows.length, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(startRow, 1, newRows.length, 3).setHorizontalAlignment('center');
    sheet.getRange(startRow, 8, newRows.length, 4).setHorizontalAlignment('center');

    if (sheet.getFilter() !== null) sheet.getFilter().remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
  return newRows.length;
}

function getExistingReplenishDocNums(sheet) {
  const existing = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return existing;
  const docNumValues = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  docNumValues.forEach(r => {
    const val = String(r[0]).trim();
    if (val && val !== '-') existing.add(val);
  });
  return existing;
}

// ==============================================================================
// 6. SYNC STOCK ADJUSTMENT / PENYESUAIAN STOK PER SKU & QTY (DTO_HistoryReplenish)
// ==============================================================================
function syncOcsAdjustmentHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_ADJUSTMENT) || ss.insertSheet(OCS_CONFIG.SHEET_ADJUSTMENT);

  ss.toast('Mencoba otentikasi ke OCS System...', '⚖️ Stock Adjustment Sync', -1);
  const token = getOcsToken();
  if (!token) return;

  const latestDate = getLatestDateFromSheet(sheet, 2);
  let filterParam = "";
  if (latestDate) {
    const bufferMs = 5 * 60 * 1000;
    const safeDate = new Date(latestDate.getTime() - bufferMs);
    filterParam = `CreatedAt ge ${safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  }

  let url = `${OCS_CONFIG.ADJUSTMENT_URL}?$count=true&$top=5000`;
  if (filterParam) {
    url += `&$filter=${encodeURIComponent(filterParam)}`;
  }

  const dataList = fetchOData(token, url);
  if (!dataList || dataList.length === 0) {
    ss.toast('ℹ️ Tidak ada data penyesuaian stok baru.', '⚖️ Stock Adjustment Sync', 5);
    return;
  }

  const headers = [
    "ID Log", "Waktu Penyesuaian", "SKU Item", "Lokasi Rak (Bin)",
    "Tipe Adjustment", "Qty Adjustment", "PIC / User", "Waktu Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#0369a1')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  const existingIds = getExistingColumnValues(sheet, 1);
  const nowSyncStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const newRows = [];

  dataList.forEach(item => {
    const id = String(item.Id || '').trim();
    if (id && !existingIds.has(id)) {
      const createdAt = item.CreatedAt ? item.CreatedAt.replace('T', ' ').substring(0, 19) : '-';
      newRows.push([
        id,
        createdAt,
        item.SellerSku || '-',
        item.BinCode || '-',
        item.Type || 'ADJUST',
        Number(item.Qty || 0),
        item.CreatedBy || item.UserCode || '-',
        nowSyncStr
      ]);
      existingIds.add(id);
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, 6, newRows.length, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(startRow, 1, newRows.length, 2).setHorizontalAlignment('center');
    sheet.getRange(startRow, 3, newRows.length, 1).setFontWeight('bold');
    sheet.getRange(startRow, 4, newRows.length, 2).setHorizontalAlignment('center');
    sheet.getRange(startRow, 7, newRows.length, 2).setHorizontalAlignment('center');

    if (sheet.getFilter() !== null) sheet.getFilter().remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
  ss.toast(`✅ Sukses! ${newRows.length} baris riwayat Stock Adjustment (SKU & Qty) ditambahkan.`, '✅ Adjustment Selesai', 5);
}

// ==============================================================================
// 7. SYNC PERGERAKAN GUDANG / WHS MOVEMENT (DTO_LogWhsMvmtItem)
// ==============================================================================
function syncOcsWhsMovementHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_MOVEMENT) || ss.insertSheet(OCS_CONFIG.SHEET_MOVEMENT);

  ss.toast('Mencoba otentikasi ke OCS System...', '📦 Whs Movement Sync', -1);
  const token = getOcsToken();
  if (!token) return;

  const latestDate = getLatestDateFromSheet(sheet, 2);
  let filterParam = "";
  if (latestDate) {
    const bufferMs = 5 * 60 * 1000;
    const safeDate = new Date(latestDate.getTime() - bufferMs);
    filterParam = `LogDate ge ${safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  }

  let url = `${OCS_CONFIG.WHS_MOVEMENT_URL}?$count=true&$top=5000`;
  if (filterParam) {
    url += `&$filter=${encodeURIComponent(filterParam)}`;
  }

  const dataList = fetchOData(token, url);
  if (!dataList || dataList.length === 0) {
    ss.toast('ℹ️ Tidak ada data pergerakan gudang baru.', '📦 Whs Movement Sync', 5);
    return;
  }

  const headers = [
    "ID Log", "Waktu Movement", "SKU Item", "Area", "Shop / Brand",
    "Qty", "Starting Qty", "Warehouse Asal", "Warehouse Tujuan", "No. Referensi / Order", "Waktu Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#4338ca')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  const existingIds = getExistingColumnValues(sheet, 1);
  const nowSyncStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const newRows = [];

  dataList.forEach(item => {
    const id = String(item.Id || '').trim();
    if (id && !existingIds.has(id)) {
      const logDate = item.LogDate ? item.LogDate.replace('T', ' ').substring(0, 19) : '-';
      newRows.push([
        id,
        logDate,
        item.SellerSku || '-',
        item.AreaId || 'Pusat',
        item.ShopCode || '-',
        Number(item.Qty || 0),
        Number(item.StartingQty || 0),
        item.SourceWhs || '-',
        item.TargetWhs || '-',
        item.RefNo || '-',
        nowSyncStr
      ]);
      existingIds.add(id);
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, 6, newRows.length, 2).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(startRow, 1, newRows.length, 2).setHorizontalAlignment('center');
    sheet.getRange(startRow, 3, newRows.length, 1).setFontWeight('bold');
    sheet.getRange(startRow, 4, newRows.length, 2).setHorizontalAlignment('center');
    sheet.getRange(startRow, 8, newRows.length, 4).setHorizontalAlignment('center');

    if (sheet.getFilter() !== null) sheet.getFilter().remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
  ss.toast(`✅ Sukses! ${newRows.length} baris riwayat Pergerakan Gudang ditambahkan.`, '✅ Whs Movement Selesai', 5);
}

// ==============================================================================
// 8. SYNC TRANSFER AREA PESANAN (DTO_LogTransferOrderArea + Lookup SKU & Qty)
// ==============================================================================
function syncOcsTransferAreaHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_TRANSFER_AREA) || ss.insertSheet(OCS_CONFIG.SHEET_TRANSFER_AREA);

  ss.toast('Mencoba otentikasi ke OCS System...', '🚚 Transfer Area Sync', -1);
  const token = getOcsToken();
  if (!token) return;

  const latestDate = getLatestDateFromSheet(sheet, 2);
  let filterParam = "";
  if (latestDate) {
    const bufferMs = 5 * 60 * 1000;
    const safeDate = new Date(latestDate.getTime() - bufferMs);
    filterParam = `CreatedDate ge ${safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  }

  let url = `${OCS_CONFIG.TRANSFER_AREA_URL}?$count=true&$top=5000`;
  if (filterParam) {
    url += `&$filter=${encodeURIComponent(filterParam)}`;
  }

  const dataList = fetchOData(token, url);
  if (!dataList || dataList.length === 0) {
    ss.toast('ℹ️ Tidak ada data transfer area baru.', '🚚 Transfer Area Sync', 5);
    return;
  }

  const headers = [
    "ID Log", "Waktu Transfer", "No. Pesanan (Order ID)", "No. Resi (Tracking)", "Platform", "Toko / Shop",
    "Area Asal", "Area Tujuan", "SKU Item", "Nama Produk", "Qty", "No. Picklist", "Pick ID Lama", "PIC / User", "Waktu Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#be185d')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  // Ambil Map Lookup Pesanan -> Items dari sheet Orders V1
  const ordersLookupMap = getOrdersLookupMap(ss);

  const existingKeys = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    existing.forEach(r => {
      const id = String(r[0]).trim();
      const sku = String(r[8]).trim();
      if (id) existingKeys.add(`${id}|${sku}`);
    });
  }

  const nowSyncStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const newRows = [];

  dataList.forEach(item => {
    const id = String(item.Id || '').trim();
    const orderId = String(item.OrderId || '').trim();
    const createdDate = item.CreatedDate ? item.CreatedDate.replace('T', ' ').substring(0, 19) : '-';
    const tracking = item.TrackingNumber || '-';
    const platform = item.CommercePlatform || '-';
    const shop = item.ShopName || '-';
    const fromArea = item.FromAreaId || '-';
    const toArea = item.ToAreaId || '-';
    const picklistNo = item.PicklistNo || '-';
    const pickIdBefore = item.PickIdBefore || '-';
    const createdBy = item.CreatedBy || '-';

    const orderItems = ordersLookupMap.get(orderId) || [];
    if (orderItems.length > 0) {
      orderItems.forEach(it => {
        const sku = it.sku || '-';
        const key = `${id}|${sku}`;
        if (!existingKeys.has(key)) {
          newRows.push([
            id, createdDate, orderId, tracking, platform, shop,
            fromArea, toArea, sku, it.productName || '-', it.qty || 1,
            picklistNo, pickIdBefore, createdBy, nowSyncStr
          ]);
          existingKeys.add(key);
        }
      });
    } else {
      const key = `${id}|-`;
      if (!existingKeys.has(key)) {
        newRows.push([
          id, createdDate, orderId, tracking, platform, shop,
          fromArea, toArea, '-', '-', 1,
          picklistNo, pickIdBefore, createdBy, nowSyncStr
        ]);
        existingKeys.add(key);
      }
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, 11, newRows.length, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    sheet.getRange(startRow, 1, newRows.length, 8).setHorizontalAlignment('center');
    sheet.getRange(startRow, 9, newRows.length, 1).setFontWeight('bold');
    sheet.getRange(startRow, 12, newRows.length, 4).setHorizontalAlignment('center');

    if (sheet.getFilter() !== null) sheet.getFilter().remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
  ss.toast(`✅ Sukses! ${newRows.length} baris riwayat Transfer Area (lengkap SKU & Qty) ditambahkan.`, '✅ Transfer Area Selesai', 5);
}

function getOrdersLookupMap(ss) {
  const map = new Map();
  const sheet = ss.getSheetByName(OCS_CONFIG.SHEET_ORDERS);
  if (!sheet) return map;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return map;

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  data.forEach(r => {
    const orderId = String(r[0]).trim();
    const sku = String(r[11]).trim();
    const productName = String(r[12]).trim();
    const qty = Number(r[13]) || 1;
    if (orderId && orderId !== '-') {
      if (!map.has(orderId)) map.set(orderId, []);
      map.get(orderId).push({ sku, productName, qty });
    }
  });
  return map;
}

// ==============================================================================
// 9. SYNC STOK REAL-TIME SNAPSHOT (DTO_WmsItemStockLiteV2)
// ==============================================================================
function syncOcsStock() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCS_CONFIG.SHEET_STOCK) || ss.insertSheet(OCS_CONFIG.SHEET_STOCK);

  ss.toast('Connecting & Authenticating with OCS System...', '📋 Stock Sync', -1);
  const token = getOcsToken();
  if (!token) return;

  ss.toast('Mengambil seluruh data stok barang (Full Snapshot)...', '📋 Stock Sync', -1);
  const stockData = fetchOData(token, `${OCS_CONFIG.STOCK_URL}?$count=true&$top=5000`);
  if (!stockData || stockData.length === 0) return;

  writeStockToSheet(sheet, stockData);
  ss.toast(`✅ Sukses! ${stockData.length} Data Stok Berhasil Disinkronkan.`, '✅ Stock Sync Selesai', 5);
}

function writeStockToSheet(sheet, dataList) {
  sheet.clear();
  const headers = ["SKU", "Nama Barang", "Area", "SAP Code", "Kategori", "Qty On Hand", "Qty On Order", "Available Qty", "Reserve Qty", "Qty Gudang Kecil", "Qty Gudang Besar", "Status Aktif", "Under Reserve", "Waktu Sync"];
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const rows = dataList.map(item => [
    item.Sku || '', item.Name || '', item.AreaId || '', item.SapCode || '', item.Category || '',
    Number(item.QtyOnHand || 0), Number(item.QtyOnOrder || 0), Number(item.AvailableQty || 0), Number(item.ReserveQty || 0),
    Number(item.QtyGudangKecil || 0), Number(item.QtyGudangBesar || 0), item.IsActive ? "AKTIF" : "NON-AKTIF", item.IsUnderReserve ? "YA" : "TIDAK", now
  ]);

  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1e293b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 6, rows.length, 6).setNumberFormat('#,##0').setHorizontalAlignment('right');
  }
  sheet.setFrozenRows(1);
  if (sheet.getFilter() !== null) sheet.getFilter().remove();
  sheet.getRange(1, 1, rows.length + 1, headers.length).createFilter();
}

// ==============================================================================
// HELPER UTILITIES
// ==============================================================================
function fetchOData(token, url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    const json = JSON.parse(response.getContentText());
    return json.value || [];
  } catch (error) {
    Logger.log('Error fetchOData: ' + error.toString());
    return [];
  }
}

function getExistingColumnValues(sheet, colIndex) {
  const existing = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return existing;
  const values = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  values.forEach(r => {
    const val = String(r[0]).trim();
    if (val && val !== '-') existing.add(val);
  });
  return existing;
}

function getLatestDateFromSheet(sheet, colIndex) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const dateValues = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  let maxDate = null;

  for (let i = 0; i < dateValues.length; i++) {
    const val = dateValues[i][0];
    if (!val) continue;

    let d = null;
    if (val instanceof Date) {
      d = val;
    } else if (typeof val === 'string' && val.trim() !== '-' && val.trim() !== '') {
      const cleanStr = val.trim().replace(' ', 'T');
      const parsed = new Date(cleanStr);
      if (!isNaN(parsed.getTime())) {
        d = parsed;
      }
    }

    if (d && (!maxDate || d > maxDate)) {
      maxDate = d;
    }
  }
  return maxDate;
}

function getOcsToken() {
  try {
    const payload = { companydb: OCS_CONFIG.COMPANY_DB, username: OCS_CONFIG.USERNAME, password: OCS_CONFIG.PASSWORD };
    const res = UrlFetchApp.fetch(OCS_CONFIG.LOGIN_URL, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText()).Token;
  } catch (e) { return null; }
}

function setupHourlyTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('syncAllOcs').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('⏰ Auto Sync All setiap 1 jam berhasil diaktifkan!');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}
