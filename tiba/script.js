


// 1) URL WEB APP GAS (/exec) - hardcode
const GAS_URL_EXEC = "https://script.google.com/macros/s/AKfycbxrhlv5bQxPtd-zZ-hyHOwq8xyyTGoZ4cUxLgCk4UVbZP0U4_SNE-rDt_anKPWcV9BWSw/exec";

/*
  2) URL GOOGLEUSERCONTENT (WAJIB untuk Chrome mobile, anti redirect/CORS)
  Cara ambil:
  - Buka di Chrome: GAS_URL_EXEC + "?action=ping"
  - Copy BASE URL dari address bar (biasanya script.googleusercontent.com)
  - PASTE di sini. (Jika terlanjur ada &lib=..., aman, nanti dibersihkan otomatis)
*/
const GAS_URL_GUC = "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLj98nfKmqSykYzV4lCcK5Gg-NnySKm4Jf_uTrOX_VJ0-uvor-EEoZHvawSYw3fVFsui1nu9XkL7emV6QNrbP-nOJrGwvn_XPRtdvC92yX0PEuJjDGnIvZ8-ul5RL2z8CXw8PYUaUh2BMYQ1pQ44WhJTsa1r-oTMex1WcyGIbeMmKNog8pxz3xAH1jBUq54VNN2T5RrYa6sSRP0zshmJtSyViFanSfVPWMDPukR-0kJdeCzw28yQmnOAAE7VmP6a5ynulU_mun2V2mPJhW4YbcHzBzKqoLBT4CTkwC8L&lib=MxZ36cMfAO6DvgMDlpXudCUmSx4WqhLym";

        const API_TIMEOUT_MS = 15000;
        const LS_KEY_LAST_GOOD_BASE = "tiba_last_good_base_v1";

        function normalizeBaseUrl(u){
        if (!u) return "";
        let s = String(u).trim();
        s = s.split("#")[0];

        try{
            const url = new URL(s);
            // buang parameter yang sering “mengacaukan” base
            ["lib","callback","cb","action","_t"].forEach(k => url.searchParams.delete(k));
            s = url.toString();
        }catch(_){
            // kalau URL tidak valid, biarkan
        }
        return s;
        }

        function buildJsonpUrl(baseUrl, params, cbName){
        const q = new URLSearchParams({
            ...(params || {}),
            callback: cbName,
            _t: Date.now().toString()
        });
        return baseUrl + (baseUrl.includes("?") ? "&" : "?") + q.toString();
        }

        function jsonpCallOnce(baseUrl, params, timeoutMs = API_TIMEOUT_MS){
        return new Promise((resolve, reject) => {
            const cb = "__tiba_jsonp_" + Date.now() + "_" + Math.random().toString(16).slice(2);
            let script = null;
            let done = false;

            const cleanup = (err) => {
            if (done) return;
            done = true;
            try { delete window[cb]; } catch(e){ window[cb] = undefined; }
            if (script && script.parentNode) script.parentNode.removeChild(script);
            if (err) reject(err);
            };

            const timer = setTimeout(() => {
            cleanup(new Error("Timeout: Tidak ada respon dari server (JSONP)."));
            }, timeoutMs);

            window[cb] = (data) => {
            clearTimeout(timer);
            cleanup();
            resolve(data);
            };

            const url = buildJsonpUrl(baseUrl, params, cb);

            script = document.createElement("script");
            script.async = true;
            script.defer = true;
            script.src = url;

            // ekstra kompatibilitas mobile
            script.crossOrigin = "anonymous";
            script.referrerPolicy = "no-referrer-when-downgrade";

            script.onerror = () => {
            clearTimeout(timer);
            cleanup(new Error("Gagal memuat JSONP. Base URL salah / tidak publik / bukan WebApp exec."));
            };

            document.head.appendChild(script);
        });
        }

        function getBaseCandidates(){
        const list = [];

        const lastGood = normalizeBaseUrl(localStorage.getItem(LS_KEY_LAST_GOOD_BASE) || "");
        if (lastGood) list.push(lastGood);

        const guc = normalizeBaseUrl(GAS_URL_GUC);
        if (guc) list.push(guc);

        list.push(normalizeBaseUrl(GAS_URL_EXEC));

        // unique + buang kosong
        return Array.from(new Set(list)).filter(Boolean);
        }

        async function apiGet(params){
        const bases = getBaseCandidates();
        let lastErr = null;

        for (const base of bases){
            try{
            const res = await jsonpCallOnce(base, params, API_TIMEOUT_MS);
            localStorage.setItem(LS_KEY_LAST_GOOD_BASE, base);
            return res;
            }catch(err){
            lastErr = err;
            }
        }

        throw lastErr || new Error("Gagal memanggil API");
        }

        /* =======================
        Di bawah ini: kode Anda
        ======================= */

        // Variabel global
        let dashboardData = null;
        let currentTab = 'arrived';
        let sortConfig = { column: null, direction: 'asc' };

        // Inisialisasi saat halaman dimuat
        document.addEventListener('DOMContentLoaded', function() {
        loadDashboardData();

        document.getElementById('refreshBtn').addEventListener('click', loadDashboardData);
        document.getElementById('tabArrived').addEventListener('click', () => switchTab('arrived'));
        document.getElementById('tabNotArrived').addEventListener('click', () => switchTab('notArrived'));
        document.getElementById('searchInput').addEventListener('input', filterTables);
        document.getElementById('filterRegion').addEventListener('change', filterTables);
        document.getElementById('filterEstate').addEventListener('change', filterTables);
        });

        // Fungsi untuk memuat data dari Google Apps Script
        function loadDashboardData() {
        showLoading(true);

        apiGet({ action: "dashboard.get" })
            .then(handleDataLoaded)
            .catch(handleDataError);
        }

        // Handler ketika data berhasil dimuat
        function handleDataLoaded(data) {
        if (data && data.success) {
            dashboardData = data;

            updateSummaryCards(data);
            updateRegionTable(data.regionStats);
            updateEstateTable(data.estateStats);
            updateParticipantTables(data);
            updateFilterDropdowns(data);

            // ✅ FIX: backend kirim generatedAt (bukan lastUpdated)
            document.getElementById('lastUpdated').textContent = data.generatedAt || '-';

            setupTableSorting();
            updateTableInfo();

            setTimeout(() => showLoading(false), 500);
            showNotification('Data berhasil dimuat', 'success');
        } else {
            showNotification('Error: ' + (data?.error || 'Response tidak valid'), 'error');
            showLoading(false);
        }
        }
        
        // Handler ketika data gagal dimuat
        function handleDataError(error) {
            console.error('Error loading data:', error);
            showNotification('Gagal memuat data. Periksa koneksi atau coba refresh.', 'error');
            showLoading(false);
            
            // Tampilkan pesan error di UI
            document.getElementById('regionTableBody').innerHTML = `
                <tr>
                    <td colspan="5" class="py-8 text-center text-red-500">
                        <i class="fas fa-exclamation-triangle mr-2"></i> Gagal memuat data
                    </td>
                </tr>
            `;
            
            document.getElementById('estateTableBody').innerHTML = `
                <tr>
                    <td colspan="5" class="py-8 text-center text-red-500">
                        <i class="fas fa-exclamation-triangle mr-2"></i> Gagal memuat data
                    </td>
                </tr>
            `;
        }
        
        // Update summary cards dengan animasi
        function updateSummaryCards(data) {
            const summary = data.summary;
            
            // Animate counters
            animateCounter('totalPeserta', summary.totalPeserta);
            animateCounter('totalArrived', summary.totalArrived);
            
            // Update percentage
            document.getElementById('arrivalPercentage').textContent = summary.arrivalPercentage + '%';
            
            // Animate progress bar
            const progressBar = document.getElementById('arrivalProgressBar');
            progressBar.style.width = '0%';
            
            setTimeout(() => {
                progressBar.style.width = summary.arrivalPercentage + '%';
            }, 300);
        }
        
        // Animate counter from 0 to target value
        function animateCounter(elementId, targetValue) {
            const element = document.getElementById(elementId);
            const duration = 1500; // ms
            const step = 20; // ms
            const increment = targetValue / (duration / step);
            let currentValue = 0;
            
            const timer = setInterval(() => {
                currentValue += increment;
                if (currentValue >= targetValue) {
                    element.textContent = formatNumber(targetValue);
                    clearInterval(timer);
                } else {
                    element.textContent = formatNumber(Math.floor(currentValue));
                }
            }, step);
        }
        
        // Format number with thousand separators
        function formatNumber(num) {
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        }
        
        // Update region table
        function updateRegionTable(regionStats) {
            const tbody = document.getElementById('regionTableBody');
            
            if (!regionStats || regionStats.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" class="py-8 text-center text-gray-500">
                            <i class="fas fa-info-circle mr-2"></i> Tidak ada data region
                        </td>
                    </tr>
                `;
                return;
            }
            
            let html = '';
            
            // Sort by percentage (highest first)
            const sortedStats = [...regionStats].sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage));
            
            sortedStats.forEach(region => {
                const percentage = parseFloat(region.percentage);
                let barColor = 'bg-red-500';
                
                if (percentage >= 80) barColor = 'bg-green-500';
                else if (percentage >= 50) barColor = 'bg-yellow-500';
                else if (percentage >= 30) barColor = 'bg-orange-500';
                
                html += `
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                        <td class="py-3 px-4 font-medium">${region.region}</td>
                        <td class="py-3 px-4">${formatNumber(region.total)}</td>
                        <td class="py-3 px-4">${formatNumber(region.arrived)}</td>
                        <td class="py-3 px-4 font-medium">${region.percentage}%</td>
                        <td class="py-3 px-4">
                            <div class="w-full bg-gray-200 rounded-full h-2.5">
                                <div class="${barColor} h-2.5 rounded-full" style="width: ${region.percentage}%"></div>
                            </div>
                        </td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;
        }
        
        // Update estate table
        function updateEstateTable(estateStats) {
            const tbody = document.getElementById('estateTableBody');
            
            if (!estateStats || estateStats.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" class="py-8 text-center text-gray-500">
                            <i class="fas fa-info-circle mr-2"></i> Tidak ada data estate/unit
                        </td>
                    </tr>
                `;
                return;
            }
            
            let html = '';
            
            // Sort by region and then by percentage
            const sortedStats = [...estateStats].sort((a, b) => {
                if (a.region === b.region) {
                    return parseFloat(b.percentage) - parseFloat(a.percentage);
                }
                return a.region.localeCompare(b.region);
            });
            
            sortedStats.forEach(estate => {
                const percentage = parseFloat(estate.percentage);
                let badgeColor = 'bg-red-100 text-red-800';
                
                if (percentage >= 80) badgeColor = 'bg-green-100 text-green-800';
                else if (percentage >= 50) badgeColor = 'bg-yellow-100 text-yellow-800';
                else if (percentage >= 30) badgeColor = 'bg-orange-100 text-orange-800';
                
                html += `
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                        <td class="py-3 px-4 font-medium">${estate.estate}</td>
                        <td class="py-3 px-4">${estate.region}</td>
                        <td class="py-3 px-4">${formatNumber(estate.total)}</td>
                        <td class="py-3 px-4">${formatNumber(estate.arrived)}</td>
                        <td class="py-3 px-4">
                            <span class="px-2 py-1 rounded-full text-xs font-medium ${badgeColor}">
                                ${estate.percentage}%
                            </span>
                        </td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;
        }
        
        // Update participant tables
        function updateParticipantTables(data) {
            updateArrivedTable(data.arrivedPeserta);
            updateNotArrivedTable(data.notArrivedPeserta);
        }
        
        // Update arrived participants table
        function updateArrivedTable(arrivedPeserta) {
            const tbody = document.getElementById('arrivedTableBody');
            
            if (!arrivedPeserta || arrivedPeserta.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="py-10 text-center text-gray-500">
                            <div class="flex flex-col items-center">
                                <i class="fas fa-users-slash text-3xl mb-3 text-gray-400"></i>
                                <p>Belum ada peserta yang datang</p>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }
            
            let html = '';
            
            arrivedPeserta.forEach(peserta => {
                // Format arrival time
                let arrivalTime = peserta.ArrivalTime || '';
                if (arrivalTime && typeof arrivalTime === 'string') {
                    try {
                        const date = new Date(arrivalTime);
                        if (!isNaN(date.getTime())) {
                            arrivalTime = date.toLocaleString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                        }
                    } catch (e) {
                        // Keep original format if parsing fails
                    }
                }
                
                html += `
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                        <td class="py-3 px-4 font-mono">${peserta.NIK}</td>
                        <td class="py-3 px-4 font-medium">${peserta.Nama || ''}</td>
                        <td class="py-3 px-4">${peserta.Region || ''}</td>
                        <td class="py-3 px-4">${peserta.Estate || ''}</td>
                        <td class="py-3 px-4">${peserta.Vehicle || ''}</td>
                        <td class="py-3 px-4 font-medium">${arrivalTime}</td>
                        <td class="py-3 px-4 font-mono">${peserta.TripId || ''}</td>
                        <td class="py-3 px-4">
                            <span class="status-arrived">Sudah Datang</span>
                        </td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;
        }
        
        // Update not arrived participants table
        function updateNotArrivedTable(notArrivedPeserta) {
            const tbody = document.getElementById('notArrivedTableBody');
            
            if (!notArrivedPeserta || notArrivedPeserta.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="py-10 text-center text-gray-500">
                            <div class="flex flex-col items-center">
                                <i class="fas fa-check-double text-3xl mb-3 text-green-400"></i>
                                <p>Semua peserta sudah datang</p>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }
            
            let html = '';
            
            notArrivedPeserta.forEach(peserta => {
                html += `
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                        <td class="py-3 px-4 font-mono">${peserta.NIK}</td>
                        <td class="py-3 px-4 font-medium">${peserta.Nama || ''}</td>
                        <td class="py-3 px-4">${peserta.Region || ''}</td>
                        <td class="py-3 px-4">${peserta.Estate || ''}</td>
                        <td class="py-3 px-4">${peserta.Vehicle || ''}</td>
                        <td class="py-3 px-4 font-mono">${peserta.MainNIK || ''}</td>
                        <td class="py-3 px-4 font-mono">${peserta.TripId || ''}</td>
                        <td class="py-3 px-4">
                            <span class="status-not-arrived">Belum Datang</span>
                        </td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;
        }
        
        // Update filter dropdowns
        function updateFilterDropdowns(data) {
            const regionSelect = document.getElementById('filterRegion');
            const estateSelect = document.getElementById('filterEstate');
            
            // Collect unique regions
            const regions = new Set();
            const estates = new Set();
            
            if (data.regionStats) {
                data.regionStats.forEach(region => {
                    if (region.region && region.region !== 'Tidak Diketahui') {
                        regions.add(region.region);
                    }
                });
            }
            
            if (data.estateStats) {
                data.estateStats.forEach(estate => {
                    if (estate.estate && estate.estate !== 'Tidak Diketahui') {
                        estates.add(estate.estate);
                    }
                });
            }
            
            // Update region dropdown
            let regionOptions = '<option value="">Semua Region</option>';
            Array.from(regions).sort().forEach(region => {
                regionOptions += `<option value="${region}">${region}</option>`;
            });
            regionSelect.innerHTML = regionOptions;
            
            // Update estate dropdown
            let estateOptions = '<option value="">Semua Estate/Unit</option>';
            Array.from(estates).sort().forEach(estate => {
                estateOptions += `<option value="${estate}">${estate}</option>`;
            });
            estateSelect.innerHTML = estateOptions;
        }
        
        // Setup table sorting
        function setupTableSorting() {
            // Setup untuk tabel peserta yang sudah datang
            const arrivedHeaders = document.querySelectorAll('#arrivedTable thead th');
            arrivedHeaders.forEach((header, index) => {
                header.addEventListener('click', () => {
                    sortTable('arrived', index);
                });
                header.style.cursor = 'pointer';
                
                // Tambah indikator sort
                header.innerHTML += ' <i class="fas fa-sort text-gray-400"></i>';
            });
            
            // Setup untuk tabel peserta yang belum datang
            const notArrivedHeaders = document.querySelectorAll('#notArrivedTable thead th');
            notArrivedHeaders.forEach((header, index) => {
                header.addEventListener('click', () => {
                    sortTable('notArrived', index);
                });
                header.style.cursor = 'pointer';
                
                // Tambah indikator sort
                header.innerHTML += ' <i class="fas fa-sort text-gray-400"></i>';
            });
        }
        
        // Sort table
        function sortTable(tableType, columnIndex) {
            // Tentukan tbody yang akan diurutkan
            const tbodyId = tableType === 'arrived' ? 'arrivedTableBody' : 'notArrivedTableBody';
            const tbody = document.getElementById(tbodyId);
            const rows = Array.from(tbody.querySelectorAll('tr'));
            
            // Tentukan apakah kolom ini sedang diurutkan
            const isSameColumn = sortConfig.column === columnIndex;
            
            // Toggle direction jika kolom sama, jika tidak reset ke ascending
            if (isSameColumn) {
                sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortConfig.column = columnIndex;
                sortConfig.direction = 'asc';
            }
            
            // Urutkan baris
            rows.sort((a, b) => {
                const aCell = a.cells[columnIndex]?.textContent || '';
                const bCell = b.cells[columnIndex]?.textContent || '';
                
                // Coba parsing sebagai angka
                const aNum = parseFloat(aCell.replace(/\./g, '').replace(',', '.'));
                const bNum = parseFloat(bCell.replace(/\./g, '').replace(',', '.'));
                
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    // Bandingkan sebagai angka
                    return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
                } else {
                    // Bandingkan sebagai string
                    return sortConfig.direction === 'asc' 
                        ? aCell.localeCompare(bCell, 'id', { sensitivity: 'base' })
                        : bCell.localeCompare(aCell, 'id', { sensitivity: 'base' });
                }
            });
            
            // Hapus baris yang ada
            rows.forEach(row => tbody.removeChild(row));
            
            // Tambahkan baris yang sudah diurutkan
            rows.forEach(row => tbody.appendChild(row));
            
            // Update indikator sort di header
            updateSortIndicators(tableType, columnIndex);
            
            // Update table info
            updateTableInfo();
        }
        
        // Update sort indicators
        function updateSortIndicators(tableType, columnIndex) {
            // Reset semua indikator
            const allHeaders = document.querySelectorAll(`#${tableType === 'arrived' ? 'arrivedTable' : 'notArrivedTable'} thead th i`);
            allHeaders.forEach(icon => {
                icon.className = 'fas fa-sort text-gray-400';
            });
            
            // Set indikator untuk kolom yang aktif
            const activeHeader = document.querySelectorAll(`#${tableType === 'arrived' ? 'arrivedTable' : 'notArrivedTable'} thead th`)[columnIndex];
            const activeIcon = activeHeader.querySelector('i');
            
            if (activeIcon) {
                if (sortConfig.direction === 'asc') {
                    activeIcon.className = 'fas fa-sort-up text-blue-600';
                } else {
                    activeIcon.className = 'fas fa-sort-down text-blue-600';
                }
            }
        }
        
        // Filter tables based on search and filters
        function filterTables() {
            if (!dashboardData) return;
            
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const selectedRegion = document.getElementById('filterRegion').value;
            const selectedEstate = document.getElementById('filterEstate').value;
            
            // Filter untuk peserta yang sudah datang
            filterParticipantTable(
                'arrivedTableBody',
                dashboardData.arrivedPeserta,
                searchTerm,
                selectedRegion,
                selectedEstate
            );
            
            // Filter untuk peserta yang belum datang
            filterParticipantTable(
                'notArrivedTableBody',
                dashboardData.notArrivedPeserta,
                searchTerm,
                selectedRegion,
                selectedEstate
            );
            
            // Update table info
            updateTableInfo();
        }
        
        // Filter participant table
        function filterParticipantTable(tbodyId, participants, searchTerm, selectedRegion, selectedEstate) {
            const tbody = document.getElementById(tbodyId);
            
            if (!participants || participants.length === 0) {
                return;
            }
            
            // Filter data
            const filtered = participants.filter(p => {
                // Filter by search term
                const matchesSearch = !searchTerm || 
                    (p.NIK && p.NIK.toLowerCase().includes(searchTerm)) ||
                    (p.Nama && p.Nama.toLowerCase().includes(searchTerm)) ||
                    (p.Region && p.Region.toLowerCase().includes(searchTerm)) ||
                    (p.Estate && p.Estate.toLowerCase().includes(searchTerm)) ||
                    (p.Vehicle && p.Vehicle.toLowerCase().includes(searchTerm)) ||
                    (p.TripId && p.TripId.toLowerCase().includes(searchTerm));
                
                // Filter by region
                const matchesRegion = !selectedRegion || p.Region === selectedRegion;
                
                // Filter by estate
                const matchesEstate = !selectedEstate || p.Estate === selectedEstate;
                
                return matchesSearch && matchesRegion && matchesEstate;
            });
            
            // Update table based on filtered data
            if (tbodyId === 'arrivedTableBody') {
                updateArrivedTable(filtered);
            } else {
                updateNotArrivedTable(filtered);
            }
        }
        
        // Switch between tabs
        function switchTab(tab) {
            currentTab = tab;
            
            // Update active tab button
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.classList.remove('bg-blue-600');
                
                if (btn.id === 'tabArrived') {
                    btn.classList.add(tab === 'arrived' ? 'bg-blue-600' : 'bg-green-600');
                } else {
                    btn.classList.add(tab === 'notArrived' ? 'bg-blue-600' : 'bg-red-600');
                }
            });
            
            // Show/hide tables
            if (tab === 'arrived') {
                document.getElementById('arrivedTable').classList.remove('hidden');
                document.getElementById('notArrivedTable').classList.add('hidden');
            } else {
                document.getElementById('arrivedTable').classList.add('hidden');
                document.getElementById('notArrivedTable').classList.remove('hidden');
            }
            
            // Update table info
            updateTableInfo();
        }
        
        // Update table info text
        function updateTableInfo() {
            let infoText = '';
            
            if (currentTab === 'arrived') {
                const rows = document.querySelectorAll('#arrivedTableBody tr:not(.no-data)');
                const count = rows.length;
                infoText = `Menampilkan ${count} peserta yang sudah datang`;
            } else {
                const rows = document.querySelectorAll('#notArrivedTableBody tr:not(.no-data)');
                const count = rows.length;
                infoText = `Menampilkan ${count} peserta yang belum datang`;
            }
            
            // Tambah info filter jika ada
            const searchTerm = document.getElementById('searchInput').value;
            const selectedRegion = document.getElementById('filterRegion').value;
            const selectedEstate = document.getElementById('filterEstate').value;
            
            const filters = [];
            if (searchTerm) filters.push(`pencarian: "${searchTerm}"`);
            if (selectedRegion) filters.push(`region: ${selectedRegion}`);
            if (selectedEstate) filters.push(`estate: ${selectedEstate}`);
            
            if (filters.length > 0) {
                infoText += ` (difilter dengan ${filters.join(', ')})`;
            }
            
            document.getElementById('tableInfo').textContent = infoText;
        }
        
        // Show/hide loading indicator
        function showLoading(show) {
            const loadingIndicator = document.getElementById('loadingIndicator');
            
            if (show) {
                loadingIndicator.classList.remove('hidden');
            } else {
                loadingIndicator.classList.add('hidden');
            }
        }
        
        // Show notification
        function showNotification(message, type) {
            // Hapus notifikasi sebelumnya
            const existingNotification = document.querySelector('.notification');
            if (existingNotification) {
                existingNotification.remove();
            }
            
            // Buat notifikasi baru
            const notification = document.createElement('div');
            notification.className = `notification fixed top-4 right-4 z-50 px-6 py-4 rounded-lg shadow-lg text-white font-medium transform transition-transform duration-300 ${
                type === 'success' ? 'bg-green-600' : 'bg-red-600'
            }`;
            notification.textContent = message;
            
            // Tambah ikon
            const icon = document.createElement('i');
            icon.className = `fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'} mr-2`;
            notification.prepend(icon);
            
            document.body.appendChild(notification);
            
            // Tampilkan dengan animasi
            setTimeout(() => {
                notification.classList.remove('transform');
                notification.classList.add('translate-x-0');
            }, 10);
            
            // Hapus setelah 5 detik
            setTimeout(() => {
                notification.classList.add('opacity-0');
                notification.classList.add('transform');
                notification.classList.add('translate-x-full');
                
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, 5000);
        }
        
        // Auto-refresh data setiap 30 detik
        setInterval(() => {
            // Hanya refresh jika user sedang aktif di halaman
            if (!document.hidden) {
                loadDashboardData();
            }
        }, 30000);