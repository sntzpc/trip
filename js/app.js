import * as api from './core/api.js';
import { resetAllOfflineData } from './core/idb.js';
import { LS, loadSession, saveSession, clearSession, loadCfg, saveCfg } from './core/storage.js';
import { $, showNotification, activateMenu, showPage, toggleSidebar as _toggleSidebar, closeSidebarOnMobile } from './core/ui.js';
import { doLogin, bindLoginEnter } from './pages/login.js';
import { loadDashboard, showRegionDetailsUI, hideRegionDetailsUI } from './pages/dashboard.js';
import { initMap, refreshMap, stopTrackingPublic, startBackgroundTrackingPublic } from './pages/map.js';
import { startScanning, manualSubmit, confirmAssignment, getPendingVehicle } from './pages/scan.js';
import { renderFamily, confirmArrival as doConfirmArrival, initArrivalPage  } from './pages/arrival.js';
import { loadParticipants, searchAndRender } from './pages/participants.js';
import { renderSyncPage } from './pages/sync.js';
import {initAdminEnhancements, showTab, loadUsers, loadVehicles, loadHistory, loadParticipantsAdmin, loadConfigAndTrips, saveConfig, upsertTrip, upsertUser, upsertVehicle, upsertParticipant} from './pages/admin.js';

const State = {  session: null,  user: null,  cfg: null,  mapTimer: null,  tripLocked: false,  assignedVehicleCode: ""};

let syncTimer = null;

function stopTrackingIfAny(){
  try{ stopTrackingPublic(); }catch{}
}


// Expose dashboard detail actions (setelah State ada)
window.showRegionDetails = ()=> State.session ? showRegionDetailsUI(State.session) : null;
window.hideRegionDetails = ()=> hideRegionDetailsUI();

// tambahan: vehicle detail
window.showVehicleDetails = ()=> State.session ? window.__showVehicleDetailsUI?.(State.session) : null;
window.hideVehicleDetails = ()=> window.__hideVehicleDetailsUI?.();

// Boot
document.addEventListener('DOMContentLoaded', async ()=>{
  // ✅ offline shell
  try{
    if ('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
  }catch{}

  ensureSidebarOverlay();
  hideLoadingSoon();
  bindLoginEnter();

  // ✅ unlock menu setelah submit keberangkatan dari halaman scan
  window.addEventListener('tt_trip_started', (ev)=>{
    const code = ev?.detail?.vehicleCode || '';
    setTripLocked(false, code);
    try{ window.showDashboard?.(); }catch{}
  });

  // Load cfg from cache first
  const cached = loadCfg();
  if (cached) applyConfig(cached);

  // Fetch config from server (no session needed)
  try{
    const cfgRes = await api.getConfig();
    State.cfg = cfgRes.config || cfgRes;
    saveCfg(State.cfg);
    applyConfig(State.cfg);
  } catch(err){
    // offline or URL not set
  }

  const session = loadSession();
  if (session && session.expiry > Date.now()){
    State.session = session;
    try{
      await afterLoginInit();
    } catch{
      clearSession();
      State.session = null;
    }
  }
});

// ✅ ketika app kembali aktif, nyalakan lagi tracking (kalau ada kendaraan terakhir)
document.addEventListener('visibilitychange', ()=>{
  try{
    if (document.visibilityState !== 'visible') return;
    if (!State?.session) return;
    const last = String(localStorage.getItem('tt_last_vehicle_code') || '').trim();
    if (last) startBackgroundTrackingPublic(State.session, last);
  }catch{}
});

function hideLoadingSoon(){
  setTimeout(() => {
    const ls = $('#loadingScreen');
    if (!ls) return;
    ls.style.opacity = '0';
    setTimeout(()=> ls.style.display='none', 400);
  }, 900);
}

function ensureSidebarOverlay(){
  if (document.querySelector('.sidebar-overlay')) return;
  const ov = document.createElement('div');
  ov.className = 'sidebar-overlay';
  ov.addEventListener('click', ()=> window.toggleSidebar?.(false)); // klik overlay menutup
  document.body.appendChild(ov);
}

// ============================
// PRE-DEPARTURE MENU GATING
// ============================
function _isAdmin(){
  const r = String(State.session?.role || State.user?.role || '').toLowerCase();
  return r === 'admin';
}

function setTripLocked(locked, vehicleCode=''){
  // ✅ admin tidak pernah dikunci
  if (_isAdmin()){
    State.tripLocked = false;
    State.assignedVehicleCode = String(vehicleCode||'').trim();
    updateTripLockUI();
    return;
  }

  State.tripLocked = !!locked;
  State.assignedVehicleCode = String(vehicleCode||'').trim();
  updateTripLockUI();
}

function updateTripLockUI(){
  // ✅ ADMIN: tampilkan semua menu, jangan hide apa pun
  if (_isAdmin()){
    const items = Array.from(document.querySelectorAll('.sidebar .menu-item'));
    items.forEach((a)=>{
      // tampilkan semua menu termasuk adminMenu
      a.style.display = 'flex';
    });
    return;
  }

  // ⛔ USER: jika locked, hide semua menu kecuali Scan (index 1)
  const locked = !!State.tripLocked;
  const items = Array.from(document.querySelectorAll('.sidebar .menu-item'));

  items.forEach((a, idx)=>{
    // urutan asumsi Anda: dashboard=0, scan=1, map=2, arrival=3, participants=4, sync=5, admin=6
    const isScan = (idx === 1);

    // admin menu memang bukan untuk user; biarkan aturan role yang mengatur (tetap jangan tampilkan)
    if (a.id === 'adminMenu') {
      a.style.display = 'none';
      return;
    }

    a.style.display = (locked && !isScan) ? 'none' : 'flex';
  });

  // header info
  const sub = document.getElementById('sidebarEventSub');
  if (sub && locked){
    sub.textContent = 'Silakan scan kendaraan & submit keberangkatan';
  }

  // kalau locked => paksa ke halaman scan
  if (locked){
    try{ window.showScan?.(); }catch{}
  }
}

async function refreshTripLockFromServer(){
  if (!State.session) return;

  // ✅ admin tidak perlu cek apa pun
  if (_isAdmin()){
    setTripLocked(false, String(localStorage.getItem('tt_last_vehicle_code')||'').trim());
    return;
  }

  const tripId = State.session.activeTripId || '';
  const nik = State.session.userId || State.user?.nik || State.user?.NIK || '';
  if (!tripId || !nik) {
    // jika info belum lengkap, default lock untuk user
    setTripLocked(true, '');
    return;
  }

  try{
    const r = await api.apiCall('getMyVehicle', { sessionId: State.session.sessionId, tripId, nik });

    if (r?.success && r?.found && r?.vehicle?.code){
      setTripLocked(false, r.vehicle.code);
      try{ localStorage.setItem('tt_last_vehicle_code', r.vehicle.code); }catch{}
    } else {
      setTripLocked(true, '');
    }
  }catch{
    // fallback offline/error: gunakan last vehicle code jika ada
    const last = String(localStorage.getItem('tt_last_vehicle_code') || '').trim();
    setTripLocked(!last, last);
  }
}

function guardTripReady(){
  // ✅ admin bebas akses
  if (_isAdmin()) return true;

  // user belum login => biarkan
  if (!State.session) return true;

  // user sudah unlock => boleh
  if (!State.tripLocked) return true;

  // user locked => block
  showNotification(
    'Sebelum akses menu lain, silakan scan kendaraan & submit keberangkatan dulu.',
    'info',
    4500
  );
  try{ window.showScan?.(); }catch{}
  return false;
}


async function afterLoginInit(){
  // Load user data
  const res = await api.apiCall('getUserData', { sessionId: State.session.sessionId, nik: State.session.userId });
  State.user = res.user;
  // Load family too
  const famRes = await api.apiCall('getFamily', { sessionId: State.session.sessionId, nik: State.session.userId, tripId: State.session.activeTripId || '' });
  State.user.family = famRes.family || [];

  State.session.user = State.user;

  showMainApp();

  // ✅ cek lock dulu (admin akan auto-unlock)
  try{ await refreshTripLockFromServer(); }catch{}

  // ✅ jika user masih locked => langsung ke Scan saja, dashboard jangan dibuka dulu
  if (!_isAdmin() && State.tripLocked){
    try{ await window.showScan?.(); }catch{}
  } else {
    await showDashboard();
  }


    // ✅ auto resume tracking jika user sudah punya kendaraan terakhir
  try{
    const last = String(localStorage.getItem('tt_last_vehicle_code') || '').trim();
    if (last){
      startBackgroundTrackingPublic(State.session, last);
    }
  }catch{}

  // Admin UI
  if ((State.session.role||'')==='admin'){
    $('#adminMenu') && ($('#adminMenu').style.display = 'flex');
    initAdminEnhancements();
  }

  renderFamily(State.user);

  // ✅ Lock menu sebelum submit keberangkatan (user role)
  try{ await refreshTripLockFromServer(); }catch{}
  $('#userName').textContent = (State.user.name || State.user.Nama || '').toUpperCase();
  $('#currentUserInfo').textContent = `${State.user.name || State.user.Nama} - ${State.user.nik || State.user.NIK}`;

  // ✅ warm cache (download master + data aktual agar 100% bisa dipakai offline)
  //    Catatan: saat offline, apiCall akan membaca cache IndexedDB (kv) otomatis.
  try{ warmupOfflineData(State.session, State.user); }catch{}

  // ✅ background sync queue saat online + prompt auto-sync (5 detik)
  try{
    if (syncTimer) clearInterval(syncTimer);

    const tick = async ({ prompt = false } = {})=>{
      if (!State.session) return;
      // hanya proses otomatis jika user tidak sedang offline
      if (navigator.onLine === false) return;

      // cek antrian dulu
      const sum = await api.getQueueSummary().catch(()=>null);
      if (!sum) return;

      if (prompt && (sum.pending + sum.failed) > 0){
        showAutoSyncPrompt(State.session, sum);
        return;
      }

      // silent background sync (tanpa notifikasi)
      if (sum.pending > 0){
        try{ await api.processQueue(State.session.sessionId, { maxItems: 20 }); }catch{}
      }
    };

    window.addEventListener('online', ()=> tick({ prompt: true }));
    syncTimer = setInterval(()=> tick({ prompt:false }), 30000);
    // saat login pertama kali, kalau sudah ada antrian dan sedang online -> tampilkan prompt
    tick({ prompt: true });
  }catch{}
}

// ============================
// Offline Warmup (download data)
// ============================
let _warmupOnce = false;
async function warmupOfflineData(session, user){
  if (!session) return;
  // jalankan sekali per load (biar tidak spam)
  if (_warmupOnce) return;
  _warmupOnce = true;

  const sid = session.sessionId;
  const tripId = session.activeTripId || '';
  const coordinatorNik = session.userId || user?.nik || user?.NIK || '';

  const jobs = [
    // data aktual
    api.getDashboard(sid, tripId),
    api.getMapData(sid, tripId, 1),
    // master trip aktif
    api.getVehicles(sid, tripId, ''),
    api.getParticipants(sid, tripId, 'all'),
    api.getParticipants(sid, tripId, 'arrived'),
    api.getParticipants(sid, tripId, 'not_arrived'),
    // kebutuhan scan offline
    api.apiCall('getScanCandidates', { sessionId: sid, coordinatorNik, tripId, q:'', limit: 200 })
  ];

  // master admin (kalau role admin)
  if ((session.role||'') === 'admin'){
    jobs.push(
      api.adminGet(sid, 'config'),
      api.adminGet(sid, 'trips'),
      api.adminGet(sid, 'users'),
      api.adminGet(sid, 'vehicles', tripId),
      api.adminGet(sid, 'participants', tripId)
    );
  }

  Promise.allSettled(jobs).catch(()=>{});
}

// ============================
// Auto-sync prompt (5 detik)
// ============================
let _autoSyncShownAt = 0;
let _autoSyncEl = null;
let _autoSyncTimer = null;

function showAutoSyncPrompt(session, sum){
  const now = Date.now();
  // cegah spam notif
  if (now - _autoSyncShownAt < 15000) return;
  _autoSyncShownAt = now;

  // kalau sudah ada notif sebelumnya, hapus
  try{ _autoSyncEl?.remove(); }catch{}
  _autoSyncEl = null;
  if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
  _autoSyncTimer = null;

  const container = document.getElementById('notificationContainer');
  if (!container) return;

  const pending = sum.pending || 0;
  const failed = sum.failed || 0;
  const total = pending + failed;

  const n = document.createElement('div');
  n.className = 'notification info';
  n.innerHTML = `
    <div class="notification-content" style="align-items:flex-start;">
      <div class="notification-icon"><i class="fas fa-sync"></i></div>
      <div class="notification-message" style="line-height:1.35;">
        <b>Ada ${total} data</b> menunggu sinkronisasi (${pending} pending, ${failed} gagal).<br>
        Sinkronisasi otomatis akan berjalan dalam <b><span id="ttSyncCountdown">5</span> detik</b>.
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <button id="ttSyncNowBtn" class="btn btn-secondary" type="button" style="padding:8px 10px;">Sync Sekarang</button>
          <button id="ttSyncLaterBtn" class="btn btn-secondary" type="button" style="padding:8px 10px;">Nanti</button>
        </div>
      </div>
    </div>
    <div class="notification-close" title="Tutup"><i class="fas fa-times"></i></div>
  `;
  container.appendChild(n);
  _autoSyncEl = n;

  const closeAll = ()=>{
    try{ n.remove(); }catch{}
    if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
    _autoSyncTimer = null;
  };
  n.querySelector('.notification-close')?.addEventListener('click', closeAll);
  n.querySelector('#ttSyncLaterBtn')?.addEventListener('click', closeAll);

  // countdown UI
  let s = 5;
  const cdEl = n.querySelector('#ttSyncCountdown');
  const cdInt = setInterval(()=>{
    s -= 1;
    if (cdEl) cdEl.textContent = String(Math.max(s, 0));
    if (s <= 0) clearInterval(cdInt);
  }, 1000);

  n.querySelector('#ttSyncNowBtn')?.addEventListener('click', async ()=>{
    try{
      closeAll();
      await api.processQueue(session.sessionId, { maxItems: 50 });
      showNotification('Sinkronisasi selesai diproses.', 'success');
    }catch(e){
      showNotification(e?.message || 'Gagal sinkronisasi', 'error');
    }
  });

  // auto-run setelah 5 detik jika tidak ditutup
  _autoSyncTimer = setTimeout(async ()=>{
    try{
      closeAll();
      await api.processQueue(session.sessionId, { maxItems: 50 });
      showNotification('Sinkronisasi otomatis dijalankan.', 'success');
    }catch(e){
      showNotification(e?.message || 'Gagal sinkronisasi', 'error');
    }
  }, 5000);

  setTimeout(()=>{ try{ n.classList.add('show'); }catch{} }, 10);
}

// ===== Page Navigation =====
window.showSync = async (menuEl)=>{
  if (!guardTripReady()) return;
  activateMenu(menuEl || (document.querySelectorAll('.menu-item')[5]||null));
  showPage('syncPage');
  closeSidebarOnMobile();
  if (State.session) await renderSyncPage(State.session);
};

function showMainApp(){
  $('#loginPage').style.display = 'none';
  $('#mainApp').style.display = 'block';
}

function applyConfig(cfg){
  const appTitle = cfg.appTitle || 'Trip Tracker';
  const eventName = cfg.eventName || appTitle;
  const eventSub = cfg.eventSub || '';
  document.title = appTitle;
  $('#appEventName') && ($('#appEventName').textContent = eventName);
  $('#loginEventTitle') && ($('#loginEventTitle').textContent = eventName);
  $('#sidebarEventTitle') && ($('#sidebarEventTitle').textContent = eventName);
  $('#headerMainTitle') && ($('#headerMainTitle').textContent = appTitle.split(' ')[0] || appTitle);
  $('#headerSubTitle') && ($('#headerSubTitle').textContent = appTitle.split(' ').slice(1).join(' ') || '');
  $('#loginEventSub') && ($('#loginEventSub').textContent = eventSub);
  $('#sidebarEventSub') && ($('#sidebarEventSub').textContent = eventSub);
  $('#appOrgName') && cfg.orgName && ($('#appOrgName').textContent = cfg.orgName);
  startCountdown(cfg);
    const ai = document.getElementById('arrivalInfoText');
  if (ai){
    const en = cfg.eventName || cfg.appTitle || 'kegiatan';
    const sub = cfg.eventSub ? ` (${cfg.eventSub})` : '';
    ai.textContent = `Konfirmasi kedatangan Anda setelah tiba di lokasi ${en}${sub}.`;
  }
}

let countdownTick = null;

function parseIndoDateRangeToStart(sub){
  // contoh: "Pontianak, 14-17 Feb 2026" atau "14 Feb 2026"
  const s = String(sub || '').trim();

  const months = {
    jan:0, januari:0,
    feb:1, februari:1,
    mar:2, maret:2,
    apr:3, april:3,
    mei:4,
    jun:5, juni:5,
    jul:6, juli:6,
    agu:7, agustus:7,
    sep:8, september:8,
    okt:9, oktober:9,
    nov:10, november:10,
    des:11, desember:11
  };

  // ambil bagian setelah koma kalau ada (Pontianak, ...)
  const part = s.includes(',') ? s.split(',').slice(1).join(',').trim() : s;

  // cari pola "14-17 Feb 2026" atau "14 Feb 2026"
  const m = part.match(/(\d{1,2})(?:\s*-\s*\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;

  const day = Number(m[1]);
  const monKey = m[2].toLowerCase();
  const year = Number(m[3]);

  // normalisasi bulan (ambil 3 huruf awal juga)
  const mk = (months[monKey] !== undefined) ? monKey : monKey.slice(0,3);
  const month = months[mk];
  if (month === undefined) return null;

  // target: jam 00:00 local
  return new Date(year, month, day, 0, 0, 0);
}

function startCountdown(cfg){
  const el = document.getElementById('countdownTimer');
  if (!el) return;

  if (countdownTick) clearInterval(countdownTick);

  // target dari config
  const target = parseIndoDateRangeToStart(cfg?.eventSub || '') || null;
  if (!target){
    el.textContent = '- Hari - Jam - Menit';
    return;
  }

  const render = ()=>{
    const now = new Date();
    let diff = target.getTime() - now.getTime();

    if (diff <= 0){
      el.textContent = '0 Hari 0 Jam 0 Menit';
      return;
    }

    const totalMin = Math.floor(diff / 60000);
    const days = Math.floor(totalMin / (60*24));
    const hours = Math.floor((totalMin - days*60*24) / 60);
    const mins = totalMin % 60;

    el.textContent = `${days} Hari ${hours} Jam ${mins} Menit`;
  };

  render();
  countdownTick = setInterval(render, 1000); // real-time; kalau mau hemat baterai: 60000
}

// --- Expose globals for inline onclick ---
window.toggleSidebar = (force) => {
  const sb = document.getElementById('sidebar');
  if (!sb) return;

  const willOpen = (typeof force === 'boolean') ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', willOpen);
  document.body.classList.toggle('sidebar-open', willOpen);
};

window.login = async () => {
  try{
    const res = await doLogin();
    State.session = loadSession();
    State.session.activeTripId = res.activeTripId || State.session.activeTripId;
    State.session.role = res.user?.role;
    State.session.userId = res.user?.nik;
    // user + family returned
    State.user = {
      nik: res.user?.nik,
      name: res.user?.name,
      role: res.user?.role,
      region: res.user?.region,
      estate: res.user?.estate,
      family: res.family || []
    };

    State.session.user = State.user;
    showMainApp();
    if (State.session.role === 'admin'){
      $('#adminMenu') && ($('#adminMenu').style.display = 'flex');
      initAdminEnhancements();
    }
    $('#userName').textContent = (State.user.name||'').toUpperCase();
    $('#currentUserInfo').textContent = `${State.user.name} - ${State.user.nik} (${State.user.estate||''})`;
    renderFamily(State.user);

  // ✅ Lock menu sebelum submit keberangkatan (user role)
  try{ await refreshTripLockFromServer(); }catch{}

  if (!_isAdmin() && State.tripLocked){
    try{ await window.showScan?.(); }catch{}
  } else {
    await showDashboard();
  }
  } catch {}
};

window.logout = async () => {
  try{ if (State.session?.sessionId) await api.logout(State.session.sessionId); } catch{}
  clearSession();
  State.session = null;
  State.user = null;
  try{ stopTrackingPublic({ silent:true }); }catch{}
  location.reload();
};

window.showDashboard = showDashboard;
async function showDashboard(){
  if (!guardTripReady()) return;
  activateMenu(document.querySelector('.menu-item'));
  showPage('dashboardPage');
  closeSidebarOnMobile();
  if (!State.session) return;
  await loadDashboard(State.session);
}

window.showScan = async ()=>{
  activateMenu(document.querySelectorAll('.menu-item')[1]);
  showPage('scanPage');
  closeSidebarOnMobile();
};

window.showMap = async ()=>{
  if (!guardTripReady()) return;
  activateMenu(document.querySelectorAll('.menu-item')[2]);
  showPage('mapPage');
  closeSidebarOnMobile();

  // ✅ tunggu halaman map benar-benar tampil & layout settle
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  initMap();

  if (!State.session) return;

  // refresh map dulu (tanpa manifest)
  await refreshMap(State.session, { includeManifest: 0, fitMode: 'first' });

  // ✅ pilih kendaraan otomatis:
  // 1) dari pending vehicle (hasil scan/penempatan)
  // 2) fallback dari localStorage (kendaraan terakhir)
  // (getPendingVehicle sudah Anda import dari scan.js)
  let code = '';
  try{
    code = String(await getPendingVehicle(State.session) || '').trim();
  }catch{}

  if (!code){
    code = String(localStorage.getItem('tt_last_vehicle_code') || '').trim();
  }

  if (code){
    // simpan untuk fallback
    localStorage.setItem('tt_last_vehicle_code', code);
    // ✅ start tracking otomatis
    // start tracking otomatis (background)
    startBackgroundTrackingPublic(State.session, code);
  } else {
    showNotification('Belum ada kendaraan terpilih. Scan kendaraan dulu di menu "Scan Kendaraan".', 'info');
  }

  // refresh map periodik (tanpa manifest)
  if (State.mapTimer) clearInterval(State.mapTimer);
  State.mapTimer = setInterval(()=>{
    refreshMap(State.session, { includeManifest: 0, fitMode: 'none' }).catch(()=>{});
  }, 30000);
};

window.showArrival = async ()=>{
  if (!guardTripReady()) return;
  activateMenu(document.querySelectorAll('.menu-item')[3]);
  showPage('arrivalPage');
  closeSidebarOnMobile();

  // ✅ lock otomatis jika sudah Arrived
  if (State.session && State.user){
    await initArrivalPage(State.session, State.user);
  }
};

window.showParticipants = async ()=>{
  if (!guardTripReady()) return;
  activateMenu(document.querySelectorAll('.menu-item')[4]);
  showPage('participantsPage');
  closeSidebarOnMobile();
  if (!State.session) return;
  const f = $('#participantFilter')?.value || 'all';
  await loadParticipants(State.session, f);
};

window.searchParticipants = ()=>{
  searchAndRender($('#participantSearch')?.value || '');
};
window.filterParticipants = async ()=>{
  if (!State.session) return;
  const f = $('#participantFilter')?.value || 'all';
  await loadParticipants(State.session, f);
};

// Scan actions
window.startScanning = ()=> State.session ? startScanning(State.session) : showNotification('Silakan login dulu', 'error');
window.manualVehicleSubmit = ()=> State.session ? manualSubmit(State.session) : showNotification('Silakan login dulu','error');
window.confirmAssignment = async ()=>{
  if (!State.session || !State.user) return;
  await confirmAssignment(State.session);
};

// Arrival
window.confirmArrival = async ()=>{
  if (!State.session || !State.user) return;
  try { stopTrackingPublic(); } catch {}
  await doConfirmArrival(State.session, State.user);
};

// Password
window.changePassword = async ()=>{
  if (!State.session) return;
  const oldPassword = $('#oldPassword')?.value || '';
  const newPassword = $('#newPassword')?.value || '';
  const confirmPassword = $('#confirmPassword')?.value || '';
  if (!oldPassword || !newPassword) return showNotification('Lengkapi password', 'error');
  if (newPassword !== confirmPassword) return showNotification('Konfirmasi password tidak sama', 'error');
  try{
    await api.changePassword(State.session.sessionId, oldPassword, newPassword);
    showNotification('Password berhasil diubah', 'success');
    $('#oldPassword').value=''; $('#newPassword').value=''; $('#confirmPassword').value='';
  } catch(err){
    showNotification(err.message||'Gagal ubah password','error');
  }
};

// Admin
window.showAdmin = async ()=>{
  activateMenu($('#adminMenu'));
  showPage('adminPage');
  closeSidebarOnMobile();
  if (!State.session) return;
  await loadUsers(State.session);
  await loadVehicles(State.session);
  await loadConfigAndTrips(State.session);
  await loadParticipantsAdmin(State.session);
  await loadHistory(State.session);
};

window.showAdminTab = async (key)=>{
  showTab(key);
  if (!State.session) return;
  if (key === 'history') await loadHistory(State.session);
};
window.saveConfig = ()=> saveConfig(State.session);

window.addNewTrip = ()=>{
  const trip = {
    __isNew: true,
    TripId: prompt('TripId (unik):', `TRIP-${new Date().getFullYear()}-01`)?.trim(),
    Name: prompt('Nama Trip/Kegiatan:', '')?.trim(),
    Start: prompt('Mulai (YYYY-MM-DD HH:mm):', '')?.trim(),
    End: prompt('Selesai (YYYY-MM-DD HH:mm):', '')?.trim(),
    Origin: prompt('Asal:', '')?.trim(),
    Destination: prompt('Tujuan:', '')?.trim(),
    Status: 'active'
  };
  if (!trip.TripId) return;
  upsertTrip(State.session, trip);
};
window.editTrip = (tripId)=>{
  const t = (window.__adminTrips||[]).find(x=>x.TripId===tripId);
  if (!t) return;
  const trip = {
    ...t,
    __isNew:false,
    Name: prompt('Nama Trip/Kegiatan:', t.Name||'')?.trim() ?? t.Name,
    Start: prompt('Mulai (YYYY-MM-DD HH:mm):', t.Start||'')?.trim() ?? t.Start,
    End: prompt('Selesai (YYYY-MM-DD HH:mm):', t.End||'')?.trim() ?? t.End,
    Origin: prompt('Asal:', t.Origin||'')?.trim() ?? t.Origin,
    Destination: prompt('Tujuan:', t.Destination||'')?.trim() ?? t.Destination,
    Status: prompt('Status (active/archived):', t.Status||'active')?.trim() ?? t.Status
  };
  upsertTrip(State.session, trip);
};

window.addNewUser = ()=>{
  const user = {
    __isNew:true,
    NIK: prompt('NIK:', '')?.trim(),
    Nama: prompt('Nama:', '')?.trim(),
    Region: prompt('Region:', '')?.trim(),
    Estate: prompt('Estate:', '')?.trim(),
    Role: prompt('Role (admin/user):', 'user')?.trim() || 'user'
  };
  if (!user.NIK) return;
  upsertUser(State.session, user);
};
window.editUser = (nik)=>{
  const u = (window.__adminUsers||[]).find(x=>x.NIK===nik);
  if (!u) return;
  const user = {
    ...u,
    __isNew:false,
    Nama: prompt('Nama:', u.Nama||'')?.trim() ?? u.Nama,
    Region: prompt('Region:', u.Region||'')?.trim() ?? u.Region,
    Estate: prompt('Estate:', u.Estate||'')?.trim() ?? u.Estate,
    Role: prompt('Role (admin/user):', u.Role||'user')?.trim() ?? u.Role
  };
  upsertUser(State.session, user);
};

window.addNewVehicle = ()=>{
  const v = {
    __isNew:true,
    Code: prompt('Kode Kendaraan:', '')?.trim(),
    Type: prompt('Jenis:', '')?.trim(),
    Capacity: Number(prompt('Kapasitas:', '4')||4),
    Driver: prompt('Driver:', '')?.trim(),
    TripId: State.session.activeTripId || '',
    Barcode: prompt('Barcode (opsional):', '')?.trim()
  };
  if (!v.Code) return;
  upsertVehicle(State.session, v);
};
window.editVehicle = (code)=>{
  const v0 = (window.__adminVehicles||[]).find(x=>x.Code===code);
  if (!v0) return;
  const v = {
    ...v0,
    __isNew:false,
    Type: prompt('Jenis:', v0.Type||'')?.trim() ?? v0.Type,
    Capacity: Number(prompt('Kapasitas:', String(v0.Capacity||''))||v0.Capacity),
    Driver: prompt('Driver:', v0.Driver||'')?.trim() ?? v0.Driver,
    Status: prompt('Status (waiting/on_the_way/arrived):', v0.Status||'waiting')?.trim() ?? v0.Status,
    TripId: prompt('TripId:', v0.TripId||State.session.activeTripId||'')?.trim() ?? v0.TripId,
    Barcode: prompt('Barcode:', v0.Barcode||'')?.trim() ?? v0.Barcode
  };
  upsertVehicle(State.session, v);
};
window.addNewParticipant = ()=>{
  const tripId = State.session?.activeTripId || '';
  const p = {
    __isNew:true,
    NIK: prompt('NIK:', '')?.trim(),
    Nama: prompt('Nama:', '')?.trim(),
    Relationship: prompt('Kategori/Hubungan (mentee/staff/istri/anak/dll):', 'mentee')?.trim(),
    Region: prompt('Region:', '')?.trim(),
    Estate: prompt('Estate:', '')?.trim(),
    MainNIK: prompt('MainNIK (untuk keluarga; kosong jika peserta mandiri):', '')?.trim(),
    Vehicle: prompt('Vehicle code (opsional):', '')?.trim(),
    Arrived: false,
    TripId: tripId
  };
  if (!p.NIK) return;
  upsertParticipant(State.session, p);
};

window.editParticipant = (nik)=>{
  const tripId = State.session?.activeTripId || '';
  const list = (window.__adminParticipants||[]);
  const row = list.find(x=> String(x.NIK)===String(nik) && String(x.TripId||'')===String(tripId));
  if (!row) return alert('Participant tidak ditemukan untuk Trip aktif');

  const p = {
    ...row,
    __isNew:false,
    Nama: prompt('Nama:', row.Nama||'')?.trim() ?? row.Nama,
    Relationship: prompt('Kategori/Hubungan:', row.Relationship||'')?.trim() ?? row.Relationship,
    Region: prompt('Region:', row.Region||'')?.trim() ?? row.Region,
    Estate: prompt('Estate:', row.Estate||'')?.trim() ?? row.Estate,
    MainNIK: prompt('MainNIK:', row.MainNIK||'')?.trim() ?? row.MainNIK,
    Vehicle: prompt('Vehicle:', row.Vehicle||'')?.trim() ?? row.Vehicle,
    TripId: tripId
  };
  upsertParticipant(State.session, p);
};
// realtime clock
setInterval(()=>{
  const el = $('#currentDateTime');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('id-ID', {
    weekday:'long', year:'numeric', month:'long', day:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
}, 1000);

// ============================
// ✅ HARD REFRESH + DISABLE PULL-TO-REFRESH (Mobile)
// ============================

// tombol header: hard refresh
window.hardRefresh = async () => {
  // Tujuan:
  // - Bersihkan data lokal (IndexedDB + localStorage) supaya data terbaru ditarik ulang
  // - Pertahankan session yang masih aktif agar user tidak perlu login ulang

  const now = Date.now();

  // simpan session aktif (kalau masih berlaku)
  let keepSession = null;
  try{
    const s = loadSession();
    if (s && s.expiry && Number(s.expiry) > now) keepSession = s;
  }catch{}

  try{
    showNotification('Refresh: bersihkan data lokal & tarik data terbaru…', 'info', 1600);
  }catch{}

  // 1) bersihkan IndexedDB (cache data + antrian sync)
  try{
    await resetAllOfflineData();
  }catch{}

  // 2) bersihkan localStorage kecuali session aktif (dan flag prefetch)
  try{
    const keys = Object.keys(localStorage);
    for (const k of keys){
      // biarkan session diset ulang di bawah
      if (k === LS.session) continue;
      localStorage.removeItem(k);
    }
    if (keepSession){
      saveSession(keepSession);
      // ✅ setelah reload, auto-prefetch data penting dari server
      localStorage.setItem('tt_force_prefetch', '1');
    }
  }catch{}

  // 3) update service worker (kalau ada)
  try{
    if ('serviceWorker' in navigator){
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update().catch(()=>{});
    }
  }catch{}

  // 4) hapus cache shell (opsional, membuat refresh benar-benar fresh)
  try{
    if ('caches' in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => k.startsWith('trip_tracker_shell') ? caches.delete(k) : null));
    }
  }catch{}

  // 5) reload dengan cache-busting param
  try{
    const u = new URL(location.href);
    u.searchParams.set('_r', String(Date.now()));
    location.replace(u.toString());
  }catch{
    location.reload();
  }
};

// disable pull-to-refresh (khusus mobile)
(function disablePullToRefresh(){
  // cara paling aman: ketika scroll sudah di top, blok gesture pull-down yang memicu refresh
  let startY = 0;
  let isAtTop = true;

  window.addEventListener('scroll', () => {
    isAtTop = (window.scrollY <= 0);
  }, { passive: true });

  window.addEventListener('touchstart', (e) => {
    if (!e.touches || !e.touches.length) return;
    startY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!e.touches || !e.touches.length) return;
    const y = e.touches[0].clientY;

    // kalau user tarik ke bawah saat posisi top -> prevent agar tidak terjadi refresh
    if (isAtTop && (y - startY) > 10){
      e.preventDefault();
    }
  }, { passive: false });

  // opsi tambahan: matikan overscroll glow/bounce untuk browser yang support
  try{
    document.documentElement.style.overscrollBehaviorY = 'none';
    document.body.style.overscrollBehaviorY = 'none';
  }catch{}
})();
