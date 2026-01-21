// Utility Functions
class Utils {
    constructor() {
        // Gunakan konfigurasi dari AppConfig
        this.config = window.AppConfig || {};
        
        // Log konfigurasi untuk debugging
        if (this.config.security?.debugMode) {
            console.log('Utils initialized with config:', this.config);
        }
    }

    // Format tanggal dan waktu
    formatDateTime(date) {
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        };
        return date.toLocaleDateString('id-ID', options);
    }

    // Cek apakah dalam radius lokasi acara
    async checkLocation() {
        // Jika geofencing dimatikan di konfigurasi
        if (!this.config.security?.enableGeofencing) {
            return true;
        }
        
        // Dalam implementasi nyata, ini akan menggunakan Geolocation API
        // Untuk simulasi, kita kembalikan true jika dalam mode debug
        if (this.config.security?.debugMode) {
            console.log('[DEBUG] Geofencing check: simulated TRUE');
            return true;
        }
        
        // Implementasi nyata akan seperti ini:
        try {
            const location = this.config.getEventLocation();
            return await this.getCurrentLocation()
                .then(userLocation => {
                    const distance = this.calculateDistance(
                        userLocation.lat, userLocation.lng,
                        location.lat, location.lng
                    );
                    
                    const inRadius = distance <= location.radius;
                    
                    if (this.config.security?.debugMode) {
                        console.log(`[DEBUG] Distance: ${distance.toFixed(2)}m, In radius: ${inRadius}`);
                    }
                    
                    return inRadius;
                })
                .catch(error => {
                    console.error('Error getting location:', error);
                    utils.showNotification('Lokasi gagal dideteksi. Aktifkan GPS & izin lokasi, lalu refresh.', 'warning');
                    return false;
                });
        } catch (error) {
            console.error('Error in checkLocation:', error);
            return false;
        }
    }

    // Dapatkan lokasi pengguna saat ini (lebih robust: fallback low->high accuracy)
    async getCurrentLocation() {
    const getPos = (opts) => new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
        reject(new Error('Geolocation tidak didukung oleh browser'));
        return;
        }
        navigator.geolocation.getCurrentPosition(
        (position) => resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
        }),
        (error) => reject(error),
        opts
        );
    });

    // 1) Coba cepat dulu (lebih sering berhasil di indoor)
    try {
        return await getPos({
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60000 // boleh pakai cache 1 menit
        });
    } catch (e1) {
        // 2) Kalau gagal, coba High Accuracy (GPS)
        return await getPos({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
        });
    }
    }

    // ===============================
    // ✅ LIVE LOCATION TRACKING (Peserta -> Server)
    // ===============================
    startLiveLocationTracking(nik, opts = {}) {
        if (!nik) return;

        // kalau geofencing dimatikan pun, live tracking boleh tetap jalan (admin monitor)
        const enable = (opts.enable !== undefined) ? !!opts.enable : true;
        if (!enable) return;

        if (!navigator.geolocation) {
            console.warn('Geolocation tidak didukung');
            return;
        }

        // stop dulu jika sudah pernah start
        this.stopLiveLocationTracking();

        const sendMinMs = Number(opts.sendMinMs || 30000); // minimal jeda kirim 15 detik
        const staleMs = Number(opts.staleMs || 120000);    // 2 menit untuk info admin (server side)
        const hiAcc = (opts.highAccuracy !== undefined) ? !!opts.highAccuracy : true;

        this._liveLoc = {
            nik: String(nik),
            watchId: null,
            lastSentAt: 0,
            lastPayloadKey: '',
            staleMs
        };

        const shouldSend = (pos) => {
            const now = Date.now();
            if (now - this._liveLoc.lastSentAt < sendMinMs) return false;

            // buat “key” agar tidak spam data yang sama persis
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const acc = pos.coords.accuracy || 0;

            const key = `${lat.toFixed(6)}|${lng.toFixed(6)}|${Math.round(acc)}`;
            if (key === this._liveLoc.lastPayloadKey && (now - this._liveLoc.lastSentAt) < (sendMinMs * 2)) {
                return false;
            }
            this._liveLoc.lastPayloadKey = key;
            return true;
        };

        const send = async (pos) => {
            try {
                if (!window.FGAPI?.public?.pushLiveLocation) return;

                const loc = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy || null,
                    speed: pos.coords.speed || null,
                    heading: pos.coords.heading || null,
                    ts: new Date(pos.timestamp || Date.now()).toISOString()
                };

                await window.FGAPI.public.pushLiveLocation(this._liveLoc.nik, loc);
                this._liveLoc.lastSentAt = Date.now();
            } catch (e) {
                // jangan spam notif ke user
                console.warn('pushLiveLocation error:', e?.message || e);
            }
        };

        const onPos = (pos) => {
            if (!this._liveLoc) return;
            if (shouldSend(pos)) send(pos);
        };

        const onErr = (err) => {
            console.warn('watchPosition error:', err);
            // jangan stop total; cukup diam
        };

        this._liveLoc.watchId = navigator.geolocation.watchPosition(onPos, onErr, {
            enableHighAccuracy: hiAcc,
            maximumAge: 10000,
            timeout: 20000
        });

        // stop saat unload
        window.addEventListener('beforeunload', () => this.stopLiveLocationTracking(), { once: true });
    }

    stopLiveLocationTracking() {
        try {
            if (this._liveLoc?.watchId != null && navigator.geolocation) {
                navigator.geolocation.clearWatch(this._liveLoc.watchId);
            }
        } catch {}
        this._liveLoc = null;
    }


    // Hitung jarak antara dua titik koordinat (Haversine formula)
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Radius bumi dalam meter
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    // Cek apakah tanggal saat ini adalah tanggal acara
    isEventDate() {
        if (!this.config.isValidEventDate) {
            return true; // Fallback jika fungsi tidak ada
        }
        
        return this.config.isValidEventDate(new Date());
    }

    // Cek apakah waktu saat ini dalam jam Gala Dinner
    isGalaDinnerTime() {
        if (!this.config.isValidGalaDinnerTime) {
            return true; // Fallback jika fungsi tidak ada
        }
        
        return this.config.isValidGalaDinnerTime(new Date());
    }

    // Generate ID unik
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // Show notification
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 animate-fade-in ${this.getNotificationColor(type)}`;
        notification.innerHTML = `
            <div class="flex items-center">
                <i class="fas ${this.getNotificationIcon(type)} mr-3"></i>
                <div>
                    <p class="font-medium">${message}</p>
                </div>
                <button class="ml-4 text-gray-500 hover:text-gray-700" onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto remove setelah waktu yang dikonfigurasi
        const timeout = this.config.app?.notificationTimeout || 5000;
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, timeout);
    }

    getNotificationColor(type) {
        const colors = {
            success: `bg-green-100 text-green-800 border border-green-200`,
            error: `bg-red-100 text-red-800 border border-red-200`,
            warning: `bg-yellow-100 text-yellow-800 border border-yellow-200`,
            info: `bg-blue-100 text-blue-800 border border-blue-200`
        };
        return colors[type] || colors.info;
    }

    getNotificationIcon(type) {
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        return icons[type] || icons.info;
    }
    
    // Validasi NIK berdasarkan konfigurasi
    validateNIK(nik) {
        if (!nik || typeof nik !== 'string') {
            return { valid: false, message: 'NIK tidak valid' };
        }
        
        const minLength = this.config.security?.nikMinLength || 8;
        
        if (nik.length < minLength) {
            return { 
                valid: false, 
                message: `NIK minimal ${minLength} karakter` 
            };
        }
        
        if (!/^\d+$/.test(nik)) {
            return { 
                valid: false, 
                message: 'NIK harus berupa angka' 
            };
        }
        
        return { valid: true, message: 'NIK valid' };
    }

    // ===============================
    // ✅ WIB-SAFE TIME HELPERS (anti timezone HP beda)
    // Semua hitungan pakai epoch ms (UTC-based), jadi aman.
    // ===============================
    parseIsoMs(iso){
    const s = String(iso || '').trim();
    const ms = Date.parse(s); // ISO +07:00 -> jadi epoch ms yang benar
    return Number.isFinite(ms) ? ms : NaN;
    }

    nowMs(){
    // epoch ms sekarang (timezone-agnostic)
    return Date.now();
    }

    getEventWindowMs(){
    const ev = this.config?.event || {};
    const startMs = this.parseIsoMs(ev.eventStartDate);
    const endMs   = this.parseIsoMs(ev.eventEndDate);
    const galaStartMs = this.parseIsoMs(ev.galaDinnerDate);
    const galaEndMs   = this.parseIsoMs(ev.galaDinnerEndTime);

    return { startMs, endMs, galaStartMs, galaEndMs };
    }

    isWithin(ms, startMs, endMs){
    if(!Number.isFinite(ms) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return true; // fallback aman
    return ms >= startMs && ms <= endMs;
    }

    // Override versi lama agar benar-benar timezone-safe
    isEventDate(){
    if (!this.config?.security?.enableDateValidation) return true;
    const { startMs, endMs } = this.getEventWindowMs();
    return this.isWithin(this.nowMs(), startMs, endMs);
    }

    // Override versi lama agar benar-benar timezone-safe
    isGalaDinnerTime(){
    if (!this.config?.security?.enableDateValidation) return true;
    const { galaStartMs, galaEndMs } = this.getEventWindowMs();
    return this.isWithin(this.nowMs(), galaStartMs, galaEndMs);
    }

    formatCountdown(msLeft){
    // msLeft bisa negatif -> "0"
    let s = Math.max(0, Math.floor(msLeft / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600);  s -= h * 3600;
    const m = Math.floor(s / 60);    s -= m * 60;

    const pad2 = (n)=> String(n).padStart(2,'0');
    if(d > 0) return `${d} hari ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    }

    formatWibDateTime(iso){
    // Tampilan selalu WIB, walaupun HP user bukan WIB
    try{
        const d = new Date(String(iso||''));
        return d.toLocaleString('id-ID', {
        weekday:'long', year:'numeric', month:'long', day:'numeric',
        hour:'2-digit', minute:'2-digit', second:'2-digit',
        timeZone:'Asia/Jakarta'
        }) + ' WIB';
    }catch{
        return String(iso||'');
    }
    }

    getTimezoneWarning(){
    // WIB = UTC+7 => offset minutes = -420 (karena getTimezoneOffset itu kebalikan)
    const off = new Date().getTimezoneOffset(); // contoh WIB => -420
    if(off !== -420){
        return `Zona waktu perangkat Anda bukan WIB (UTC+7). Aplikasi tetap aman karena memakai waktu server/ISO.`;
    }
    return '';
    }

}

// Inisialisasi utils
const utils = new Utils();
window.utils = window.utils || utils;

// ✅ auto start tracking setelah user login (fg:user-ready dipicu oleh auth.js)
document.addEventListener('fg:user-ready', (ev) => {
    const nik = ev?.detail?.nik || window.FG_USER?.nik || localStorage.getItem('fg_nik') || '';
    if (!nik) return;

    // nyalakan live tracking selama aplikasi tidak ditutup
    utils.startLiveLocationTracking(nik, {
        sendMinMs: utils.config?.app?.locationLiveSendMinMs || 30000,
        highAccuracy: true
    });
});

// Update clock
function updateClock() {
    const clockElement = document.getElementById('clock');
    if (clockElement) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'Asia/Jakarta'
        });
        clockElement.textContent = timeString;
        
        // Update tanggal acara jika ada di header
        const eventDateElement = document.getElementById('event-date');
        if (eventDateElement) {
            const eventDate = utils.config.getEventDate ? utils.config.getEventDate() : new Date();
            const dateString = eventDate.toLocaleDateString('id-ID', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            eventDateElement.textContent = dateString;
        }
    }
}

// Update location status
async function updateLocationStatus() {
    const statusElement = document.getElementById('location-status');
    const displayStatusElement = document.getElementById('display-location-status');
    
    if (statusElement && displayStatusElement) {
        try {
            const inLocation = await utils.checkLocation();
            const locationName = utils.config.getEventLocation ? 
                utils.config.getEventLocation().name : 'Lokasi Acara';
            
            if (inLocation) {
                statusElement.innerHTML = `<i class="fas fa-map-marker-alt text-green-500"></i><span class="text-gray-600">Dalam radius ${locationName}</span>`;
                displayStatusElement.textContent = `Dalam radius ${locationName}`;
                displayStatusElement.className = 'font-semibold text-green-600';
            } else {
                statusElement.innerHTML = `<i class="fas fa-map-marker-alt text-red-500"></i><span class="text-gray-600">Di luar radius ${locationName}</span>`;
                displayStatusElement.textContent = `Di luar radius ${locationName}`;
                displayStatusElement.className = 'font-semibold text-red-600';
            }
        } catch (error) {
            console.error('Error checking location:', error);
            // Fallback status
            statusElement.innerHTML = `<i class="fas fa-map-marker-alt text-yellow-500"></i><span class="text-gray-600">Status lokasi tidak tersedia</span>`;
            displayStatusElement.textContent = 'Status lokasi tidak tersedia';
            displayStatusElement.className = 'font-semibold text-yellow-600';
        }
    }
}

// Initialize clock and location
setInterval(updateClock, 1000);
updateClock();

// Update location status berdasarkan interval konfigurasi
const locationInterval = utils.config.app?.locationUpdateInterval || 30000;
setInterval(updateLocationStatus, locationInterval);
updateLocationStatus();