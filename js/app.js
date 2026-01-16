import * as api from './core/api.js';
import { loadSession, clearSession, loadCfg, saveCfg } from './core/storage.js';
import { $, showNotification, activateMenu, showPage, toggleSidebar as _toggleSidebar, closeSidebarOnMobile } from './core/ui.js';
import { doLogin, bindLoginEnter } from './pages/login.js';
import { loadDashboard } from './pages/dashboard.js';
import { initMap, refreshMap } from './pages/map.js';
import { startScanning, manualSubmit, confirmAssignment, getPendingVehicle } from './pages/scan.js';
import { renderFamily, confirmArrival as doConfirmArrival } from './pages/arrival.js';
import { loadParticipants, searchAndRender } from './pages/participants.js';
import { initAdminEnhancements, showTab, loadUsers, loadVehicles, loadConfigAndTrips, saveConfig, upsertTrip, upsertUser, upsertVehicle } from './pages/admin.js';

const State = {
  session: null,
  user: null,
  cfg: null,
  mapTimer: null
};

// Boot
document.addEventListener('DOMContentLoaded', async ()=>{
  ensureSidebarOverlay();
  hideLoadingSoon();
  bindLoginEnter();

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

async function afterLoginInit(){
  // Load user data
  const res = await api.apiCall('getUserData', { sessionId: State.session.sessionId, nik: State.session.userId });
  State.user = res.user;
  // Load family too
  const famRes = await api.apiCall('getFamily', { sessionId: State.session.sessionId, nik: State.session.userId, tripId: State.session.activeTripId || '' });
  State.user.family = famRes.family || [];

  showMainApp();
  await showDashboard();

  // Admin UI
  if ((State.session.role||'')==='admin'){
    $('#adminMenu') && ($('#adminMenu').style.display = 'flex');
    initAdminEnhancements();
  }

  renderFamily(State.user);
  $('#userName').textContent = (State.user.name || State.user.Nama || '').toUpperCase();
  $('#currentUserInfo').textContent = `${State.user.name || State.user.Nama} - ${State.user.nik || State.user.NIK}`;
}

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
    showMainApp();
    if (State.session.role === 'admin'){
      $('#adminMenu') && ($('#adminMenu').style.display = 'flex');
      initAdminEnhancements();
    }
    $('#userName').textContent = (State.user.name||'').toUpperCase();
    $('#currentUserInfo').textContent = `${State.user.name} - ${State.user.nik} (${State.user.estate||''})`;
    renderFamily(State.user);
    await showDashboard();
  } catch {}
};

window.logout = async () => {
  try{ if (State.session?.sessionId) await api.logout(State.session.sessionId); } catch{}
  clearSession();
  State.session = null;
  State.user = null;
  location.reload();
};

window.showDashboard = showDashboard;
async function showDashboard(){
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
  activateMenu(document.querySelectorAll('.menu-item')[2]);
  showPage('mapPage');
  closeSidebarOnMobile();

  // ✅ penting: tunggu DOM/layout settle dulu baru initMap
  requestAnimationFrame(() => initMap());

  if (!State.session) return;
  await refreshMap(State.session);

  if (State.mapTimer) clearInterval(State.mapTimer);
  State.mapTimer = setInterval(()=> refreshMap(State.session).catch(()=>{}), 20000);
};

window.showArrival = async ()=>{
  activateMenu(document.querySelectorAll('.menu-item')[3]);
  showPage('arrivalPage');
  closeSidebarOnMobile();
};

window.showParticipants = async ()=>{
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
  const nikList = [State.user.nik, ...(State.user.family||[]).map(m=>m.nik)];
  await confirmAssignment(State.session, nikList);
};

// Arrival
window.confirmArrival = async ()=>{
  if (!State.session || !State.user) return;
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
};

window.showAdminTab = (key)=> showTab(key);
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
