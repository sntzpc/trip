import * as api from '../core/api.js';
import { $, $$, showNotification } from '../core/ui.js';
import { createTablePager } from '../core/table_pager.js';

export function initAdminEnhancements(){
  // Inject a new tab for Settings/Trip if not exists
  const tabs = document.querySelector('.admin-tabs');
  if (!tabs) return;
  if (!tabs.querySelector('[data-tab="settings"]')){
    const b = document.createElement('button');
    b.className = 'admin-tab';
    b.textContent = 'Kegiatan/Trip';
    b.dataset.tab = 'settings';
    b.onclick = () => window.showAdminTab('settings');
    tabs.insertBefore(b, tabs.children[2]||null);
  }
  const content = document.querySelector('.admin-content');
  if (content && !document.getElementById('adminSettingsTab')){
    const div = document.createElement('div');
    div.id = 'adminSettingsTab';
    div.className = 'admin-tab-content';
    div.innerHTML = `
      <h3>Pengaturan Aplikasi & Kegiatan</h3>
      <div class="admin-form-grid">
        <div class="form-group">
          <label>Judul Aplikasi</label>
          <input type="text" id="cfg_appTitle" placeholder="Trip Tracker"/>
        </div>
        <div class="form-group">
          <label>Nama Kegiatan</label>
          <input type="text" id="cfg_eventName" placeholder="Family Gathering / Magang / Training"/>
        </div>
        <div class="form-group">
          <label>Subtitle (lokasi/tanggal)</label>
          <input type="text" id="cfg_eventSub" placeholder="Pontianak, 14-17 Feb 2026"/>
        </div>
        <div class="form-group">
          <label>Active Trip ID</label>
          <input type="text" id="cfg_activeTrip" placeholder="TRIP-2026-01"/>
        </div>
      </div>
      <button class="btn-primary" id="btnSaveCfg">Simpan Pengaturan</button>

      <div class="menu-divider" style="margin:16px 0"></div>
      <h3>Daftar Trip</h3>
      <button class="btn-primary" id="btnAddTrip"><i class="fas fa-plus"></i> Tambah Trip</button>
      <div class="admin-table-container">
        <table class="admin-table">
          <thead><tr><th>TripId</th><th>Nama</th><th>Mulai</th><th>Selesai</th><th>Asal</th><th>Tujuan</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody id="adminTripsTable"></tbody>
        </table>
      </div>
    `;
      // ✅ Inject tab Participants (jika belum ada)
      if (!tabs.querySelector('[data-tab="participants"]')){
        const b = document.createElement('button');
        b.className = 'admin-tab';
        b.textContent = 'Participants';
        b.dataset.tab = 'participants';
        b.onclick = () => window.showAdminTab('participants');
        tabs.insertBefore(b, tabs.children[2]||null); // taruh setelah Users/Vehicles
      }

      // ✅ Pane Participants
      if (content && !document.getElementById('adminParticipantsTab')){
        const p = document.createElement('div');
        p.id = 'adminParticipantsTab';
        p.className = 'admin-tab-content';
        p.innerHTML = `
          <h3>Manajemen Participants</h3>

          <div class="admin-actions-row">
            <button class="btn-primary" id="btnAddParticipant">
              <i class="fas fa-plus"></i> Tambah Participant
            </button>
            <small style="opacity:.75">TripId akan otomatis memakai Active Trip ID.</small>
          </div>

          <div class="admin-table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>NIK</th>
                  <th>Nama</th>
                  <th>Kategori/Hubungan</th>
                  <th>Region</th>
                  <th>Estate</th>
                  <th>MainNIK</th>
                  <th>Vehicle</th>
                  <th>Arrived</th>
                  <th>TripId</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody id="adminParticipantsTable"></tbody>
            </table>
          </div>
        `;
        content.appendChild(p);

        // tombol tambah
        document.getElementById('btnAddParticipant')?.addEventListener('click', ()=> window.addNewParticipant?.());
      }
    content.appendChild(div);

    $('#btnSaveCfg')?.addEventListener('click', ()=> window.saveConfig?.());
    $('#btnAddTrip')?.addEventListener('click', ()=> window.addNewTrip?.());
  }
}

export function showTab(tabKey){
  // tabKey: users, vehicles, history, password, settings
  $$('.admin-tab').forEach(b=>b.classList.remove('active'));
  $$('.admin-tab-content').forEach(c=>c.classList.remove('active'));

  const btn = document.querySelector(`.admin-tab[data-tab="${tabKey}"]`) || Array.from($$('.admin-tab')).find(b=> (b.textContent||'').toLowerCase().includes(tabKey));
  btn?.classList.add('active');

  const idMap = {
    users:'adminUsersTab',
    vehicles:'adminVehiclesTab',
    participants:'adminParticipantsTab',
    history:'adminHistoryTab',
    password:'adminPasswordTab',
    settings:'adminSettingsTab'
  };
  const pane = document.getElementById(idMap[tabKey] || 'adminUsersTab');
  pane?.classList.add('active');
}

let usersPager = null;

export async function loadUsers(session){
  const res = await api.adminGet(session.sessionId, 'users');
  const container = document.querySelector('#adminUsersTab .admin-table-container');
  const tbody = $('#adminUsersTable');
  if (!tbody || !container) return;

  if (!usersPager){
    usersPager = createTablePager({
      containerEl: container,
      tbodyEl: tbody,
      searchPlaceholder: 'Cari NIK / Nama / Region / Estate / Role...',
      getRowText: (u)=> `${u.NIK||''} ${u.Nama||''} ${u.Region||''} ${u.Estate||''} ${u.Role||''}`,
      renderRowHtml: (u)=> `
        <tr>
          <td>${esc(u.NIK)}</td>
          <td>${esc(u.Nama)}</td>
          <td>${esc(u.Region||'')}</td>
          <td>${esc(u.Estate||'')}</td>
          <td>${esc(u.Role||'user')}</td>
          <td><button class="btn-small" onclick='editUser("${escAttr(u.NIK)}")'><i class="fas fa-edit"></i></button></td>
        </tr>
      `
    });
  }

  window.__adminUsers = res.users||[];
  usersPager.setData(window.__adminUsers);
}

let vehiclesPager = null;

export async function loadVehicles(session){
  const res = await api.adminGet(session.sessionId, 'vehicles', session.activeTripId||'');
  const container = document.querySelector('#adminVehiclesTab .admin-table-container');
  const tbody = $('#adminVehiclesTable');
  if (!tbody || !container) return;

  if (!vehiclesPager){
    vehiclesPager = createTablePager({
      containerEl: container,
      tbodyEl: tbody,
      searchPlaceholder: 'Cari Code / Type / Driver / Status / TripId...',
      getRowText: (v)=> `${v.Code||''} ${v.Type||''} ${v.Driver||''} ${v.Status||''} ${v.TripId||''} ${v.Barcode||''}`,
      renderRowHtml: (v)=> `
        <tr>
          <td>${esc(v.Code)}</td>
          <td>${esc(v.Type||'')}</td>
          <td>${esc(v.Capacity||'')}</td>
          <td>${esc(v.Driver||'')}</td>
          <td>${esc(v.Status||'')}</td>
          <td>${esc(v.Passengers||'')}</td>
          <td><button class="btn-small" onclick='editVehicle("${escAttr(v.Code)}")'><i class="fas fa-edit"></i></button></td>
        </tr>
      `
    });
  }

  window.__adminVehicles = res.vehicles||[];
  vehiclesPager.setData(window.__adminVehicles);
}

let participantsPager = null;

export async function loadParticipantsAdmin(session){
  const tripId = session?.activeTripId || '';
  const res = await api.adminGet(session.sessionId, 'participants', tripId);

  const container = document.querySelector('#adminParticipantsTab .admin-table-container');
  const tbody = document.getElementById('adminParticipantsTable');
  if (!tbody || !container) return;

  if (!participantsPager){
    participantsPager = createTablePager({
      containerEl: container,
      tbodyEl: tbody,
      searchPlaceholder: 'Cari NIK/Nama/Relasi/Vehicle/MainNIK/TripId...',
      getRowText: (p)=> `${p.NIK||''} ${p.Nama||''} ${p.Relationship||''} ${p.Vehicle||''} ${p.MainNIK||''} ${p.TripId||''}`,
      renderRowHtml: (p)=> {
        const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
        return `
          <tr>
            <td>${esc(p.NIK||'')}</td>
            <td>${esc(p.Nama||'')}</td>
            <td>${esc(p.Relationship||p.Category||'')}</td>
            <td>${esc(p.Region||'')}</td>
            <td>${esc(p.Estate||'')}</td>
            <td>${esc(p.MainNIK||'')}</td>
            <td>${esc(p.Vehicle||'')}</td>
            <td>${arrived ? '<span class="badge success">true</span>' : '<span class="badge warning">false</span>'}</td>
            <td>${esc(p.TripId||'')}</td>
            <td>
              <button class="btn-small" onclick='editParticipant("${escAttr(p.NIK)}")'><i class="fas fa-edit"></i></button>
            </td>
          </tr>
        `;
      }
    });
  }

  window.__adminParticipants = res.participants || [];
  participantsPager.setData(window.__adminParticipants);
}

export async function loadConfigAndTrips(session){
  const cfgRes = await api.adminGet(session.sessionId, 'config');
  const cfg = cfgRes.config || {};
  $('#cfg_appTitle') && ($('#cfg_appTitle').value = cfg.appTitle || 'Trip Tracker');
  $('#cfg_eventName') && ($('#cfg_eventName').value = cfg.eventName || '');
  $('#cfg_eventSub') && ($('#cfg_eventSub').value = cfg.eventSub || '');
  $('#cfg_activeTrip') && ($('#cfg_activeTrip').value = cfg.activeTripId || '');

  const tripsRes = await api.adminGet(session.sessionId, 'trips');
  renderTrips(tripsRes.trips||[]);
  window.__adminTrips = tripsRes.trips||[];
}

function renderTrips(trips){
  const tbody = $('#adminTripsTable');
  if (!tbody) return;
  tbody.innerHTML = trips.map(t=>`
    <tr>
      <td>${esc(t.TripId)}</td>
      <td>${esc(t.Name||'')}</td>
      <td>${esc(t.Start||'')}</td>
      <td>${esc(t.End||'')}</td>
      <td>${esc(t.Origin||'')}</td>
      <td>${esc(t.Destination||'')}</td>
      <td>${esc(t.Status||'active')}</td>
      <td>
        <button class="btn-small" onclick='editTrip("${escAttr(t.TripId)}")'><i class="fas fa-edit"></i></button>
      </td>
    </tr>
  `).join('');
}

export async function saveConfig(session){
  const data = {
    appTitle: $('#cfg_appTitle')?.value.trim(),
    eventName: $('#cfg_eventName')?.value.trim(),
    eventSub: $('#cfg_eventSub')?.value.trim(),
    activeTripId: $('#cfg_activeTrip')?.value.trim(),
  };
  await api.adminUpdate(session.sessionId, 'config', 'update', data);
  showNotification('Pengaturan tersimpan. Refresh halaman jika perlu.', 'success');
}

export async function upsertTrip(session, trip){
  await api.adminUpdate(session.sessionId, 'trip', trip.__isNew ? 'add' : 'update', trip);
  showNotification('Trip tersimpan', 'success');
  await loadConfigAndTrips(session);
}

export async function upsertUser(session, user){
  await api.adminUpdate(session.sessionId, 'user', user.__isNew ? 'add' : 'update', user);
  showNotification('User tersimpan', 'success');
  await loadUsers(session);
}

export async function upsertVehicle(session, vehicle){
  await api.adminUpdate(session.sessionId, 'vehicle', vehicle.__isNew ? 'add' : 'update', vehicle);
  showNotification('Kendaraan tersimpan', 'success');
  await loadVehicles(session);
}

export async function upsertParticipant(session, p){
  await api.adminUpdate(session.sessionId, 'participant', p.__isNew ? 'add' : 'update', p);
  showNotification('Participant tersimpan', 'success');
  await loadParticipantsAdmin(session);
}

function esc(s){
  return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function escAttr(s){
  return esc(s).replaceAll('`','');
}
