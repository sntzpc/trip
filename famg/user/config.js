// CONFIGURASI AMAN - Aplikasi Family Gathering KMP1 2026
// File ini berisi konfigurasi yang dapat diubah dengan aman
// Tanpa perlu mengubah kode utama aplikasi

window.AppConfig = {
    // ===== API (Google Apps Script Web App) =====
    // Isi URL ini setelah deploy Web App di Google Apps Script
    // Contoh: https://script.google.com/macros/s/AKfycbxxxx/exec
    api: {
        url: "https://script.google.com/macros/s/AKfycbwA7SzOOcOxI21Zm0CYW7TTBuMftWShOA1pSfShrJzsPZB_j5We0rhKTnMaV9BMvnA/exec"
    },

    // KONFIGURASI ACARA
    event: {
        // Nama acara
        name: "Family Gathering KMP1 Tahun 2026",
        
        // Tanggal dan waktu acara utama (Gala Dinner)
        // Format: "YYYY-MM-DDTHH:mm:ss±HH:mm"
        galaDinnerDate: "2026-01-19T07:00:00+07:00",
        galaDinnerEndTime: "2026-01-19T23:50:00+07:00",
        
        // Tanggal rangkaian acara
        eventStartDate: "2026-01-16T00:00:00+07:00",
        eventEndDate: "2026-01-19T23:59:59+07:00",
        
        // Lokasi acara utama
        location: {
            name: "Seriang Training Center",
            address: "Desa Kekurak Kecamatan Badau",
            
            // Koordinat geofencing (titik pusat)
            coordinates: {
                latitude: 0.960484631752835,   // Latitude Novotel Pontianak
                longitude: 111.89255411462112, // Longitude Novotel Pontianak
                accuracy: 50           // Akurasi dalam meter
            },
            
            // Radius geofencing dalam meter
            geofencingRadius: 2500
        }
    },
    
    // KONFIGURASI APLIKASI
    app: {
        // ===== BRANDING (opsional) =====
        // Jika field ini di-override dari Admin Panel (server config),
        // UI akan otomatis ikut berubah (judul halaman, header, dll)
        brand: {
            appName: "Family Gathering App",
            shortName: "FG App",
            headerTitle: "Family Gathering",
            headerSubtitle: "",
            adminSubtitle: ""
        },

        // ===== TEXTS PER HALAMAN (opsional, multi-event) =====
        pages: {
            index: {
                docTitle: "{appName}",
                // Gunakan token template agar cukup ubah 2-3 nilai inti saja (eventName/headerSubtitle/appName)
                // Token umum: {eventName} {headerSubtitle} {headerTitle} {appName} {year} {locationName}
                presenceTitle: "Presensi {eventName}",
                presenceSubtitle: "{headerSubtitle}",
                presenceLocationNote: "Wajib berada di lokasi acara {eventName}",
                alreadyAttendedMsg: "Terima kasih telah hadir di {eventName}",
                appHeaderTitle: "{eventName}",
                appHeaderSubtitle: "{headerSubtitle}",
                currentEventCardTitle: "Acara Sedang Berlangsung",
                scheduleTitle: "Rundown {eventName}",
                doorprizeCardTitle: "Pemenang Doorprize {eventName}",
                footerOrg: "{headerTitle}",
                footerEvent: "{eventName}",
                footerDate: "{headerSubtitle}",
                footerCopy: "© {year} {eventName}. All rights reserved."
            },
            doorprize: {
                docTitle: "Doorprize - {eventName}",
                headerTitle: "Doorprize",
                headerSubtitle: "{eventName}",
                machineEventName: "{eventName}",
                stageLabel: "Doorprize"
            },
            rundown: {
                docTitle: "Rundown - {eventName}",
                headerTitle: "Rundown",
                headerSubtitle: "{eventName} · {headerSubtitle}"
            }
        },

        // Waktu timeout untuk konfirmasi doorprize (dalam milidetik)
        doorprizeConfirmTimeout: 60000, // 1 menit
        
        // Interval update lokasi (dalam milidetik)
        locationUpdateInterval: 30000, // 30 detik
        
        // Interval pergantian acara (simulasi, dalam milidetik)
        eventSwitchInterval: 180000, // 3 menit
        
        // Waktu notifikasi (dalam milidetik)
        notificationTimeout: 5000
    },
    
    // KONFIGURASI KEAMANAN
    security: {
        // Validasi NIK (minimal panjang karakter)
        nikMinLength: 8,
        
        // Validasi tanggal dan waktu
        enableDateValidation: true,
        enableGeofencing: true,
        
        // Mode debug (untuk pengembangan)
        debugMode: false
    },
    
    // KONFIGURASI TAMPILAN
    ui: {
        primaryColor: "#3B82F6",    // Biru
        secondaryColor: "#10B981",  // Hijau
        accentColor: "#8B5CF6",     // Ungu
        successColor: "#10B981",    // Hijau sukses
        errorColor: "#EF4444",      // Merah error
        warningColor: "#F59E0B"     // Kuning peringatan
    },
    
    // METODE UNTUK MENGAMBIL KONFIGURASI
    getEventDate: function() {
        return new Date(this.event.galaDinnerDate);
    },

    // Di dalam AppConfig object, tambahkan:
    colors: {
        day1: {
            primary: '#3B82F6', // Biru
            light: '#EFF6FF'
        },
        day2: {
            primary: '#10B981', // Hijau
            light: '#F0FDF4'
        },
        day3: {
            primary: '#8B5CF6', // Ungu
            light: '#FAF5FF'
        },
        day4: {
            primary: '#F97316', // Oranye
            light: '#FFF7ED'
        }
    },
    
    getEventLocation: function() {
        return {
            lat: this.event.location.coordinates.latitude,
            lng: this.event.location.coordinates.longitude,
            radius: this.event.location.geofencingRadius,
            name: this.event.location.name,
            address: this.event.location.address
        };
    },
    
    // Validasi apakah tanggal saat ini adalah tanggal acara
    isValidEventDate: function(dateToCheck = new Date()) {
        if (!this.security.enableDateValidation) return true;
        
        const eventDate = new Date(this.event.galaDinnerDate);
        const eventStart = new Date(this.event.eventStartDate);
        const eventEnd = new Date(this.event.eventEndDate);
        
        return dateToCheck >= eventStart && dateToCheck <= eventEnd;
    },
    
    // Validasi apakah waktu saat ini dalam jam Gala Dinner
    isValidGalaDinnerTime: function(dateToCheck = new Date()) {
        if (!this.security.enableDateValidation) return true;
        
        const galaStart = new Date(this.event.galaDinnerDate);
        const galaEnd = new Date(this.event.galaDinnerEndTime);
        
        return dateToCheck >= galaStart && dateToCheck <= galaEnd;
    },
    
    // Debug logging (hanya di mode debug)
    log: function(message, data = null) {
        if (this.security.debugMode) {
            console.log(`[AppConfig] ${message}`, data || '');
        }
    }
};

var AppConfig = window.AppConfig;

(function(){
  const LS_KEY = 'fg_config_patch_v1';

  // ✅ DEFAULTS (tetap ada, tidak perlu deploy ulang untuk override)
  const DEFAULTS = window.AppConfig || {
    api:{ url:'' },
    event:{},
    app:{},
    security:{},
    ui:{},
    colors:{}
  };

  // --------- deep merge ----------
  function isObj(x){ return x && typeof x === 'object' && !Array.isArray(x); }
  function deepClone(o){ return JSON.parse(JSON.stringify(o||{})); }
  function deepMerge(base, patch){
    const out = deepClone(base);
    (function walk(t, p){
      Object.keys(p||{}).forEach(k=>{
        const pv = p[k];
        const tv = t[k];
        if(isObj(pv) && isObj(tv)){
          walk(tv, pv);
        }else{
          t[k] = pv;
        }
      });
    })(out, patch||{});
    return out;
  }

  // --------- deep freeze ----------
  function deepFreeze(o){
    if(!o || typeof o !== 'object') return o;
    Object.freeze(o);
    Object.getOwnPropertyNames(o).forEach((prop)=>{
      const v = o[prop];
      if(v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
    });
    return o;
  }

  // --------- build merged snapshot ----------
  let _PATCH = {};
  try{ _PATCH = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }catch{ _PATCH = {}; }
  let _MERGED = deepFreeze(deepMerge(DEFAULTS, _PATCH));

  function rebuild(){
    _MERGED = deepFreeze(deepMerge(DEFAULTS, _PATCH));
  }

  // ✅ wrapper AppConfig (immutable API, mutable state internal)
  const AppConfig = {
    // getters (selalu baca snapshot terbaru)
    get api(){ return _MERGED.api; },
    get event(){ return _MERGED.event; },
    get app(){ return _MERGED.app; },
    get security(){ return _MERGED.security; },
    get ui(){ return _MERGED.ui; },
    get colors(){ return _MERGED.colors; },

    // methods existing (mengikuti config kamu)
    getEventDate(){ return new Date(AppConfig.event.galaDinnerDate); },
    getEventLocation(){
      return {
        lat: AppConfig.event.location.coordinates.latitude,
        lng: AppConfig.event.location.coordinates.longitude,
        radius: AppConfig.event.location.geofencingRadius,
        name: AppConfig.event.location.name,
        address: AppConfig.event.location.address
      };
    },
    isValidEventDate(dateToCheck = new Date()){
      if(!AppConfig.security.enableDateValidation) return true;
      const start = new Date(AppConfig.event.eventStartDate);
      const end = new Date(AppConfig.event.eventEndDate);
      return dateToCheck >= start && dateToCheck <= end;
    },
    isValidGalaDinnerTime(dateToCheck = new Date()){
      if(!AppConfig.security.enableDateValidation) return true;
      const start = new Date(AppConfig.event.galaDinnerDate);
      const end = new Date(AppConfig.event.galaDinnerEndTime);
      return dateToCheck >= start && dateToCheck <= end;
    },
    log(message, data=null){
      if(AppConfig.security.debugMode){
        console.log('[AppConfig]', message, data||'');
      }
    },

    // ✅ NEW: apply patch (dari server / admin)
    applyPatch(patch, saveToLocal=true){
      _PATCH = (patch && typeof patch === 'object') ? patch : {};
      if(saveToLocal){
        try{ localStorage.setItem(LS_KEY, JSON.stringify(_PATCH)); }catch{}
      }
      rebuild();
      return _MERGED;
    },

    // ✅ NEW: clear override (balik default)
    clearPatch(){
      _PATCH = {};
      try{ localStorage.removeItem(LS_KEY); }catch{}
      rebuild();
      return _MERGED;
    }
  };

  // expose
  window.AppConfig = AppConfig;
  Object.freeze(window.AppConfig); // wrapper aman
})();
