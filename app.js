/**
 * OCS WMS System - Professional Warehouse & Android Mobile PDA App
 * Frontend Controller (SPA)
 */

document.addEventListener('DOMContentLoaded', () => {
    // Application State
    const AppState = {
        user: null,
        currentScannedItem: null,
        activeAdminTab: 'tabDashboard',
        activeReplenishFilter: 'ALL',
        skuRacks: [],
        stocks: [],
        replenishRequests: [],
        isSyncing: false
    };

    // DOM Elements - Views
    const viewLogin = document.getElementById('viewLogin');
    const viewOperator = document.getElementById('viewOperator');
    const viewAdmin = document.getElementById('viewAdmin');

    // DOM Elements - Auth & Status
    const formLogin = document.getElementById('formLogin');
    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');
    const androidClock = document.getElementById('androidClock');
    const operatorDisplayName = document.getElementById('operatorDisplayName');
    const adminUserName = document.getElementById('adminUserName');
    const opProfileName = document.getElementById('opProfileName');
    const opStatsToday = document.getElementById('opStatsToday');
    const opStatsCompleted = document.getElementById('opStatsCompleted');

    // DOM Elements - Operator Scanner
    const formScanBin = document.getElementById('formScanBin');
    const inputBinCode = document.getElementById('inputBinCode');
    const btnClearScan = document.getElementById('btnClearScan');
    const operatorLoadingSync = document.getElementById('operatorLoadingSync');
    const operatorProductResult = document.getElementById('operatorProductResult');
    const scanEmptyState = document.getElementById('scanEmptyState');
    const resRackName = document.getElementById('resRackName');
    const resBinCode = document.getElementById('resBinCode');
    const resProductName = document.getElementById('resProductName');
    const resSku = document.getElementById('resSku');
    const resBarcode = document.getElementById('resBarcode');
    const resQtyKecil = document.getElementById('resQtyKecil');
    const resQtyBesar = document.getElementById('resQtyBesar');
    const badgeKecilStatus = document.getElementById('badgeKecilStatus');
    const badgeBesarStatus = document.getElementById('badgeBesarStatus');
    const alertGudangBesarKosong = document.getElementById('alertGudangBesarKosong');
    const maxBesarQtyText = document.getElementById('maxBesarQtyText');
    const btnStepMinus = document.getElementById('btnStepMinus');
    const btnStepPlus = document.getElementById('btnStepPlus');
    const inputQtyRequest = document.getElementById('inputQtyRequest');
    const inputReplenishNotes = document.getElementById('inputReplenishNotes');
    const btnSubmitReplenish = document.getElementById('btnSubmitReplenish');
    const operatorHistoryList = document.getElementById('operatorHistoryList');
    const opStockSearchInput = document.getElementById('opStockSearchInput');
    const opStockResultsList = document.getElementById('opStockResultsList');

    // DOM Elements - Admin Portal
    const portalNavButtons = document.querySelectorAll('.portal-nav-btn');
    const portalTabPanes = document.querySelectorAll('.portal-tab-pane');
    const adminPageTitle = document.getElementById('adminPageTitle');
    const adminPageSubtitle = document.getElementById('adminPageSubtitle');
    const badgePendingCount = document.getElementById('badgePendingCount');

    // Admin Stats
    const statTotalRacks = document.getElementById('statTotalRacks');
    const statPendingReplenish = document.getElementById('statPendingReplenish');
    const statCompletedReplenish = document.getElementById('statCompletedReplenish');
    const statTotalSku = document.getElementById('statTotalSku');

    // Admin Tables
    const dashReplenishTableBody = document.getElementById('dashReplenishTableBody');
    const dashLowStockList = document.getElementById('dashLowStockList');
    const skuRacksTableBody = document.getElementById('skuRacksTableBody');
    const adminReplenishTableBody = document.getElementById('adminReplenishTableBody');
    const stockMasterTableBody = document.getElementById('stockMasterTableBody');
    const usersTableBody = document.getElementById('usersTableBody');

    // Search & Filters
    const searchSkuRacks = document.getElementById('searchSkuRacks');
    const searchStocks = document.getElementById('searchStocks');
    const replenishStatusFilters = document.getElementById('replenishStatusFilters');

    // Modals
    const formSaveRack = document.getElementById('formSaveRack');
    const formSaveUser = document.getElementById('formSaveUser');
    const modalSyncProgress = document.getElementById('modalSyncProgress');
    const syncProgressBar = document.getElementById('syncProgressBar');
    const syncStepStatus = document.getElementById('syncStepStatus');
    const syncItemCounter = document.getElementById('syncItemCounter');
    const syncLogBox = document.getElementById('syncLogBox');
    const btnCloseSyncModal = document.getElementById('btnCloseSyncModal');

    // =========================================================================
    // 1. INITIALIZATION & ROUTING
    // =========================================================================

    initAndroidClock();
    checkSession();

    function initAndroidClock() {
        if (!androidClock) return;
        const update = () => {
            const now = new Date();
            androidClock.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
        };
        update();
        setInterval(update, 10000);
    }

    function switchView(viewName) {
        viewLogin.classList.remove('active');
        viewOperator.classList.remove('active');
        viewAdmin.classList.remove('active');

        if (viewName === 'login') {
            viewLogin.classList.add('active');
            loginUsername.focus();
        } else if (viewName === 'operator') {
            viewOperator.classList.add('active');
            if (AppState.user) {
                operatorDisplayName.textContent = AppState.user.full_name || AppState.user.username;
                if (opProfileName) opProfileName.textContent = AppState.user.full_name;
            }
            setTimeout(() => inputBinCode && inputBinCode.focus(), 250);
            loadOperatorHistory();
            loadOpStockSearchList();
        } else if (viewName === 'admin') {
            viewAdmin.classList.add('active');
            if (AppState.user) {
                adminUserName.textContent = AppState.user.full_name || AppState.user.username;
            }
            loadDashboardStats();
            loadSkuRacks();
        }
    }

    // =========================================================================
    // 2. AUTHENTICATION
    // =========================================================================

    async function checkSession() {
        try {
            const res = await fetch('api.php?action=check_session');
            const data = await res.json();
            if (data.logged_in && data.user) {
                AppState.user = data.user;
                if (AppState.user.role === 'admin') {
                    switchView('admin');
                } else {
                    switchView('operator');
                }
            } else {
                switchView('login');
            }
        } catch (err) {
            switchView('login');
        }
    }

    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        await performLogin(loginUsername.value.trim(), loginPassword.value.trim());
    });

    window.quickLogin = async function(username, password) {
        loginUsername.value = username;
        loginPassword.value = password;
        await performLogin(username, password);
    };

    async function performLogin(username, password) {
        const btn = document.getElementById('btnLoginSubmit');
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memverifikasi...`;

        try {
            const formData = new FormData();
            formData.append('action', 'login');
            formData.append('username', username);
            formData.append('password', password);

            const res = await fetch('api.php', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.status === 'success') {
                AppState.user = data.user;
                showToast(`Login berhasil sebagai ${data.user.full_name}`, 'success');
                if (data.user.role === 'admin') {
                    switchView('admin');
                } else {
                    switchView('operator');
                }
            } else {
                showToast(data.message || 'Username atau password salah.', 'error');
            }
        } catch (err) {
            showToast('Gagal terhubung ke server API.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<span>Masuk ke Sistem</span> <i class="fa-solid fa-arrow-right"></i>`;
        }
    }

    window.logoutApp = async function() {
        try {
            await fetch('api.php?action=logout');
            AppState.user = null;
            AppState.currentScannedItem = null;
            showToast('Berhasil logout.', 'info');
            switchView('login');
        } catch (err) {
            switchView('login');
        }
    };

    // =========================================================================
    // 3. OPERATOR MOBILE WMS APP WORKFLOW
    // =========================================================================

    window.switchMobileTab = function(tabId, btn) {
        document.querySelectorAll('.mobile-bottom-navbar .bottom-tab-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.mobile-main-body .mobile-tab-view').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const target = document.getElementById(tabId);
        if (target) target.classList.add('active');

        if (tabId === 'opTabScan') {
            setTimeout(() => inputBinCode && inputBinCode.focus(), 200);
        } else if (tabId === 'opTabStockSearch') {
            loadOpStockSearchList();
        } else if (tabId === 'opTabHistory') {
            loadOperatorHistory();
        }
    };

    window.resetScanForm = function() {
        AppState.currentScannedItem = null;
        if (inputBinCode) {
            inputBinCode.value = '';
            setTimeout(() => inputBinCode.focus(), 120);
        }
        if (inputReplenishNotes) inputReplenishNotes.value = '';
        if (inputQtyRequest) {
            inputQtyRequest.value = 0;
            inputQtyRequest.min = 0;
            inputQtyRequest.max = 0;
        }
        if (operatorProductResult) operatorProductResult.style.display = 'none';
        if (alertGudangBesarKosong) alertGudangBesarKosong.style.display = 'none';
        if (operatorLoadingSync) operatorLoadingSync.style.display = 'none';
        if (scanEmptyState) scanEmptyState.style.display = 'flex';
    };

    if (btnClearScan) {
        btnClearScan.addEventListener('click', () => {
            window.resetScanForm();
        });
    }

    if (formScanBin) {
        formScanBin.addEventListener('submit', (e) => {
            e.preventDefault();
            const binCode = inputBinCode.value.trim();
            if (binCode) executeBinScan(binCode);
        });
    }

    window.scanSpecificBin = function(binCode) {
        inputBinCode.value = binCode;
        executeBinScan(binCode);
    };

    window.triggerOperatorSync = function() {
        const binCode = inputBinCode.value.trim();
        if (binCode) {
            executeBinScan(binCode);
        } else {
            showToast('Masukkan atau scan Bin Code terlebih dahulu.', 'info');
        }
    };

    // Synthesize authentic PDA scanner beep on successful scan
    function playBarcodeBeep() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1760, audioCtx.currentTime); // High pitch crisp beep
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.12);
        } catch (e) {}
    }

    async function executeBinScan(binCode) {
        operatorLoadingSync.style.display = 'flex';
        operatorProductResult.style.display = 'none';
        if (scanEmptyState) scanEmptyState.style.display = 'none';
        AppState.currentScannedItem = null;

        try {
            const res = await fetch(`api.php?action=scan_bin_code&bin_code=${encodeURIComponent(binCode)}`);
            const json = await res.json();

            if (json.status === 'success') {
                playBarcodeBeep();
                const item = json.data;
                AppState.currentScannedItem = item;

                resRackName.textContent = item.rack_name || 'Lokasi Rak';
                resBinCode.textContent = item.bin_code;
                resProductName.textContent = item.product_name;
                resSku.textContent = item.sku;
                resBarcode.textContent = item.barcode || '-';
                resQtyKecil.textContent = Number(item.qty_gudang_kecil || 0).toLocaleString('id-ID');
                resQtyBesar.textContent = Number(item.qty_gudang_besar || 0).toLocaleString('id-ID');

                const qtyKecil = item.qty_gudang_kecil || 0;
                if (qtyKecil <= 5) {
                    badgeKecilStatus.className = 'stock-status-pill danger';
                    badgeKecilStatus.textContent = 'Kritis! Segera Replenish';
                } else if (qtyKecil <= 15) {
                    badgeKecilStatus.className = 'stock-status-pill warning';
                    badgeKecilStatus.textContent = 'Perlu Replenish';
                } else {
                    badgeKecilStatus.className = 'stock-status-pill ready';
                    badgeKecilStatus.textContent = 'Stok Aman';
                }

                // Gudang Besar Status & Limit Rules
                const qtyBesar = Math.max(0, parseInt(item.qty_gudang_besar || 0, 10));
                if (badgeBesarStatus) {
                    if (qtyBesar === 0) {
                        badgeBesarStatus.className = 'stock-status-pill danger';
                        badgeBesarStatus.textContent = 'Stok Kosong';
                    } else if (qtyBesar <= 5) {
                        badgeBesarStatus.className = 'stock-status-pill warning';
                        badgeBesarStatus.textContent = 'Stok Menipis';
                    } else {
                        badgeBesarStatus.className = 'stock-status-pill ready';
                        badgeBesarStatus.textContent = 'Stok Tersedia';
                    }
                }

                if (maxBesarQtyText) maxBesarQtyText.textContent = qtyBesar.toLocaleString('id-ID');

                if (qtyBesar <= 0) {
                    if (alertGudangBesarKosong) alertGudangBesarKosong.style.display = 'block';
                    inputQtyRequest.value = 0;
                    inputQtyRequest.min = 0;
                    inputQtyRequest.max = 0;
                    inputQtyRequest.disabled = true;
                    if (btnStepMinus) btnStepMinus.disabled = true;
                    if (btnStepPlus) btnStepPlus.disabled = true;
                    btnSubmitReplenish.disabled = true;
                    btnSubmitReplenish.style.opacity = '0.5';
                    btnSubmitReplenish.style.cursor = 'not-allowed';
                    btnSubmitReplenish.innerHTML = `<i class="fa-solid fa-ban"></i> Stok Gudang Besar Kosong`;
                } else {
                    if (alertGudangBesarKosong) alertGudangBesarKosong.style.display = 'none';
                    inputQtyRequest.disabled = false;
                    if (btnStepMinus) btnStepMinus.disabled = false;
                    if (btnStepPlus) btnStepPlus.disabled = false;
                    btnSubmitReplenish.disabled = false;
                    btnSubmitReplenish.style.opacity = '1';
                    btnSubmitReplenish.style.cursor = 'pointer';
                    btnSubmitReplenish.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Ajukan Request Replenish`;

                    const suggestedQty = Math.min(10, qtyBesar);
                    inputQtyRequest.value = suggestedQty;
                    inputQtyRequest.min = 1;
                    inputQtyRequest.max = qtyBesar;
                }

                operatorProductResult.style.display = 'flex';

                if (item.synced_live) {
                    showToast(`✅ Live Sync OCS: Stok ${item.sku} terupdate!`, 'success');
                } else {
                    showToast(`📦 Data stok ${item.bin_code} siap.`, 'info');
                }
            } else {
                showToast(json.message || 'Bin Code tidak ditemukan.', 'error');
            }
        } catch (err) {
            showToast('Gagal memproses pemindaian: ' + err.message, 'error');
        } finally {
            operatorLoadingSync.style.display = 'none';
        }
    }

    // Stepper Input Event Listener to enforce max limit live
    if (inputQtyRequest) {
        inputQtyRequest.addEventListener('input', () => {
            if (!AppState.currentScannedItem) return;
            const maxQty = Math.max(0, parseInt(AppState.currentScannedItem.qty_gudang_besar || 0, 10));
            let val = parseInt(inputQtyRequest.value, 10);
            if (isNaN(val)) return;

            if (maxQty <= 0) {
                inputQtyRequest.value = 0;
                return;
            }

            if (val > maxQty) {
                inputQtyRequest.value = maxQty;
                showToast(`Jumlah yang diajukan tidak boleh melebihi stok Gudang Besar (${maxQty} Pcs).`, 'warning');
            } else if (val < 1 && maxQty > 0) {
                inputQtyRequest.value = 1;
            }
        });
    }

    window.adjustQtyRequest = function(delta) {
        if (!AppState.currentScannedItem) return;
        const maxQty = Math.max(0, parseInt(AppState.currentScannedItem.qty_gudang_besar || 0, 10));
        if (maxQty <= 0) {
            showToast('Stok Gudang Besar kosong (0 Pcs)', 'error');
            inputQtyRequest.value = 0;
            return;
        }

        let current = parseInt(inputQtyRequest.value, 10) || 1;
        current += delta;
        if (current > maxQty) {
            current = maxQty;
            showToast(`Jumlah maksimal yang dapat diajukan adalah ${maxQty} Pcs (stok Gudang Besar).`, 'warning');
        }
        if (current < 1) current = 1;
        inputQtyRequest.value = current;
    };

    window.setQtyRequest = function(val) {
        if (!AppState.currentScannedItem) return;
        const maxQty = Math.max(0, parseInt(AppState.currentScannedItem.qty_gudang_besar || 0, 10));
        if (maxQty <= 0) {
            showToast('Stok Gudang Besar kosong (0 Pcs)', 'error');
            inputQtyRequest.value = 0;
            return;
        }

        let target = val;
        if (target > maxQty) {
            target = maxQty;
            showToast(`Jumlah disesuaikan ke kapasitas maksimal Gudang Besar (${maxQty} Pcs).`, 'warning');
        }
        if (target < 1) target = 1;
        inputQtyRequest.value = target;
    };

    window.setMaxQtyRequest = function() {
        if (!AppState.currentScannedItem) return;
        const maxQty = Math.max(0, parseInt(AppState.currentScannedItem.qty_gudang_besar || 0, 10));
        if (maxQty <= 0) {
            showToast('Stok Gudang Besar kosong (0 Pcs)', 'error');
            inputQtyRequest.value = 0;
            return;
        }
        inputQtyRequest.value = maxQty;
        showToast(`Jumlah diset ke stok maksimal Gudang Besar: ${maxQty} Pcs`, 'info');
    };

    btnSubmitReplenish.addEventListener('click', async () => {
        if (!AppState.currentScannedItem) {
            showToast('Scan Bin Code terlebih dahulu.', 'error');
            return;
        }

        const maxQty = Math.max(0, parseInt(AppState.currentScannedItem.qty_gudang_besar || 0, 10));
        if (maxQty <= 0) {
            showToast('Stok di Gudang Besar kosong (0 Pcs). Tidak dapat mengajukan replenish.', 'error');
            return;
        }

        const qtyReq = parseInt(inputQtyRequest.value, 10);
        if (isNaN(qtyReq) || qtyReq <= 0) {
            showToast('Qty Request harus lebih dari 0.', 'error');
            return;
        }

        if (qtyReq > maxQty) {
            showToast(`Jumlah yang diajukan (${qtyReq} Pcs) tidak boleh lebih besar dari stok Gudang Besar (${maxQty} Pcs)!`, 'error');
            inputQtyRequest.value = maxQty;
            return;
        }

        btnSubmitReplenish.disabled = true;
        btnSubmitReplenish.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...`;

        try {
            const payload = {
                action: 'submit_replenish',
                bin_code: AppState.currentScannedItem.bin_code,
                sku: AppState.currentScannedItem.sku,
                product_name: AppState.currentScannedItem.product_name,
                barcode: AppState.currentScannedItem.barcode,
                qty_gudang_kecil: AppState.currentScannedItem.qty_gudang_kecil,
                qty_gudang_besar: AppState.currentScannedItem.qty_gudang_besar,
                qty_request: qtyReq,
                requested_by: AppState.user ? AppState.user.full_name : 'Operator',
                notes: inputReplenishNotes.value.trim()
            };

            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();

            if (json.status === 'success') {
                showToast(`🎉 ${json.message}`, 'success');
                window.resetScanForm();
                loadOperatorHistory();
            } else {
                showToast(json.message || 'Gagal mengajukan permintaan.', 'error');
            }
        } catch (err) {
            showToast('Gagal menghubungi server: ' + err.message, 'error');
        } finally {
            btnSubmitReplenish.disabled = false;
            btnSubmitReplenish.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Ajukan Request Replenish`;
        }
    });

    window.loadOperatorHistory = async function() {
        if (!operatorHistoryList) return;
        try {
            const userName = AppState.user ? AppState.user.full_name : '';
            const res = await fetch(`api.php?action=get_replenish_requests&requested_by=${encodeURIComponent(userName)}&limit=10`);
            const json = await res.json();

            if (json.status === 'success' && json.data.length > 0) {
                if (opStatsToday) opStatsToday.textContent = json.data.length;
                if (opStatsCompleted) opStatsCompleted.textContent = json.data.filter(r => r.status === 'COMPLETED').length;

                const historyHtml = json.data.map(req => {
                    const statusClass = (req.status || 'PENDING').toLowerCase();
                    const statusLabel = {
                        'PENDING': 'Menunggu',
                        'APPROVED': 'Disetujui',
                        'COMPLETED': 'Selesai',
                        'REJECTED': 'Ditolak'
                    }[req.status] || req.status;

                    return `
                        <div class="feed-item">
                            <div>
                                <strong>${req.sku} (${req.bin_code})</strong>
                                <small>${req.product_name} • ${req.qty_request} Pcs</small>
                            </div>
                            <span class="badge-status ${statusClass}">${statusLabel}</span>
                        </div>
                    `;
                }).join('');

                operatorHistoryList.innerHTML = historyHtml;
                const fullList = document.getElementById('operatorFullHistoryList');
                if (fullList) fullList.innerHTML = historyHtml;
            } else {
                operatorHistoryList.innerHTML = `<div class="empty-feed">Belum ada pengajuan replenish hari ini.</div>`;
                const fullList = document.getElementById('operatorFullHistoryList');
                if (fullList) fullList.innerHTML = `<div class="empty-feed">Belum ada data riwayat.</div>`;
            }
        } catch (err) {}
    };

    window.loadOpStockSearchList = async function() {
        if (!opStockResultsList) return;
        try {
            const res = await fetch('api.php?action=get_stocks');
            const json = await res.json();
            if (json.status === 'success') {
                AppState.stocks = json.data;
                renderOpStockSearch(json.data);
            }
        } catch (err) {}
    };

    window.filterOpStockList = function() {
        const q = (opStockSearchInput.value || '').toLowerCase();
        const filtered = AppState.stocks.filter(s => 
            (s.sku && s.sku.toLowerCase().includes(q)) ||
            (s.product_name && s.product_name.toLowerCase().includes(q)) ||
            (s.bin_code && s.bin_code.toLowerCase().includes(q))
        );
        renderOpStockSearch(filtered);
    };

    function renderOpStockSearch(items) {
        if (!opStockResultsList) return;
        if (!items || items.length === 0) {
            opStockResultsList.innerHTML = `<div class="empty-feed">Tidak ada stok yang cocok.</div>`;
            return;
        }
        opStockResultsList.innerHTML = items.slice(0, 30).map(s => `
            <div class="stock-feed-row" onclick="selectStockToScan('${s.bin_code || s.sku}')">
                <div>
                    <strong>${s.sku}</strong>
                    <small style="display: block; color: var(--text-muted);">${s.product_name}</small>
                    <small style="color: var(--primary); font-weight: 700;">Rak: ${s.bin_code || 'Belum ada Rak'}</small>
                </div>
                <div style="text-align: right;">
                    <strong style="font-family: var(--font-mono);">${s.qty_gudang_kecil || 0} Pcs</strong>
                    <small style="display: block; color: var(--text-muted);">Kecil</small>
                </div>
            </div>
        `).join('');
    }

    window.selectStockToScan = function(binOrSku) {
        switchMobileTab('opTabScan', document.querySelector('.mobile-bottom-navbar .bottom-tab-item:first-child'));
        inputBinCode.value = binOrSku;
        executeBinScan(binOrSku);
    };

    // =========================================================================
    // 4. ADMIN DASHBOARD & MANAGEMENT PORTAL
    // =========================================================================

    portalNavButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            switchAdminTab(targetTab);
        });
    });

    window.switchAdminTab = function(tabId) {
        AppState.activeAdminTab = tabId;

        portalNavButtons.forEach(b => {
            if (b.getAttribute('data-tab') === tabId) b.classList.add('active');
            else b.classList.remove('active');
        });

        portalTabPanes.forEach(pane => {
            if (pane.id === tabId) pane.classList.add('active');
            else pane.classList.remove('active');
        });

        const titles = {
            tabDashboard: { title: 'Dashboard Overview', sub: 'Ringkasan operasional pergudangan & sinkronisasi stok' },
            tabSkuRacks: { title: 'Master SKU-Rack & Bin Code', sub: 'Pemetaan kode Bin, Rak Lokasi, SKU, dan Barcode Produk' },
            tabReplenish: { title: 'Permintaan Replenishment', sub: 'Daftar pengajuan mutasi Gudang Besar ke Gudang Kecil' },
            tabStocks: { title: 'Data Stok OCS (Live Inventory)', sub: 'Snapshot saldo stok fisik, Gudang Besar, dan Gudang Kecil' },
            tabUsers: { title: 'Manajemen Pengguna', sub: 'Kelola akun login Operator Gudang dan Administrator' }
        };

        if (titles[tabId]) {
            adminPageTitle.textContent = titles[tabId].title;
            adminPageSubtitle.textContent = titles[tabId].sub;
            const breadcrumbCurrent = document.getElementById('breadcrumbCurrent');
            if (breadcrumbCurrent) {
                const shortTitles = {
                    tabDashboard: 'Dashboard',
                    tabSkuRacks: 'Master SKU-Rack',
                    tabReplenish: 'Replenishment',
                    tabStocks: 'Stok OCS',
                    tabUsers: 'Pengguna'
                };
                breadcrumbCurrent.textContent = shortTitles[tabId] || titles[tabId].title;
            }
        }

        if (tabId === 'tabDashboard') loadDashboardStats();
        if (tabId === 'tabSkuRacks') loadSkuRacks();
        if (tabId === 'tabReplenish') loadAdminReplenish();
        if (tabId === 'tabStocks') loadStockList();
        if (tabId === 'tabUsers') loadUsers();
    };

    async function loadDashboardStats() {
        try {
            const res = await fetch('api.php?action=get_dashboard_stats');
            const json = await res.json();
            if (json.status === 'success') {
                const d = json.data;
                statTotalRacks.textContent = d.total_racks.toLocaleString('id-ID');
                statPendingReplenish.textContent = d.pending_replenish.toLocaleString('id-ID');
                statCompletedReplenish.textContent = d.completed_replenish.toLocaleString('id-ID');
                statTotalSku.textContent = d.total_sku.toLocaleString('id-ID');
                badgePendingCount.textContent = d.pending_replenish;
            }

            const resReq = await fetch('api.php?action=get_replenish_requests&limit=5');
            const jsonReq = await resReq.json();
            if (jsonReq.status === 'success') {
                renderDashboardReplenish(jsonReq.data);
            }

            const resStock = await fetch('api.php?action=get_stocks');
            const jsonStock = await resStock.json();
            if (jsonStock.status === 'success') {
                renderDashboardLowStock(jsonStock.data);
            }
        } catch (err) {}
    }

    function renderDashboardReplenish(items) {
        if (!dashReplenishTableBody) return;
        if (!items || items.length === 0) {
            dashReplenishTableBody.innerHTML = `<tr><td colspan="7" class="td-center" style="padding: 2.5rem 1rem; color: var(--text-muted);"><i class="fa-solid fa-inbox" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; opacity: 0.4;"></i>Belum ada permintaan replenish yang masuk hari ini.</td></tr>`;
            return;
        }

        dashReplenishTableBody.innerHTML = items.map(r => {
            const statusClass = (r.status || 'PENDING').toLowerCase();
            return `
                <tr>
                    <td><strong>${r.request_no}</strong></td>
                    <td><span class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${r.bin_code}</span></td>
                    <td><strong>${r.sku}</strong><br><small style="color: var(--text-muted);">${r.product_name}</small></td>
                    <td><strong style="color: var(--primary); font-family: var(--font-mono); font-size: 1rem;">${r.qty_request} Pcs</strong></td>
                    <td><span style="font-weight: 600;">${r.requested_by}</span></td>
                    <td><span class="badge-status ${statusClass}">${r.status}</span></td>
                    <td class="td-center">
                        <button class="btn-primary-clean" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;" onclick="switchAdminTab('tabReplenish')">
                            Proses <i class="fa-solid fa-arrow-right"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderDashboardLowStock(stocks) {
        if (!dashLowStockList) return;
        const lowItems = (stocks || []).filter(s => (s.qty_gudang_kecil || 0) <= 15).slice(0, 5);
        if (lowItems.length === 0) {
            dashLowStockList.innerHTML = `<div class="empty-feed" style="padding: 2rem 1rem;"><i class="fa-solid fa-circle-check" style="color: var(--success); font-size: 1.5rem; display: block; margin-bottom: 0.4rem;"></i>Semua stok di Gudang Kecil dalam status aman.</div>`;
            return;
        }

        dashLowStockList.innerHTML = lowItems.map(s => `
            <div class="low-stock-row">
                <div>
                    <strong>${s.sku}</strong>
                    <span>${s.product_name} • Rak: <strong style="color: var(--text-dark);">${s.bin_code || '-'}</strong></span>
                </div>
                <div style="text-align: right;">
                    <span class="qty-warn">${s.qty_gudang_kecil} Pcs</span>
                    <small style="display: block; color: var(--text-muted); font-size: 0.7rem;">Gudang Kecil</small>
                </div>
            </div>
        `).join('');
    }

    // =========================================================================
    // 5. MASTER SKU-RACK & BIN CODE
    // =========================================================================

    window.loadSkuRacks = async function() {
        const search = searchSkuRacks ? searchSkuRacks.value.trim() : '';
        skuRacksTableBody.innerHTML = `<tr><td colspan="8" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data master SKU-Rack...</td></tr>`;

        try {
            const res = await fetch(`api.php?action=get_sku_racks&search=${encodeURIComponent(search)}`);
            const json = await res.json();
            if (json.status === 'success') {
                AppState.skuRacks = json.data;
                renderSkuRacksTable(json.data);
            }
        } catch (err) {
            skuRacksTableBody.innerHTML = `<tr><td colspan="8" class="td-center py-4" style="color: var(--danger);">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    if (searchSkuRacks) {
        searchSkuRacks.addEventListener('input', debounce(() => loadSkuRacks(), 300));
    }

    function renderSkuRacksTable(items) {
        if (!items || items.length === 0) {
            skuRacksTableBody.innerHTML = `<tr><td colspan="8" class="td-center py-4" style="color: var(--text-muted);">Tidak ada data Bin Code yang cocok.</td></tr>`;
            return;
        }

        skuRacksTableBody.innerHTML = items.map(r => `
            <tr>
                <td><strong class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${r.bin_code}</strong></td>
                <td><strong>${r.rack_name}</strong></td>
                <td><code>${r.sku}</code></td>
                <td><span style="font-family: var(--font-mono); font-size: 0.82rem; color: #475569;">${r.barcode || '-'}</span></td>
                <td><strong style="color: #0f172a;">${r.product_name}</strong></td>
                <td><span style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.78rem; font-weight: 600;">${r.category || 'General'}</span></td>
                <td><small style="color: var(--text-muted); font-family: var(--font-mono);">${(r.created_at || '').substring(0, 10)}</small></td>
                <td class="td-center">
                    <div style="display: flex; gap: 0.35rem; justify-content: center;">
                        <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem;" title="Edit Lokasi" onclick="openModalEditRack(${r.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem; color: var(--danger);" title="Hapus Lokasi" onclick="deleteSkuRack(${r.id}, '${r.bin_code}')"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    window.openModalAddRack = function() {
        document.getElementById('modalRackTitle').textContent = 'Tambah Lokasi Bin Code';
        document.getElementById('rackFormId').value = '0';
        formSaveRack.reset();
        openModal('modalRack');
    };

    window.openModalEditRack = function(id) {
        const item = AppState.skuRacks.find(r => Number(r.id) === Number(id));
        if (!item) return;

        document.getElementById('modalRackTitle').textContent = `Edit Bin Code: ${item.bin_code}`;
        document.getElementById('rackFormId').value = item.id;
        document.getElementById('rackFormBinCode').value = item.bin_code;
        document.getElementById('rackFormName').value = item.rack_name;
        document.getElementById('rackFormSku').value = item.sku;
        document.getElementById('rackFormBarcode').value = item.barcode || '';
        document.getElementById('rackFormProdName').value = item.product_name;
        document.getElementById('rackFormCategory').value = item.category || '';
        document.getElementById('rackFormNotes').value = item.notes || '';

        openModal('modalRack');
    };

    formSaveRack.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            action: 'save_sku_rack',
            id: document.getElementById('rackFormId').value,
            bin_code: document.getElementById('rackFormBinCode').value.trim(),
            rack_name: document.getElementById('rackFormName').value.trim(),
            sku: document.getElementById('rackFormSku').value.trim(),
            barcode: document.getElementById('rackFormBarcode').value.trim(),
            product_name: document.getElementById('rackFormProdName').value.trim(),
            category: document.getElementById('rackFormCategory').value.trim(),
            notes: document.getElementById('rackFormNotes').value.trim()
        };

        const submitBtn = document.getElementById('btnSaveRackSubmit');
        submitBtn.disabled = true;

        try {
            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.status === 'success') {
                showToast(json.message, 'success');
                closeModal('modalRack');
                loadSkuRacks();
                loadDashboardStats();
            } else {
                showToast(json.message || 'Gagal menyimpan.', 'error');
            }
        } catch (err) {
            showToast('Error server: ' + err.message, 'error');
        } finally {
            submitBtn.disabled = false;
        }
    });

    window.deleteSkuRack = async function(id, binCode) {
        if (!confirm(`Hapus data Bin Code ${binCode}?`)) return;
        try {
            const res = await fetch(`api.php?action=delete_sku_rack&id=${id}`);
            const json = await res.json();
            if (json.status === 'success') {
                showToast(json.message, 'success');
                loadSkuRacks();
                loadDashboardStats();
            } else {
                showToast(json.message || 'Gagal menghapus.', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    };

    // =========================================================================
    // 6. PERMINTAAN REPLENISH (ADMIN APPROVAL)
    // =========================================================================

    if (replenishStatusFilters) {
        const filterBtns = replenishStatusFilters.querySelectorAll('.pill-filter');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                AppState.activeReplenishFilter = btn.getAttribute('data-status');
                loadAdminReplenish();
            });
        });
    }

    window.loadAdminReplenish = async function() {
        adminReplenishTableBody.innerHTML = `<tr><td colspan="10" class="td-center py-4">Memuat data permintaan...</td></tr>`;

        try {
            const status = AppState.activeReplenishFilter;
            const res = await fetch(`api.php?action=get_replenish_requests&status=${status}`);
            const json = await res.json();
            if (json.status === 'success') {
                AppState.replenishRequests = json.data;
                renderAdminReplenishTable(json.data);
            }
        } catch (err) {
            adminReplenishTableBody.innerHTML = `<tr><td colspan="10" class="td-center py-4 text-danger">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    function renderAdminReplenishTable(items) {
        if (!items || items.length === 0) {
            adminReplenishTableBody.innerHTML = `<tr><td colspan="10" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-inbox" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; opacity: 0.4;"></i>Tidak ada data permintaan replenish yang ditemukan.</td></tr>`;
            return;
        }

        adminReplenishTableBody.innerHTML = items.map(r => {
            const statusClass = (r.status || 'PENDING').toLowerCase();
            const isPending = r.status === 'PENDING';
            const isApproved = r.status === 'APPROVED';

            let actionsHtml = '';
            if (isPending) {
                actionsHtml = `
                    <div style="display: flex; gap: 0.35rem; justify-content: center;">
                        <button class="btn-primary-clean" style="padding: 0.35rem 0.65rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-size: 0.78rem;" title="Setujui Mutasi" onclick="updateReplenishStatus(${r.id}, 'APPROVED')"><i class="fa-solid fa-check"></i> Setujui</button>
                        <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem; color: var(--danger); font-size: 0.78rem;" title="Tolak Mutasi" onclick="updateReplenishStatus(${r.id}, 'REJECTED')"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                `;
            } else if (isApproved) {
                actionsHtml = `
                    <div style="display: flex; gap: 0.35rem; justify-content: center;">
                        <button class="btn-primary-clean" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" title="Selesaikan Mutasi Fisik" onclick="updateReplenishStatus(${r.id}, 'COMPLETED')"><i class="fa-solid fa-box-check"></i> Selesaikan</button>
                    </div>
                `;
            } else {
                actionsHtml = `<small style="color: var(--text-muted); font-weight: 600;"><i class="fa-solid fa-lock"></i> Selesai</small>`;
            }

            return `
                <tr>
                    <td><strong>${r.request_no}</strong></td>
                    <td><small style="color: var(--text-muted); font-family: var(--font-mono);">${(r.created_at || '').substring(0, 16)}</small></td>
                    <td><span class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${r.bin_code}</span></td>
                    <td><strong style="color: #0f172a;">${r.sku}</strong><br><small style="color: var(--text-muted);">${r.product_name}</small></td>
                    <td class="td-right" style="font-family: var(--font-mono); font-weight: 600;">${r.qty_gudang_kecil} Pcs</td>
                    <td class="td-right" style="color: var(--success); font-weight: 700; font-family: var(--font-mono);">${r.qty_gudang_besar} Pcs</td>
                    <td class="td-right"><strong style="font-size: 1.05rem; color: var(--primary); font-family: var(--font-mono);">${r.qty_request} Pcs</strong></td>
                    <td><span style="font-weight: 600;">${r.requested_by}</span></td>
                    <td><span class="badge-status ${statusClass}">${r.status}</span></td>
                    <td class="td-center">${actionsHtml}</td>
                </tr>
            `;
        }).join('');
    }

    window.updateReplenishStatus = async function(id, newStatus) {
        let notes = '';
        if (newStatus === 'REJECTED') {
            notes = prompt('Alasan penolakan (opsional):') || '';
        }

        try {
            const payload = {
                action: 'update_replenish_status',
                id: id,
                status: newStatus,
                admin_notes: notes
            };

            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();

            if (json.status === 'success') {
                showToast(json.message, 'success');
                loadAdminReplenish();
                loadDashboardStats();
            } else {
                showToast(json.message || 'Gagal mengubah status.', 'error');
            }
        } catch (err) {
            showToast('Error server: ' + err.message, 'error');
        }
    };

    // =========================================================================
    // 7. DATA STOK OCS & FULL SYNC WITH ANIMATED SPINNER MODAL
    // =========================================================================

    window.loadStockList = async function() {
        const search = searchStocks ? searchStocks.value.trim() : '';
        stockMasterTableBody.innerHTML = `<tr><td colspan="10" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data stok OCS...</td></tr>`;

        try {
            const res = await fetch(`api.php?action=get_stocks&search=${encodeURIComponent(search)}`);
            const json = await res.json();
            if (json.status === 'success') {
                AppState.stocks = json.data;
                renderStockTable(json.data);
            }
        } catch (err) {
            stockMasterTableBody.innerHTML = `<tr><td colspan="10" class="td-center py-4" style="color: var(--danger);">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    if (searchStocks) {
        searchStocks.addEventListener('input', debounce(() => loadStockList(), 300));
    }

    function renderStockTable(items) {
        if (!items || items.length === 0) {
            stockMasterTableBody.innerHTML = `<tr><td colspan="10" class="td-center py-4" style="color: var(--text-muted);">Belum ada data stok. Klik 'Sync Full Stok OCS' untuk sinkronisasi.</td></tr>`;
            return;
        }

        stockMasterTableBody.innerHTML = items.map(s => `
            <tr>
                <td><code>${s.sku}</code></td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: #475569;">${s.barcode || '-'}</span></td>
                <td><strong style="color: #0f172a;">${s.product_name}</strong></td>
                <td>${s.bin_code ? `<span class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${s.bin_code}</span>` : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td><span style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.78rem; font-weight: 600;">${s.area_id || 'Pusat'}</span></td>
                <td class="td-right"><strong style="font-family: var(--font-mono); font-size: 0.95rem;">${Number(s.qty_gudang_kecil || 0).toLocaleString('id-ID')}</strong></td>
                <td class="td-right" style="color: var(--success); font-weight: 700; font-family: var(--font-mono); font-size: 0.95rem;">${Number(s.qty_gudang_besar || 0).toLocaleString('id-ID')}</td>
                <td class="td-right" style="font-family: var(--font-mono);">${Number(s.qty_on_hand || 0).toLocaleString('id-ID')}</td>
                <td class="td-right" style="font-family: var(--font-mono); font-weight: 600; color: #0284c7;">${Number(s.qty_available || 0).toLocaleString('id-ID')}</td>
                <td><small style="color: var(--text-muted); font-family: var(--font-mono);">${(s.last_synced_at || '').substring(0, 16)}</small></td>
            </tr>
        `).join('');
    }

    // Fullscreen OCS Sync Modal with Progress & Spinner
    window.openSyncProgressModal = async function() {
        if (AppState.isSyncing) return;
        AppState.isSyncing = true;

        syncProgressBar.style.width = '10%';
        syncStepStatus.textContent = 'Menghubungkan ke OCS Cloud API...';
        syncItemCounter.textContent = 'Memulai...';
        syncLogBox.innerHTML = `
            <div class="log-entry info">[START] Membuka sesi otentikasi OCS Cloud...</div>
            <div class="log-entry info">[OData] Memanggil DTO_WmsItemStockLiteV2 dengan pagination looping...</div>
        `;
        btnCloseSyncModal.disabled = true;

        openModal('modalSyncProgress');

        try {
            // Animate progress step
            syncProgressBar.style.width = '35%';
            syncStepStatus.textContent = 'Mengunduh 2,500+ data stok OCS...';

            const res = await fetch('api.php?action=sync_all_stock');
            const json = await res.json();

            if (json.status === 'success') {
                syncProgressBar.style.width = '100%';
                syncStepStatus.textContent = 'Sinkronisasi Selesai!';
                syncItemCounter.textContent = `${json.total_synced} Items`;

                syncLogBox.innerHTML += `
                    <div class="log-entry success">[SUCCESS] Mengunduh ${json.total_synced} item stok selesai!</div>
                    <div class="log-entry success">[DB] Seluruh saldo Gudang Besar & Kecil tersimpan di MySQL.</div>
                    <div class="log-entry info">[DONE] Waktu: ${json.timestamp}</div>
                `;
                syncLogBox.scrollTop = syncLogBox.scrollHeight;

                showToast(`🎉 Berhasil sync ${json.total_synced} item dari OCS Cloud!`, 'success');
                loadStockList();
                loadDashboardStats();
            } else {
                syncProgressBar.style.width = '100%';
                syncStepStatus.textContent = 'Gagal Sync';
                syncLogBox.innerHTML += `<div class="log-entry error">[ERROR] ${json.message}</div>`;
                showToast(json.message || 'Gagal sinkronisasi.', 'error');
            }
        } catch (err) {
            syncStepStatus.textContent = 'Error Koneksi';
            syncLogBox.innerHTML += `<div class="log-entry error">[EXCEPTION] ${err.message}</div>`;
            showToast('Error koneksi: ' + err.message, 'error');
        } finally {
            AppState.isSyncing = false;
            btnCloseSyncModal.disabled = false;
        }
    };

    // Fullscreen SKU-Rack Sync Modal with Progress & Spinner
    window.openSyncSkuRackModal = async function() {
        if (AppState.isSyncing) return;
        AppState.isSyncing = true;

        syncProgressBar.style.width = '15%';
        syncStepStatus.textContent = 'Menghubungkan ke OCS Cloud Master SKU-Rack...';
        syncItemCounter.textContent = 'Memulai...';
        syncLogBox.innerHTML = `
            <div class="log-entry info">[START] Membuka sesi otentikasi OCS Cloud...</div>
            <div class="log-entry info">[OData] Mengambil data pemetaan dari DTO_WmsItems (https://ocs.iegsystem.id/master/sku-rack)...</div>
            <div class="log-entry info">[OData] Mengambil data barcode produk dari DTO_LookupStockDetailedData...</div>
        `;
        btnCloseSyncModal.disabled = true;

        openModal('modalSyncProgress');

        try {
            syncProgressBar.style.width = '50%';
            syncStepStatus.textContent = 'Mengunduh 680+ lokasi Bin Rack dari OCS...';

            const res = await fetch('api.php?action=sync_sku_racks_from_ocs');
            const json = await res.json();

            if (json.status === 'success') {
                syncProgressBar.style.width = '100%';
                syncStepStatus.textContent = 'Sinkronisasi SKU-Rack Selesai!';
                syncItemCounter.textContent = `${json.total_synced} Lokasi`;

                syncLogBox.innerHTML += `
                    <div class="log-entry success">[SUCCESS] Mengunduh ${json.total_synced} lokasi Bin Code dari OCS selesai!</div>
                    <div class="log-entry success">[DB] Database master SKU-Rack berhasil diperbarui.</div>
                    <div class="log-entry info">[DONE] Waktu: ${json.timestamp}</div>
                `;
                syncLogBox.scrollTop = syncLogBox.scrollHeight;

                showToast(`🎉 Berhasil sync ${json.total_synced} lokasi SKU-Rack dari OCS Cloud!`, 'success');
                loadSkuRacks();
                loadDashboardStats();
            } else {
                syncProgressBar.style.width = '100%';
                syncStepStatus.textContent = 'Gagal Sync';
                syncLogBox.innerHTML += `<div class="log-entry error">[ERROR] ${json.message}</div>`;
                showToast(json.message || 'Gagal sinkronisasi SKU-Rack.', 'error');
            }
        } catch (err) {
            syncStepStatus.textContent = 'Error Koneksi';
            syncLogBox.innerHTML += `<div class="log-entry error">[EXCEPTION] ${err.message}</div>`;
            showToast('Error koneksi: ' + err.message, 'error');
        } finally {
            AppState.isSyncing = false;
            btnCloseSyncModal.disabled = false;
        }
    };

    // =========================================================================
    // 8. USER MANAGEMENT
    // =========================================================================

    window.loadUsers = async function() {
        usersTableBody.innerHTML = `<tr><td colspan="6" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data pengguna...</td></tr>`;

        try {
            const res = await fetch('api.php?action=get_users');
            const json = await res.json();
            if (json.status === 'success') {
                renderUsersTable(json.data);
            }
        } catch (err) {
            usersTableBody.innerHTML = `<tr><td colspan="6" class="td-center py-4" style="color: var(--danger);">Gagal: ${err.message}</td></tr>`;
        }
    };

    function renderUsersTable(items) {
        if (!items || items.length === 0) {
            usersTableBody.innerHTML = `<tr><td colspan="6" class="td-center py-4" style="color: var(--text-muted);">Belum ada user terdaftar.</td></tr>`;
            return;
        }

        usersTableBody.innerHTML = items.map(u => {
            const roleBadge = u.role === 'admin' 
                ? '<span class="badge-status approved"><i class="fa-solid fa-shield"></i> Administrator</span>'
                : '<span class="badge-status completed"><i class="fa-solid fa-mobile-screen"></i> Operator PDA</span>';

            return `
                <tr>
                    <td><span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-muted);">#${u.id}</span></td>
                    <td><strong style="color: #0f172a; font-size: 0.95rem;">${u.username}</strong></td>
                    <td><strong style="color: #334155;">${u.full_name}</strong></td>
                    <td>${roleBadge}</td>
                    <td><small style="color: var(--text-muted); font-family: var(--font-mono);">${(u.created_at || '').substring(0, 10)}</small></td>
                    <td class="td-center">
                        <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem;" onclick="openModalEditUser(${JSON.stringify(u).replace(/"/g, '&quot;')})">
                            <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.openModalAddUser = function() {
        document.getElementById('modalUserTitle').textContent = 'Tambah Pengguna Baru';
        document.getElementById('userFormId').value = '0';
        document.getElementById('userFormPassHelp').textContent = '(Wajib untuk user baru)';
        document.getElementById('userFormPassword').required = true;
        formSaveUser.reset();
        openModal('modalUser');
    };

    window.openModalEditUser = function(user) {
        document.getElementById('modalUserTitle').textContent = `Edit Pengguna: ${user.username}`;
        document.getElementById('userFormId').value = user.id;
        document.getElementById('userFormUsername').value = user.username;
        document.getElementById('userFormFullName').value = user.full_name;
        document.getElementById('userFormRole').value = user.role;
        document.getElementById('userFormPassHelp').textContent = '(Kosongkan jika tidak ingin ganti password)';
        document.getElementById('userFormPassword').required = false;
        document.getElementById('userFormPassword').value = '';
        openModal('modalUser');
    };

    formSaveUser.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            action: 'save_user',
            id: document.getElementById('userFormId').value,
            username: document.getElementById('userFormUsername').value.trim(),
            full_name: document.getElementById('userFormFullName').value.trim(),
            role: document.getElementById('userFormRole').value,
            password: document.getElementById('userFormPassword').value
        };

        try {
            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.status === 'success') {
                showToast(json.message, 'success');
                closeModal('modalUser');
                loadUsers();
            } else {
                showToast(json.message || 'Gagal menyimpan user.', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });

    // =========================================================================
    // UTILITIES: MODALS & TOAST
    // =========================================================================

    window.openModal = function(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    };

    window.closeModal = function(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    };

    window.showToast = function(msg, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast-item ${type}`;

        const icons = {
            success: 'fa-solid fa-circle-check',
            error: 'fa-solid fa-circle-exmark',
            info: 'fa-solid fa-circle-info'
        };

        toast.innerHTML = `<i class="${icons[type] || icons.info}"></i> <span>${msg}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    };

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
});
