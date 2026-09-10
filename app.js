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
        minusStocks: [],
        minusThreshold: 0,
        replenishRequests: [],
        isSyncing: false
    };

    // A refresh used to drop straight back to the login screen while the
    // check_session round trip was still in flight. Cache the last known
    // identity + tab locally so the correct view paints immediately, then let
    // the server response confirm or revoke it.
    const SESSION_CACHE_KEY = 'ocsWmsSession';

    function readCachedSession() {
        try {
            const raw = localStorage.getItem(SESSION_CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    function writeCachedSession(user, activeTab, sessionToken) {
        try {
            if (!user) {
                localStorage.removeItem(SESSION_CACHE_KEY);
                localStorage.removeItem('ocsSessionToken');
                document.documentElement.classList.remove('has-auth-session');
                return;
            }
            localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ user, activeTab: activeTab || null }));
            if (sessionToken) {
                localStorage.setItem('ocsSessionToken', sessionToken);
            }
            document.documentElement.classList.add('has-auth-session');
        } catch (err) { /* private mode / quota */ }
    }

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
    const minusStockTableBody = document.getElementById('minusStockTableBody');
    const badgeMinusCount = document.getElementById('badgeMinusCount');

    // Search & Filters
    const searchSkuRacks = document.getElementById('searchSkuRacks');
    const searchStocks = document.getElementById('searchStocks');
    const searchMinusStock = document.getElementById('searchMinusStock');
    const minusThresholdFilters = document.getElementById('minusThresholdFilters');
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

    function initAndroidClock() {
        if (!androidClock) return;
        const update = () => {
            const now = new Date();
            androidClock.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
        };
        update();
        setInterval(update, 10000);
    }

    // State for Login Warehouse Choice (Default: gudang_kecil)
    let selectedLoginWarehouse = 'gudang_kecil';

    window.selectLoginWarehouse = function(wh) {
        selectedLoginWarehouse = wh;
        const optKecil = document.getElementById('optCardKecil');
        const optBesar = document.getElementById('optCardBesar');
        const radioKecil = document.getElementById('radioWhKecil');
        const radioBesar = document.getElementById('radioWhBesar');

        if (wh === 'gudang_besar') {
            if (optKecil) optKecil.classList.remove('active');
            if (optBesar) optBesar.classList.add('active');
            if (radioBesar) radioBesar.checked = true;
            if (optKecil) {
                const ic = optKecil.querySelector('.card-radio-indicator i');
                if (ic) ic.className = 'fa-regular fa-circle';
            }
            if (optBesar) {
                const ib = optBesar.querySelector('.card-radio-indicator i');
                if (ib) ib.className = 'fa-solid fa-circle-dot';
            }
        } else {
            if (optBesar) optBesar.classList.remove('active');
            if (optKecil) optKecil.classList.add('active');
            if (radioKecil) radioKecil.checked = true;
            if (optBesar) {
                const ib = optBesar.querySelector('.card-radio-indicator i');
                if (ib) ib.className = 'fa-regular fa-circle';
            }
            if (optKecil) {
                const ic = optKecil.querySelector('.card-radio-indicator i');
                if (ic) ic.className = 'fa-solid fa-circle-dot';
            }
        }
    };

    function switchView(viewName) {
        viewLogin.classList.remove('active');
        viewOperator.classList.remove('active');
        viewAdmin.classList.remove('active');

        if (viewName === 'login') {
            stopPickTaskAutoPolling();
            viewLogin.classList.add('active');
            loginUsername.focus();
        } else if (viewName === 'operator') {
            viewOperator.classList.add('active');
            if (AppState.user) {
                operatorDisplayName.textContent = AppState.user.full_name || AppState.user.username;
                if (opProfileName) opProfileName.textContent = AppState.user.full_name;

                const effectiveWh = (AppState.user.work_location || AppState.user.role) === 'gudang_besar' ? 'gudang_besar' : 'gudang_kecil';

                const opBadge = document.getElementById('opActiveWarehouseBadge') || document.querySelector('.warehouse-badge');
                const badgeIcon = document.getElementById('opWarehouseBadgeIcon');
                const badgeLabel = document.getElementById('opWarehouseLabelText');

                if (effectiveWh === 'gudang_besar') {
                    if (opBadge) {
                        opBadge.classList.add('gudang-besar');
                        opBadge.classList.remove('gudang-kecil');
                    }
                    if (badgeIcon) badgeIcon.className = 'fa-solid fa-warehouse';
                    if (badgeLabel) badgeLabel.textContent = 'Gudang Besar (Main Storage)';
                } else {
                    if (opBadge) {
                        opBadge.classList.add('gudang-kecil');
                        opBadge.classList.remove('gudang-besar');
                    }
                    if (badgeIcon) badgeIcon.className = 'fa-solid fa-box-open';
                    if (badgeLabel) badgeLabel.textContent = 'Gudang Kecil (Picking Rack)';
                }

                const opTag = document.getElementById('opProfileRoleTag');
                if (opTag) {
                    opTag.textContent = effectiveWh === 'gudang_besar' ? 'Operator Gudang Besar (Task Pick)' : 'Operator Gudang Kecil (Request Replenish)';
                }

                const profWhName = document.getElementById('profileWhName');
                const profWhDesc = document.getElementById('profileWhDesc');
                const profWhIcon = document.getElementById('profileWhIcon');
                if (profWhName) profWhName.textContent = effectiveWh === 'gudang_besar' ? 'Gudang Besar' : 'Gudang Kecil';
                if (profWhDesc) profWhDesc.textContent = effectiveWh === 'gudang_besar' ? 'Area Main Storage • Menerima Task Pick' : 'Area Picking Rack • Request Replenish';
                if (profWhIcon) profWhIcon.innerHTML = `<i class="fa-solid fa-${effectiveWh === 'gudang_besar' ? 'warehouse' : 'box-open'}"></i>`;
            }
            setTimeout(() => inputBinCode && inputBinCode.focus(), 250);
            loadOperatorHistory();
            loadOpStockSearchList();
            loadPickTasks();
        } else if (viewName === 'admin') {
            stopPickTaskAutoPolling();
            viewAdmin.classList.add('active');
            if (AppState.user) {
                const displayName = AppState.user.full_name || AppState.user.username || 'ADMIN';
                if (adminUserName) adminUserName.textContent = displayName;
                const adminAvatarLetter = document.getElementById('adminAvatarLetter');
                if (adminAvatarLetter) adminAvatarLetter.textContent = displayName.charAt(0).toUpperCase();
                const adminUserRole = document.getElementById('adminUserRole');
                if (adminUserRole) adminUserRole.textContent = '@' + (AppState.user.username || 'ADMIN').toUpperCase();
            }
            loadDashboardStats();
            loadSkuRacks();
        }
    }

    // =========================================================================
    // 2. AUTHENTICATION & SESSION HANDLING
    // =========================================================================

    function routeForUser(user, preferredTab) {
        AppState.user = user;
        const effectiveWh = (user.work_location || user.role) === 'gudang_besar' ? 'gudang_besar' : (user.role === 'admin' ? 'admin' : 'gudang_kecil');

        if (user.role === 'admin') {
            stopPickTaskAutoPolling();
            switchView('admin');
            const tab = preferredTab || AppState.activeAdminTab || 'tabDashboard';
            if (document.getElementById(tab)) switchAdminTab(tab);
        } else if (effectiveWh === 'gudang_besar') {
            switchView('operator');
            startPickTaskAutoPolling();
            const btnPick = document.getElementById('btnNavPickTask');
            if (preferredTab && document.getElementById(preferredTab)) {
                switchMobileTab(preferredTab);
            } else {
                switchMobileTab('opTabPickTask', btnPick);
            }
        } else {
            // Role gudang_kecil
            switchView('operator');
            stopPickTaskAutoPolling();
            const btnScan = document.getElementById('btnNavScan');
            if (preferredTab && document.getElementById(preferredTab)) {
                switchMobileTab(preferredTab);
            } else {
                switchMobileTab('opTabScan', btnScan);
            }
        }
    }

    async function checkSession() {
        const cached = readCachedSession();
        if (cached && cached.user) {
            routeForUser(cached.user, cached.activeTab);
        } else {
            switchView('login');
        }

        try {
            const token = localStorage.getItem('ocsSessionToken') || '';
            const url = 'api.php?action=check_session' + (token ? `&session_token=${encodeURIComponent(token)}` : '');
            const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
            const data = await res.json();
            if (data.logged_in && data.user) {
                AppState.user = data.user;
                if (!cached || !cached.user || cached.user.username !== data.user.username || (cached.user.work_location || cached.user.role) !== (data.user.work_location || data.user.role)) {
                    routeForUser(data.user, cached ? cached.activeTab : null);
                }
                writeCachedSession(data.user, AppState.activeAdminTab, data.session_token || token);
            } else {
                writeCachedSession(null);
                switchView('login');
            }
        } catch (err) {
            // Keep optimistic view on connection error
            if (!cached || !cached.user) switchView('login');
        }
    }

    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        await performLogin(loginUsername.value.trim(), loginPassword.value.trim());
    });

    window.quickLogin = async function(username, password) {
        loginUsername.value = username;
        loginPassword.value = password;
        if (username === 'gudang_besar') {
            selectLoginWarehouse('gudang_besar');
        } else if (username === 'gudang_kecil') {
            selectLoginWarehouse('gudang_kecil');
        }
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
            formData.append('warehouse', selectedLoginWarehouse);

            const res = await fetch('api.php', { method: 'POST', body: formData, credentials: 'same-origin' });
            const data = await res.json();

            if (data.status === 'success') {
                AppState.user = data.user;
                const effectiveWh = (data.user.work_location || data.user.role) === 'gudang_besar' ? 'gudang_besar' : 'gudang_kecil';
                const initialTab = data.user.role === 'admin' ? 'tabDashboard' : (effectiveWh === 'gudang_besar' ? 'opTabPickTask' : 'opTabScan');
                
                writeCachedSession(data.user, initialTab, data.session_token);
                showToast(`Login berhasil sebagai ${data.user.full_name} (${effectiveWh === 'gudang_besar' ? 'Gudang Besar' : 'Gudang Kecil'})`, 'success');
                routeForUser(data.user);
            } else {
                showToast(data.message || 'Username atau password salah.', 'error');
            }
        } catch (err) {
            showToast('Gagal terhubung ke server API.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<span>Masuk Sekarang</span> <i class="fa-solid fa-arrow-right-to-bracket"></i>`;
        }
    }

    window.openSwitchWarehouseModal = function() {
        const currentWh = (AppState.user && (AppState.user.work_location || AppState.user.role)) === 'gudang_besar' ? 'gudang_besar' : 'gudang_kecil';
        const badgeKecil = document.getElementById('swBadgeCurrentKecil');
        const badgeBesar = document.getElementById('swBadgeCurrentBesar');
        const cardKecil = document.getElementById('btnSwitchCardKecil');
        const cardBesar = document.getElementById('btnSwitchCardBesar');

        if (badgeKecil) badgeKecil.style.display = currentWh === 'gudang_kecil' ? 'inline-block' : 'none';
        if (badgeBesar) badgeBesar.style.display = currentWh === 'gudang_besar' ? 'inline-block' : 'none';
        if (cardKecil) cardKecil.classList.toggle('active-wh', currentWh === 'gudang_kecil');
        if (cardBesar) cardBesar.classList.toggle('active-wh', currentWh === 'gudang_besar');

        openModal('modalSwitchWarehouse');
    };

    window.switchActiveWarehouse = async function(targetWarehouse) {
        if (!AppState.user) return;
        closeModal('modalSwitchWarehouse');

        try {
            const formData = new FormData();
            formData.append('action', 'switch_work_location');
            formData.append('warehouse', targetWarehouse);

            const token = localStorage.getItem('ocsSessionToken') || '';
            const res = await fetch('api.php' + (token ? `?session_token=${encodeURIComponent(token)}` : ''), {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });
            const data = await res.json();
            if (data.status === 'success' && data.user) {
                AppState.user = data.user;
                const newTab = targetWarehouse === 'gudang_besar' ? 'opTabPickTask' : 'opTabScan';
                writeCachedSession(data.user, newTab, data.session_token);
                showToast(data.message, 'success');
                routeForUser(data.user, newTab);
            } else {
                showToast(data.message || 'Gagal mengganti lokasi gudang.', 'error');
            }
        } catch (err) {
            showToast('Gagal menghubungi server: ' + err.message, 'error');
        }
    };

    window.logoutApp = async function() {
        stopPickTaskAutoPolling();
        writeCachedSession(null);
        try {
            await fetch('api.php?action=logout', { credentials: 'same-origin' });
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

        if (!btn) {
            btn = document.querySelector(`.mobile-bottom-navbar .bottom-tab-item[onclick*="${tabId}"]`);
        }
        if (btn) btn.classList.add('active');

        const target = document.getElementById(tabId);
        if (target) target.classList.add('active');

        if (AppState.user) {
            writeCachedSession(AppState.user, tabId, localStorage.getItem('ocsSessionToken'));
        }

        if (tabId === 'opTabScan') {
            setTimeout(() => inputBinCode && inputBinCode.focus(), 200);
            loadOperatorHistory();
        } else if (tabId === 'opTabPickTask') {
            loadPickTasks();
        } else if (tabId === 'opTabStockSearch') {
            loadOpStockSearchList();
        } else if (tabId === 'opTabHistory') {
            switchMobileTab('opTabScan');
            return;
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
        const historyContainer = document.getElementById('operatorHistoryList');
        if (!historyContainer) return;
        try {
            const res = await fetch(`api.php?action=get_replenish_requests&status=COMPLETED&today=1&limit=50`);
            const json = await res.json();

            if (json.status === 'success' && json.data && json.data.length > 0) {
                if (opStatsToday) opStatsToday.textContent = json.data.length;
                const totalPcs = json.data.reduce((acc, r) => acc + (parseInt(r.picked_qty || r.qty_request) || 0), 0);
                if (opStatsCompleted) opStatsCompleted.textContent = totalPcs + ' Pcs';

                const historyHtml = json.data.map(req => {
                    const rack = req.rack_gudang_besar || '-';
                    const batch = req.batch_number || '-';
                    const pickedQty = req.picked_qty || req.qty_request;
                    const timeStr = (req.picked_at || req.created_at || '').substring(11, 16);

                    return `
                        <div class="feed-item" style="border-left: 3.5px solid #10b981; background: #ffffff; padding: 0.85rem 1rem; margin-bottom: 0.65rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); border-top: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9;">
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.3rem;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                                        <strong style="color: #0f172a; font-size: 0.88rem;">${req.sku}</strong>
                                        <span class="loc-bin-tag" style="font-size: 0.72rem; padding: 0.15rem 0.45rem;"><i class="fa-solid fa-tag"></i> ${req.bin_code}</span>
                                    </div>
                                    <span class="badge-status completed" style="font-size: 0.7rem; padding: 0.2rem 0.55rem;"><i class="fa-solid fa-circle-check"></i> Selesai Dipick</span>
                                </div>
                                <div style="font-size: 0.78rem; color: #475569; margin-bottom: 0.45rem; font-weight: 500; line-height: 1.35;">
                                    ${req.product_name}
                                </div>
                                <div style="display: flex; gap: 0.6rem; font-size: 0.74rem; color: #334155; flex-wrap: wrap; background: #f8fafc; padding: 0.35rem 0.6rem; border-radius: 6px; border: 1px solid #e2e8f0;">
                                    <span><i class="fa-solid fa-boxes-stacked" style="color: var(--primary);"></i> Qty: <strong style="color: var(--primary);">${pickedQty} Pcs</strong></span>
                                    <span><i class="fa-solid fa-warehouse" style="color: #ea580c;"></i> Rak GB: <strong style="color: #c2410c;">${rack}</strong></span>
                                    <span><i class="fa-solid fa-barcode" style="color: #4f46e5;"></i> Batch: <strong style="color: #4338ca;">${batch}</strong></span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.4rem; font-size: 0.7rem; color: #94a3b8;">
                                    <span><i class="fa-solid fa-user-check" style="color: #10b981;"></i> Di-pick: <strong>${req.picked_by || req.processed_by || 'Operator Gudang'}</strong></span>
                                    <span><i class="fa-regular fa-clock"></i> ${timeStr} WIB</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                historyContainer.innerHTML = historyHtml;
            } else {
                if (opStatsToday) opStatsToday.textContent = '0';
                if (opStatsCompleted) opStatsCompleted.textContent = '0 Pcs';
                historyContainer.innerHTML = `
                    <div class="empty-feed" style="text-align: center; padding: 1.5rem 1rem; color: #94a3b8;">
                        <i class="fa-solid fa-clipboard-check" style="font-size: 1.8rem; color: #cbd5e1; display: block; margin-bottom: 0.5rem;"></i>
                        <strong style="color: #64748b; font-size: 0.85rem; display: block;">Belum ada request selesai dipick hari ini</strong>
                        <span style="font-size: 0.75rem;">Request yang telah selesai dipick oleh Gudang Besar akan langsung tampil di sini.</span>
                    </div>
                `;
            }
        } catch (err) {
            console.error('loadOperatorHistory error:', err);
        }
    };

    // =========================================================================
    // 3B. TASK PICK GUDANG BESAR (OPERATOR GUDANG BESAR) - REALTIME SYNC
    // =========================================================================

    AppState.pickTasks = [];
    AppState.activePickFilter = 'PENDING';
    let pickTaskSearchTerm = '';
    let pickTaskPollTimer = null;
    let knownPendingTaskIds = new Set();
    let isFirstPoll = true;

    // Gentle 2-tone melodic web audio chime for incoming pick tasks
    function playNotificationChime() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            if (ctx.state === 'suspended') {
                ctx.resume();
            }
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
            osc.start();
            osc.stop(ctx.currentTime + 0.45);
        } catch (e) {
            // Audio context policy safe ignore
        }
    }

    window.loadPickTasks = async function(isBackground = false) {
        const feed = document.getElementById('pickTasksFeed');
        if (!feed) return;
        if (!isBackground && AppState.pickTasks.length === 0) {
            feed.innerHTML = `<div class="empty-feed"><i class="fa-solid fa-spinner fa-spin"></i> Memuat task pick...</div>`;
        }

        try {
            const res = await fetch('api.php?action=get_replenish_requests&limit=100', { credentials: 'same-origin', cache: 'no-store' });
            const json = await res.json();
            if (json.status === 'success') {
                const incomingTasks = json.data || [];
                const currentPending = incomingTasks.filter(t => t.status === 'PENDING');
                const currentPendingIds = new Set(currentPending.map(t => String(t.id)));

                // Check if any brand-new request arrived from Gudang Kecil
                let freshTasks = [];
                if (!isFirstPoll) {
                    freshTasks = currentPending.filter(t => !knownPendingTaskIds.has(String(t.id)));
                }
                knownPendingTaskIds = currentPendingIds;
                isFirstPoll = false;

                if (freshTasks.length > 0) {
                    // 1. Play alert chime & vibrate
                    playNotificationChime();
                    if (navigator.vibrate) {
                        try { navigator.vibrate([150, 80, 150]); } catch (e) {}
                    }

                    // 2. Show alert banner in Gudang Besar view
                    const banner = document.getElementById('newPickTaskAlert');
                    if (banner) {
                        const titleEl = document.getElementById('alertNewTaskTitle');
                        const subEl = document.getElementById('alertNewTaskSubtitle');
                        const firstFresh = freshTasks[0];
                        if (titleEl) titleEl.textContent = `${freshTasks.length} Task Pick Baru dari Gudang Kecil!`;
                        if (subEl) subEl.textContent = `#${firstFresh.request_no} • ${firstFresh.product_name} (${firstFresh.qty_request} Pcs)`;
                        banner.style.display = 'flex';
                    }

                    showToast(`🔔 [Gudang Besar] ${freshTasks.length} Task Pick Baru Masuk dari Gudang Kecil!`, 'info');

                    // 3. Pulse bottom nav bubble
                    const bubble = document.getElementById('bubblePickTask');
                    if (bubble) {
                        bubble.classList.add('animate-bounce');
                        setTimeout(() => bubble.classList.remove('animate-bounce'), 3000);
                    }
                }

                AppState.pickTasks = incomingTasks;
                updatePickCounters();
                renderPickTasks();
            } else if (!isBackground) {
                feed.innerHTML = `<div class="empty-feed text-danger">Gagal memuat task: ${json.message}</div>`;
            }
        } catch (err) {
            if (!isBackground) {
                feed.innerHTML = `<div class="empty-feed text-danger">Gagal menghubungi server: ${err.message}</div>`;
            }
        }
    };

    window.startPickTaskAutoPolling = function() {
        window.stopPickTaskAutoPolling();
        // Polling setiap 4 detik untuk update task otomatis
        pickTaskPollTimer = setInterval(() => {
            const isGb = AppState.user && ((AppState.user.work_location || AppState.user.role) === 'gudang_besar');
            if (isGb) {
                loadPickTasks(true);
            }
        }, 4000);
    };

    window.stopPickTaskAutoPolling = function() {
        if (pickTaskPollTimer) {
            clearInterval(pickTaskPollTimer);
            pickTaskPollTimer = null;
        }
    };

    window.focusNewestPickTask = function() {
        const banner = document.getElementById('newPickTaskAlert');
        if (banner) banner.style.display = 'none';

        // Switch chip filter to PENDING
        const pendingChip = document.querySelector('.pick-filter-chip[data-status="PENDING"]');
        filterPickTasks('PENDING', pendingChip);

        const feed = document.getElementById('pickTasksFeed');
        if (feed) {
            feed.scrollTop = 0;
            const firstCard = feed.querySelector('.pick-task-card.pending');
            if (firstCard) {
                firstCard.classList.add('highlight-glow');
                setTimeout(() => firstCard.classList.remove('highlight-glow'), 3500);
            }
        }
    };

    function updatePickCounters() {
        const pendingCount = AppState.pickTasks.filter(t => t.status === 'PENDING').length;
        const completedCount = AppState.pickTasks.filter(t => t.status === 'COMPLETED').length;

        const badgeP = document.getElementById('badgePickPending');
        if (badgeP) badgeP.textContent = pendingCount;
        const badgeC = document.getElementById('badgePickCompleted');
        if (badgeC) badgeC.textContent = completedCount;

        const bubble = document.getElementById('bubblePickTask');
        if (bubble) {
            if (pendingCount > 0) {
                bubble.textContent = pendingCount;
                bubble.style.display = 'inline-flex';
            } else {
                bubble.style.display = 'none';
            }
        }
    }

    window.filterPickTasks = function(status, btn) {
        AppState.activePickFilter = status;
        document.querySelectorAll('.pick-filter-chip').forEach(c => c.classList.remove('active'));
        if (btn) btn.classList.add('active');
        renderPickTasks();
    };

    window.searchPickTasks = function(term) {
        pickTaskSearchTerm = (term || '').trim().toLowerCase();
        renderPickTasks();
    };

    function renderPickTasks() {
        const feed = document.getElementById('pickTasksFeed');
        if (!feed) return;

        let filtered = AppState.pickTasks;
        if (AppState.activePickFilter !== 'ALL') {
            filtered = filtered.filter(t => t.status === AppState.activePickFilter);
        }
        if (pickTaskSearchTerm) {
            filtered = filtered.filter(t => 
                (t.sku || '').toLowerCase().includes(pickTaskSearchTerm) ||
                (t.product_name || '').toLowerCase().includes(pickTaskSearchTerm) ||
                (t.request_no || '').toLowerCase().includes(pickTaskSearchTerm) ||
                (t.bin_code || '').toLowerCase().includes(pickTaskSearchTerm) ||
                (t.requested_by || '').toLowerCase().includes(pickTaskSearchTerm)
            );
        }

        if (filtered.length === 0) {
            feed.innerHTML = `
                <div class="empty-feed">
                    <i class="fa-solid fa-clipboard-check" style="font-size: 2rem; opacity: 0.35; margin-bottom: 0.5rem; display: block;"></i>
                    Tidak ada task pick yang sesuai kriteria.
                </div>
            `;
            return;
        }

        feed.innerHTML = filtered.map(task => {
            const isPending = task.status === 'PENDING';
            const isCompleted = task.status === 'COMPLETED';
            const statusClass = isPending ? 'pending' : (isCompleted ? 'completed' : 'rejected');
            const statusText = isPending ? 'Menunggu Pick' : (isCompleted ? 'Selesai Dipick' : task.status);

            let actionArea = '';
            if (isPending) {
                actionArea = `
                    <button type="button" class="btn-pick-action" onclick='openPickModal(${JSON.stringify(task).replace(/'/g, "&#39;")})'>
                        <i class="fa-solid fa-dolly"></i> Ambil Barang (Pick)
                    </button>
                `;
            } else if (isCompleted) {
                actionArea = `
                    <div class="pick-completed-info">
                        <div class="completed-badge-row">
                            <span class="info-pill gb-rack"><i class="fa-solid fa-warehouse"></i> Rak: <strong>${task.rack_gudang_besar || '-'}</strong></span>
                            <span class="info-pill batch"><i class="fa-solid fa-barcode"></i> Batch: <strong>${task.batch_number || '-'}</strong></span>
                        </div>
                        <small class="completed-meta">Dipick oleh <strong>${task.picked_by || task.processed_by || 'Operator GB'}</strong> • ${task.picked_qty || task.qty_request} Pcs</small>
                    </div>
                `;
            }

            return `
                <div class="pick-task-card ${statusClass}">
                    <div class="task-card-header">
                        <div class="task-no-group">
                            <span class="task-no">${task.request_no}</span>
                            <span class="task-time"><i class="fa-regular fa-clock"></i> ${(task.created_at || '').substring(0, 16)}</span>
                        </div>
                        <span class="badge-status ${statusClass}">${statusText}</span>
                    </div>

                    <div class="task-location-row">
                        <span class="loc-bin-tag"><i class="fa-solid fa-location-dot"></i> Rak Tujuan: <strong>${task.bin_code}</strong></span>
                        <span class="requester-tag"><i class="fa-solid fa-user"></i> ${task.requested_by}</span>
                    </div>

                    <div class="task-prod-info">
                        <h4 class="task-prod-name">${task.product_name}</h4>
                        <div class="task-prod-meta">
                            <span>SKU: <strong>${task.sku}</strong></span>
                            <span>Barcode: ${task.barcode || '-'}</span>
                        </div>
                    </div>

                    <div class="task-qty-boxes">
                        <div class="qty-box requested">
                            <small>Diminta Gudang Kecil</small>
                            <strong>${task.qty_request} Pcs</strong>
                        </div>
                        <div class="qty-box besar">
                            <small>Stok Gudang Besar</small>
                            <strong>${task.qty_gudang_besar} Pcs</strong>
                        </div>
                    </div>

                    ${actionArea}
                </div>
            `;
        }).join('');
    }

    window.openPickModal = function(task) {
        document.getElementById('pickTaskId').value = task.id;
        document.getElementById('modalPickReqNo').textContent = task.request_no;
        document.getElementById('pickProdName').textContent = task.product_name;
        document.getElementById('pickSku').textContent = task.sku;
        document.getElementById('pickDestBin').textContent = task.bin_code;
        document.getElementById('pickQtyRequested').textContent = `${task.qty_request} Pcs`;
        document.getElementById('pickAvailableBesar').textContent = `${task.qty_gudang_besar} Pcs`;
        document.getElementById('pickRequestedBy').textContent = task.requested_by;

        const inputQty = document.getElementById('inputPickQty');
        inputQty.value = task.qty_request;
        inputQty.max = task.qty_gudang_besar;

        document.getElementById('inputPickRackBesar').value = '';
        document.getElementById('inputPickBatchNumber').value = '';
        document.getElementById('inputPickNotes').value = '';

        openModal('modalPickTask');
        setTimeout(() => document.getElementById('inputPickRackBesar').focus(), 150);
    };

    window.suggestPickRack = function() {
        const racks = ['GB-RAK-01', 'GB-RAK-02', 'GB-B01-01', 'GB-B02-01', 'GB-C03-01', 'GB-BULK-A1'];
        const randomRack = racks[Math.floor(Math.random() * racks.length)];
        document.getElementById('inputPickRackBesar').value = randomRack;
        showToast(`Lokasi rak Gudang Besar diisi: ${randomRack}`, 'info');
    };

    window.generateDemoBatch = function() {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 6));
        const randomNum = Math.floor(100 + Math.random() * 900);
        const batch = `BATCH-${dateStr}-${randomLetter}${randomNum}`;
        document.getElementById('inputPickBatchNumber').value = batch;
        showToast(`Batch number diisi: ${batch}`, 'info');
    };

    window.submitPickTask = async function(e) {
        e.preventDefault();
        const id = document.getElementById('pickTaskId').value;
        const rackBesar = document.getElementById('inputPickRackBesar').value.trim();
        const batchNumber = document.getElementById('inputPickBatchNumber').value.trim();
        const pickedQty = parseInt(document.getElementById('inputPickQty').value, 10);
        const notes = document.getElementById('inputPickNotes').value.trim();

        if (!rackBesar) {
            showToast('Lokasi Rack Gudang Besar wajib diisi.', 'warning');
            return;
        }
        if (!batchNumber) {
            showToast('Batch Number barang wajib diisi.', 'warning');
            return;
        }

        const btn = document.getElementById('btnSubmitPick');
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses Pick...`;

        try {
            const formData = new FormData();
            formData.append('action', 'complete_pick_task');
            formData.append('id', id);
            formData.append('rack_gudang_besar', rackBesar);
            formData.append('batch_number', batchNumber);
            formData.append('picked_qty', pickedQty);
            formData.append('notes', notes);

            const res = await fetch('api.php', { method: 'POST', body: formData, credentials: 'same-origin' });
            const json = await res.json();

            if (json.status === 'success') {
                showToast(json.message, 'success');
                closeModal('modalPickTask');
                loadPickTasks();
                loadOperatorHistory();
                loadOpStockSearchList();
                if (document.getElementById('tabDashboard') && document.getElementById('tabDashboard').classList.contains('active')) {
                    loadDashboardStats();
                }
                if (document.getElementById('tabReplenish') && document.getElementById('tabReplenish').classList.contains('active')) {
                    loadAdminReplenish();
                }
            } else {
                showToast(json.message || 'Gagal menyelesaikan task pick.', 'error');
            }
        } catch (err) {
            showToast('Gagal menghubungi server: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check"></i> Selesaikan Pick & Transfer Stok`;
        }
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
        if (AppState.user) writeCachedSession(AppState.user, tabId);

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
            tabMinusStock: { title: 'Stok Minus Gudang Kecil', sub: 'Daftar SKU dengan saldo Gudang Kecil minus atau habis' },
            tabUsers: { title: 'Manajemen Pengguna', sub: 'Kelola akun login Operator Gudang dan Administrator' }
        };

        if (titles[tabId]) {
            // The topbar was redesigned without a subtitle line; guard both so a
            // missing node cannot abort the rest of the tab switch.
            if (adminPageTitle) adminPageTitle.textContent = titles[tabId].title;
            if (adminPageSubtitle) adminPageSubtitle.textContent = titles[tabId].sub;
            const breadcrumbCurrent = document.getElementById('breadcrumbCurrent');
            if (breadcrumbCurrent) {
                const shortTitles = {
                    tabDashboard: 'Dashboard',
                    tabSkuRacks: 'Master SKU-Rack',
                    tabReplenish: 'Replenishment',
                    tabStocks: 'Stok OCS',
                    tabMinusStock: 'Stok Minus',
                    tabUsers: 'Pengguna'
                };
                breadcrumbCurrent.textContent = shortTitles[tabId] || titles[tabId].title;
            }
        }

        if (tabId === 'tabDashboard') loadDashboardStats();
        if (tabId === 'tabSkuRacks') loadSkuRacks();
        if (tabId === 'tabReplenish') loadAdminReplenish();
        if (tabId === 'tabStocks') loadStockList();
        if (tabId === 'tabMinusStock') loadMinusStock();
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
                if (badgeMinusCount) {
                    const minus = d.minus_stock_count || 0;
                    badgeMinusCount.textContent = minus;
                    badgeMinusCount.style.display = minus > 0 ? '' : 'none';
                }
                const elNeg = document.getElementById('minusCountNegative');
                const elZero = document.getElementById('minusCountZero');
                if (elNeg) elNeg.textContent = (d.minus_stock_count || 0).toLocaleString('id-ID');
                if (elZero) elZero.textContent = (d.empty_stock_count || 0).toLocaleString('id-ID');
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
                    <td class="col-sku"><strong class="sku-tag" style="color: #0f172a; white-space: nowrap; display: inline-block;">${r.sku}</strong><br><small style="color: var(--text-muted);">${r.product_name}</small></td>
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

        skuRacksTableBody.innerHTML = items.map(r => {
            // OCS returns some SKUs with no physical bin yet; the sync stores a
            // synthetic "BIN-<sku>" key for those. Show them as unmapped instead
            // of echoing the SKU back in both location columns.
            const sku = r.sku || '';
            const binCode = r.bin_code || '';
            const isUnmapped = binCode.toUpperCase() === ('BIN-' + sku).toUpperCase();
            const area = (r.notes || '').replace(/^Area:\s*/i, '').trim();

            const binCell = isUnmapped
                ? `<span class="bin-unmapped-tag"><i class="fa-solid fa-circle-question"></i> Belum Dipetakan</span>`
                : `<strong class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${binCode}</strong>`;

            let rackLabel = r.rack_name || '';
            if (isUnmapped || !rackLabel || rackLabel.toUpperCase() === binCode.toUpperCase()) {
                rackLabel = isUnmapped ? (area ? `Area ${area}` : 'Belum ada lokasi rak') : `Rak ${binCode}`;
            }

            return `
            <tr>
                <td class="col-sku"><code style="white-space: nowrap;">${sku}</code></td>
                <td><strong style="color: #0f172a;">${r.product_name}</strong></td>
                <td><span style="font-family: var(--font-mono); font-size: 0.82rem; color: #475569;">${r.barcode || '-'}</span></td>
                <td><span style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.78rem; font-weight: 600;">${r.category || 'General'}</span></td>
                <td>${binCell}</td>
                <td><strong>${rackLabel}</strong>${(!isUnmapped && area) ? `<br><small style="color: var(--text-muted);">Area: ${area}</small>` : ''}</td>
                <td><small style="color: var(--text-muted); font-family: var(--font-mono);">${(r.created_at || '').substring(0, 10)}</small></td>
                <td class="td-center">
                    <div style="display: flex; gap: 0.35rem; justify-content: center;">
                        <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem;" title="Edit Lokasi" onclick="openModalEditRack(${r.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem; color: var(--danger);" title="Hapus Lokasi" onclick="deleteSkuRack(${r.id}, '${r.bin_code}')"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `;
        }).join('');
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
            adminReplenishTableBody.innerHTML = `<tr><td colspan="11" class="td-center py-4 text-danger">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    function renderAdminReplenishTable(items) {
        if (!items || items.length === 0) {
            adminReplenishTableBody.innerHTML = `<tr><td colspan="11" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-inbox" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; opacity: 0.4;"></i>Tidak ada data permintaan replenish yang ditemukan.</td></tr>`;
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
                        <button class="btn-primary-clean" style="padding: 0.35rem 0.65rem; background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%); font-size: 0.78rem;" title="Pick Barang Gudang Besar" onclick='openPickModal(${JSON.stringify(r).replace(/'/g, "&#39;")})'><i class="fa-solid fa-dolly"></i> Pick</button>
                        <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem; color: var(--danger); font-size: 0.78rem;" title="Tolak Mutasi" onclick="updateReplenishStatus(${r.id}, 'REJECTED')"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                `;
            } else if (isApproved) {
                actionsHtml = `
                    <div style="display: flex; gap: 0.35rem; justify-content: center;">
                        <button class="btn-primary-clean" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" title="Selesaikan Mutasi Fisik" onclick='openPickModal(${JSON.stringify(r).replace(/'/g, "&#39;")})'><i class="fa-solid fa-dolly"></i> Selesaikan</button>
                    </div>
                `;
            } else {
                actionsHtml = `<small style="color: var(--text-muted); font-weight: 600;"><i class="fa-solid fa-check-double text-green"></i> Selesai</small>`;
            }

            const rackBesarHtml = r.rack_gudang_besar 
                ? `<span class="loc-bin-tag" style="background: rgba(234, 88, 12, 0.1); color: #c2410c; border: 1px solid rgba(234, 88, 12, 0.25);"><i class="fa-solid fa-warehouse"></i> ${r.rack_gudang_besar}</span>` 
                : '<span style="color: var(--text-muted); font-style: italic;">Belum di-pick</span>';

            const batchHtml = r.batch_number 
                ? `<span class="loc-bin-tag" style="background: rgba(79, 70, 229, 0.08); color: #4338ca; border: 1px solid rgba(79, 70, 229, 0.2);"><i class="fa-solid fa-barcode"></i> ${r.batch_number}</span>` 
                : '<span style="color: var(--text-muted); font-style: italic;">-</span>';

            return `
                <tr>
                    <td><strong>${r.request_no}</strong></td>
                    <td><small style="color: var(--text-muted); font-family: var(--font-mono);">${(r.created_at || '').substring(0, 16)}</small></td>
                    <td><span class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${r.bin_code}</span></td>
                    <td class="col-sku"><strong class="sku-tag" style="color: #0f172a; white-space: nowrap; display: inline-block;">${r.sku}</strong><br><small style="color: var(--text-muted);">${r.product_name}</small></td>
                    <td class="td-right"><strong style="font-size: 1.05rem; color: var(--primary); font-family: var(--font-mono);">${r.qty_request} Pcs</strong></td>
                    <td class="td-right"><span class="stock-pill default" style="font-family: var(--font-mono); font-weight: 700; font-size: 0.92rem; padding: 0.25rem 0.55rem; border-radius: 6px; background: rgba(59, 130, 246, 0.08); color: #1d4ed8; border: 1px solid rgba(59, 130, 246, 0.2);">${r.qty_gudang_besar ?? 0} Pcs</span></td>
                    <td><span style="font-weight: 600;">${r.requested_by}</span></td>
                    <td>${rackBesarHtml}</td>
                    <td>${batchHtml}</td>
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
                <td class="col-sku"><code style="white-space: nowrap;">${s.sku}</code></td>
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

    // =========================================================================
    // 7B. STOK MINUS GUDANG KECIL
    // =========================================================================

    window.loadMinusStock = async function() {
        if (!minusStockTableBody) return;
        const search = searchMinusStock ? searchMinusStock.value.trim() : '';
        minusStockTableBody.innerHTML = `<tr><td colspan="8" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data stok minus...</td></tr>`;

        try {
            const url = `api.php?action=get_negative_stocks&threshold=${AppState.minusThreshold}&search=${encodeURIComponent(search)}`;
            const res = await fetch(url, { credentials: 'same-origin' });
            const json = await res.json();
            if (json.status === 'success') {
                AppState.minusStocks = json.data;
                renderMinusStockTable(json.data);
                const elRows = document.getElementById('minusCountRows');
                if (elRows) elRows.textContent = (json.total_rows || 0).toLocaleString('id-ID');
            } else {
                minusStockTableBody.innerHTML = `<tr><td colspan="8" class="td-center py-4" style="color: var(--danger);">${json.message || 'Gagal memuat data.'}</td></tr>`;
            }
        } catch (err) {
            minusStockTableBody.innerHTML = `<tr><td colspan="8" class="td-center py-4" style="color: var(--danger);">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    function renderMinusStockTable(items) {
        if (!items || items.length === 0) {
            minusStockTableBody.innerHTML = `<tr><td colspan="8" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-circle-check" style="color: var(--success); font-size: 1.4rem; display: block; margin-bottom: 0.5rem;"></i>Tidak ada stok Gudang Kecil yang minus untuk filter ini.</td></tr>`;
            return;
        }

        minusStockTableBody.innerHTML = items.map(s => {
            const kecil = Number(s.qty_gudang_kecil || 0);
            const qtyClass = kecil < 0 ? 'qty-minus' : (kecil === 0 ? 'qty-warn' : '');
            const binLabel = s.bin_code && !String(s.bin_code).toUpperCase().startsWith('BIN-' + String(s.sku).toUpperCase())
                ? `<strong class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${s.bin_code}</strong><br><small style="color: var(--text-muted);">${s.rack_name || ''}</small>`
                : `<span class="bin-unmapped-tag"><i class="fa-solid fa-circle-question"></i> Belum Dipetakan</span>`;

            return `
                <tr>
                    <td class="col-sku"><code style="white-space: nowrap;">${s.sku}</code></td>
                    <td><strong style="color: #0f172a;">${s.product_name || '-'}</strong></td>
                    <td><span style="font-family: var(--font-mono); font-size: 0.82rem; color: #475569;">${s.barcode || '-'}</span></td>
                    <td>${binLabel}</td>
                    <td class="td-right"><strong class="${qtyClass}">${kecil.toLocaleString('id-ID')}</strong></td>
                    <td class="td-right">${Number(s.qty_gudang_besar || 0).toLocaleString('id-ID')}</td>
                    <td class="td-right">${Number(s.qty_on_hand || 0).toLocaleString('id-ID')}</td>
                    <td><small style="color: var(--text-muted); font-family: var(--font-mono);">${(s.last_synced_at || '-').substring(0, 16)}</small></td>
                </tr>
            `;
        }).join('');
    }

    if (searchMinusStock) {
        searchMinusStock.addEventListener('input', debounce(() => loadMinusStock(), 300));
    }

    if (minusThresholdFilters) {
        minusThresholdFilters.querySelectorAll('.pill-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                minusThresholdFilters.querySelectorAll('.pill-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                AppState.minusThreshold = Number(btn.getAttribute('data-threshold'));
                loadMinusStock();
            });
        });
    }

    // =========================================================================
    // 7C. UNIFIED OCS SYNC (SKU-RACK + STOK, ONE BUTTON)
    // =========================================================================

    function syncLog(html) {
        syncLogBox.innerHTML += html;
        syncLogBox.scrollTop = syncLogBox.scrollHeight;
    }

    // One button now covers both halves of the OCS import: the SKU-Rack mapping
    // has to land first, because the stock pass relies on its barcode map to
    // resolve rows the stock feed leaves blank.
    window.runFullOcsSync = async function() {
        if (AppState.isSyncing) return;
        AppState.isSyncing = true;

        syncProgressBar.style.width = '8%';
        syncStepStatus.textContent = 'Menghubungkan ke OCS Cloud API...';
        syncItemCounter.textContent = 'Memulai...';
        syncLogBox.innerHTML = `<div class="log-entry info">[START] Membuka sesi otentikasi OCS Cloud...</div>`;
        btnCloseSyncModal.disabled = true;
        openModal('modalSyncProgress');

        let rackCount = 0;
        let stockCount = 0;
        let failed = false;

        try {
            // --- Tahap 1: Master SKU-Rack & Barcode ---
            syncProgressBar.style.width = '20%';
            syncStepStatus.textContent = 'Tahap 1/2 - Sinkronisasi Master SKU-Rack & Barcode...';
            syncLog(`<div class="log-entry info">[OData] DTO_WmsItems + DTO_LookupStockDetailedData...</div>`);

            const resRack = await fetch('api.php?action=sync_sku_racks_from_ocs', { credentials: 'same-origin' });
            const jsonRack = await resRack.json();

            if (jsonRack.status === 'success') {
                rackCount = jsonRack.total_synced || 0;
                syncProgressBar.style.width = '55%';
                syncItemCounter.textContent = `${rackCount} Lokasi`;
                syncLog(`<div class="log-entry success">[SUCCESS] ${rackCount} pemetaan Bin Code tersimpan.</div>`);
            } else {
                failed = true;
                syncLog(`<div class="log-entry error">[ERROR] Tahap SKU-Rack gagal: ${jsonRack.message}</div>`);
            }

            // --- Tahap 2: Saldo Stok (tetap dijalankan agar saldo tidak basi) ---
            syncProgressBar.style.width = '65%';
            syncStepStatus.textContent = 'Tahap 2/2 - Sinkronisasi Saldo Stok OCS...';
            syncLog(`<div class="log-entry info">[OData] DTO_WmsItemStockLiteV2 dengan pagination looping...</div>`);

            const resStock = await fetch('api.php?action=sync_all_stock', { credentials: 'same-origin' });
            const jsonStock = await resStock.json();

            if (jsonStock.status === 'success') {
                stockCount = jsonStock.total_synced || 0;
                syncLog(`<div class="log-entry success">[SUCCESS] ${stockCount} item stok tersimpan (Gudang Besar & Kecil).</div>`);
            } else {
                failed = true;
                syncLog(`<div class="log-entry error">[ERROR] Tahap Stok gagal: ${jsonStock.message}</div>`);
            }

            syncProgressBar.style.width = '100%';
            syncItemCounter.textContent = `${rackCount} Lokasi / ${stockCount} Item`;

            if (failed) {
                syncStepStatus.textContent = 'Sinkronisasi Selesai Sebagian';
                showToast('Sync selesai sebagian - cek log untuk detail.', 'error');
            } else {
                syncStepStatus.textContent = 'Sinkronisasi Selesai!';
                syncLog(`<div class="log-entry info">[DONE] Waktu: ${new Date().toLocaleString('id-ID')}</div>`);
                showToast(`🎉 Sync OCS selesai: ${rackCount} lokasi & ${stockCount} item stok.`, 'success');
            }

            loadSkuRacks();
            loadStockList();
            loadMinusStock();
            loadDashboardStats();
        } catch (err) {
            syncStepStatus.textContent = 'Error Koneksi';
            syncLog(`<div class="log-entry error">[EXCEPTION] ${err.message}</div>`);
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
            let roleBadge = '';
            if (u.role === 'admin') {
                roleBadge = '<span class="badge-status approved"><i class="fa-solid fa-shield"></i> Administrator</span>';
            } else if (u.role === 'gudang_besar') {
                roleBadge = '<span class="badge-status ready" style="background: rgba(234, 88, 12, 0.12); color: #c2410c; border: 1px solid rgba(234, 88, 12, 0.25);"><i class="fa-solid fa-warehouse"></i> Gudang Besar</span>';
            } else if (u.role === 'gudang_kecil') {
                roleBadge = '<span class="badge-status warning" style="background: rgba(79, 70, 229, 0.1); color: #4338ca; border: 1px solid rgba(79, 70, 229, 0.25);"><i class="fa-solid fa-box-open"></i> Gudang Kecil</span>';
            } else {
                roleBadge = '<span class="badge-status completed"><i class="fa-solid fa-mobile-screen"></i> Operator PDA</span>';
            }

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

    // Bootstrapped last so every window.* handler declared above already exists
    // by the time an optimistically restored session paints its view.
    checkSession();

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
});
