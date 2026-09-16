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
        minusAssignFilter: 'ALL',
        selectedMinusSkus: new Set(),
        selectedMinusItems: new Map(),
        selectedReplenishIds: new Set(),
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

    /**
     * Checks if a bin_code is a synthetic fallback created when OCS has no physical rack for the SKU.
     */
    function isSyntheticBin(binCode, sku) {
        if (!binCode) return true;
        const b = String(binCode).trim().toUpperCase();
        if (!sku) {
            return b.startsWith('BIN-') && b.length > 8;
        }
        const s = String(sku).trim().toUpperCase();
        return b === ('BIN-' + s) || b === ('LOKASI BIN-' + s) || b.startsWith('BIN-' + s);
    }

    /**
     * Renders clean badge for a rack location, gracefully handling unmapped/synthetic bins.
     */
    function formatBinBadge(binCode, sku, defaultText = 'Belum ada rak') {
        if (isSyntheticBin(binCode, sku)) {
            return `<span class="bin-unmapped-tag" style="color: #94a3b8; font-size: 0.76rem;"><i class="fa-regular fa-circle-question"></i> ${defaultText}</span>`;
        }
        return `<span class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${binCode}</span>`;
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
                    if (badgeLabel) badgeLabel.textContent = 'Gudang Besar';
                } else {
                    if (opBadge) {
                        opBadge.classList.add('gudang-kecil');
                        opBadge.classList.remove('gudang-besar');
                    }
                    if (badgeIcon) badgeIcon.className = 'fa-solid fa-box-open';
                    if (badgeLabel) badgeLabel.textContent = 'Gudang Kecil';
                }

                const opTag = document.getElementById('opProfileRoleTag');
                if (opTag) {
                    opTag.textContent = effectiveWh === 'gudang_besar' ? 'Operator Gudang Besar (Replenish)' : 'Operator Gudang Kecil (Req Replenish)';
                }

                const profWhName = document.getElementById('profileWhName');
                const profWhDesc = document.getElementById('profileWhDesc');
                const profWhIcon = document.getElementById('profileWhIcon');
                if (profWhName) profWhName.textContent = effectiveWh === 'gudang_besar' ? 'Gudang Besar' : 'Gudang Kecil';
                if (profWhDesc) profWhDesc.textContent = effectiveWh === 'gudang_besar' ? 'Area Main Storage • Mengerjakan Replenish' : 'Area Picking Rack • Req Replenish';
                const homeOpName = document.getElementById('homeOperatorName');
                if (homeOpName) homeOpName.textContent = AppState.user.full_name || AppState.user.username || 'Operator Gudang';

                applyWarehouseModeUI(effectiveWh);
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
                const roleLabel = AppState.user.role === 'superadmin' ? 'SUPERADMIN' : (AppState.user.username || 'ADMIN').toUpperCase();
                if (adminUserRole) adminUserRole.textContent = '@' + roleLabel;
            }
        }
    }

    function applyWarehouseModeUI(effectiveWh) {
        // All tabs (Home, Req Replenish, Replenish, Cek Stok, Akun) are always available in the Android menu
        const btnNavScan = document.getElementById('btnNavScan');
        if (btnNavScan) {
            btnNavScan.style.display = 'flex';
        }
    }

    // =========================================================================
    // 2. AUTHENTICATION & SESSION HANDLING
    // =========================================================================

    function routeForUser(user, preferredTab) {
        AppState.user = user;
        const isAdminRole = user.role === 'admin' || user.role === 'superadmin';

        if (isAdminRole) {
            stopPickTaskAutoPolling();
            switchView('admin');
            const tab = preferredTab || AppState.activeAdminTab || 'tabDashboard';
            if (document.getElementById(tab)) switchAdminTab(tab);
        } else {
            // Operator Role: Direct access to Android-style home menu or specified tab
            switchView('operator');
            startPickTaskAutoPolling();
            const targetTab = (preferredTab && document.getElementById(preferredTab)) ? preferredTab : 'opTabHome';
            switchMobileTab(targetTab);
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
                const isAdmin = data.user.role === 'admin' || data.user.role === 'superadmin';
                const initialTab = isAdmin ? 'tabDashboard' : 'opTabHome';
                
                writeCachedSession(data.user, initialTab, data.session_token);
                showToast(`Login berhasil sebagai ${data.user.full_name || data.user.username}`, 'success');
                routeForUser(data.user, initialTab);
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
                applyWarehouseModeUI(targetWarehouse);
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
        if (window.closeCameraScanner) window.closeCameraScanner();
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
        if (window.closeCameraScanner) window.closeCameraScanner();

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

        if (tabId === 'opTabHome') {
            loadPickTasks();
            loadOperatorHistory();
            loadOpStockSearchList();
        } else if (tabId === 'opTabScan') {
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
    window.executeBinScan = executeBinScan;

    // =========================================================================
    // 3A. CAMERA LIVE BARCODE & QR SCANNER (OPERATOR)
    // =========================================================================
    let html5QrScannerInstance = null;
    let cameraScannerActive = false;
    let activeCameraId = null;
    let availableCamerasList = [];
    let isTorchEnabled = false;
    let cameraScanTargetInput = 'inputBinCode';
    let cameraScanSuccessHandler = null;

    const modalCameraScanner = document.getElementById('modalCameraScanner');
    const cameraLoadingIndicator = document.getElementById('cameraLoadingIndicator');
    const cameraErrorAlert = document.getElementById('cameraErrorAlert');
    const btnToggleTorch = document.getElementById('btnToggleTorch');
    const btnSwitchCamera = document.getElementById('btnSwitchCamera');
    const inputManualScanCode = document.getElementById('inputManualScanCode');
    const cameraTargetHint = document.getElementById('cameraTargetHint');

    window.openCameraScanner = async function(targetInputId = 'inputBinCode', onSuccessCallback = null) {
        cameraScanTargetInput = targetInputId || 'inputBinCode';
        cameraScanSuccessHandler = onSuccessCallback || null;

        const cameraModalHeading = document.querySelector('.camera-modal-heading');

        if (cameraTargetHint) {
            if (cameraScanTargetInput === 'inputPickRackBesar') {
                if (cameraModalHeading) cameraModalHeading.textContent = 'Scan Lokasi Rak Gudang Besar';
                cameraTargetHint.textContent = 'Scan barcode / QR lokasi rak Gudang Besar';
            } else if (cameraScanTargetInput === 'inputPickBatchNumber') {
                if (cameraModalHeading) cameraModalHeading.textContent = 'Scan Batch Number / Lot';
                cameraTargetHint.textContent = 'Scan barcode batch number / lot produk';
            } else if (cameraScanTargetInput === 'opStockSearchInput') {
                if (cameraModalHeading) cameraModalHeading.textContent = 'Scan Barcode / QR Cek Stok';
                cameraTargetHint.textContent = 'Arahkan kamera ke Barcode SKU, Produk, atau Bin Rak';
            } else {
                if (cameraModalHeading) cameraModalHeading.textContent = 'Scan Barcode / QR Rak';
                cameraTargetHint.textContent = 'Arahkan kamera ke Bin Code lokasi rak';
            }
        }

        if (inputManualScanCode) {
            inputManualScanCode.value = '';
            if (cameraScanTargetInput === 'opStockSearchInput') {
                inputManualScanCode.placeholder = 'Atau ketik SKU / Barcode / Bin...';
            } else {
                inputManualScanCode.placeholder = 'Atau ketik Bin Code (cth: PL-17-01-01)...';
            }
        }
        if (cameraErrorAlert) {
            cameraErrorAlert.style.display = 'none';
            cameraErrorAlert.textContent = '';
        }
        if (cameraLoadingIndicator) {
            cameraLoadingIndicator.style.display = 'flex';
        }
        if (btnToggleTorch) {
            btnToggleTorch.style.display = 'none';
            btnToggleTorch.classList.remove('active');
            isTorchEnabled = false;
        }
        if (btnSwitchCamera) {
            btnSwitchCamera.style.display = 'none';
        }

        if (modalCameraScanner) {
            modalCameraScanner.classList.add('active');
        }

        // Check library availability
        if (typeof Html5Qrcode === 'undefined') {
            if (cameraLoadingIndicator) cameraLoadingIndicator.style.display = 'none';
            showCameraError('Library barcode scanner belum siap. Silakan refresh halaman.');
            return;
        }

        // Browser mediaDevices check
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (cameraLoadingIndicator) cameraLoadingIndicator.style.display = 'none';
            if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                showCameraError('Akses kamera di browser memerlukan koneksi aman HTTPS atau localhost/127.0.0.1.');
            } else {
                showCameraError('Browser ini tidak mendukung akses kamera HTML5.');
            }
            return;
        }

        try {
            await startCameraLiveFeed();
        } catch (err) {
            console.error('Failed to start camera:', err);
            if (cameraLoadingIndicator) cameraLoadingIndicator.style.display = 'none';
            showCameraError(formatCameraError(err));
        }
    };

    function showCameraError(msg) {
        if (cameraErrorAlert) {
            cameraErrorAlert.style.display = 'block';
            cameraErrorAlert.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${msg}`;
        }
        showToast(msg, 'error');
    }

    function formatCameraError(err) {
        const str = (err && (err.message || err.name || String(err))) || '';
        if (str.includes('NotAllowedError') || str.includes('Permission denied') || str.includes('PermissionDismissedError')) {
            return 'Izin kamera ditolak. Mohon izinkan akses kamera di setelan browser Anda.';
        }
        if (str.includes('NotFoundError') || str.includes('DevicesNotFoundError')) {
            return 'Kamera tidak ditemukan pada perangkat ini.';
        }
        if (str.includes('NotReadableError') || str.includes('TrackStartError')) {
            return 'Kamera sedang digunakan oleh aplikasi lain.';
        }
        if (str.includes('OverconstrainedError')) {
            return 'Parameter kamera tidak didukung oleh perangkat.';
        }
        return 'Gagal mengakses kamera: ' + (err.message || str || 'Terjadi kesalahan sistem.');
    }

    async function startCameraLiveFeed(preferredCameraId = null) {
        if (cameraLoadingIndicator) cameraLoadingIndicator.style.display = 'flex';
        if (cameraErrorAlert) cameraErrorAlert.style.display = 'none';

        if (html5QrScannerInstance) {
            try {
                if (html5QrScannerInstance.isScanning) {
                    await html5QrScannerInstance.stop();
                }
                await html5QrScannerInstance.clear();
            } catch (e) {
                console.warn('Cleanup old camera instance:', e);
            }
            html5QrScannerInstance = null;
        }

        html5QrScannerInstance = new Html5Qrcode('cameraScanViewport', {
            verbose: false,
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            }
        });

        // Enumerate cameras
        try {
            availableCamerasList = await Html5Qrcode.getCameras();
            if (availableCamerasList && availableCamerasList.length > 1) {
                if (btnSwitchCamera) btnSwitchCamera.style.display = 'flex';
            }
        } catch (e) {
            availableCamerasList = [];
        }

        let cameraConfig = { facingMode: 'environment' };
        if (preferredCameraId) {
            cameraConfig = preferredCameraId;
            activeCameraId = preferredCameraId;
        } else if (availableCamerasList.length > 0) {
            const rearCam = availableCamerasList.find(c => 
                c.label && (c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear') || c.label.toLowerCase().includes('belakang') || c.label.toLowerCase().includes('environment'))
            );
            if (rearCam) {
                activeCameraId = rearCam.id;
                cameraConfig = rearCam.id;
            } else {
                activeCameraId = availableCamerasList[0].id;
                cameraConfig = availableCamerasList[0].id;
            }
        }

        const scanConfig = {
            fps: 20,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const width = Math.min(Math.floor(viewfinderWidth * 0.86), 360);
                const height = Math.min(Math.floor(viewfinderHeight * 0.65), 240);
                return { width, height };
            },
            aspectRatio: 1.0
        };

        await html5QrScannerInstance.start(
            cameraConfig,
            scanConfig,
            onCameraScanSuccess,
            (errorMessage) => {
                // Ignore continuous frame-by-frame miss
            }
        );

        cameraScannerActive = true;
        if (cameraLoadingIndicator) cameraLoadingIndicator.style.display = 'none';

        try {
            const capabilities = html5QrScannerInstance.getRunningTrackCameraCapabilities();
            if (capabilities && typeof capabilities.torchFeature === 'function' && capabilities.torchFeature().isSupported()) {
                if (btnToggleTorch) btnToggleTorch.style.display = 'flex';
            }
        } catch (e) {}
    }

    function onCameraScanSuccess(decodedText, decodedResult) {
        if (!decodedText) return;
        const code = decodedText.trim();
        if (!code) return;

        playBarcodeBeep();
        if (navigator.vibrate) {
            try { navigator.vibrate(120); } catch (e) {}
        }

        window.closeCameraScanner();

        if (typeof cameraScanSuccessHandler === 'function') {
            cameraScanSuccessHandler(code);
            return;
        }

        if (cameraScanTargetInput === 'inputBinCode') {
            if (inputBinCode) {
                inputBinCode.value = code;
            }
            executeBinScan(code);
            showToast(`Berhasil scan Bin: ${code}`, 'success');
        } else if (cameraScanTargetInput === 'opStockSearchInput') {
            if (opStockSearchInput) {
                opStockSearchInput.value = code;
            }
            const btnClear = document.getElementById('btnClearOpStockSearch');
            if (btnClear) btnClear.style.display = 'flex';
            filterOpStockList();
            showToast(`Hasil scan stok: ${code}`, 'success');
        } else {
            const targetEl = document.getElementById(cameraScanTargetInput);
            if (targetEl) {
                targetEl.value = code;
                targetEl.focus();
                showToast(`Kode terscan: ${code}`, 'success');
            }
        }
    }

    window.closeCameraScanner = async function() {
        if (html5QrScannerInstance) {
            try {
                if (html5QrScannerInstance.isScanning) {
                    await html5QrScannerInstance.stop();
                }
                await html5QrScannerInstance.clear();
            } catch (e) {
                console.warn('Error stopping camera:', e);
            }
            html5QrScannerInstance = null;
        }

        cameraScannerActive = false;
        isTorchEnabled = false;
        if (btnToggleTorch) {
            btnToggleTorch.classList.remove('active');
            btnToggleTorch.style.display = 'none';
        }
        if (modalCameraScanner) {
            modalCameraScanner.classList.remove('active');
        }
        if (cameraLoadingIndicator) {
            cameraLoadingIndicator.style.display = 'none';
        }
        const cameraModalHeading = document.querySelector('.camera-modal-heading');
        if (cameraModalHeading) {
            cameraModalHeading.textContent = 'Scan Barcode / QR Rak';
        }
        if (inputManualScanCode) {
            inputManualScanCode.placeholder = 'Atau ketik Bin Code (cth: PL-17-01-01)...';
        }
    };

    window.toggleScannerTorch = async function() {
        if (!html5QrScannerInstance || !html5QrScannerInstance.isScanning) return;
        try {
            const capabilities = html5QrScannerInstance.getRunningTrackCameraCapabilities();
            if (capabilities && typeof capabilities.torchFeature === 'function' && capabilities.torchFeature().isSupported()) {
                isTorchEnabled = !isTorchEnabled;
                await capabilities.torchFeature().apply(isTorchEnabled);
                if (btnToggleTorch) {
                    if (isTorchEnabled) {
                        btnToggleTorch.classList.add('active');
                    } else {
                        btnToggleTorch.classList.remove('active');
                    }
                }
            }
        } catch (e) {
            console.warn('Torch toggle error:', e);
        }
    };

    window.switchScannerCamera = async function() {
        if (!availableCamerasList || availableCamerasList.length < 2) return;
        const currentIndex = availableCamerasList.findIndex(c => c.id === activeCameraId);
        const nextIndex = (currentIndex + 1) % availableCamerasList.length;
        const nextCamera = availableCamerasList[nextIndex];
        if (nextCamera) {
            try {
                await startCameraLiveFeed(nextCamera.id);
            } catch (err) {
                console.error('Failed to switch camera:', err);
                showCameraError('Gagal berganti kamera: ' + (err.message || err));
            }
        }
    };

    window.submitManualCameraScan = function(event) {
        if (event) event.preventDefault();
        const code = (inputManualScanCode ? inputManualScanCode.value.trim() : '');
        if (!code) {
            showToast('Ketik kode terlebih dahulu.', 'warning');
            return;
        }
        onCameraScanSuccess(code);
    };

    if (modalCameraScanner) {
        modalCameraScanner.addEventListener('click', (e) => {
            if (e.target === modalCameraScanner) {
                window.closeCameraScanner();
            }
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalCameraScanner && modalCameraScanner.classList.contains('active')) {
            window.closeCameraScanner();
        }
    });

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
                    const batchClean = formatBatchDisplay(req.batch_number);
                    const rawBatchEscaped = (req.batch_number || '').replace(/"/g, '&quot;');
                    const pickedQty = req.picked_qty || req.qty_request;
                    const timeStr = (req.picked_at || req.created_at || '').substring(11, 16);

                    return `
                        <div class="history-item-card">
                            <div class="h-card-header">
                                <div class="h-card-title-group">
                                    <strong class="h-sku">${req.sku}</strong>
                                    <span class="h-bin-pill"><i class="fa-solid fa-tag"></i> ${req.bin_code}</span>
                                </div>
                                <span class="h-status-badge"><i class="fa-solid fa-circle-check"></i> Selesai</span>
                            </div>
                            <div class="h-product-title">
                                ${req.product_name}
                            </div>
                            <div class="h-specs-box">
                                <div class="h-spec-col">
                                    <span class="h-spec-lbl"><i class="fa-solid fa-boxes-stacked"></i> Qty Selesai</span>
                                    <strong class="h-spec-val qty">${pickedQty} Pcs</strong>
                                </div>
                                <div class="h-spec-col">
                                    <span class="h-spec-lbl"><i class="fa-solid fa-warehouse"></i> Rak Gudang Besar</span>
                                    <strong class="h-spec-val rack">${rack}</strong>
                                </div>
                                <div class="h-spec-col full-w">
                                    <span class="h-spec-lbl"><i class="fa-solid fa-barcode"></i> Batch Number</span>
                                    <strong class="h-spec-val batch" title="${rawBatchEscaped}">${batchClean}</strong>
                                </div>
                            </div>
                            <div class="h-card-footer">
                                <span class="h-user-info"><i class="fa-solid fa-user-check"></i> Oleh: <strong>${req.picked_by || req.processed_by || 'Operator Gudang'}</strong></span>
                                <span class="h-time-info"><i class="fa-regular fa-clock"></i> ${timeStr} WIB</span>
                            </div>
                        </div>
                    `;
                }).join('');

                if (historyContainer) historyContainer.innerHTML = historyHtml;
                const homeContainer = document.getElementById('homeOperatorHistoryList');
                if (homeContainer) homeContainer.innerHTML = historyHtml;
                const homeStatToday = document.getElementById('homeStatToday');
                if (homeStatToday) homeStatToday.textContent = json.data.length;
            } else {
                if (opStatsToday) opStatsToday.textContent = '0';
                if (opStatsCompleted) opStatsCompleted.textContent = '0 Pcs';
                const homeStatToday = document.getElementById('homeStatToday');
                if (homeStatToday) homeStatToday.textContent = '0';
                const emptyHtml = `
                    <div class="empty-feed" style="text-align: center; padding: 1.5rem 1rem; color: #94a3b8;">
                        <i class="fa-solid fa-clipboard-check" style="font-size: 1.8rem; color: #cbd5e1; display: block; margin-bottom: 0.5rem;"></i>
                        <strong style="color: #64748b; font-size: 0.85rem; display: block;">Belum ada request selesai direplenish hari ini</strong>
                        <span style="font-size: 0.75rem;">Request yang telah selesai direplenish oleh Gudang Besar akan langsung tampil di sini.</span>
                    </div>
                `;
                if (historyContainer) historyContainer.innerHTML = emptyHtml;
                const homeContainer = document.getElementById('homeOperatorHistoryList');
                if (homeContainer) homeContainer.innerHTML = emptyHtml;
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
            feed.innerHTML = `<div class="empty-feed"><i class="fa-solid fa-spinner fa-spin"></i> Memuat antrean replenish...</div>`;
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
                        if (titleEl) titleEl.textContent = `${freshTasks.length} Permintaan Replenish Baru dari Gudang Kecil!`;
                        if (subEl) subEl.textContent = `#${firstFresh.request_no} • ${firstFresh.product_name} (${firstFresh.qty_request} Pcs)`;
                        banner.style.display = 'flex';
                    }

                    showToast(`🔔 [Gudang Besar] ${freshTasks.length} Permintaan Replenish Baru Masuk dari Gudang Kecil!`, 'info');

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

        const homeStatPending = document.getElementById('homeStatPending');
        if (homeStatPending) homeStatPending.textContent = pendingCount;

        const homeBadgePending = document.getElementById('homeBadgePending');
        if (homeBadgePending) {
            if (pendingCount > 0) {
                homeBadgePending.textContent = `${pendingCount} Tugas`;
                homeBadgePending.style.display = 'inline-flex';
            } else {
                homeBadgePending.style.display = 'none';
            }
        }
    }

    AppState.taskCollapseState = new Map();
    let isAllTasksCollapsed = false;

    function formatBatchDisplay(batch) {
        if (!batch) return '-';
        const str = String(batch).trim();
        if (str.includes(';')) {
            const parts = str.split(';').map(p => p.trim()).filter(p => p !== '');
            return parts[0] || str;
        }
        return str;
    }

    window.toggleTaskCollapse = function(taskId, event) {
        if (event) {
            // Prevent toggling if user clicked an action button inside the card
            if (event.target.closest('.btn-pick-action') || event.target.closest('a')) {
                return;
            }
        }
        const card = document.getElementById(`taskCard_${taskId}`);
        if (!card) return;

        const isCurrentlyCollapsed = card.classList.contains('is-collapsed');
        const nextState = !isCurrentlyCollapsed;

        AppState.taskCollapseState.set(String(taskId), nextState);

        card.classList.toggle('is-collapsed', nextState);
        card.classList.toggle('is-expanded', !nextState);

        const icon = card.querySelector('.btn-card-toggle i');
        if (icon) {
            icon.className = nextState ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
        }
        const toggleBtn = card.querySelector('.btn-card-toggle');
        if (toggleBtn) {
            toggleBtn.title = nextState ? 'Maximize (Buka Detail)' : 'Minimize (Ciutkan)';
        }
    };

    window.toggleAllCardsCollapse = function() {
        isAllTasksCollapsed = !isAllTasksCollapsed;
        const cards = document.querySelectorAll('.pick-task-card');
        cards.forEach(card => {
            const taskId = card.getAttribute('data-task-id');
            if (taskId) {
                AppState.taskCollapseState.set(String(taskId), isAllTasksCollapsed);
            }
            card.classList.toggle('is-collapsed', isAllTasksCollapsed);
            card.classList.toggle('is-expanded', !isAllTasksCollapsed);

            const icon = card.querySelector('.btn-card-toggle i');
            if (icon) {
                icon.className = isAllTasksCollapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
            }
            const toggleBtn = card.querySelector('.btn-card-toggle');
            if (toggleBtn) {
                toggleBtn.title = isAllTasksCollapsed ? 'Maximize (Buka Detail)' : 'Minimize (Ciutkan)';
            }
        });

        const mainIcon = document.querySelector('#btnToggleAllCards i');
        const mainText = document.getElementById('textToggleAllCards');
        if (mainIcon) {
            mainIcon.className = isAllTasksCollapsed ? 'fa-solid fa-expand' : 'fa-solid fa-compress';
        }
        if (mainText) {
            mainText.textContent = isAllTasksCollapsed ? 'Expand' : 'Minimize';
        }
    };

    window.filterPickTasks = function(status, btn) {
        AppState.activePickFilter = status;
        document.querySelectorAll('.pick-filter-chip').forEach(c => {
            if (c.id !== 'btnToggleAllCards') c.classList.remove('active');
        });
        if (btn && btn.id !== 'btnToggleAllCards') btn.classList.add('active');
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
                <div class="empty-feed" style="padding: 2.5rem 1rem; text-align: center; color: #94a3b8;">
                    <i class="fa-solid fa-clipboard-check" style="font-size: 2.2rem; color: #cbd5e1; margin-bottom: 0.6rem; display: block;"></i>
                    <strong style="color: #64748b; font-size: 0.95rem; display: block;">Tidak ada antrean task yang sesuai</strong>
                    <span style="font-size: 0.8rem;">Semua barang siap ambil atau filter saat ini kosong.</span>
                </div>
            `;
            return;
        }

        feed.innerHTML = filtered.map(task => {
            const isPending = task.status === 'PENDING';
            const isCompleted = task.status === 'COMPLETED';
            const statusClass = isPending ? 'pending' : (isCompleted ? 'completed' : 'rejected');
            const statusText = isPending ? 'Menunggu Pick' : (isCompleted ? 'Selesai Direplenish' : task.status);

            // Default: PENDING is expanded, COMPLETED is collapsed (unless user toggled)
            let isCollapsed = isCompleted;
            if (AppState.taskCollapseState.has(String(task.id))) {
                isCollapsed = AppState.taskCollapseState.get(String(task.id));
            }

            const batchShort = formatBatchDisplay(task.batch_number);
            const rawBatchEscaped = (task.batch_number || '').replace(/"/g, '&quot;');

            let actionArea = '';
            if (isPending) {
                actionArea = `
                    <button type="button" class="btn-pick-action" onclick='openPickModal(${JSON.stringify(task).replace(/'/g, "&#39;")})'>
                        <i class="fa-solid fa-dolly"></i> Ambil Barang (Pick & Replenish)
                    </button>
                `;
            } else if (isCompleted) {
                actionArea = `
                    <div class="pick-completed-info">
                        <div class="completed-badge-row">
                            <span class="info-pill gb-rack"><i class="fa-solid fa-warehouse"></i> Rak GB: <strong>${task.rack_gudang_besar || '-'}</strong></span>
                            <span class="info-pill batch" title="${rawBatchEscaped}"><i class="fa-solid fa-barcode"></i> Batch: <strong>${batchShort}</strong></span>
                        </div>
                        <small class="completed-meta"><i class="fa-solid fa-circle-check"></i> Direplenish oleh <strong>${task.picked_by || task.processed_by || 'Operator GB'}</strong> • ${task.picked_qty || task.qty_request} Pcs</small>
                    </div>
                `;
            }

            return `
                <div class="pick-task-card ${statusClass} ${isCollapsed ? 'is-collapsed' : 'is-expanded'}" 
                     id="taskCard_${task.id}" 
                     data-task-id="${task.id}">
                    
                    <!-- Card Header (Tappable to Minimize / Maximize) -->
                    <div class="task-card-header" onclick="toggleTaskCollapse('${task.id}', event)">
                        <div class="task-header-row-top">
                            <div class="task-meta-left">
                                <span class="task-req-badge">#${task.request_no}</span>
                                <span class="task-status-pill ${statusClass}">
                                    <i class="fa-solid fa-${isCompleted ? 'circle-check' : 'clock'}"></i>
                                    ${isCompleted ? 'Selesai' : 'Menunggu Pick'}
                                </span>
                            </div>
                            <button type="button" class="btn-card-toggle" title="${isCollapsed ? 'Maximize (Buka Detail)' : 'Minimize (Ciutkan)'}">
                                <i class="fa-solid fa-chevron-${isCollapsed ? 'down' : 'up'}"></i>
                            </button>
                        </div>

                        <!-- Compact preview row when card is collapsed -->
                        <div class="task-compact-preview">
                            <div class="preview-product-name" title="${task.product_name || task.sku}">
                                ${task.product_name || task.sku}
                            </div>
                            <div class="preview-chips-flex">
                                <span class="preview-chip loc"><i class="fa-solid fa-location-dot"></i> Rak: <strong>${task.bin_code}</strong></span>
                                <span class="preview-chip qty"><i class="fa-solid fa-layer-group"></i> <strong>${task.qty_request} Pcs</strong></span>
                                ${isCompleted && task.rack_gudang_besar ? `<span class="preview-chip gb"><i class="fa-solid fa-warehouse"></i> ${task.rack_gudang_besar}</span>` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Collapsible Card Body -->
                    <div class="task-card-body">
                        <div class="task-location-row">
                            <span class="loc-bin-tag"><i class="fa-solid fa-location-dot"></i> Rak Tujuan: <strong>${task.bin_code}</strong></span>
                            <span class="requester-tag"><i class="fa-solid fa-user"></i> ${task.requested_by}</span>
                            ${task.assigned_to ? `<span class="requester-tag assigned-highlight"><i class="fa-solid fa-user-check"></i> Ditugaskan: <strong>${task.assigned_to}</strong></span>` : ''}
                            <span class="task-time-pill"><i class="fa-regular fa-clock"></i> ${(task.created_at || '').substring(0, 16)}</span>
                        </div>

                        <div class="task-prod-info">
                            <h4 class="task-prod-name">${task.product_name}</h4>
                            <div class="task-prod-meta">
                                <span>SKU: <strong>${task.sku}</strong></span>
                                <span>Barcode: <strong>${task.barcode || '-'}</strong></span>
                            </div>
                        </div>

                        <div class="task-qty-boxes">
                            <div class="qty-box requested">
                                <small>Diminta Gudang Kecil</small>
                                <strong>${task.qty_request} Pcs</strong>
                            </div>
                            <div class="qty-box besar">
                                <small>Stok Gudang Besar</small>
                                <strong>${Number(task.qty_gudang_besar || 0).toLocaleString('id-ID')} Pcs</strong>
                            </div>
                        </div>

                        ${actionArea}
                    </div>
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
                showToast(json.message || 'Gagal menyelesaikan replenish.', 'error');
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
                if (opStockSearchInput && opStockSearchInput.value.trim()) {
                    filterOpStockList();
                } else {
                    renderOpStockSearch(json.data);
                }
            }
        } catch (err) {}
    };

    window.filterOpStockList = function() {
        const q = (opStockSearchInput ? opStockSearchInput.value : '').toLowerCase().trim();
        const btnClear = document.getElementById('btnClearOpStockSearch');
        if (btnClear) {
            btnClear.style.display = q ? 'flex' : 'none';
        }
        const filtered = (AppState.stocks || []).filter(s => 
            (s.sku && s.sku.toLowerCase().includes(q)) ||
            (s.product_name && s.product_name.toLowerCase().includes(q)) ||
            (s.bin_code && s.bin_code.toLowerCase().includes(q)) ||
            (s.barcode && s.barcode.toLowerCase().includes(q))
        );
        renderOpStockSearch(filtered);
    };

    window.clearOpStockSearch = function() {
        if (opStockSearchInput) {
            opStockSearchInput.value = '';
            opStockSearchInput.focus();
        }
        const btnClear = document.getElementById('btnClearOpStockSearch');
        if (btnClear) btnClear.style.display = 'none';
        filterOpStockList();
    };

    window.openOpStockCameraScanner = function() {
        if (!AppState.stocks || AppState.stocks.length === 0) {
            loadOpStockSearchList();
        }
        openCameraScanner('opStockSearchInput', (code) => {
            if (opStockSearchInput) {
                opStockSearchInput.value = code;
            }
            const btnClear = document.getElementById('btnClearOpStockSearch');
            if (btnClear) btnClear.style.display = 'flex';

            if (!AppState.stocks || AppState.stocks.length === 0) {
                loadOpStockSearchList().then(() => {
                    filterOpStockList();
                });
            } else {
                filterOpStockList();
            }
            showToast(`Hasil scan stok: ${code}`, 'success');
        });
    };

    if (opStockSearchInput) {
        opStockSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                filterOpStockList();
                opStockSearchInput.blur();
            } else if (e.key === 'Escape') {
                clearOpStockSearch();
            }
        });
    }

    function renderOpStockSearch(items) {
        if (!opStockResultsList) return;
        if (!items || items.length === 0) {
            opStockResultsList.innerHTML = `<div class="empty-feed">Tidak ada stok yang cocok.</div>`;
            return;
        }
        opStockResultsList.innerHTML = items.slice(0, 30).map(s => {
            const isUnmapped = isSyntheticBin(s.bin_code, s.sku);
            const rackLabel = isUnmapped ? 'Belum ada Rak' : `Rak: ${s.bin_code}`;
            const rackColor = isUnmapped ? '#94a3b8' : 'var(--primary)';
            return `
            <div class="stock-feed-row" onclick="selectStockToScan('${s.bin_code || s.sku}')">
                <div>
                    <strong>${s.sku}</strong>
                    <small style="display: block; color: var(--text-muted);">${s.product_name}</small>
                    <small style="color: ${rackColor}; font-weight: 700;">${rackLabel}</small>
                    ${s.barcode && s.barcode !== '-' ? `<small style="display: block; color: #64748b; font-family: var(--font-mono); font-size: 0.75rem; margin-top: 2px;"><i class="fa-solid fa-barcode"></i> ${s.barcode}</small>` : ''}
                </div>
                <div style="text-align: right;">
                    <strong style="font-family: var(--font-mono);">${s.qty_gudang_kecil || 0} Pcs</strong>
                    <small style="display: block; color: var(--text-muted);">Kecil</small>
                </div>
            </div>
        `;
        }).join('');
    }

    window.selectStockToScan = function(binOrSku) {
        switchMobileTab('opTabScan', document.querySelector('.mobile-bottom-navbar .bottom-tab-item:first-child'));
        inputBinCode.value = binOrSku;
        executeBinScan(binOrSku);
    };

    // =========================================================================
    // 4. ADMIN DASHBOARD & MANAGEMENT PORTAL
    // =========================================================================

    // Admin Sidebar Toggle (Minimize / Maximize)
    window.toggleAdminSidebar = function(forceState) {
        const layout = document.querySelector('.admin-portal-layout');
        const btnToggle = document.getElementById('btnToggleAdminSidebar');
        const iconToggle = document.getElementById('iconToggleAdminSidebar');
        if (!layout) return;

        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
            const willOpen = (typeof forceState === 'boolean') ? forceState : !layout.classList.contains('mobile-sidebar-open');
            layout.classList.toggle('mobile-sidebar-open', willOpen);
            if (btnToggle) {
                btnToggle.classList.toggle('active', willOpen);
                btnToggle.title = willOpen ? 'Tutup Menu Sidebar' : 'Buka Menu Sidebar';
            }
            if (iconToggle) {
                iconToggle.className = willOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
            }
        } else {
            const willCollapse = (typeof forceState === 'boolean') ? !forceState : !layout.classList.contains('sidebar-collapsed');
            layout.classList.toggle('sidebar-collapsed', willCollapse);
            try {
                localStorage.setItem('ocsAdminSidebarCollapsed', willCollapse ? '1' : '0');
            } catch (e) {}

            if (btnToggle) {
                btnToggle.classList.toggle('active', willCollapse);
                btnToggle.title = willCollapse ? 'Maximize Sidebar (Perluas Menu)' : 'Minimize Sidebar (Perkecil Menu)';
            }
            if (iconToggle) {
                iconToggle.className = willCollapse ? 'fa-solid fa-bars-staggered' : 'fa-solid fa-bars';
            }
        }
    };

    // Restore saved sidebar state on load
    try {
        if (window.innerWidth > 768 && localStorage.getItem('ocsAdminSidebarCollapsed') === '1') {
            const layout = document.querySelector('.admin-portal-layout');
            const btnToggle = document.getElementById('btnToggleAdminSidebar');
            const iconToggle = document.getElementById('iconToggleAdminSidebar');
            if (layout) layout.classList.add('sidebar-collapsed');
            if (btnToggle) {
                btnToggle.classList.add('active');
                btnToggle.title = 'Maximize Sidebar (Perluas Menu)';
            }
            if (iconToggle) {
                iconToggle.className = 'fa-solid fa-bars-staggered';
            }
        }
    } catch (e) {}

    window.addEventListener('resize', () => {
        const layout = document.querySelector('.admin-portal-layout');
        if (!layout) return;
        if (window.innerWidth > 768) {
            layout.classList.remove('mobile-sidebar-open');
            const isCollapsed = localStorage.getItem('ocsAdminSidebarCollapsed') === '1';
            layout.classList.toggle('sidebar-collapsed', isCollapsed);
            const iconToggle = document.getElementById('iconToggleAdminSidebar');
            if (iconToggle) {
                iconToggle.className = isCollapsed ? 'fa-solid fa-bars-staggered' : 'fa-solid fa-bars';
            }
            const btnToggle = document.getElementById('btnToggleAdminSidebar');
            if (btnToggle) {
                btnToggle.classList.toggle('active', isCollapsed);
                btnToggle.title = isCollapsed ? 'Maximize Sidebar (Perluas Menu)' : 'Minimize Sidebar (Perkecil Menu)';
            }
        } else {
            layout.classList.remove('sidebar-collapsed');
        }
    });

    portalNavButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            switchAdminTab(targetTab);
            if (window.innerWidth <= 768) {
                toggleAdminSidebar(false);
            }
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
            tabRackMap: { title: 'Peta Lokasi Rak Gudang', sub: 'Visualisasi denah fisik rak, ketersediaan stok, dan status minus' },
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
                    tabRackMap: 'Peta Rak',
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
        if (tabId === 'tabRackMap') loadRackMap();
        if (tabId === 'tabReplenish') loadAdminReplenish();
        if (tabId === 'tabStocks') loadStockList();
        if (tabId === 'tabMinusStock') loadMinusStock();
        if (tabId === 'tabUsers') loadUsers();
    };

    function updateTopbarLastSync(dateStr) {
        const el = document.getElementById('topbarLastSyncTime');
        if (!el) return;
        if (!dateStr) {
            el.textContent = '-';
            return;
        }
        try {
            const parts = dateStr.replace('T', ' ').split(/[- :]/);
            if (parts.length >= 5) {
                const day = parts[2];
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
                const month = monthNames[parseInt(parts[1], 10) - 1] || parts[1];
                const hour = parts[3];
                const min = parts[4];
                el.textContent = `${day} ${month}, ${hour}:${min} WIB`;
                el.title = `Terakhir sinkronisasi OCS: ${dateStr} WIB`;
                return;
            }
            el.textContent = dateStr;
        } catch (e) {
            el.textContent = dateStr;
        }
    }

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

                if (d.last_synced_at) {
                    updateTopbarLastSync(d.last_synced_at);
                }

                if (d.recent_replenish) {
                    renderDashboardReplenish(d.recent_replenish);
                }
                if (d.low_stocks) {
                    renderDashboardLowStock(d.low_stocks);
                }
            }
        } catch (err) {
            console.error('loadDashboardStats error:', err);
        }
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
                    <td>${formatBinBadge(r.bin_code, r.sku)}</td>
                    <td class="col-sku-combined">
                        <span class="sku-code-text">${r.sku}</span>
                        <span class="sku-product-name">${r.product_name || '-'}</span>
                    </td>
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

        dashLowStockList.innerHTML = lowItems.map(s => {
            const rackLabel = isSyntheticBin(s.bin_code, s.sku) ? 'Belum ada rak' : s.bin_code;
            return `
            <div class="low-stock-row">
                <div>
                    <strong>${s.sku}</strong>
                    <span>${s.product_name} • Rak: <strong style="color: var(--text-dark);">${rackLabel || '-'}</strong></span>
                </div>
                <div style="text-align: right;">
                    <span class="qty-warn">${s.qty_gudang_kecil} Pcs</span>
                    <small style="display: block; color: var(--text-muted); font-size: 0.7rem;">Gudang Kecil</small>
                </div>
            </div>
        `;
        }).join('');
    }

    // =========================================================================
    // 5. MASTER SKU-RACK & BIN CODE
    // =========================================================================

    window.loadSkuRacks = async function() {
        const search = searchSkuRacks ? searchSkuRacks.value.trim() : '';
        skuRacksTableBody.innerHTML = `<tr><td colspan="7" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data master SKU-Rack...</td></tr>`;

        try {
            const res = await fetch(`api.php?action=get_sku_racks&search=${encodeURIComponent(search)}`);
            const json = await res.json();
            if (json.status === 'success') {
                AppState.skuRacks = json.data;
                renderSkuRacksTable(json.data);
            }
        } catch (err) {
            skuRacksTableBody.innerHTML = `<tr><td colspan="7" class="td-center py-4" style="color: var(--danger);">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    if (searchSkuRacks) {
        searchSkuRacks.addEventListener('input', debounce(() => loadSkuRacks(), 300));
    }

    function renderSkuRacksTable(items) {
        if (!items || items.length === 0) {
            skuRacksTableBody.innerHTML = `<tr><td colspan="7" class="td-center py-4" style="color: var(--text-muted);">Tidak ada data Bin Code yang cocok.</td></tr>`;
            return;
        }

        skuRacksTableBody.innerHTML = items.map(r => {
            const sku = r.sku || '';
            const binCode = r.bin_code || '';
            const isUnmapped = isSyntheticBin(binCode, sku);
            const area = (r.notes || '').replace(/^Area:\s*/i, '').trim();

            const binCell = isUnmapped
                ? `<span class="bin-unmapped-tag"><i class="fa-solid fa-circle-question"></i> Belum Dipetakan</span>`
                : `<strong class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${binCode}</strong>`;

            let rackLabel = r.rack_name || '';
            if (isUnmapped || !rackLabel || rackLabel.toUpperCase() === binCode.toUpperCase() || rackLabel.startsWith('Lokasi BIN-')) {
                rackLabel = isUnmapped ? (area ? `Area ${area}` : 'Belum ada lokasi rak') : `Rak ${binCode}`;
            }

            return `
            <tr>
                <td class="col-sku-combined">
                    <span class="sku-code-text">${sku}</span>
                    <span class="sku-product-name">${r.product_name || '-'}</span>
                </td>
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
    // 5B. WAREHOUSE RACK MAP (PETA LOKASI RAK)
    // =========================================================================

    AppState.rackMapData = null;
    AppState.rackMapFilter = {
        zone: 'ALL',
        status: 'ALL', // 'ALL', 'AVAILABLE', 'EMPTY', 'MINUS'
        basis: 'gudang_kecil', // 'gudang_kecil', 'on_hand', 'gudang_besar'
        search: '',
        viewMode: 'grid' // 'grid' | 'list'
    };

    window.loadRackMap = async function() {
        const gridContainer = document.getElementById('rackMapGridContainer');
        const tableBody = document.getElementById('rackMapTableBody');
        if (gridContainer) {
            gridContainer.innerHTML = `<div class="td-center py-5" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 0.75rem; font-weight: 600;">Menyusun peta lokasi rak gudang...</p></div>`;
        }
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="10" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
        }

        try {
            const res = await fetch('api.php?action=get_rack_map');
            const json = await res.json();
            if (json.status === 'success') {
                AppState.rackMapData = json;
                updateRackMapStatsUI();
                renderRackMap();
            } else {
                if (gridContainer) gridContainer.innerHTML = `<div class="td-center py-5 text-danger"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><p style="margin-top: 0.5rem;">Gagal memuat peta: ${json.message || 'Error server'}</p></div>`;
            }
        } catch (err) {
            if (gridContainer) gridContainer.innerHTML = `<div class="td-center py-5 text-danger"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><p style="margin-top: 0.5rem;">Koneksi gagal: ${err.message}</p></div>`;
        }
    };

    function getStockByBasis(item, basis) {
        if (basis === 'on_hand') return Number(item.qty_on_hand || 0);
        if (basis === 'gudang_besar') return Number(item.qty_gudang_besar || 0);
        return Number(item.qty_gudang_kecil || 0);
    }

    function updateRackMapStatsUI() {
        if (!AppState.rackMapData) return;
        const basis = AppState.rackMapFilter.basis || 'gudang_kecil';
        const stats = AppState.rackMapData.stats;
        const curStats = (stats && stats[basis]) ? stats[basis] : (stats.gudang_kecil || { available: 0, empty: 0, minus: 0 });

        const total = stats.total || 0;
        const avail = curStats.available || 0;
        const empty = curStats.empty || 0;
        const minus = curStats.minus || 0;

        const elTotal = document.getElementById('rackMapTotalCount');
        const elAvail = document.getElementById('rackMapAvailableCount');
        const elEmpty = document.getElementById('rackMapEmptyCount');
        const elMinus = document.getElementById('rackMapMinusCount');

        if (elTotal) elTotal.textContent = total.toLocaleString('id-ID');
        if (elAvail) elAvail.textContent = avail.toLocaleString('id-ID');
        if (elEmpty) elEmpty.textContent = empty.toLocaleString('id-ID');
        if (elMinus) elMinus.textContent = minus.toLocaleString('id-ID');

        const elAvailPct = document.getElementById('rackMapAvailablePercent');
        const elEmptyPct = document.getElementById('rackMapEmptyPercent');
        const elMinusSub = document.getElementById('rackMapMinusPercent');

        if (elAvailPct && total > 0) elAvailPct.textContent = `${Math.round((avail / total) * 100)}% slot terisi`;
        if (elEmptyPct && total > 0) elEmptyPct.textContent = `${Math.round((empty / total) * 100)}% slot kosong`;
        if (elMinusSub) {
            elMinusSub.textContent = minus > 0 ? `${minus} SKU stok minus di rak!` : 'Semua stok aman (tidak ada minus)';
        }

        const badgeNav = document.getElementById('badgeRackMinusNav');
        if (badgeNav) {
            if (minus > 0) {
                badgeNav.textContent = minus;
                badgeNav.style.display = 'inline-block';
            } else {
                badgeNav.style.display = 'none';
            }
        }

        const zones = AppState.rackMapData.zones_summary || [];
        const zoneMap = {};
        zones.forEach(z => { zoneMap[z.zone] = z.total; });

        const countAll = document.getElementById('zoneCountALL');
        if (countAll) countAll.textContent = total;

        ['RP', 'PL', 'CS', 'RO', 'BIN', 'UNMAPPED'].forEach(z => {
            const el = document.getElementById('zoneCount' + z);
            if (el) el.textContent = zoneMap[z] || 0;
        });
    }

    window.setRackStatusFilter = function(status) {
        AppState.rackMapFilter.status = status;

        const cards = {
            ALL: 'kpiCardAll',
            AVAILABLE: 'kpiCardAvailable',
            EMPTY: 'kpiCardEmpty',
            MINUS: 'kpiCardMinus'
        };
        const tags = {
            ALL: 'tagFilterAll',
            AVAILABLE: 'tagFilterAvailable',
            EMPTY: 'tagFilterEmpty',
            MINUS: 'tagFilterMinus'
        };

        Object.keys(cards).forEach(key => {
            const c = document.getElementById(cards[key]);
            const t = document.getElementById(tags[key]);
            if (c) {
                if (key === status) c.classList.add('active-filter-card');
                else c.classList.remove('active-filter-card');
            }
            if (t) {
                if (key === status) t.classList.add('active');
                else t.classList.remove('active');
            }
        });

        renderRackMap();
    };

    window.setRackZoneFilter = function(zone) {
        AppState.rackMapFilter.zone = zone;
        document.querySelectorAll('.zone-pill-btn').forEach(btn => {
            if (btn.getAttribute('data-zone') === zone) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        renderRackMap();
    };

    window.changeRackStockBasis = function(basis) {
        AppState.rackMapFilter.basis = basis;
        updateRackMapStatsUI();
        renderRackMap();
    };

    window.setRackViewMode = function(mode) {
        AppState.rackMapFilter.viewMode = mode;
        const btnGrid = document.getElementById('btnViewGrid');
        const btnList = document.getElementById('btnViewList');
        const gridBox = document.getElementById('rackMapGridContainer');
        const listBox = document.getElementById('rackMapTableContainer');

        if (mode === 'grid') {
            if (btnGrid) btnGrid.classList.add('active');
            if (btnList) btnList.classList.remove('active');
            if (gridBox) gridBox.style.display = 'block';
            if (listBox) listBox.style.display = 'none';
        } else {
            if (btnList) btnList.classList.add('active');
            if (btnGrid) btnGrid.classList.remove('active');
            if (gridBox) gridBox.style.display = 'none';
            if (listBox) listBox.style.display = 'block';
        }
        renderRackMap();
    };

    window.handleRackMapSearch = debounce(function(query) {
        AppState.rackMapFilter.search = (query || '').trim().toLowerCase();
        const btnClear = document.getElementById('btnClearRackSearch');
        if (btnClear) btnClear.style.display = query ? 'inline-block' : 'none';
        renderRackMap();
    }, 250);

    window.clearRackMapSearch = function() {
        const input = document.getElementById('rackMapSearchInput');
        if (input) input.value = '';
        AppState.rackMapFilter.search = '';
        const btnClear = document.getElementById('btnClearRackSearch');
        if (btnClear) btnClear.style.display = 'none';
        renderRackMap();
    };

    window.renderRackMap = function() {
        if (!AppState.rackMapData || !AppState.rackMapData.items) return;

        const { zone, status, basis, search, viewMode } = AppState.rackMapFilter;
        let items = AppState.rackMapData.items;

        if (zone !== 'ALL') {
            items = items.filter(it => it.zone === zone);
        }

        if (status !== 'ALL') {
            items = items.filter(it => {
                const q = getStockByBasis(it, basis);
                if (status === 'AVAILABLE') return q > 0;
                if (status === 'EMPTY') return q === 0;
                if (status === 'MINUS') return q < 0;
                return true;
            });
        }

        if (search) {
            items = items.filter(it => 
                (it.bin_code && it.bin_code.toLowerCase().includes(search)) ||
                (it.sku && it.sku.toLowerCase().includes(search)) ||
                (it.product_name && it.product_name.toLowerCase().includes(search)) ||
                (it.barcode && it.barcode.toLowerCase().includes(search)) ||
                (it.rack_name && it.rack_name.toLowerCase().includes(search))
            );
        }

        if (viewMode === 'grid') {
            renderRackMapGrid(items);
        } else {
            renderRackMapTable(items);
        }
    };

    function renderRackMapGrid(items) {
        const container = document.getElementById('rackMapGridContainer');
        if (!container) return;

        if (!items || items.length === 0) {
            container.innerHTML = `
                <div class="card-white td-center py-5" style="border-radius: 16px; color: var(--text-muted);">
                    <i class="fa-solid fa-magnifying-glass" style="font-size: 2.2rem; opacity: 0.35; margin-bottom: 0.65rem; display: block;"></i>
                    <strong style="font-size: 1rem; color: #334155; display: block;">Tidak Ada Lokasi Rak yang Cocok</strong>
                    <p style="font-size: 0.8rem; margin: 0.35rem 0 0.85rem;">Coba sesuaikan filter status, zona, atau kata kunci pencarian Anda.</p>
                    <button type="button" class="btn-primary-clean btn-sm" onclick="setRackStatusFilter('ALL'); setRackZoneFilter('ALL'); clearRackMapSearch();">Reset Filter</button>
                </div>
            `;
            return;
        }

        const basis = AppState.rackMapFilter.basis || 'gudang_kecil';

        const zoneGroups = {};
        items.forEach(it => {
            const z = it.zone || 'OTHER';
            const rk = it.rack || 'MISC';
            const lv = it.level || '01';

            if (!zoneGroups[z]) zoneGroups[z] = {};
            if (!zoneGroups[z][rk]) zoneGroups[z][rk] = {};
            if (!zoneGroups[z][rk][lv]) zoneGroups[z][rk][lv] = [];
            zoneGroups[z][rk][lv].push(it);
        });

        const zoneTitles = {
            RP: { title: 'Zone RP — Rak Picking Reguler', desc: 'Rak standar pengambilan barang operasional (Fast & Medium Moving)', icon: 'fa-cubes-stacked' },
            PL: { title: 'Zone PL — Pallet Line / Storage', desc: 'Ambalan palet bawah dan area penyimpanan kartonan', icon: 'fa-pallet' },
            CS: { title: 'Zone CS — Clearance Sale', desc: 'Rak khusus produk promo dan cuci gudang', icon: 'fa-tag' },
            RO: { title: 'Zone RO — Return & Outbound', desc: 'Rak transit pengembalian dan packing keluar', icon: 'fa-arrow-right-arrow-left' },
            BIN: { title: 'Zone BIN — Area Bundling & Rak Khusus', desc: 'Lokasi bundling, gimmick, dan packaging', icon: 'fa-box-archive' },
            UNMAPPED: { title: 'Produk Belum Dipetakan (Unmapped)', desc: 'Produk aktif di OCS yang belum ditempatkan pada rak fisik', icon: 'fa-circle-question' },
            OTHER: { title: 'Area Rak Lainnya', desc: 'Lokasi penyimpanan khusus', icon: 'fa-warehouse' },
            TEST: { title: 'Zone Uji Coba (Test)', desc: 'Data rak percobaan', icon: 'fa-flask' }
        };

        let html = '';

        const zoneOrder = ['RP', 'PL', 'CS', 'RO', 'BIN', 'OTHER', 'UNMAPPED', 'TEST'];
        const existingZones = Object.keys(zoneGroups).sort((a, b) => {
            const idxA = zoneOrder.indexOf(a);
            const idxB = zoneOrder.indexOf(b);
            return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
        });

        existingZones.forEach(z => {
            const racks = zoneGroups[z];
            const meta = zoneTitles[z] || { title: `Zone ${z}`, desc: 'Area Rak Gudang', icon: 'fa-warehouse' };
            const rackKeys = Object.keys(racks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

            let zoneTotalSlots = 0;
            let zoneAvail = 0;
            let zoneEmpty = 0;
            let zoneMinus = 0;

            rackKeys.forEach(rk => {
                Object.keys(racks[rk]).forEach(lv => {
                    racks[rk][lv].forEach(it => {
                        zoneTotalSlots++;
                        const q = getStockByBasis(it, basis);
                        if (q > 0) zoneAvail++;
                        else if (q === 0) zoneEmpty++;
                        else zoneMinus++;
                    });
                });
            });

            html += `
            <div class="rack-zone-section" data-zone-section="${z}">
                <div class="rack-zone-header">
                    <div class="rack-zone-title-box">
                        <div style="width: 38px; height: 38px; border-radius: 10px; background: #e0e7ff; color: #4338ca; display: grid; place-items: center; font-size: 1.15rem;">
                            <i class="fa-solid ${meta.icon}"></i>
                        </div>
                        <div>
                            <h3>${meta.title}</h3>
                            <span style="font-size: 0.74rem; color: #64748b;">${meta.desc} • <strong>${rackKeys.length} Rak</strong> (${zoneTotalSlots} Slot)</span>
                        </div>
                    </div>
                    <div class="rack-zone-meta">
                        ${zoneAvail > 0 ? `<span class="shelf-micro-pill green"><i class="fa-solid fa-boxes-stacked"></i> ${zoneAvail} Ada Qty</span>` : ''}
                        ${zoneEmpty > 0 ? `<span class="shelf-micro-pill amber"><i class="fa-solid fa-inbox"></i> ${zoneEmpty} Kosong</span>` : ''}
                        ${zoneMinus > 0 ? `<span class="shelf-micro-pill red pulse-danger"><i class="fa-solid fa-triangle-exclamation"></i> ${zoneMinus} Minus</span>` : ''}
                    </div>
                </div>

                <div class="rack-shelves-grid">
            `;

            rackKeys.forEach(rk => {
                const levels = racks[rk];
                const levelKeys = Object.keys(levels).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

                let shelfTotal = 0;
                let shelfMinus = 0;
                let shelfAvail = 0;
                let shelfEmpty = 0;

                levelKeys.forEach(lv => {
                    levels[lv].forEach(it => {
                        shelfTotal++;
                        const q = getStockByBasis(it, basis);
                        if (q < 0) shelfMinus++;
                        else if (q > 0) shelfAvail++;
                        else shelfEmpty++;
                    });
                });

                const rackTitle = z === 'UNMAPPED' ? 'Daftar SKU Belum Ada Rak' : (rk === 'MISC' ? 'Rak Umum' : `Rak ${z}-${rk}`);

                html += `
                <div class="rack-shelf-card">
                    <div class="rack-shelf-header">
                        <div class="shelf-title-wrap">
                            <i class="fa-solid fa-server" style="color: #6366f1; font-size: 0.85rem;"></i>
                            <h4>${rackTitle}</h4>
                        </div>
                        <div class="shelf-stat-pills">
                            ${shelfAvail > 0 ? `<span class="shelf-micro-pill green" title="Ada stok">${shelfAvail}</span>` : ''}
                            ${shelfEmpty > 0 ? `<span class="shelf-micro-pill amber" title="Kosong">${shelfEmpty}</span>` : ''}
                            ${shelfMinus > 0 ? `<span class="shelf-micro-pill red pulse-danger" title="Stok minus!">${shelfMinus}</span>` : ''}
                        </div>
                    </div>

                    <div class="shelf-levels-stack">
                `;

                levelKeys.forEach(lv => {
                    const slots = levels[lv].sort((a, b) => (a.slot || '').localeCompare(b.slot || '', undefined, { numeric: true }));
                    const levelLabel = lv.startsWith('0') ? 'L' + lv.replace(/^0+/, '') : ('L' + lv);

                    html += `
                    <div class="shelf-level-row">
                        <div class="shelf-level-badge" title="Tingkat / Ambalan Rak ${lv}">
                            ${levelLabel}
                            <span>LVL</span>
                        </div>
                        <div class="shelf-slots-row">
                    `;

                    slots.forEach(it => {
                        const q = getStockByBasis(it, basis);
                        let statusClass = 'slot-empty';
                        let qtyDisplay = '0';
                        let badgeIcon = '';

                        if (it.is_synthetic) {
                            statusClass = 'slot-unmapped';
                            qtyDisplay = q > 0 ? `+${q}` : (q < 0 ? `${q}` : '0');
                        } else if (q < 0) {
                            statusClass = 'slot-minus pulse-danger';
                            qtyDisplay = `${q}`;
                            badgeIcon = '<i class="fa-solid fa-triangle-exclamation" style="font-size:0.6rem; margin-right:2px;"></i>';
                        } else if (q > 0) {
                            statusClass = 'slot-available';
                            qtyDisplay = `+${q}`;
                        } else {
                            statusClass = 'slot-empty';
                            qtyDisplay = '0';
                        }

                        const slotLabel = it.is_synthetic ? 'UNM' : (it.slot || '-');
                        const tooltip = `${it.bin_code} | ${it.sku}\n${it.product_name}\nSaldo: ${q} Pcs (${basis === 'gudang_kecil' ? 'Gudang Kecil' : basis})`;

                        html += `
                        <div class="rack-slot-cell ${statusClass}" 
                             onclick="openRackSlotDetail(${it.id})" 
                             title="${tooltip}">
                            <div class="slot-top-row">
                                <span class="slot-code">${slotLabel}</span>
                                <span class="slot-qty">${badgeIcon}${qtyDisplay}</span>
                            </div>
                            <div class="slot-sku-text">${it.sku || it.product_name}</div>
                        </div>
                        `;
                    });

                    html += `
                        </div>
                    </div>
                    `;
                });

                html += `
                    </div>
                </div>
                `;
            });

            html += `
                </div>
            </div>
            `;
        });

        container.innerHTML = html;
    }

    function renderRackMapTable(items) {
        const tableBody = document.getElementById('rackMapTableBody');
        if (!tableBody) return;

        if (!items || items.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="10" class="td-center py-4" style="color: var(--text-muted);">Tidak ada data lokasi rak yang cocok dengan filter.</td></tr>`;
            return;
        }

        const basis = AppState.rackMapFilter.basis || 'gudang_kecil';

        tableBody.innerHTML = items.map(it => {
            const q = getStockByBasis(it, basis);
            let statusBadge = '';
            if (it.is_synthetic) {
                statusBadge = `<span class="bin-unmapped-tag"><i class="fa-regular fa-circle-question"></i> Belum Dipetakan</span>`;
            } else if (q < 0) {
                statusBadge = `<span class="badge-status rejected pulse-danger" style="background:#fee2e2; color:#b91c1c; font-weight:800;"><i class="fa-solid fa-triangle-exclamation"></i> MINUS (${q})</span>`;
            } else if (q === 0) {
                statusBadge = `<span class="badge-status default" style="background:#f1f5f9; color:#64748b; font-weight:700;"><i class="fa-solid fa-inbox"></i> Kosong (0)</span>`;
            } else {
                statusBadge = `<span class="badge-status completed" style="background:#ecfdf5; color:#047857; font-weight:700;"><i class="fa-solid fa-circle-check"></i> Ada Qty (+${q})</span>`;
            }

            const binBadge = formatBinBadge(it.bin_code, it.sku);
            const levelSlot = it.is_synthetic ? '-' : `Lvl ${it.level} / Slot ${it.slot}`;

            return `
            <tr>
                <td>${binBadge}</td>
                <td><strong style="font-family: var(--font-mono); font-size: 0.8rem; color: #4338ca;">${it.zone}</strong> - <span style="font-weight:600;">${it.rack}</span></td>
                <td><small style="font-family: var(--font-mono); font-weight:700; color:#334155;">${levelSlot}</small></td>
                <td class="col-sku-combined">
                    <span class="sku-code-text">${it.sku}</span>
                    <span class="sku-product-name">${it.product_name || '-'}</span>
                </td>
                <td><small style="font-family: var(--font-mono); color: #64748b;">${it.barcode || '-'}</small></td>
                <td class="td-right"><strong style="font-family: var(--font-mono); font-size: 0.95rem; color: ${it.qty_gudang_kecil < 0 ? '#b91c1c' : '#0f172a'};">${Number(it.qty_gudang_kecil || 0).toLocaleString('id-ID')}</strong></td>
                <td class="td-right" style="color: var(--success); font-weight: 700; font-family: var(--font-mono);">${Number(it.qty_gudang_besar || 0).toLocaleString('id-ID')}</td>
                <td class="td-right" style="font-family: var(--font-mono);">${Number(it.qty_on_hand || 0).toLocaleString('id-ID')}</td>
                <td class="td-center">${statusBadge}</td>
                <td class="td-center">
                    <div style="display: flex; gap: 0.35rem; justify-content: center;">
                        <button class="btn-primary-clean btn-sm" style="padding: 0.3rem 0.6rem; font-size: 0.74rem;" onclick="openRackSlotDetail(${it.id})" title="Lihat Detail Slot">
                            <i class="fa-solid fa-circle-info"></i> Detail
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');
    }

    window.openRackSlotDetail = function(itemId) {
        if (!AppState.rackMapData || !AppState.rackMapData.items) return;
        const item = AppState.rackMapData.items.find(it => Number(it.id) === Number(itemId));
        if (!item) return;

        const binTitle = document.getElementById('slotModalBinCode');
        const rackSub = document.getElementById('slotModalRackSubtitle');
        const body = document.getElementById('slotModalBodyContent');

        if (binTitle) binTitle.textContent = item.bin_code || ('BIN-' + item.sku);
        if (rackSub) {
            rackSub.textContent = item.is_synthetic ? 'Produk Belum Ada Lokasi Rak Fisik di OCS' : `${item.rack_name || item.bin_code} (Zona ${item.zone}, Rak ${item.rack}, Level ${item.level}, Slot ${item.slot})`;
        }

        const basis = AppState.rackMapFilter.basis || 'gudang_kecil';
        const qBasis = getStockByBasis(item, basis);

        let statusHtml = '';
        if (qBasis < 0) {
            statusHtml = `<span class="badge-status rejected pulse-danger" style="background:#fee2e2; color:#b91c1c; font-weight:800; font-size:0.8rem; padding:0.3rem 0.75rem;"><i class="fa-solid fa-triangle-exclamation"></i> STOK MINUS (${qBasis} Pcs)</span>`;
        } else if (qBasis === 0) {
            statusHtml = `<span class="badge-status default" style="background:#f1f5f9; color:#64748b; font-weight:700; font-size:0.8rem; padding:0.3rem 0.75rem;"><i class="fa-solid fa-inbox"></i> STOK KOSONG (0 Pcs)</span>`;
        } else {
            statusHtml = `<span class="badge-status completed" style="background:#ecfdf5; color:#047857; font-weight:700; font-size:0.8rem; padding:0.3rem 0.75rem;"><i class="fa-solid fa-circle-check"></i> STOK TERSEDIA (+${qBasis} Pcs)</span>`;
        }

        if (body) {
            body.innerHTML = `
                <!-- Status Row -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid #f1f5f9;">
                    <div>
                        <span style="font-size: 0.72rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Status Stok (${basis === 'gudang_kecil' ? 'Gudang Kecil' : basis})</span>
                        <div style="margin-top: 0.25rem;">${statusHtml}</div>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 0.72rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Area</span>
                        <div style="font-size: 0.85rem; font-weight: 800; color: #0f172a;">${item.area_id || 'Pusat'}</div>
                    </div>
                </div>

                <!-- Product Info Card -->
                <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 0.85rem 1rem; margin-bottom: 1rem;">
                    <span style="font-size: 0.7rem; font-weight: 800; color: #4338ca; text-transform: uppercase; letter-spacing: 0.04em;">SKU Produk</span>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: 0.15rem;">
                        <strong style="font-family: var(--font-mono); font-size: 0.95rem; color: #0f172a;">${item.sku}</strong>
                        <button type="button" class="btn-secondary-clean btn-sm" onclick="navigator.clipboard.writeText('${item.sku}'); showToast('SKU disalin ke clipboard!', 'success');" title="Salin SKU">
                            <i class="fa-regular fa-copy"></i> Salin
                        </button>
                    </div>
                    <div style="font-size: 0.88rem; font-weight: 600; color: #334155; margin-top: 0.35rem; line-height: 1.35;">${item.product_name || '-'}</div>
                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed #cbd5e1; font-size: 0.75rem; color: #64748b;">
                        <span><i class="fa-solid fa-barcode"></i> Barcode: <strong style="font-family: var(--font-mono); color: #0f172a;">${item.barcode || '-'}</strong></span>
                        <span><i class="fa-solid fa-layer-group"></i> Kategori: <strong>${item.category || 'General'}</strong></span>
                    </div>
                </div>

                <!-- Stock Breakdown Matrix -->
                <div class="modal-stock-breakdown-card">
                    <span style="font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.04em;">Rincian Saldo Stok Fisik OCS</span>
                    <div class="stock-pill-row">
                        <div class="stock-pill-cell" style="${item.qty_gudang_kecil < 0 ? 'border-color: #fca5a5; background: #fef2f2;' : ''}">
                            <span class="stock-num" style="color: ${item.qty_gudang_kecil < 0 ? '#b91c1c' : '#0f172a'};">${Number(item.qty_gudang_kecil || 0).toLocaleString('id-ID')}</span>
                            <span class="stock-label">Gudang Kecil</span>
                        </div>
                        <div class="stock-pill-cell">
                            <span class="stock-num" style="color: #059669;">${Number(item.qty_gudang_besar || 0).toLocaleString('id-ID')}</span>
                            <span class="stock-label">Gudang Besar</span>
                        </div>
                        <div class="stock-pill-cell">
                            <span class="stock-num">${Number(item.qty_on_hand || 0).toLocaleString('id-ID')}</span>
                            <span class="stock-label">On Hand</span>
                        </div>
                        <div class="stock-pill-cell">
                            <span class="stock-num" style="color: #0284c7;">${Number(item.qty_available || 0).toLocaleString('id-ID')}</span>
                            <span class="stock-label">Available</span>
                        </div>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div style="display: flex; gap: 0.65rem; margin-top: 1.25rem;">
                    <button type="button" class="btn-secondary-clean" style="flex: 1; padding: 0.65rem; font-size: 0.82rem; font-weight: 700;" onclick="closeModal('modalRackSlotDetail')">
                        Tutup
                    </button>
                    <button type="button" class="btn-primary-clean" style="flex: 2; padding: 0.65rem; font-size: 0.82rem; font-weight: 800; background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); justify-content: center;" onclick="triggerQuickReplenishFromSlot('${item.bin_code || ('BIN-' + item.sku)}', '${item.sku}')">
                        <i class="fa-solid fa-truck-ramp-box"></i> Ajukan Replenish
                    </button>
                </div>
            `;
        }

        openModal('modalRackSlotDetail');
    };

    window.triggerQuickReplenishFromSlot = function(binCode, sku) {
        closeModal('modalRackSlotDetail');

        if (AppState.activeView === 'operator') {
            switchMobileTab('opTabScan');
            const input = document.getElementById('inputBinCode');
            if (input) input.value = binCode;
            executeBinScan(binCode);
            return;
        }

        switchAdminTab('tabReplenish');
        showToast(`Lokasi rak ${binCode} siap diajukan untuk mutasi.`, 'info');
    };

    window.openMobileRackMap = function() {
        if (AppState.user && AppState.user.role === 'admin') {
            switchView('admin');
            switchAdminTab('tabRackMap');
        } else {
            switchView('admin');
            switchAdminTab('tabRackMap');
            showToast('Menampilkan Peta Lokasi Rak Gudang.', 'info');
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
        adminReplenishTableBody.innerHTML = `<tr><td colspan="13" class="td-center py-4">Memuat data permintaan...</td></tr>`;

        try {
            const status = AppState.activeReplenishFilter;
            const res = await fetch(`api.php?action=get_replenish_requests&status=${status}`);
            const json = await res.json();
            if (json.status === 'success') {
                AppState.replenishRequests = json.data;
                renderAdminReplenishTable(json.data);
                updateReplenishSelectedCount();
            }
        } catch (err) {
            adminReplenishTableBody.innerHTML = `<tr><td colspan="13" class="td-center py-4 text-danger">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    function renderAdminReplenishTable(items) {
        if (!items || items.length === 0) {
            adminReplenishTableBody.innerHTML = `<tr><td colspan="13" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-inbox" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; opacity: 0.4;"></i>Tidak ada data permintaan replenish yang ditemukan.</td></tr>`;
            return;
        }

        adminReplenishTableBody.innerHTML = items.map(r => {
            const isPending = r.status === 'PENDING';
            const isApproved = r.status === 'APPROVED';
            const statusClass = (r.status || 'PENDING').toLowerCase();
            const isCancelled = r.status === 'CANCELLED';
            const isCompleted = r.status === 'COMPLETED';
            const isChecked = AppState.selectedReplenishIds.has(Number(r.id));

            let pickBtnHtml = '';
            if (isPending) {
                pickBtnHtml = `
                    <button class="btn-primary-clean btn-sm" style="background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%); padding: 0.3rem 0.55rem; font-size: 0.72rem;" title="Pick Barang Gudang Besar" onclick='openPickModal(${JSON.stringify(r).replace(/'/g, "&#39;")})'><i class="fa-solid fa-dolly"></i> Pick</button>
                    <button class="btn-secondary-clean btn-sm" style="padding: 0.3rem 0.5rem; font-size: 0.72rem; color: var(--danger);" title="Tolak Mutasi" onclick="updateReplenishStatus(${r.id}, 'REJECTED')"><i class="fa-solid fa-xmark"></i></button>
                `;
            } else if (isApproved) {
                pickBtnHtml = `
                    <button class="btn-primary-clean btn-sm" style="padding: 0.3rem 0.55rem; font-size: 0.72rem;" title="Selesaikan Mutasi Fisik" onclick='openPickModal(${JSON.stringify(r).replace(/'/g, "&#39;")})'><i class="fa-solid fa-dolly"></i> Selesaikan</button>
                `;
            }

            const actionsHtml = `
                <div style="display: flex; gap: 0.25rem; justify-content: center; align-items: center; flex-wrap: wrap;">
                    ${pickBtnHtml}
                    ${!isCompleted ? `
                        <button class="btn-secondary-clean btn-sm" style="padding: 0.3rem 0.5rem; font-size: 0.72rem;" title="Edit Permintaan" onclick='openEditReplenishModal(${JSON.stringify(r).replace(/'/g, "&#39;")})'>
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                    ` : ''}
                    ${!isCancelled && !isCompleted ? `
                        <button class="btn-secondary-clean btn-sm" style="padding: 0.3rem 0.5rem; font-size: 0.72rem; color: #ea580c;" title="Batalkan Permintaan" onclick="cancelReplenishRequest(${r.id}, '${r.request_no}')">
                            <i class="fa-solid fa-ban"></i>
                        </button>
                    ` : ''}
                    <button class="btn-secondary-clean btn-sm" style="padding: 0.3rem 0.5rem; font-size: 0.72rem; color: var(--danger);" title="Hapus Permintaan" onclick="deleteReplenishRequest(${r.id}, '${r.request_no}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;

            const rackBesarHtml = r.rack_gudang_besar 
                ? `<span class="loc-bin-tag" style="background: rgba(234, 88, 12, 0.1); color: #c2410c; border: 1px solid rgba(234, 88, 12, 0.25);"><i class="fa-solid fa-warehouse"></i> ${r.rack_gudang_besar}</span>` 
                : '<span style="color: var(--text-muted); font-style: italic; font-size: 0.72rem;">Belum di-pick</span>';

            const batchHtml = r.batch_number 
                ? `<span class="loc-bin-tag" style="background: rgba(79, 70, 229, 0.08); color: #4338ca; border: 1px solid rgba(79, 70, 229, 0.2);"><i class="fa-solid fa-barcode"></i> ${r.batch_number}</span>` 
                : '<span style="color: var(--text-muted); font-style: italic; font-size: 0.72rem;">-</span>';

            const assignedHtml = r.assigned_to 
                ? `<div style="margin-top: 0.2rem;"><span class="assigned-user-pill" title="Ditugaskan ke ${r.assigned_to}"><i class="fa-solid fa-user-check"></i> ${r.assigned_to}</span></div>` 
                : '';

            const isDoneOcs = Number(r.done_ocs) === 1;
            const isDoneWms = Number(r.done_wms) === 1;

            const cutStockHtml = `
                <div class="cut-stock-btn-group">
                    <button type="button" class="btn-cut-stock cut-ocs ${isDoneOcs ? 'active' : 'pending'}"
                            onclick="toggleCutStock(${r.id}, 'ocs')"
                            title="${isDoneOcs ? 'OCS: Sudah potong stok (Klik untuk batalkan)' : 'OCS: Klik jika sudah potong stok'}">
                        <i class="fa-solid ${isDoneOcs ? 'fa-circle-check' : 'fa-circle-notch'}"></i>
                        <span>Done OCS</span>
                    </button>
                    <button type="button" class="btn-cut-stock cut-wms ${isDoneWms ? 'active' : 'pending'}"
                            onclick="toggleCutStock(${r.id}, 'wms')"
                            title="${isDoneWms ? 'WMS: Sudah potong stok (Klik untuk batalkan)' : 'WMS: Klik jika sudah potong stok'}">
                        <i class="fa-solid ${isDoneWms ? 'fa-circle-check' : 'fa-circle-notch'}"></i>
                        <span>Done WMS</span>
                    </button>
                </div>
            `;

            return `
                <tr class="${isChecked ? 'row-selected' : ''}">
                    <td class="td-center">
                        <input type="checkbox" class="tbl-checkbox check-replenish-item" 
                               data-id="${r.id}" 
                               ${isChecked ? 'checked' : ''} 
                               onchange="toggleSelectReplenishItem(${r.id}, this.checked)">
                    </td>
                    <td><strong style="font-family: var(--font-mono); font-size: 0.76rem; color: #0f172a;">${r.request_no}</strong></td>
                    <td><small style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.68rem;">${(r.created_at || '').substring(0, 16)}</small></td>
                    <td>${formatBinBadge(r.bin_code, r.sku)}</td>
                    <td class="col-sku-combined">
                        <span class="sku-code-text">${r.sku}</span>
                        <span class="sku-product-name">${r.product_name || '-'}</span>
                    </td>
                    <td class="td-right"><strong style="font-size: 0.82rem; color: var(--primary); font-family: var(--font-mono);">${r.qty_request} Pcs</strong></td>
                    <td class="td-right"><span class="stock-pill default" style="font-family: var(--font-mono); font-weight: 700; font-size: 0.76rem; padding: 0.15rem 0.45rem; border-radius: 5px; background: rgba(59, 130, 246, 0.08); color: #1d4ed8; border: 1px solid rgba(59, 130, 246, 0.2);">${r.qty_gudang_besar ?? 0} Pcs</span></td>
                    <td><span style="font-weight: 600; font-size: 0.76rem;">${r.requested_by}</span>${assignedHtml}</td>
                    <td>${rackBesarHtml}</td>
                    <td>${batchHtml}</td>
                    <td><span class="badge-status ${statusClass}">${r.status}</span></td>
                    <td class="td-center">${cutStockHtml}</td>
                    <td class="td-center">${actionsHtml}</td>
                </tr>
            `;
        }).join('');
    }

    // Batch Actions for Replenish Requests
    window.toggleSelectAllReplenish = function(checked) {
        if (!AppState.replenishRequests || AppState.replenishRequests.length === 0) return;
        AppState.replenishRequests.forEach(r => {
            if (checked) {
                AppState.selectedReplenishIds.add(Number(r.id));
            } else {
                AppState.selectedReplenishIds.delete(Number(r.id));
            }
        });
        document.querySelectorAll('.check-replenish-item').forEach(cb => {
            cb.checked = checked;
            const tr = cb.closest('tr');
            if (tr) tr.classList.toggle('row-selected', checked);
        });
        updateReplenishSelectedCount();
    };

    window.toggleSelectReplenishItem = function(id, checked) {
        id = Number(id);
        if (checked) {
            AppState.selectedReplenishIds.add(id);
        } else {
            AppState.selectedReplenishIds.delete(id);
        }
        const cb = document.querySelector(`.check-replenish-item[data-id="${id}"]`);
        if (cb) {
            const tr = cb.closest('tr');
            if (tr) tr.classList.toggle('row-selected', checked);
        }
        updateReplenishSelectedCount();
    };

    window.updateReplenishSelectedCount = function() {
        const count = AppState.selectedReplenishIds.size;
        const bar = document.getElementById('replenishBatchBar');
        const text = document.getElementById('replenishSelectedCountText');
        if (text) text.textContent = `${count} Permintaan dipilih`;
        if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
        const master = document.getElementById('checkAllReplenish');
        if (master) {
            master.checked = count > 0 && AppState.replenishRequests && count === AppState.replenishRequests.length;
        }
    };

    window.clearReplenishSelection = function() {
        AppState.selectedReplenishIds.clear();
        document.querySelectorAll('.check-replenish-item').forEach(cb => {
            cb.checked = false;
            const tr = cb.closest('tr');
            if (tr) tr.classList.remove('row-selected');
        });
        const master = document.getElementById('checkAllReplenish');
        if (master) master.checked = false;
        updateReplenishSelectedCount();
    };

    window.executeBatchReplenishAction = async function(actionType) {
        if (AppState.selectedReplenishIds.size === 0) {
            showToast('Pilih minimal 1 permintaan terlebih dahulu.', 'error');
            return;
        }

        let label = 'Selesaikan & Potong Stok (OCS & WMS)';
        if (actionType === 'done_ocs') label = 'Tandai Done OCS';
        if (actionType === 'done_wms') label = 'Tandai Done WMS';

        const count = AppState.selectedReplenishIds.size;
        if (!confirm(`Apakah Anda yakin ingin memproses ${count} permintaan terpilih?\nAksi: ${label}`)) {
            return;
        }

        try {
            const payload = {
                action: 'batch_complete_replenish',
                request_ids: Array.from(AppState.selectedReplenishIds),
                batch_action: actionType
            };

            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            const json = await res.json();

            if (json.status === 'success') {
                showToast(json.message, 'success');
                clearReplenishSelection();
                loadAdminReplenish();
                loadDashboardStats();
                if (actionType === 'complete_and_cut') {
                    loadMinusStock();
                }
            } else {
                showToast(json.message || 'Gagal memproses batch permintaan.', 'error');
            }
        } catch (err) {
            showToast('Error server: ' + err.message, 'error');
        }
    };

    window.toggleCutStock = async function(id, type) {
        try {
            const payload = {
                action: 'toggle_cut_stock',
                id: id,
                type: type
            };

            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            const json = await res.json();

            if (json.status === 'success') {
                showToast(json.message, 'success');
                if (AppState.replenishRequests && Array.isArray(AppState.replenishRequests)) {
                    const item = AppState.replenishRequests.find(x => Number(x.id) === Number(id));
                    if (item) {
                        if (type === 'ocs') item.done_ocs = json.new_status;
                        if (type === 'wms') item.done_wms = json.new_status;
                        renderAdminReplenishTable(AppState.replenishRequests);
                        return;
                    }
                }
                loadAdminReplenish();
            } else {
                showToast(json.message || 'Gagal mengubah status potong stok.', 'error');
            }
        } catch (err) {
            showToast('Error server: ' + err.message, 'error');
        }
    };

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

    window.openEditReplenishModal = function(r) {
        if (!r) return;
        document.getElementById('editReplenishId').value = r.id;
        document.getElementById('editReplenishReqNo').textContent = r.request_no || 'REP-XXXX';
        document.getElementById('editReplenishSku').textContent = r.sku || '-';
        document.getElementById('editReplenishProdName').textContent = r.product_name || '-';
        document.getElementById('editReplenishBin').value = r.bin_code || '-';

        const maxBesar = Number(r.qty_gudang_besar || 0);
        document.getElementById('editReplenishMaxBesar').value = `${maxBesar.toLocaleString('id-ID')} Pcs`;

        const qtyInput = document.getElementById('editReplenishQty');
        qtyInput.value = r.qty_request || 1;
        if (maxBesar > 0) {
            qtyInput.max = maxBesar;
            document.getElementById('editReplenishQtyHint').textContent = `Maksimal: ${maxBesar.toLocaleString('id-ID')} Pcs (Stok Gudang Besar)`;
        } else {
            document.getElementById('editReplenishQtyHint').textContent = `Jumlah request`;
        }

        document.getElementById('editReplenishNotes').value = r.admin_notes || '';
        openModal('modalEditReplenish');
    };

    window.submitEditReplenish = async function(event) {
        event.preventDefault();
        const id = document.getElementById('editReplenishId').value;
        const qty = parseInt(document.getElementById('editReplenishQty').value, 10);
        const notes = document.getElementById('editReplenishNotes').value.trim();
        const btn = document.getElementById('btnSubmitEditReplenish');

        if (!id || isNaN(qty) || qty <= 0) {
            showToast('Qty Request harus lebih besar dari 0.', 'error');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

        try {
            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    action: 'edit_replenish_request',
                    id: id,
                    qty_request: qty,
                    admin_notes: notes
                })
            });
            const json = await res.json();
            if (json.status === 'success') {
                showToast(json.message, 'success');
                closeModal('modalEditReplenish');
                loadAdminReplenish();
                loadDashboardStats();
            } else {
                showToast(json.message || 'Gagal mengubah permintaan.', 'error');
            }
        } catch (err) {
            showToast('Error server: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan`;
        }
    };

    window.cancelReplenishRequest = async function(id, reqNo) {
        const reason = prompt(`Batalkan Permintaan Replenish #${reqNo}?\nMasukkan alasan pembatalan (opsional):`, 'Dibatalkan oleh Admin');
        if (reason === null) return;

        try {
            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    action: 'cancel_replenish_request',
                    id: id,
                    reason: reason.trim() || 'Dibatalkan oleh Admin'
                })
            });
            const json = await res.json();
            if (json.status === 'success') {
                showToast(json.message, 'success');
                loadAdminReplenish();
                loadDashboardStats();
            } else {
                showToast(json.message || 'Gagal membatalkan permintaan.', 'error');
            }
        } catch (err) {
            showToast('Error server: ' + err.message, 'error');
        }
    };

    window.deleteReplenishRequest = async function(id, reqNo) {
        if (!confirm(`HAPUS PERMANEN Permintaan Replenish #${reqNo}?\n\nData yang dihapus tidak dapat dikembalikan.`)) {
            return;
        }

        try {
            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    action: 'delete_replenish_request',
                    id: id
                })
            });
            const json = await res.json();
            if (json.status === 'success') {
                showToast(json.message, 'success');
                loadAdminReplenish();
                loadDashboardStats();
            } else {
                showToast(json.message || 'Gagal menghapus permintaan.', 'error');
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
        stockMasterTableBody.innerHTML = `<tr><td colspan="9" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data stok OCS...</td></tr>`;

        try {
            const res = await fetch(`api.php?action=get_stocks&search=${encodeURIComponent(search)}`);
            const json = await res.json();
            if (json.status === 'success') {
                AppState.stocks = json.data;
                renderStockTable(json.data);
            }
        } catch (err) {
            stockMasterTableBody.innerHTML = `<tr><td colspan="9" class="td-center py-4" style="color: var(--danger);">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    if (searchStocks) {
        searchStocks.addEventListener('input', debounce(() => loadStockList(), 300));
    }

    function renderStockTable(items) {
        if (!items || items.length === 0) {
            stockMasterTableBody.innerHTML = `<tr><td colspan="9" class="td-center py-4" style="color: var(--text-muted);">Belum ada data stok. Klik 'Sync Data OCS' di topbar untuk sinkronisasi.</td></tr>`;
            return;
        }

        stockMasterTableBody.innerHTML = items.map(s => `
            <tr>
                <td class="col-sku-combined">
                    <span class="sku-code-text">${s.sku}</span>
                    <span class="sku-product-name">${s.product_name || '-'}</span>
                </td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: #475569;">${s.barcode || '-'}</span></td>
                <td>${formatBinBadge(s.bin_code, s.sku)}</td>
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
        minusStockTableBody.innerHTML = `<tr><td colspan="9" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data stok minus...</td></tr>`;

        try {
            const assignFilter = AppState.minusAssignFilter || 'ALL';
            const url = `api.php?action=get_negative_stocks&threshold=${AppState.minusThreshold}&assigned_filter=${encodeURIComponent(assignFilter)}&search=${encodeURIComponent(search)}`;
            const res = await fetch(url, { credentials: 'same-origin' });
            const json = await res.json();
            if (json.status === 'success') {
                AppState.minusStocks = json.data;
                renderMinusStockTable(json.data);
                const elRows = document.getElementById('minusCountRows');
                if (elRows) elRows.textContent = (json.total_rows || 0).toLocaleString('id-ID');
                updateMinusSelectedCount();
            } else {
                minusStockTableBody.innerHTML = `<tr><td colspan="9" class="td-center py-4" style="color: var(--danger);">${json.message || 'Gagal memuat data.'}</td></tr>`;
            }
        } catch (err) {
            minusStockTableBody.innerHTML = `<tr><td colspan="9" class="td-center py-4" style="color: var(--danger);">Gagal memuat: ${err.message}</td></tr>`;
        }
    };

    function renderMinusStockTable(items) {
        if (!items || items.length === 0) {
            minusStockTableBody.innerHTML = `<tr><td colspan="9" class="td-center py-4" style="color: var(--text-muted);"><i class="fa-solid fa-circle-check" style="color: var(--success); font-size: 1.4rem; display: block; margin-bottom: 0.5rem;"></i>Tidak ada stok Gudang Kecil yang sesuai filter ini.</td></tr>`;
            return;
        }

        minusStockTableBody.innerHTML = items.map(s => {
            const kecil = Number(s.qty_gudang_kecil || 0);
            const besar = Number(s.qty_gudang_besar || 0);
            const canAssign = besar > 0;
            const qtyClass = kecil < 0 ? 'qty-minus' : (kecil === 0 ? 'qty-warn' : '');
            const binLabel = s.bin_code && !String(s.bin_code).toUpperCase().startsWith('BIN-' + String(s.sku).toUpperCase())
                ? `<strong class="loc-bin-tag"><i class="fa-solid fa-tag"></i> ${s.bin_code}</strong><br><small style="color: var(--text-muted); font-size: 0.68rem;">${s.rack_name || ''}</small>`
                : `<span class="bin-unmapped-tag" style="font-size: 0.68rem;"><i class="fa-solid fa-circle-question"></i> Belum Dipetakan</span>`;

            // If item cannot be assigned, remove from selection if present
            if (!canAssign && AppState.selectedMinusSkus.has(s.sku)) {
                AppState.selectedMinusSkus.delete(s.sku);
                AppState.selectedMinusItems.delete(s.sku);
            }

            const isChecked = canAssign && AppState.selectedMinusSkus.has(s.sku);

            const statusAssignHtml = s.active_assigned_to 
                ? `<span class="assigned-user-pill" title="Ditugaskan ke ${s.active_assigned_to} (${s.active_request_no || ''})"><i class="fa-solid fa-user-check"></i> ${s.active_assigned_to}</span>` 
                : `<span class="unassigned-pill" title="Belum ada penugasan replenish aktif"><i class="fa-solid fa-clock"></i> Belum</span>`;

            let actionBtn = '';
            let checkboxCell = '';
            if (canAssign) {
                actionBtn = `<button class="btn-primary-clean btn-sm" onclick='openAssignGudangBesarModal(${JSON.stringify(s).replace(/'/g, "&#39;")})' title="Assign tugas replenish ke Operator Gudang Besar"><i class="fa-solid fa-user-tag"></i> Assign GB</button>`;
                checkboxCell = `
                    <input type="checkbox" class="tbl-checkbox check-minus-item" 
                           data-sku="${s.sku}" 
                           ${isChecked ? 'checked' : ''} 
                           title="Pilih untuk assign ke Gudang Besar" 
                           onchange='toggleSelectMinusItem(${JSON.stringify(s.sku)}, ${JSON.stringify(s).replace(/'/g, "&#39;")}, this.checked)'>
                `;
            } else {
                actionBtn = `<button class="btn-secondary-clean btn-sm" disabled style="opacity: 0.5; cursor: not-allowed;" title="Stok Gudang Besar kosong (0 Pcs)"><i class="fa-solid fa-ban"></i> Stok GB 0</button>`;
                checkboxCell = `
                    <input type="checkbox" class="tbl-checkbox check-minus-item" 
                           data-sku="${s.sku}" 
                           disabled 
                           style="opacity: 0.25; cursor: not-allowed;" 
                           title="Tidak dapat dipilih karena Stok Gudang Besar kosong (Stok GB 0)">
                `;
            }

            return `
                <tr class="${isChecked ? 'row-selected' : ''}">
                    <td class="td-center">
                        ${checkboxCell}
                    </td>
                    <td class="col-sku-combined">
                        <span class="sku-code-text">${s.sku}</span>
                        <span class="sku-product-name">${s.product_name || '-'}</span>
                    </td>
                    <td><span style="font-family: var(--font-mono); font-size: 0.72rem; color: #475569;">${s.barcode || '-'}</span></td>
                    <td>${binLabel}</td>
                    <td class="td-right"><strong class="${qtyClass}" style="font-size: 0.82rem;">${kecil.toLocaleString('id-ID')}</strong></td>
                    <td class="td-right" style="font-size: 0.78rem;">${besar.toLocaleString('id-ID')}</td>
                    <td class="td-right" style="font-size: 0.78rem;">${Number(s.qty_on_hand || 0).toLocaleString('id-ID')}</td>
                    <td>${statusAssignHtml}</td>
                    <td class="td-center">${actionBtn}</td>
                </tr>
            `;
        }).join('');
    }

    // Batch Multi-Select for Stok Minus (Hanya SKU dengan Stok Gudang Besar > 0 / Assign GB)
    window.toggleSelectAllMinusStock = function(checked) {
        if (!AppState.minusStocks || AppState.minusStocks.length === 0) return;
        AppState.minusStocks.forEach(s => {
            const besar = Number(s.qty_gudang_besar || 0);
            if (besar > 0) {
                if (checked) {
                    AppState.selectedMinusSkus.add(s.sku);
                    AppState.selectedMinusItems.set(s.sku, s);
                } else {
                    AppState.selectedMinusSkus.delete(s.sku);
                    AppState.selectedMinusItems.delete(s.sku);
                }
            }
        });
        document.querySelectorAll('.check-minus-item:not(:disabled)').forEach(cb => {
            cb.checked = checked;
            const tr = cb.closest('tr');
            if (tr) tr.classList.toggle('row-selected', checked);
        });
        updateMinusSelectedCount();
    };

    window.toggleSelectMinusItem = function(sku, item, checked) {
        const besar = Number(item.qty_gudang_besar || 0);
        if (checked && besar <= 0) {
            showToast('Hanya item dengan Stok Gudang Besar > 0 (Assign GB) yang dapat dipilih.', 'error');
            const cb = document.querySelector(`.check-minus-item[data-sku="${sku}"]`);
            if (cb) cb.checked = false;
            return;
        }

        if (checked) {
            AppState.selectedMinusSkus.add(sku);
            AppState.selectedMinusItems.set(sku, item);
        } else {
            AppState.selectedMinusSkus.delete(sku);
            AppState.selectedMinusItems.delete(sku);
        }
        const cb = document.querySelector(`.check-minus-item[data-sku="${sku}"]`);
        if (cb) {
            const tr = cb.closest('tr');
            if (tr) tr.classList.toggle('row-selected', checked);
        }
        updateMinusSelectedCount();
    };

    window.updateMinusSelectedCount = function() {
        const count = AppState.selectedMinusSkus.size;
        const bar = document.getElementById('minusBatchBar');
        const text = document.getElementById('minusSelectedCountText');
        if (text) text.textContent = `${count} SKU dipilih`;
        if (bar) bar.style.display = count > 0 ? 'flex' : 'none';

        const assignableCount = (AppState.minusStocks || []).filter(s => Number(s.qty_gudang_besar || 0) > 0).length;
        const master = document.getElementById('checkAllMinusStock');
        if (master) {
            master.checked = count > 0 && assignableCount > 0 && count === assignableCount;
            master.indeterminate = count > 0 && count < assignableCount;
            if (assignableCount === 0) {
                master.disabled = true;
                master.title = 'Tidak ada SKU dengan Stok Gudang Besar > 0 yang dapat dipilih';
            } else {
                master.disabled = false;
                master.title = `Pilih semua ${assignableCount} SKU yang dapat di-assign ke Gudang Besar`;
            }
        }
    };

    window.clearMinusSelection = function() {
        AppState.selectedMinusSkus.clear();
        AppState.selectedMinusItems.clear();
        document.querySelectorAll('.check-minus-item').forEach(cb => {
            cb.checked = false;
            const tr = cb.closest('tr');
            if (tr) tr.classList.remove('row-selected');
        });
        const master = document.getElementById('checkAllMinusStock');
        if (master) {
            master.checked = false;
            master.indeterminate = false;
        }
        updateMinusSelectedCount();
    };

    // Filter Assign GB Event Listeners
    const minusAssignFilters = document.getElementById('minusAssignFilters');
    if (minusAssignFilters) {
        minusAssignFilters.querySelectorAll('.pill-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                minusAssignFilters.querySelectorAll('.pill-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                AppState.minusAssignFilter = btn.getAttribute('data-assign') || 'ALL';
                loadMinusStock();
            });
        });
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

    // Modal Assign Replenish ke Gudang Besar (Single)
    window.openAssignGudangBesarModal = async function(item) {
        if (!item) return;

        document.getElementById('assignSku').value = item.sku || '';
        document.getElementById('assignBinCode').value = item.bin_code || ('BIN-' + item.sku);
        document.getElementById('assignProductName').value = item.product_name || item.sku || '';
        document.getElementById('assignBarcode').value = item.barcode || '';
        document.getElementById('assignQtyKecil').value = item.qty_gudang_kecil || 0;
        document.getElementById('assignQtyBesar').value = item.qty_gudang_besar || 0;

        document.getElementById('assignDisplaySku').textContent = item.sku || '-';
        document.getElementById('assignDisplayProdName').textContent = item.product_name || item.sku || '-';
        document.getElementById('assignDisplayBin').innerHTML = `<i class="fa-solid fa-tag"></i> ${item.bin_code || ('BIN-' + item.sku)}`;

        const kecil = Number(item.qty_gudang_kecil || 0);
        const besar = Number(item.qty_gudang_besar || 0);

        document.getElementById('assignDisplayStokKecil').textContent = `${kecil.toLocaleString('id-ID')} Pcs`;
        document.getElementById('assignDisplayStokBesar').textContent = `${besar.toLocaleString('id-ID')} Pcs`;

        const qtyHint = document.getElementById('assignQtyHint');
        if (qtyHint) qtyHint.textContent = `Maks: ${besar.toLocaleString('id-ID')} Pcs`;

        const inputQty = document.getElementById('assignInputQty');
        inputQty.max = besar;

        let suggested = 10;
        if (kecil < 0) {
            suggested = Math.abs(kecil) + 5;
        } else if (kecil === 0) {
            suggested = 10;
        }
        if (suggested > besar) {
            suggested = besar;
        }
        inputQty.value = Math.max(1, suggested);

        document.getElementById('assignInputNotes').value = kecil < 0 ? `Stok minus ${kecil} Pcs di rak Gudang Kecil, mohon segera direplenish.` : '';

        // Load Gudang Besar users
        const selectOp = document.getElementById('assignSelectOperator');
        selectOp.innerHTML = '<option value="">-- Memuat daftar operator... --</option>';

        try {
            const res = await fetch('api.php?action=get_users', { credentials: 'same-origin' });
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                const users = json.data;
                const gbUsers = users.filter(u => u.role === 'gudang_besar' || u.role === 'operator');
                const listToUse = gbUsers.length > 0 ? gbUsers : users;

                selectOp.innerHTML = listToUse.map(u => {
                    const roleLabel = u.role === 'gudang_besar' ? 'Gudang Besar' : (u.role === 'admin' ? 'Admin' : 'Operator');
                    return `<option value="${u.username}">${u.full_name || u.username} (${roleLabel})</option>`;
                }).join('');
            } else {
                selectOp.innerHTML = `
                    <option value="gudang_besar">Operator Gudang Besar (gudang_besar)</option>
                    <option value="operator2">Operator Gudang 2 (operator2)</option>
                `;
            }
        } catch (e) {
            selectOp.innerHTML = `
                <option value="gudang_besar">Operator Gudang Besar (gudang_besar)</option>
                <option value="operator2">Operator Gudang 2 (operator2)</option>
            `;
        }

        openModal('modalAssignGudangBesar');
    };

    // Modal Batch Assign ke Gudang Besar (Multiple Select)
    window.openBatchAssignModal = async function() {
        if (AppState.selectedMinusSkus.size === 0) {
            showToast('Pilih minimal 1 SKU terlebih dahulu.', 'error');
            return;
        }

        const count = AppState.selectedMinusSkus.size;
        const summaryText = document.getElementById('batchAssignSummaryText');
        if (summaryText) summaryText.textContent = `${count} SKU Terpilih untuk Penugasan`;

        const listContainer = document.getElementById('batchAssignSelectedList');
        if (listContainer) {
            const items = Array.from(AppState.selectedMinusItems.values());
            listContainer.innerHTML = items.map(it => {
                const kecil = Number(it.qty_gudang_kecil || 0);
                const besar = Number(it.qty_gudang_besar || 0);
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 0.76rem;">
                        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
                            <strong style="font-family: var(--font-mono); color: #0f172a;">${it.sku}</strong>
                            <span style="color: #64748b; margin-left: 0.35rem;">${it.product_name || '-'}</span>
                        </div>
                        <div style="display: flex; gap: 0.6rem; font-family: var(--font-mono); font-size: 0.74rem;">
                            <span style="color: #dc2626; font-weight: 700;">Kecil: ${kecil}</span>
                            <span style="color: #10b981; font-weight: 700;">GB: ${besar}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const selectOp = document.getElementById('batchAssignSelectOperator');
        selectOp.innerHTML = '<option value="">-- Memuat daftar operator... --</option>';

        try {
            const res = await fetch('api.php?action=get_users', { credentials: 'same-origin' });
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                const users = json.data;
                const gbUsers = users.filter(u => u.role === 'gudang_besar' || u.role === 'operator');
                const listToUse = gbUsers.length > 0 ? gbUsers : users;

                selectOp.innerHTML = listToUse.map(u => {
                    const roleLabel = u.role === 'gudang_besar' ? 'Gudang Besar' : (u.role === 'admin' ? 'Admin' : 'Operator');
                    return `<option value="${u.username}">${u.full_name || u.username} (${roleLabel})</option>`;
                }).join('');
            } else {
                selectOp.innerHTML = `
                    <option value="gudang_besar">Operator Gudang Besar (gudang_besar)</option>
                    <option value="operator2">Operator Gudang 2 (operator2)</option>
                `;
            }
        } catch (e) {
            selectOp.innerHTML = `
                <option value="gudang_besar">Operator Gudang Besar (gudang_besar)</option>
                <option value="operator2">Operator Gudang 2 (operator2)</option>
            `;
        }

        openModal('modalBatchAssignGB');
    };

    window.submitBatchAssign = async function(event) {
        if (event) event.preventDefault();
        if (AppState.selectedMinusSkus.size === 0) {
            showToast('Tidak ada SKU yang dipilih.', 'error');
            return;
        }

        const operator = document.getElementById('batchAssignSelectOperator').value;
        if (!operator) {
            showToast('Pilih operator tujuan terlebih dahulu.', 'error');
            return;
        }

        const qtyMode = document.getElementById('batchAssignQtyMode').value || 'auto';
        const notes = document.getElementById('batchAssignInputNotes').value.trim() || 'Stok minus di rak Gudang Kecil, mohon segera direplenish.';
        const requestedBy = AppState.user ? (AppState.user.full_name || AppState.user.username) : 'Admin Inventory';

        const btnSubmit = document.getElementById('btnSubmitBatchAssign');
        if (btnSubmit) btnSubmit.disabled = true;

        try {
            const items = [];
            AppState.selectedMinusItems.forEach(item => {
                const kecil = Number(item.qty_gudang_kecil || 0);
                const besar = Number(item.qty_gudang_besar || 0);
                let qtyReq = 10;

                if (qtyMode === 'auto') {
                    if (kecil < 0) {
                        qtyReq = Math.abs(kecil) + 5;
                    } else if (kecil === 0) {
                        qtyReq = 10;
                    }
                    if (besar > 0 && qtyReq > besar) {
                        qtyReq = besar;
                    }
                } else if (qtyMode === 'fixed10') {
                    qtyReq = besar > 0 ? Math.min(10, besar) : 10;
                } else if (qtyMode === 'fixed25') {
                    qtyReq = besar > 0 ? Math.min(25, besar) : 25;
                } else if (qtyMode === 'max') {
                    qtyReq = besar > 0 ? besar : 10;
                }

                items.push({
                    sku: item.sku,
                    bin_code: item.bin_code || ('BIN-' + item.sku),
                    product_name: item.product_name || item.sku || '',
                    barcode: item.barcode || '',
                    qty_gudang_kecil: kecil,
                    qty_gudang_besar: besar,
                    qty_request: Math.max(1, qtyReq)
                });
            });

            const payload = {
                action: 'batch_assign_replenish_task',
                assigned_to: operator,
                requested_by: requestedBy,
                notes: notes,
                items: items
            };

            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            const json = await res.json();

            if (json.status === 'success') {
                showToast(json.message || 'Berhasil menugaskan seluruh SKU terpilih!', 'success');
                closeModal('modalBatchAssignGB');
                clearMinusSelection();
                loadMinusStock();
                loadAdminReplenish();
                loadDashboardStats();
            } else {
                showToast(json.message || 'Gagal menugaskan task batch.', 'error');
            }
        } catch (err) {
            showToast('Error server: ' + err.message, 'error');
        } finally {
            if (btnSubmit) btnSubmit.disabled = false;
        }
    };

    const formAssignGB = document.getElementById('formAssignGudangBesar');
    if (formAssignGB) {
        formAssignGB.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btnSubmit = document.getElementById('btnSubmitAssignTask');
            if (btnSubmit) btnSubmit.disabled = true;

            try {
                const payload = {
                    action: 'assign_replenish_task',
                    sku: document.getElementById('assignSku').value,
                    bin_code: document.getElementById('assignBinCode').value,
                    product_name: document.getElementById('assignProductName').value,
                    barcode: document.getElementById('assignBarcode').value,
                    qty_gudang_kecil: Number(document.getElementById('assignQtyKecil').value || 0),
                    qty_gudang_besar: Number(document.getElementById('assignQtyBesar').value || 0),
                    qty_request: Number(document.getElementById('assignInputQty').value || 1),
                    assigned_to: document.getElementById('assignSelectOperator').value,
                    requested_by: AppState.user ? (AppState.user.full_name || AppState.user.username) : 'Admin Inventory',
                    notes: document.getElementById('assignInputNotes').value.trim()
                };

                const res = await fetch('api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify(payload)
                });
                const json = await res.json();

                if (json.status === 'success') {
                    showToast(json.message || 'Task replenish berhasil ditugaskan!', 'success');
                    closeModal('modalAssignGudangBesar');
                    loadMinusStock();
                    loadAdminReplenish();
                    loadDashboardStats();
                } else {
                    showToast(json.message || 'Gagal menugaskan task.', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            } finally {
                if (btnSubmit) btnSubmit.disabled = false;
            }
        });
    }

    // =========================================================================
    // 7C. UNIFIED OCS SYNC (REAL-TIME PROGRESS & AUTO-CLOSE POPUP)
    // =========================================================================

    function syncLog(html) {
        syncLogBox.innerHTML += html;
        syncLogBox.scrollTop = syncLogBox.scrollHeight;
    }

    async function safeFetchJson(url, options = {}) {
        const res = await fetch(url, options);
        const text = await res.text();
        if (!text || !text.trim()) {
            throw new Error(`Server tidak mengembalikan respon (HTTP ${res.status}). Kemungkinan koneksi timeout.`);
        }
        try {
            return JSON.parse(text);
        } catch (e) {
            const cleanText = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
            throw new Error(`Respon tidak valid (HTTP ${res.status}): ${cleanText.substring(0, 150)}`);
        }
    }

    window.runFullOcsSync = async function() {
        if (AppState.isSyncing) return;
        AppState.isSyncing = true;

        syncProgressBar.style.width = '6%';
        syncStepStatus.textContent = 'Menghubungkan ke OCS Cloud API...';
        syncItemCounter.textContent = 'Memulai...';
        syncLogBox.innerHTML = `<div class="log-entry info">[START] Membuka sesi sinkronisasi OCS Cloud...</div>`;
        btnCloseSyncModal.disabled = true;
        openModal('modalSyncProgress');

        let rackCount = 0;
        let stockCount = 0;

        try {
            // --- Tahap 1: Inisialisasi & Cek OCS Cloud ---
            syncProgressBar.style.width = '15%';
            syncStepStatus.textContent = 'Tahap 1/3 - Otentikasi OCS Cloud...';
            syncLog(`<div class="log-entry info">[OData] Memeriksa total data di OCS Cloud...</div>`);

            const jsonInit = await safeFetchJson('api.php?action=sync_init', { credentials: 'same-origin' });

            if (jsonInit.status !== 'success' || !jsonInit.token) {
                throw new Error(jsonInit.message || 'Gagal login ke OCS Cloud API.');
            }

            const token = jsonInit.token;
            const totalStockOcs = jsonInit.total_stock || 2525;
            const totalRacksOcs = jsonInit.total_racks || 684;
            syncLog(`<div class="log-entry success">[AUTH] Berhasil terhubung. Total: ${totalStockOcs.toLocaleString('id-ID')} item stok & ${totalRacksOcs.toLocaleString('id-ID')} lokasi rak.</div>`);

            // --- Tahap 2: Sinkronisasi Master SKU-Rack & Barcode ---
            syncProgressBar.style.width = '35%';
            syncStepStatus.textContent = 'Tahap 2/3 - Sinkronisasi Master SKU-Rack & Barcode...';
            syncItemCounter.textContent = `0 / ${totalRacksOcs} Lokasi`;
            syncLog(`<div class="log-entry info">[OData] Mengunduh pemetaan rak & barcode master ($top=1000)...</div>`);

            const jsonRack = await safeFetchJson('api.php?action=sync_sku_racks_step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ token: token })
            });

            if (jsonRack.status === 'success') {
                rackCount = jsonRack.total_synced || totalRacksOcs;
                syncProgressBar.style.width = '45%';
                syncItemCounter.textContent = `${rackCount} Lokasi Rak`;
                syncLog(`<div class="log-entry success">[SUCCESS] ${rackCount} pemetaan Bin Code tersimpan (${jsonRack.barcode_filled || 0} barcode terisi).</div>`);
            } else {
                syncLog(`<div class="log-entry error">[WARN] Tahap SKU-Rack: ${jsonRack.message}</div>`);
            }

            // --- Tahap 3: Sinkronisasi Saldo Stok Gudang (Step-by-step per 1000 item) ---
            syncStepStatus.textContent = 'Tahap 3/3 - Sinkronisasi Saldo Stok Gudang...';
            syncLog(`<div class="log-entry info">[OData] Mengunduh saldo stok bertahap ($top=1000)...</div>`);

            let skip = 0;
            let top = 1000;
            let hasMore = true;
            let batchNo = 1;

            while (hasMore) {
                const jsonStock = await safeFetchJson('api.php?action=sync_stock_step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ token: token, skip: skip, top: top })
                });

                if (jsonStock.status !== 'success') {
                    throw new Error(jsonStock.message || `Gagal menyinkronkan stok pada batch ke-${batchNo}`);
                }

                stockCount += (jsonStock.batch_count || 0);
                const currentTotal = jsonStock.total_count || totalStockOcs;
                skip = jsonStock.next_skip || (skip + top);
                hasMore = jsonStock.has_more;

                // Progress calculation between 45% and 95%
                const stockRatio = Math.min(1, stockCount / Math.max(1, currentTotal));
                const currentPct = Math.round(45 + (stockRatio * 50));
                syncProgressBar.style.width = `${currentPct}%`;
                syncItemCounter.textContent = `${stockCount.toLocaleString('id-ID')} / ${currentTotal.toLocaleString('id-ID')} Item (${currentPct}%)`;
                syncLog(`<div class="log-entry success">[STOK] Batch ${batchNo} (${jsonStock.batch_count || 0} item) tersimpan. Total: ${stockCount.toLocaleString('id-ID')} item.</div>`);

                batchNo++;
                if (batchNo > 10) break; // safety guard
            }

            // --- Selesai 100% ---
            syncProgressBar.style.width = '100%';
            syncStepStatus.textContent = '🎉 Sinkronisasi Selesai 100%!';
            syncItemCounter.textContent = `${rackCount} Lokasi / ${stockCount} Item (100%)`;
            syncLog(`<div class="log-entry success" style="font-weight: 700;">[SELESAI] Data OCS berhasil disinkronkan 100%! Menutup popup...</div>`);

            // Automatically close popup after 1.2s as requested by user
            setTimeout(() => {
                closeModal('modalSyncProgress');
                showToast(`🎉 Sync OCS Berhasil: ${rackCount} lokasi & ${stockCount} item stok tersimpan!`, 'success');
            }, 1200);

            // Reload all dashboards & tables
            loadSkuRacks();
            loadStockList();
            loadMinusStock();
            loadDashboardStats();
            loadAdminReplenish();
        } catch (err) {
            syncStepStatus.textContent = 'Gagal Sinkronisasi';
            syncLog(`<div class="log-entry error">[EXCEPTION] ${err.message}</div>`);
            showToast('Sync gagal: ' + err.message, 'error');
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
            if (u.role === 'superadmin') {
                roleBadge = '<span class="badge-status" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; border: none; font-weight: 700; box-shadow: 0 2px 6px rgba(79, 70, 229, 0.3);"><i class="fa-solid fa-crown"></i> Super Admin</span>';
            } else if (u.role === 'admin') {
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
                        <div style="display: flex; gap: 0.35rem; justify-content: center; align-items: center;">
                            <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem;" onclick="openModalEditUser(${JSON.stringify(u).replace(/"/g, '&quot;')})" title="Edit Pengguna">
                                <i class="fa-solid fa-pen-to-square"></i> Edit
                            </button>
                            <button class="btn-secondary-clean" style="padding: 0.35rem 0.65rem; color: #dc2626; background: rgba(239, 68, 68, 0.06); border-color: rgba(220, 38, 38, 0.25);" onclick="deleteUser(${u.id}, '${u.username}')" title="Hapus Pengguna">
                                <i class="fa-solid fa-trash-can"></i> Hapus
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.deleteUser = async function(id, username) {
        if (AppState.user && (AppState.user.id == id || AppState.user.username === username)) {
            showToast('Tidak dapat menghapus akun yang sedang Anda gunakan saat ini.', 'error');
            return;
        }

        if (!confirm(`Apakah Anda yakin ingin menghapus akun pengguna '${username}'?\nTindakan ini tidak dapat dibatalkan.`)) return;

        try {
            const res = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'delete_user', id: id })
            });
            const json = await res.json();
            if (json.status === 'success') {
                showToast(json.message || 'Pengguna berhasil dihapus.', 'success');
                loadUsers();
            } else {
                showToast(json.message || 'Gagal menghapus pengguna.', 'error');
            }
        } catch (err) {
            showToast('Error server: ' + err.message, 'error');
        }
    };

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
