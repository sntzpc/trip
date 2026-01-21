// ==========================
// FG2026 - Doorprize Feed (User - PRIVATE)
// ==========================

class DoorprizeFeed {
  constructor(){
    this.container = document.getElementById('doorprize-container');
    this.noWinner  = document.getElementById('no-winner');
    this.audio     = document.getElementById('doorprize-sound');

    this.notificationContainer = this.createNotificationContainer();
    this.lastDrawId = localStorage.getItem('fg_last_draw_id') || '';

    this.pollTimer = null;
    this.pollMs = 25000;
    this._loading = false;

    // ✅ cache di constructor (lebih kompatibel)
    this.imgCache = new Map();

    // load awal
    this.load();
    this.startPolling();

    // jika user info berubah (tab lain), refresh
    window.addEventListener('storage', (ev) => {
      const key = String(ev?.key || '').toLowerCase();
      if(key.includes('nik') || key.includes('participant') || key.includes('user')){
        this.load();
      }
    });
  }

  // =========================
  // Ambil NIK user yang sedang login
  // =========================
  getMyNik(){
    if (window.FG_USER?.nik) return String(window.FG_USER.nik || '').trim();
    return String(localStorage.getItem('fg_nik') || '').trim();
  }

  // =========================
  // Drive helpers
  // =========================
  driveIdFromAny(s){
    const str = String(s || '').trim();
    if(!str) return '';
    if(/^[a-zA-Z0-9_-]{20,}$/.test(str) && !str.includes('http')) return str;

    let m = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    m = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    m = str.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    return '';
  }

  async getPrizeImageDataUrlCached(urlOrId){
    const id = this.driveIdFromAny(urlOrId);
    if(!id) return '';

    if(this.imgCache.has(id)) return this.imgCache.get(id);

    try{
      const res = await window.FGAPI.public.getPrizeImageDataUrl(id);
      const dataUrl = String(res?.data_url || '');
      if(dataUrl){
        this.imgCache.set(id, dataUrl);
        return dataUrl;
      }
    }catch(e){
      console.warn('[doorprize] getPrizeImageDataUrl failed:', e);
    }
    return '';
  }

  // =========================
  // Polling
  // =========================
  startPolling(){
    if(this.pollTimer) clearInterval(this.pollTimer);

    const jitterMs = 3000;

    const tick = () => {
        if (document.hidden) return; // ✅ hemat: jangan polling saat background
        if(this.getMyNik()) this.load();
    };

    // pertama kali
    setTimeout(tick, Math.floor(Math.random() * jitterMs));

    this.pollTimer = setInterval(tick, this.pollMs + Math.floor(Math.random() * jitterMs));

    // refresh sekali ketika tab aktif lagi
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tick();
    });
    }

  // =========================
  // UI Notification
  // =========================
  createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'doorprize-notifications';
    container.className = 'fixed top-20 right-4 z-50 space-y-2 max-w-sm';
    document.body.appendChild(container);
    return container;
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `p-4 rounded-xl shadow-lg border-l-4 ${
      type === 'success'
        ? 'bg-green-50 border-green-500 text-green-800'
        : 'bg-blue-50 border-blue-500 text-blue-800'
    }`;

    notification.innerHTML = `
      <div class="flex items-start">
        <div class="flex-shrink-0">
          <i class="fas fa-gift ${type === 'success' ? 'text-green-500' : 'text-blue-500'}"></i>
        </div>
        <div class="ml-3">
          <p class="text-sm font-medium">${message}</p>
          <p class="text-xs mt-1">${new Date().toLocaleTimeString('id-ID')}</p>
        </div>
        <button class="ml-auto -mx-1.5 -my-1.5 text-gray-400 hover:text-gray-900"
          onclick="this.parentElement.parentElement.remove()">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    this.notificationContainer.appendChild(notification);
    setTimeout(() => notification.remove(), 10000);
  }

  // =========================
  // Tombol klaim
  // =========================
  addClaimButton(drawId) {
    const claimBtn = document.createElement('button');
    claimBtn.className = 'mt-2 px-4 py-2 bg-gradient-to-r from-green-600 to-teal-500 text-white rounded-xl hover:opacity-90 transition text-sm';
    claimBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Konfirmasi Ambil Doorprize';

    claimBtn.addEventListener('click', async () => {
      if(!confirm('Konfirmasi bahwa Anda telah menerima doorprize ini?')) return;

      try {
        const myNik = this.getMyNik();
        if(!myNik) throw new Error('NIK belum terbaca. Silakan login/absen ulang.');

        await window.FGAPI.public.markDoorprizeTaken(drawId, myNik);
        this.showNotification('Doorprize telah dikonfirmasi diambil!', 'success');
        setTimeout(() => this.load(), 800);
      } catch (error) {
        console.warn('Gagal update status doorprize:', error);
        this.showNotification('Silakan hubungi operator untuk konfirmasi pengambilan', 'info');
      }
    });

    return claimBtn;
  }

  // =========================
  // Load dari server
  // =========================
  async load(){
    if(this._loading) return;
    this._loading = true;

    try{
      if(!this.container) return;

      const myNik = this.getMyNik();
      if(!myNik){
        this.render([]);
        return;
      }

      const data = await window.FGAPI.public.getDoorprizeByNIK(myNik, 10);
      const rows = (data && data.rows) ? data.rows : [];

      this.maybeNotify(rows);
      this.render(rows);
    }catch(e){
      console.warn('doorprize by NIK error:', e);
      this.render([]);
    } finally {
      this._loading = false;
    }
  }

  maybeNotify(rows){
    if(!rows || !rows.length) return;

    const latest = rows[0];
    if(!latest?.draw_id) return;

    if(String(latest.draw_id) !== String(this.lastDrawId)){
      this.lastDrawId = String(latest.draw_id);
      localStorage.setItem('fg_last_draw_id', this.lastDrawId);

      const status = String(latest.status || 'WIN').toUpperCase();

      if(status === 'WIN'){
        try{
          if(this.audio){
            this.audio.currentTime = 0;
            this.audio.play().catch(()=>{});
          }
        }catch{}

        const prizeName = latest.prize_name || 'Doorprize';
        this.showNotification(`🎉 SELAMAT! Anda memenangkan: ${prizeName}`, 'success');

        setTimeout(() => {
          alert(`🎉 SELAMAT!\n\nAnda memenangkan:\n${prizeName}\n\nSilakan ambil doorprize Anda di meja panitia.`);
        }, 500);
      }

      if(status === 'TAKEN'){
        this.showNotification(`✅ Doorprize "${latest.prize_name||'Doorprize'}" sudah tercatat DIAMBIL.`, 'info');
      }
    }
  }

  // =========================
  // Render
  // =========================
  render(rows){
    if(!this.container) return;

    this.container.innerHTML = '';

    if(!rows || !rows.length){
      if(this.noWinner){
        this.noWinner.classList.remove('hidden');
        this.container.appendChild(this.noWinner);
      }
      return;
    }

    if(this.noWinner) this.noWinner.classList.add('hidden');

    rows.forEach(r => {
      const el = document.createElement('div');
      el.className = 'p-4 border-2 border-yellow-200 bg-yellow-50 rounded-xl animate-fade-in mb-4';

      const status = String(r.status||'WIN').toUpperCase();

      let badgeClass = 'text-xs px-2 py-1 rounded-full';
      let badgeText = '';
      if(status === 'TAKEN'){ badgeClass += ' bg-green-100 text-green-800'; badgeText = 'Sudah Diambil'; }
      else if(status === 'NO_SHOW'){ badgeClass += ' bg-red-100 text-red-800'; badgeText = 'Tidak Ambil'; }
      else { badgeClass += ' bg-blue-100 text-blue-800'; badgeText = 'Menunggu Pengambilan'; }

      const prizeImgId = this.driveIdFromAny(r.prize_image);
      const imgHtml = prizeImgId
        ? `<img data-prize-img="1" data-drive-id="${prizeImgId}"
             src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
             alt="${(r.prize_name||'Doorprize')}"
             class="w-14 h-14 object-cover rounded-lg border bg-white"/>`
        : `<div class="w-14 h-14 rounded-lg bg-purple-100 flex items-center justify-center">
             <i class="fas fa-gift text-purple-600 text-xl"></i>
           </div>`;

      el.innerHTML = `
        <div class="flex items-start gap-4">
          ${imgHtml}
          <div class="flex-grow">
            <div class="flex items-center justify-between gap-2">
              <h4 class="font-bold text-gray-800">${r.name||'-'}</h4>
              <span class="${badgeClass}">${badgeText}</span>
            </div>
            <p class="text-gray-600 text-sm">NIK: ${r.nik||'-'}</p>
            <div class="mt-2 flex items-center">
              <div class="w-7 h-7 bg-gradient-to-r from-purple-500 to-pink-500 rounded flex items-center justify-center mr-2">
                <i class="fas fa-trophy text-white text-xs"></i>
              </div>
              <span class="font-semibold text-gray-800">${r.prize_name||'-'}</span>
            </div>
            <div class="mt-2 text-xs text-gray-500"><i class="far fa-clock mr-1"></i>${r.time_local||''}</div>
            ${status === 'WIN' ? '<div class="mt-3 text-xs text-yellow-600 bg-yellow-100 p-2 rounded"><i class="fas fa-info-circle mr-1"></i>Silakan ambil doorprize di meja panitia</div>' : ''}
          </div>
        </div>
      `;

      if(status === 'WIN'){
        const claimBtn = this.addClaimButton(String(r.draw_id||''));
        const btnContainer = document.createElement('div');
        btnContainer.className = 'mt-3 flex justify-end';
        btnContainer.appendChild(claimBtn);
        el.appendChild(btnContainer);
      }

      this.container.appendChild(el);

      // ✅ load gambar async via GAS (dataURL)
      const imgEl = el.querySelector('img[data-prize-img="1"]');
      if(imgEl){
        const id = imgEl.getAttribute('data-drive-id') || '';
        this.getPrizeImageDataUrlCached(id).then((dataUrl) => {
          if(!dataUrl) return;
          if(!imgEl.isConnected) return;
          imgEl.src = dataUrl;
        });
      }
    });
  }
}

// ==========================
// INIT (paling penting)
// ==========================
let doorprizeInstance = null;

function bootDoorprize(){
  if(doorprizeInstance) return;

  // tunggu FGAPI siap (api.js sudah load)
  if(!window.FGAPI?.public){
    setTimeout(bootDoorprize, 200);
    return;
  }

  doorprizeInstance = new DoorprizeFeed();
}

// 1) auto boot saat DOM siap
document.addEventListener('DOMContentLoaded', bootDoorprize);

// 2) kalau Anda punya event khusus user-ready, tetap dukung
document.addEventListener('fg:user-ready', (e) => {
  // update global user jika Anda kirim dari auth
  if(e?.detail?.nik) window.FG_USER = { ...(window.FG_USER||{}), nik: e.detail.nik };
  bootDoorprize();
});
