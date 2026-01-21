// Events Module dengan Detail Harian
class Events {
    constructor() {
        this.currentEvent = null;
        this.dailySchedules = {};
        // fallback data (akan ditimpa oleh data dari server jika tersedia)
        this.events = [
            {
                id: 'event-1',
                title: 'Pembukaan Acara',
                description: 'Pembukaan resmi Family Gathering KMP1 2026 oleh direksi perusahaan',
                time: '16:00 - 16:30',
                day: 3, // Hari ke-3 (18 Januari - Gala Dinner)
                active: true
            },
            {
                id: 'event-2',
                title: 'Sambutan & Laporan',
                description: 'Sambutan dari manajemen dan laporan kegiatan Family Gathering',
                time: '16:30 - 17:00',
                day: 3,
                active: false
            },
            {
                id: 'event-3',
                title: 'Makan Malam',
                description: 'Gala dinner dengan berbagai hidangan spesial',
                time: '17:00 - 18:30',
                day: 3,
                active: false
            },
            {
                id: 'event-4',
                title: 'Hiburan & Games',
                description: 'Sesi hiburan dan permainan interaktif untuk seluruh keluarga',
                time: '18:30 - 19:30',
                day: 3,
                active: false
            },
            {
                id: 'event-5',
                title: 'Pengundian Doorprize',
                description: 'Pengundian doorprize menarik untuk peserta Family Gathering',
                time: '19:30 - 21:00',
                day: 3,
                active: false
            },
            {
                id: 'event-6',
                title: 'Penutupan',
                description: 'Penutupan acara dan foto bersama',
                time: '21:00 - 21:30',
                day: 3,
                active: false
            }
        ];
        
        this.initializeDailySchedules();
        this.initializeElements();

        // Load dari server
        this.loadFromServer();

        // Poll current event supaya realtime di aplikasi user
        this.startPollingCurrentEvent();
    }

    async loadFromServer(){
        try{
            const sch = await window.FGAPI.public.getSchedule();
            if (sch && sch.dailySchedules) this.dailySchedules = sch.dailySchedules;
            if (sch && sch.events) this.events = sch.events;
            this.renderEventSchedule();

            const cur = await window.FGAPI.public.getCurrentEvent();
            if (cur && cur.event) this.setCurrentEvent(cur.event, true);
        }catch(e){
            // jika server belum diset, tetap pakai fallback lokal
            console.warn('Schedule/current event load failed, using local fallback:', e);
            try{
                this.renderEventSchedule();
            }catch{}
        }
    }

    startPollingCurrentEvent(){
        // ✅ 25 detik + jitter supaya 250 device tidak nembak bareng
        const baseMs = (window.AppConfig?.app?.eventPollIntervalMs) || 25000;
        const jitterMs = 3000;

        // stop timer lama jika ada
        if (this._pollCurTimer) clearInterval(this._pollCurTimer);

        const tick = async () => {
            // ✅ hemat: jangan polling saat tab/background
            if (document.hidden) return;
            try{
            const cur = await window.FGAPI.public.getCurrentEvent();
            if (cur && cur.event) this.setCurrentEvent(cur.event, true);
            }catch{}
        };

        // run pertama dengan jitter
        setTimeout(tick, Math.floor(Math.random() * jitterMs));

        this._pollCurTimer = setInterval(tick, baseMs + Math.floor(Math.random() * jitterMs));

        // optional: saat balik ke tab, refresh sekali
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) tick();
        });
        }

    // Inisialisasi jadwal detail harian
    initializeDailySchedules() {
        this.dailySchedules = {
            day1: {
                dayNumber: 1,
                date: 'Jumat, 16 Januari 2026',
                title: 'Kedatangan Peserta & Check-in',
                theme: 'Hari Kedatangan & Registrasi',
                icon: 'fa-hotel',
                color: 'blue',
                activities: [
                    {
                        time: '09:00 - 15:00',
                        title: 'Kedatangan Peserta di Bandara',
                        description: 'Peserta tiba di Bandara Supadio Pontianak',
                        location: 'Bandara Supadio, Pontianak',
                        icon: 'fa-plane-arrival'
                    },
                    {
                        time: '10:00 - 18:00',
                        title: 'Check-in Hotel',
                        description: 'Registrasi dan check-in di hotel yang telah disediakan',
                        location: 'Lobby Hotel Seriang Training',
                        icon: 'fa-key'
                    },
                    {
                        time: '12:00 - 14:00',
                        title: 'Makan Siang',
                        description: 'Makan siang di restoran hotel',
                        location: 'Restoran Hotel',
                        icon: 'fa-utensils'
                    },
                    {
                        time: '15:00 - 17:00',
                        title: 'Briefing & Pembagian Group',
                        description: 'Pengarahan kegiatan dan pembagian kelompok peserta',
                        location: 'Ballroom Hotel',
                        icon: 'fa-users'
                    },
                    {
                        time: '19:00 - 21:00',
                        title: 'Welcome Dinner',
                        description: 'Makan malam penyambutan peserta',
                        location: 'Restoran Hotel',
                        icon: 'fa-glass-cheers'
                    }
                ],
                notes: [
                    'Peserta diharapkan tiba sebelum pukul 15:00 WIB',
                    'Dresscode: Casual/baju bebas rapi',
                    'Membawa kartu identitas untuk registrasi'
                ]
            },
            day2: {
                dayNumber: 2,
                date: 'Sabtu, 17 Januari 2026',
                title: 'Team Building & Outbound',
                theme: 'Hari Kebersamaan & Kerjasama Tim',
                icon: 'fa-users-line',
                color: 'green',
                activities: [
                    {
                        time: '07:00 - 08:00',
                        title: 'Sarapan Pagi',
                        description: 'Sarapan bersama di restoran hotel',
                        location: 'Restoran Hotel',
                        icon: 'fa-coffee'
                    },
                    {
                        time: '08:30 - 09:00',
                        title: 'Pengantar Outbound',
                        description: 'Briefing kegiatan outbound dan pembagian alat',
                        location: 'Lapangan Outbound',
                        icon: 'fa-bullhorn'
                    },
                    {
                        time: '09:00 - 12:00',
                        title: 'Games Team Building',
                        description: 'Permainan kelompok untuk membangun kerjasama tim',
                        location: 'Area Outbound',
                        icon: 'fa-gamepad'
                    },
                    {
                        time: '12:00 - 13:00',
                        title: 'Makan Siang',
                        description: 'Makan siang di lokasi outbound',
                        location: 'Tenda Makan',
                        icon: 'fa-utensils'
                    },
                    {
                        time: '13:00 - 16:00',
                        title: 'Flying Fox & High Rope',
                        description: 'Aktivitas menantang untuk mengatasi rasa takut',
                        location: 'Area Adventure',
                        icon: 'fa-person-falling'
                    },
                    {
                        time: '16:30 - 17:30',
                        title: 'Refleksi & Sharing',
                        description: 'Sesi refleksi hasil kegiatan outbound',
                        location: 'Meeting Room',
                        icon: 'fa-comments'
                    },
                    {
                        time: '19:00 - 21:00',
                        title: 'BBQ Night',
                        description: 'Makan malam bakar-bakaran bersama',
                        location: 'Poolside Area',
                        icon: 'fa-fire'
                    }
                ],
                notes: [
                    'Gunakan pakaian olahraga dan sepatu yang nyaman',
                    'Bawa sunscreen dan topi',
                    'Air minum akan disediakan panitia'
                ]
            },
            day3: {
                dayNumber: 3,
                date: 'Minggu, 18 Januari 2026',
                title: 'Gala Dinner & Doorprize',
                theme: 'Puncak Acara & Penghargaan',
                icon: 'fa-crown',
                color: 'purple',
                activities: [
                    {
                        time: '08:00 - 10:00',
                        title: 'Sarapan & Free Time',
                        description: 'Sarapan dan waktu luang untuk persiapan',
                        location: 'Restoran Hotel',
                        icon: 'fa-clock'
                    },
                    {
                        time: '10:00 - 12:00',
                        title: 'Latihan Performance',
                        description: 'Gladi resik untuk performance malam hari',
                        location: 'Ballroom Hotel',
                        icon: 'fa-music'
                    },
                    {
                        time: '12:00 - 14:00',
                        title: 'Makan Siang',
                        description: 'Makan siang sebelum persiapan gala dinner',
                        location: 'Restoran Hotel',
                        icon: 'fa-utensils'
                    },
                    {
                        time: '14:00 - 16:00',
                        title: 'Persiapan & Make-up',
                        description: 'Waktu persiapan dan rias untuk gala dinner',
                        location: 'Kamar Hotel',
                        icon: 'fa-spa'
                    },
                    {
                        time: '16:00 - 16:30',
                        title: 'Pembukaan Acara',
                        description: 'Pembukaan resmi oleh direksi perusahaan',
                        location: 'Grand Ballroom',
                        icon: 'fa-microphone'
                    },
                    {
                        time: '16:30 - 17:00',
                        title: 'Sambutan & Laporan',
                        description: 'Sambutan dari manajemen dan laporan kegiatan',
                        location: 'Grand Ballroom',
                        icon: 'fa-chart-line'
                    },
                    {
                        time: '17:00 - 18:30',
                        title: 'Makan Malam',
                        description: 'Gala dinner dengan berbagai hidangan spesial',
                        location: 'Grand Ballroom',
                        icon: 'fa-wine-glass-alt'
                    },
                    {
                        time: '18:30 - 19:30',
                        title: 'Hiburan & Performance',
                        description: 'Sesi hiburan dan performance dari peserta',
                        location: 'Grand Ballroom',
                        icon: 'fa-theater-masks'
                    },
                    {
                        time: '19:30 - 21:00',
                        title: 'Pengundian Doorprize',
                        description: 'Pengundian doorprize menarik untuk peserta',
                        location: 'Grand Ballroom',
                        icon: 'fa-gift'
                    },
                    {
                        time: '21:00 - 21:30',
                        title: 'Penutupan & Foto Bersama',
                        description: 'Penutupan acara dan foto bersama seluruh peserta',
                        location: 'Grand Ballroom',
                        icon: 'fa-camera'
                    }
                ],
                notes: [
                    'Dresscode: Formal/Pakaian Pesta',
                    'Kehadiran wajib untuk seluruh peserta',
                    'Siapkan nomor undian untuk doorprize'
                ]
            },
            day4: {
                dayNumber: 4,
                date: 'Senin, 19 Januari 2026',
                title: 'Check-out & Kepulangan',
                theme: 'Hari Perpisahan',
                icon: 'fa-plane-departure',
                color: 'orange',
                activities: [
                    {
                        time: '07:00 - 09:00',
                        title: 'Sarapan Terakhir',
                        description: 'Sarapan terakhir sebelum check-out',
                        location: 'Restoran Hotel',
                        icon: 'fa-mug-hot'
                    },
                    {
                        time: '09:00 - 11:00',
                        title: 'Check-out Hotel',
                        description: 'Pengembalian kunci kamar dan penyelesaian administrasi',
                        location: 'Lobby Hotel',
                        icon: 'fa-door-open'
                    },
                    {
                        time: '11:00 - 12:00',
                        title: 'Farewell Gathering',
                        description: 'Pelepasan peserta dan penutupan akhir acara',
                        location: 'Lobby Hotel',
                        icon: 'fa-handshake'
                    },
                    {
                        time: '12:00 - 13:00',
                        title: 'Makan Siang Perpisahan',
                        description: 'Makan siang sebelum keberangkatan',
                        location: 'Restoran Hotel',
                        icon: 'fa-utensils'
                    },
                    {
                        time: '13:00 - 15:00',
                        title: 'Transfer ke Bandara',
                        description: 'Perjalanan menuju Bandara Supadio',
                        location: 'Bandara Supadio',
                        icon: 'fa-bus'
                    },
                    {
                        time: '15:00 - 18:00',
                        title: 'Kepulangan Peserta',
                        description: 'Peserta kembali ke daerah masing-masing',
                        location: 'Bandara Supadio',
                        icon: 'fa-plane'
                    }
                ],
                notes: [
                    'Pastikan semua barang telah dikemas',
                    'Kembalikan kunci kamar sebelum pukul 11:00',
                    'Konfirmasi transportasi ke bandara'
                ]
            }
        };
    }

    initializeElements() {
        this.currentEventTitle = document.getElementById('current-event-title');
        this.currentEventDesc = document.getElementById('current-event-desc');
        this.currentEventTime = document.getElementById('current-event-time');
        this.eventStatus = document.getElementById('event-status');
        
        // Set event pertama sebagai aktif (fallback)
        if (this.events && this.events.length) this.setCurrentEvent(this.events[0], true);
        
        // Render rounddown acara dengan klik
        this.renderClickableRounddown();
    }

    setCurrentEvent(event, silent = false) {
        this.currentEvent = event;

        if (!event) return;
        
        // Update UI
        if (this.currentEventTitle) this.currentEventTitle.textContent = event.title || '-';
        if (this.currentEventDesc) this.currentEventDesc.textContent = event.description || '';
        if (this.currentEventTime) this.currentEventTime.innerHTML = `<i class="far fa-clock mr-2"></i>${event.time || ''}`;
        
        // Update event status
        if (event.active) {
            this.eventStatus.innerHTML = '<i class="fas fa-calendar-alt mr-2"></i>Acara Berlangsung';
            this.eventStatus.className = 'px-4 py-2 bg-green-100 text-green-700 rounded-lg font-medium';
        }

        // Optional: notifikasi hanya untuk debug lokal
        if (!silent && window.utils && window.AppConfig?.security?.debugMode) {
            utils.showNotification(`Acara aktif: ${event.title}`, 'info');
        }
    }

    renderEventSchedule() {
        // Versi UI yang kamu pakai sekarang
        this.renderClickableRounddown();
    }

    // Render rounddown acara yang dapat diklik
    renderClickableRounddown() {
        const rounddownContainer = document.querySelector('#event-schedule-container');
        if (!rounddownContainer) return;
        
        rounddownContainer.innerHTML = '';
        
        Object.values(this.dailySchedules).forEach(daySchedule => {
            const dayElement = this.createDayElement(daySchedule);
            rounddownContainer.appendChild(dayElement);
        });
    }

    parseISODateToParts(iso){
    // iso: '2026-01-18'
    const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return null;
    return { y:+m[1], mo:+m[2], d:+m[3] };
    }

    monthShort(mo){
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    return months[(mo||1)-1] || '';
    }

    getDisplayDateBadge(daySchedule){
    // ambil dari daySchedule.date (ISO) jika ada
    const p = this.parseISODateToParts(daySchedule.date);
    if(p) return { day: String(p.d), mon: this.monthShort(p.mo) };

    // fallback lama: pakai perhitungan startDate
    const eventDate = window.AppConfig?.getEventDate ? window.AppConfig.getEventDate() : new Date('2026-01-16');
    const dayDate = new Date(eventDate);
    dayDate.setDate(dayDate.getDate() + ((daySchedule.dayNumber||1) - 1));
    return { day: String(dayDate.getDate()), mon: this.monthShort(dayDate.getMonth()+1) };
    }


    // Buat elemen hari yang dapat diklik
    createDayElement(daySchedule) {
        const isToday = this.checkIfToday(daySchedule.dayNumber);
        const badge = this.getDisplayDateBadge(daySchedule);
        
        const dayElement = document.createElement('div');
        dayElement.className = `flex items-start border-l-4 border-${daySchedule.color}-500 pl-4 py-3 rounded-r-lg cursor-pointer transition-all duration-300 hover:bg-${daySchedule.color}-50 hover:shadow-md ${isToday ? `bg-${daySchedule.color}-50` : ''}`;
        dayElement.dataset.day = `day${daySchedule.dayNumber}`;
        dayElement.addEventListener('click', () => this.showDayDetails(daySchedule));
        
        dayElement.innerHTML = `
            <div class="mr-4">
                <div class="w-12 h-12 bg-${daySchedule.color}-100 rounded-lg flex flex-col items-center justify-center">
                    <span class="font-bold text-${daySchedule.color}-700 text-lg">${badge.day}</span>
                    <span class="text-xs text-${daySchedule.color}-600">${badge.mon}</span>
                </div>
            </div>
            <div class="flex-grow">
                <h4 class="font-bold text-gray-800">${daySchedule.title}</h4>
                <p class="text-gray-600 text-sm mt-1">${daySchedule.theme}</p>
                <div class="flex items-center text-gray-500 text-sm mt-2">
                    <i class="far fa-calendar mr-2"></i>${daySchedule.date}
                </div>
            </div>
            <div class="ml-4 flex items-center">
                <i class="fas fa-chevron-right text-gray-400"></i>
            </div>
            ${isToday ? '<div class="ml-4"><span class="bg-green-100 text-green-800 text-xs font-semibold px-3 py-1 rounded-full">HARI INI</span></div>' : ''}
        `;
        
        return dayElement;
    }

    // Tampilkan detail hari
    showDayDetails(daySchedule) {
        // Tutup modal yang sudah ada jika ada
        this.closeDayDetails();
        
        // Buat modal detail
        const modal = document.createElement('div');
        modal.id = 'day-detail-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
        modal.innerHTML = this.createDayDetailHTML(daySchedule);
        
        // Tambahkan ke body
        document.body.appendChild(modal);

        const btnCal = modal.querySelector('#btn-add-calendar');
            if(btnCal){
            btnCal.addEventListener('click', ()=>{
                // default: pakai activity pertama sebagai event calendar
                const a = (daySchedule.activities && daySchedule.activities[0]) ? daySchedule.activities[0] : null;
                if(!a){
                utils.showNotification('Tidak ada kegiatan untuk ditambahkan', 'warning');
                return;
                }

                // parse "16:00 - 16:30"
                const mm = String(a.time||'').match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
                const startHm = mm ? mm[1] : '';
                const endHm = mm ? mm[2] : '';

                const startISO = this.toGCalDateTime(daySchedule.date, startHm);
                const endISO   = this.toGCalDateTime(daySchedule.date, endHm);

                if(!startISO || !endISO){
                // fallback: all-day
                const p = this.parseISODateToParts(daySchedule.date);
                if(!p){
                    utils.showNotification('Tanggal tidak valid untuk kalender', 'error');
                    return;
                }
                const y = String(p.y);
                const mo = String(p.mo).padStart(2,'0');
                const d = String(p.d).padStart(2,'0');
                const allDay = `${y}${mo}${d}/${y}${mo}${d}`;
                this.openGoogleCalendarEvent({
                    title: a.title,
                    details: a.description || '',
                    location: a.location || '',
                    startISO: allDay.split('/')[0],
                    endISO: allDay.split('/')[1]
                });
                return;
                }

                this.openGoogleCalendarEvent({
                title: a.title,
                details: a.description || '',
                location: a.location || '',
                startISO,
                endISO
                });
            });
            }
        
        // Tambahkan event listener untuk tombol close
        modal.querySelector('#close-day-detail').addEventListener('click', () => {
            this.closeDayDetails();
        });
        
        // Tambahkan event listener untuk klik di luar modal
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeDayDetails();
            }
        });
        
        // Blokir scroll body
        document.body.style.overflow = 'hidden';
    }

    // Buat HTML untuk detail hari
    createDayDetailHTML(daySchedule) {
        const activitiesHTML = daySchedule.activities.map(activity => `
            <div class="flex items-start mb-6 animate-slide-in" style="animation-delay: ${Math.random() * 200}ms">
                <div class="mr-4 mt-1">
                    <div class="w-10 h-10 bg-${daySchedule.color}-100 rounded-lg flex items-center justify-center">
                        <i class="fas ${activity.icon} text-${daySchedule.color}-600"></i>
                    </div>
                </div>
                <div class="flex-grow">
                    <div class="flex justify-between items-start">
                        <h5 class="font-bold text-gray-800">${activity.title}</h5>
                        <span class="bg-${daySchedule.color}-100 text-${daySchedule.color}-800 text-xs font-semibold px-2 py-1 rounded ml-4">${activity.time}</span>
                    </div>
                    <p class="text-gray-600 text-sm mt-1">${activity.description}</p>
                    <div class="flex items-center text-gray-500 text-sm mt-2">
                        <i class="fas fa-map-marker-alt mr-2"></i>${activity.location}
                    </div>
                </div>
            </div>
        `).join('');
        
        const notesHTML = daySchedule.notes.map(note => `
            <li class="flex items-start mb-2">
                <i class="fas fa-circle text-xs text-${daySchedule.color}-500 mr-3 mt-1"></i>
                <span class="text-gray-700">${note}</span>
            </li>
        `).join('');
        
        return `
            <div class="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden animate-fade-in">
                <!-- Modal Header -->
                <div class="bg-gradient-to-r from-${daySchedule.color}-600 to-${daySchedule.color}-400 p-6">
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="text-2xl font-bold text-white mb-2">${daySchedule.title}</h3>
                            <p class="text-white opacity-90">${daySchedule.date} • ${daySchedule.theme}</p>
                        </div>
                        <button id="close-day-detail" class="text-white hover:bg-white hover:bg-opacity-20 rounded-full w-10 h-10 flex items-center justify-center transition">
                            <i class="fas fa-times text-xl"></i>
                        </button>
                    </div>
                </div>
                
                <!-- Modal Body -->
                <div class="p-6 overflow-y-auto max-h-[70vh]">
                    <!-- Activities Section -->
                    <div class="mb-8">
                        <h4 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                            <i class="fas fa-calendar-day text-${daySchedule.color}-600 mr-3"></i>
                            Jadwal Kegiatan
                        </h4>
                        <div class="relative pl-8">
                            <!-- Timeline line -->
                            <div class="absolute left-4 top-0 bottom-0 w-0.5 bg-${daySchedule.color}-200"></div>
                            ${activitiesHTML}
                        </div>
                    </div>
                    
                    <!-- Notes Section -->
                    <div class="bg-${daySchedule.color}-50 border border-${daySchedule.color}-200 rounded-xl p-5">
                        <h4 class="text-lg font-bold text-gray-800 mb-3 flex items-center">
                            <i class="fas fa-info-circle text-${daySchedule.color}-600 mr-3"></i>
                            Catatan Penting
                        </h4>
                        <ul class="space-y-2">
                            ${notesHTML}
                        </ul>
                    </div>
                </div>
                
                <!-- Modal Footer -->
                <div class="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-between items-center">
                    <div class="text-sm text-gray-600">
                        <i class="fas ${daySchedule.icon} text-${daySchedule.color}-600 mr-2"></i>
                        Hari ${daySchedule.dayNumber} • ${this.getTotalActivities(daySchedule)} kegiatan
                    </div>
                    <button id="btn-add-calendar" class="bg-gradient-to-r from-${daySchedule.color}-600 to-${daySchedule.color}-500 text-white font-semibold py-2 px-6 rounded-lg hover:opacity-90 transition">
                        <i class="far fa-calendar-plus mr-2"></i>Tambah ke Kalender
                    </button>
                </div>
            </div>
        `;
    }

    // Tutup modal detail
    closeDayDetails() {
        const modal = document.getElementById('day-detail-modal');
        if (modal) {
            modal.remove();
            // Aktifkan kembali scroll body
            document.body.style.overflow = 'auto';
        }
    }

    // Helper functions
    checkIfToday(dayNumber) {
        // Untuk simulasi, anggap hari ke-3 (Gala Dinner) adalah hari ini
        return dayNumber === 3;
    }

    getDayName(dayNumber) {
        const days = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        // Sesuaikan dengan tanggal acara di config.js
        const eventDate = window.AppConfig?.getEventDate ? window.AppConfig.getEventDate() : new Date('2026-01-16');
        const dayDate = new Date(eventDate);
        dayDate.setDate(dayDate.getDate() + (dayNumber - 1));
        return days[dayDate.getMonth()];
    }

    toGCalDateTime(dateISO, hm){
        // return 'YYYYMMDDTHHMM00'
        const p = this.parseISODateToParts(dateISO);
        if(!p) return '';
        const m = String(hm||'').match(/^(\d{1,2}):(\d{2})$/);
        if(!m) return '';
        const hh = String(m[1]).padStart(2,'0');
        const mm = String(m[2]).padStart(2,'0');
        const y = String(p.y);
        const mo = String(p.mo).padStart(2,'0');
        const d = String(p.d).padStart(2,'0');
        return `${y}${mo}${d}T${hh}${mm}00`;
        }

    openGoogleCalendarEvent({ title, details, location, startISO, endISO }){
        const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
        const params = new URLSearchParams();
        params.set('text', title || 'Acara');
        if(details) params.set('details', details);
        if(location) params.set('location', location);

        // pakai timezone jakarta biar konsisten
        params.set('ctz', 'Asia/Jakarta');

        if(startISO && endISO){
            params.set('dates', `${startISO}/${endISO}`);
        }

    window.open(base + '&' + params.toString(), '_blank', 'noopener');
    }

    getTotalActivities(daySchedule) {
        return daySchedule.activities.length;
    }

    // Simulasi operator memilih acara
    simulateOperatorEvents() {
        let eventIndex = 0;
        
        // Ganti acara setiap 3 menit (untuk simulasi)
        setInterval(() => {
            eventIndex = (eventIndex + 1) % this.events.length;
            this.setCurrentEvent(this.events[eventIndex]);
            
            // Jika acara adalah pengundian doorprize, trigger doorprize
            if (this.events[eventIndex].id === 'event-5') {
                // Trigger doorprize setelah beberapa detik
                setTimeout(() => {
                    if (window.doorprize) {
                        window.doorprize.drawWinner();
                    }
                }, 2000);
            }
        }, 180000); // 3 menit
    }

    // Method untuk diakses operator (simulasi)
    operatorSelectEvent(eventId) {
        const event = this.events.find(e => e.id === eventId);
        if (event) {
            this.setCurrentEvent(event);
            utils.showNotification(`Acara diubah ke: ${event.title}`, 'info');
        }
    }
}

// Inisialisasi events module
const events = new Events();