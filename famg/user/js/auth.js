// Authentication Module
class Auth {
    constructor() {
        this.currentUser = null;
        this.attended = false;
        this.utils = window.utils || new Utils();
        this.initializeElements();
        this.applyBranding();
        this.loadRemoteConfig();
        this.initRegistrationCountdown();
        this.loadAttendanceStatus();
    }

    initializeElements() {
        this.nikInput = document.getElementById('nik-input');
        this.checkNikBtn = document.getElementById('check-nik-btn');
        this.authError = document.getElementById('auth-error');
        this.authSuccess = document.getElementById('auth-success');
        this.alreadyAttended = document.getElementById('already-attended');
        this.familyList = document.getElementById('family-list');
        this.confirmAttendanceBtn = document.getElementById('confirm-attendance-btn');
        this.enterAppBtn = document.getElementById('enter-app-btn');
        this.authSection = document.getElementById('auth-section');
        this.appSection = document.getElementById('app-section');
        this.logoutBtn = document.getElementById('logout-btn');
        
        this.bindEvents();
    }
    async loadRemoteConfig(){
        try{
            const r = await window.FGAPI.public.getConfig();
            const patch = r?.config || null;
            if(patch && window.AppConfig?.applyPatch){
            window.AppConfig.applyPatch(patch, true); // simpan ke localStorage juga
            }
            // setelah patch diterapkan, refresh branding
            this.applyBranding();
        }catch(e){
            // diamkan: pakai default config.js
        }
        }

    // ===============================
    // ✅ Branding UI dari AppConfig (tanpa hardcode)
    // ===============================
    applyBranding(){
        try{
            const cfg = window.AppConfig || {};
            const brand = cfg.app?.brand || {};

            const appName = (brand.appName || cfg.event?.name || '').trim();
            if(appName) document.title = appName;

            const headerTitle = (brand.headerTitle || cfg.event?.name || '').trim();
            const headerSub = (brand.headerSubtitle || '').trim();

            const h1 = document.getElementById('main-event-title');
            const p  = document.getElementById('main-event-date');
            if(h1 && headerTitle) h1.textContent = headerTitle;
            if(p && headerSub) p.textContent = headerSub;
        }catch(e){
            // no-op
        }
    }

    bindEvents() {
        this.checkNikBtn.addEventListener('click', () => this.checkNIK());
        this.nikInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.checkNIK();
        });
        this.confirmAttendanceBtn.addEventListener('click', () => this.confirmAttendance());
        this.enterAppBtn.addEventListener('click', () => this.enterApp());
        this.logoutBtn.addEventListener('click', () => this.logout());
    }

    // ===============================
    // ✅ Countdown Registrasi/Absensi + timezone warning
    // ===============================
    initRegistrationCountdown(){
        const box = document.getElementById('reg-countdown');
        if(!box) return;

        const btn = document.getElementById('check-nik-btn');
        const nikInput = document.getElementById('nik-input');

        // simpan label tombol asli (agar icon tetap)
        if(btn && !btn.dataset.baseHtml){
            btn.dataset.baseHtml = btn.innerHTML;
        }

        const setBtn = (enabled, suffix='')=>{
            if(!btn) return;
            btn.disabled = !enabled;

            // shimmer hanya saat dibuka
            btn.classList.toggle('fg-shimmer', !!enabled);

            // tampilkan suffix kecil (contoh: "Dibuka 00:12:10")
            if(suffix){
            btn.innerHTML = `
                <div class="leading-tight text-center">
                <div>${btn.dataset.baseHtml || 'Verifikasi'}</div>
                <div class="text-[11px] opacity-90 mt-1">${suffix}</div>
                </div>
            `;
            }else{
            btn.innerHTML = btn.dataset.baseHtml || btn.innerHTML;
            }
        };

        const setInput = (enabled)=>{
            if(nikInput) nikInput.disabled = !enabled;
        };

        const fmtCD = (msLeft)=>{
            return this.utils?.formatCountdown
            ? this.utils.formatCountdown(msLeft)
            : `${Math.max(0, Math.ceil(msLeft/1000))}s`;
        };

        const render = ()=>{
            const cfg = window.AppConfig || {};
            const ev = cfg.event || {};

            const nowMs = (this.utils?.nowMs ? this.utils.nowMs() : Date.now());
            const startMs = (this.utils?.parseIsoMs ? this.utils.parseIsoMs(ev.galaDinnerDate) : Date.parse(ev.galaDinnerDate));
            const endMs   = (this.utils?.parseIsoMs ? this.utils.parseIsoMs(ev.galaDinnerEndTime) : Date.parse(ev.galaDinnerEndTime));

            const invalidIso = !Number.isFinite(startMs) || !Number.isFinite(endMs);

            const startWib = this.utils?.formatWibDateTime
            ? this.utils.formatWibDateTime(ev.galaDinnerDate)
            : (ev.galaDinnerDate || '');

            const endWib = this.utils?.formatWibDateTime
            ? this.utils.formatWibDateTime(ev.galaDinnerEndTime)
            : (ev.galaDinnerEndTime || '');

            const tzWarn = this.utils?.getTimezoneWarning ? this.utils.getTimezoneWarning() : '';
            const tzPill = tzWarn ? `
            <span class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600">
                <i class="fas fa-globe-asia"></i><span>Non-WIB</span>
            </span>
            ` : '';

            // helper UI builder
            const badge = (state, text)=>{
            // warna halus via fg-badge + tailwind classes (transition dibantu CSS)
            let cls = 'fg-badge inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold';
            if(state === 'BEFORE') cls += ' bg-blue-50 text-blue-700 border-blue-100';
            if(state === 'OPEN')   cls += ' bg-green-50 text-green-700 border-green-100';
            if(state === 'AFTER')  cls += ' bg-red-50 text-red-700 border-red-100';
            if(state === 'WARN')   cls += ' bg-yellow-50 text-yellow-800 border-yellow-200';

            const dot = (state === 'OPEN')
                ? `<span class="w-2 h-2 rounded-full bg-green-600 animate-pulse"></span>`
                : `<span class="w-2 h-2 rounded-full bg-current opacity-50"></span>`;

            return `<span class="${cls}">${dot}<span>${text}</span></span>${tzPill}`;
            };

            const progress = (mode, percent)=>{
            // mode: "indeterminate" atau "determinate"
            const ind = (mode === 'indeterminate') ? 'is-indeterminate' : '';
            const w = Math.max(0, Math.min(100, Number(percent)||0));
            return `
                <div class="fg-progress ${ind}">
                <div class="fg-bar" style="${mode==='determinate' ? `width:${w}%;` : ''}"></div>
                </div>
            `;
            };

            // ============ INVALID ISO ============
            if(invalidIso){
            setBtn(true, '');
            setInput(true);

            box.innerHTML = `
                <div class="flex items-center justify-center">
                ${badge('WARN','Waktu absensi belum valid')}
                </div>
                <div class="mt-3">${progress('indeterminate')}</div>
            `;
            return;
            }

            // ============ BEFORE ============
            if(nowMs < startMs){
            const left = startMs - nowMs;
            const cd = fmtCD(left);

            setBtn(false, `Dibuka ${cd}`);
            setInput(false);

            box.innerHTML = `
                <div class="flex items-center justify-center">
                ${badge('BEFORE','Belum dibuka')}
                </div>

                <div class="mt-3">${progress('indeterminate')}</div>

                <div class="mt-2 text-center">
                <div class="text-[11px] text-gray-500">Dibuka dalam</div>
                <div class="text-2xl font-extrabold tracking-wide text-gray-900">${cd}</div>
                <div class="mt-1 text-[11px] text-gray-500">Buka <b>${startWib}</b> • Tutup <b>${endWib}</b></div>
                </div>
            `;
            return;
            }

            // ============ AFTER ============
            if(nowMs > endMs){
            setBtn(false, 'Ditutup');
            setInput(false);

            box.innerHTML = `
                <div class="flex items-center justify-center">
                ${badge('AFTER','Absensi ditutup')}
                </div>
                <div class="mt-3">${progress('determinate', 100)}</div>
                <div class="mt-2 text-center text-[11px] text-gray-500">Ditutup <b>${endWib}</b></div>
            `;
            return;
            }

            // ============ OPEN ============
            const total = Math.max(1, endMs - startMs);
            const elapsed = Math.max(0, nowMs - startMs);
            const pct = (elapsed / total) * 100;

            const left = endMs - nowMs;
            const cd = fmtCD(left);

            setBtn(true, '');
            setInput(true);

            box.innerHTML = `
            <div class="flex items-center justify-center">
                ${badge('OPEN','Dibuka')}
            </div>

            <div class="mt-3">${progress('determinate', pct)}</div>

            <div class="mt-2 text-center">
                <div class="text-[11px] text-gray-500">Tutup dalam</div>
                <div class="text-2xl font-extrabold tracking-wide text-gray-900">${cd}</div>
            </div>
            `;
        };

        render();
        clearInterval(this._regTimer);
        this._regTimer = setInterval(render, 1000);

        window.addEventListener('beforeunload', ()=> {
            try{ clearInterval(this._regTimer); }catch{}
        }, { once:true });
    }


    async checkNIK() {
        const nik = this.nikInput.value.trim();
        
        // Validasi NIK menggunakan utils
        const validation = this.utils.validateNIK(nik);
        if (!validation.valid) {
            this.showError('NIK tidak valid', validation.message);
            return;
        }
        
        // Cek apakah sudah absen (server)
        try {
            const st = await window.FGAPI.public.getAttendanceStatus(nik);
            if (st && st.already === true) {
                // Simpan user jika tersedia agar tombol "Masuk" tetap bisa tampil info user
                if (st.participant) this.currentUser = st.participant;
                this.showAlreadyAttended();
                return;
            }
        } catch (e) {
            this.showError('Gagal memeriksa status absensi', String(e.message || e));
            return;
        }
        
        // Cek apakah dalam radius lokasi
        const inLocation = await this.utils.checkLocation();
        if (!inLocation) {
            const locationName = window.AppConfig?.getEventLocation ? 
                window.AppConfig.getEventLocation().name : 'lokasi acara';
            this.showError('Tidak dapat melakukan absensi', `Anda berada di luar radius ${locationName}`);
            return;
        }
        
        // Cek apakah tanggal dan waktu acara
        if (!this.utils.isEventDate()) {
            this.showError('Tidak dapat melakukan absensi', 'Absensi hanya dapat dilakukan pada tanggal acara');
            return;
        }
        
        if (!this.utils.isGalaDinnerTime()) {
            const eventTime = window.AppConfig?.event?.galaDinnerDate ? 
                new Date(window.AppConfig.event.galaDinnerDate).toLocaleTimeString('id-ID', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    timeZone: 'Asia/Jakarta' 
                }) : '16:00';
            this.showError('Tidak dapat melakukan absensi', `Absensi hanya dapat dilakukan mulai pukul ${eventTime} WIB`);
            return;
        }
        
        // Ambil data peserta dari server
        try {
            const participant = await window.FGAPI.public.getParticipantByNIK(nik);
            if (!participant) {
                this.showError('NIK tidak ditemukan', 'Pastikan NIK yang dimasukkan sudah benar');
                return;
            }
            this.currentUser = participant;
            this.showSuccess(participant);
        } catch (e) {
            this.showError('Gagal memuat data peserta', String(e.message || e));
        }
    }

    showError(message, detail) {
        this.authError.classList.remove('hidden');
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-detail').textContent = detail;
        this.authSuccess.classList.add('hidden');
        this.alreadyAttended.classList.add('hidden');
        
        // Auto hide error after configured time
        const timeout = window.AppConfig?.app?.notificationTimeout || 5000;
        setTimeout(() => {
            this.authError.classList.add('hidden');
        }, timeout);
    }

    showSuccess(participant) {
        this.authError.classList.add('hidden');
        this.authSuccess.classList.remove('hidden');
        this.alreadyAttended.classList.add('hidden');
        
        // Update UI dengan informasi acara dari konfigurasi
        const eventDate = window.AppConfig?.getEventDate ? 
            window.AppConfig.getEventDate() : new Date('2026-02-16T16:00:00+07:00');
        
        const dateString = eventDate.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        const locationName = window.AppConfig?.getEventLocation ? 
            window.AppConfig.getEventLocation().name : 'Novotel Pontianak';
        
        // Update teks informasi di form
        const eventInfoElements = document.querySelectorAll('.event-info');
        eventInfoElements.forEach(element => {
            if (element.id === 'event-date-info') {
                element.textContent = dateString;
            } else if (element.id === 'event-location-info') {
                element.textContent = locationName;
            }
        });
        
        // Tampilkan daftar keluarga
        this.renderFamilyList(this.ensureMainInFamily(participant));
    }

    showAlreadyAttended() {
        this.authError.classList.add('hidden');
        this.authSuccess.classList.add('hidden');
        this.alreadyAttended.classList.remove('hidden');
    }

    ensureMainInFamily(participant){
        const name = String(participant?.name || '').trim();
        const fam = Array.isArray(participant?.family) ? [...participant.family] : [];

        // format label peserta utama (konsisten)
        const mainLabel = name ? `${name} (Peserta Utama)` : '';

        // kalau nama kosong, ya biarkan apa adanya
        if(!mainLabel) return fam;

        // hapus duplikat jika sudah ada
        const lowerMain = mainLabel.toLowerCase();
        const cleaned = fam.filter(x => String(x||'').trim().toLowerCase() !== lowerMain);

        // ✅ peserta utama selalu index 0
        return [mainLabel, ...cleaned];
        }

    renderFamilyList(familyMembers) {
        this.familyList.innerHTML = '';
        
        familyMembers.forEach((member, index) => {
            const memberElement = document.createElement('div');
            memberElement.className = 'flex items-center p-4 bg-gray-50 rounded-xl';
            memberElement.innerHTML = `
                <input type="checkbox" id="member-${index}" class="checkbox-custom" checked>
                <label for="member-${index}" class="ml-3 flex-grow cursor-pointer">
                    <span class="font-medium text-gray-800">${member}</span>
                    ${index === 0 ? '<span class="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">Peserta Utama</span>' : ''}
                </label>
            `;
            this.familyList.appendChild(memberElement);
        });
    }

    async confirmAttendance() {
        if (!this.currentUser) return;

        // ✅ gunakan family list yang sudah dipastikan ada peserta utama
        const familyForUi = this.ensureMainInFamily(this.currentUser);

        const checkboxes = document.querySelectorAll('#family-list input[type="checkbox"]');
        const attendedMembers = [];

        checkboxes.forEach((checkbox, index) => {
            if (checkbox.checked) attendedMembers.push(familyForUi[index]);
        });

        if (attendedMembers.length === 0) {
            this.utils.showNotification('Pilih minimal 1 orang hadir', 'warning');
            return;
        }
        
        // Simpan ke server
        try {
            await window.FGAPI.public.submitAttendance(this.currentUser.nik, attendedMembers);
            this.attended = true;
            this.utils.showNotification('Kehadiran berhasil dikonfirmasi', 'success');
            this.showAlreadyAttended();
        } catch (e) {
            this.utils.showNotification(String(e.message || e), 'error');
        }
    }

    // Status absensi sekarang dicek via server (lihat checkNIK)
    checkIfAlreadyAttended(nik) { return false; }

    enterApp() {
        if (!this.currentUser) return;

        // ✅ Simpan sesi
        sessionStorage.setItem('currentUser', JSON.stringify(this.currentUser));

        // ✅ SINKRON GLOBAL (INI KUNCI)
        window.FG_USER = {
            nik: this.currentUser.nik,
            name: this.currentUser.name
        };

        // OPTIONAL: simpan juga ke localStorage (agar tahan reload)
        localStorage.setItem('fg_nik', this.currentUser.nik);

        // UI
        this.authSection.classList.add('hidden');
        this.appSection.classList.remove('hidden');

        this.updateUserInfo();
        this.updateEventInfo();

        // 🔔 BERITAHU MODUL LAIN
        document.dispatchEvent(
            new CustomEvent('fg:user-ready', { detail: window.FG_USER })
        );

        this.utils.showNotification(`Selamat datang, ${this.currentUser.name}`, 'success');
    }

    updateUserInfo() {
        const userNameElement = document.getElementById('user-name');
        const displayUserName = document.getElementById('display-user-name');
        const displayUserNik = document.getElementById('display-user-nik');
        const displayFamilyCount = document.getElementById('display-family-count');
        const authInfo = document.getElementById('auth-info');
        
        if (this.currentUser) {
            userNameElement.textContent = this.currentUser.name;
            displayUserName.textContent = this.currentUser.name;
            displayUserNik.textContent = this.currentUser.nik;
            displayFamilyCount.textContent = `${this.currentUser.family.length} orang`;
            authInfo.classList.remove('hidden');
        }
    }
    
    updateEventInfo() {
        // Update informasi acara di halaman utama
        const eventTitle = document.getElementById('main-event-title');
        const eventDate = document.getElementById('main-event-date');
        const eventLocation = document.getElementById('main-event-location');
        
        if (eventTitle && window.AppConfig?.event?.name) {
            eventTitle.textContent = window.AppConfig.event.name;
        }
        
        if (eventDate && window.AppConfig?.getEventDate) {
            const date = window.AppConfig.getEventDate();
            const dateString = date.toLocaleDateString('id-ID', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            eventDate.textContent = dateString;
        }
        
        if (eventLocation && window.AppConfig?.getEventLocation) {
            const location = window.AppConfig.getEventLocation();
            eventLocation.textContent = `${location.name}, ${location.address}`;
        }
    }

    logout() {
        this.currentUser = null;
        this.attended = false;
        
        // Clear session
        sessionStorage.removeItem('currentUser');
        
        // Reset form
        this.nikInput.value = '';
        this.authError.classList.add('hidden');
        this.authSuccess.classList.add('hidden');
        this.alreadyAttended.classList.add('hidden');
        
        // Tampilkan form absensi
        this.appSection.classList.add('hidden');
        this.authSection.classList.remove('hidden');

        try { this.utils.stopLiveLocationTracking(); } catch {}
        
        this.utils.showNotification('Anda telah keluar dari aplikasi', 'info');
    }

    loadAttendanceStatus() {
        const savedUser = sessionStorage.getItem('currentUser');
        if (savedUser) {
            try {
                this.currentUser = JSON.parse(savedUser);

                // ✅ PENTING
                window.FG_USER = {
                    nik: this.currentUser.nik,
                    name: this.currentUser.name
                };
                localStorage.setItem('fg_nik', this.currentUser.nik);

                this.authSection.classList.add('hidden');
                this.appSection.classList.remove('hidden');

                this.updateUserInfo();
                this.updateEventInfo();

                document.dispatchEvent(
                    new CustomEvent('fg:user-ready', { detail: window.FG_USER })
                );
            } catch (e) {
                sessionStorage.removeItem('currentUser');
            }
        }
    }

}

// Inisialisasi auth module
const auth = new Auth();