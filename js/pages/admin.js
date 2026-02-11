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
          <div class="hint">Geofence kedatangan akan mengikuti Trip ID aktif.</div>
        </div>
      </div>

      <div class="menu-divider" style="margin:14px 0"></div>
      <h3 style="margin-top:0;">Tujuan / Lokasi Kedatangan (Geofence)</h3>
      <div class="admin-form-grid">
        <div class="form-group">
          <label>Latitude</label>
          <input type="number" step="any" id="cfg_arrivalLat" placeholder="-1.234567"/>
        </div>
        <div class="form-group">
          <label>Longitude</label>
          <input type="number" step="any" id="cfg_arrivalLng" placeholder="102.345678"/>
        </div>
        <div class="form-group">
          <label>Radius (meter)</label>
          <input type="number" step="1" id="cfg_arrivalRadius" placeholder="150"/>
        </div>
      </div>

      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:6px;">
        <div style="font-weight:800;">Multi Titik (Opsional)</div>
        <button type="button" id="cfg_addArrivalPoint" class="btn btn-secondary" style="padding:8px 10px;">
          <i class="fa-solid fa-plus"></i> Tambah Titik
        </button>
      </div>
      <div id="cfg_arrivalPoints" style="margin-top:8px;"></div>

      <div class="menu-divider" style="margin:14px 0"></div>
      <h3 style="margin-top:0;">Bypass Khusus (Opsional)</h3>
      <div class="admin-form-grid">
        <div class="form-group">
          <label><input type="checkbox" id="cfg_arrivalBypassEnabled"> Aktifkan bypass untuk Admin/Koordinator</label>
          <div style="font-size:12px;color:#666;line-height:1.4;">
            Jika aktif, Admin/Koordinator dapat melakukan bypass dengan PIN/OTP.
          </div>
        </div>
        <div class="form-group">
          <label>PIN/OTP (6-10 digit)</label>
          <input type="password" inputmode="numeric" id="cfg_arrivalBypassPin" placeholder="Kosongkan jika tidak mengubah PIN"/>
          <div id="cfg_arrivalBypassHint" style="font-size:12px;color:#666;margin-top:4px;"></div>
        </div>
      </div>

      <div style="font-size:12px; color:#666; margin:-4px 0 10px; line-height:1.4;">
        Geofence ini dipakai untuk:
        <b>(1) Konfirmasi Kedatangan</b> (peserta harus berada di dalam radius) dan
        <b>(2) Live Maps + Notifikasi jarak</b> (1000m, 500m, ... 50m, tiba) untuk semua user.
        Anda boleh atur <b>multi titik</b> jika tujuan/kedatangan punya beberapa lokasi.
      </div>

      <div class="menu-divider" style="margin:14px 0"></div>
      <h3 style="margin-top:0;">Pemberhentian Sementara (Multi Titik)</h3>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:6px;">
        <div style="font-weight:800;">Daftar titik pemberhentian</div>
        <button type="button" id="cfg_addStopPoint" class="btn btn-secondary" style="padding:8px 10px;">
          <i class="fa-solid fa-plus"></i> Tambah Titik
        </button>
      </div>
      <div id="cfg_stopPoints" style="margin-top:8px;"></div>
      <div style="font-size:12px; color:#666; margin:-4px 0 10px; line-height:1.4;">
        Titik ini ditampilkan di Live Maps dan juga memicu notifikasi jarak, namun <b>tidak mengaktifkan Konfirmasi Kedatangan</b>.
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
// ===== Arrival Geofence UI Helpers (multi titik + bypass) =====
let _arrivalPoints = []; // [{id,name,lat,lng,radiusM}]

// ✅ Pemberhentian sementara (multi titik)
let _stopPoints = []; // [{name,lat,lng,radiusM}]

function _renderArrivalPoints(){
  const box = document.getElementById('cfg_arrivalPoints');
  if (!box) return;

  const row = (p, idx)=>`
    <div class="admin-form-grid" style="align-items:end; margin-bottom:8px;">
      <div class="form-group">
        <label>Nama Titik</label>
        <input type="text" class="cfg_ap_name" value="${(p?.name||'')}" placeholder="Mis. Gate / Mess / Aula">
      </div>
      <div class="form-group">
        <label>Latitude</label>
        <input type="number" step="any" class="cfg_ap_lat" value="${p?.lat ?? ''}" placeholder="-1.234567">
      </div>
      <div class="form-group">
        <label>Longitude</label>
        <input type="number" step="any" class="cfg_ap_lng" value="${p?.lng ?? ''}" placeholder="102.345678">
      </div>
      <div class="form-group">
        <label>Radius (m)</label>
        <input type="number" step="1" class="cfg_ap_rad" value="${p?.radiusM ?? ''}" placeholder="150">
      </div>
      <div class="form-group" style="display:flex; gap:8px;">
        <button type="button" class="btn btn-secondary cfg_ap_remove" data-idx="${idx}" style="padding:10px 12px;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `;

  box.innerHTML = _arrivalPoints.length
    ? _arrivalPoints.map((p,i)=> row(p,i)).join('')
    : `<div style="font-size:12px; color:#666;">Belum ada titik tambahan.</div>`;

  box.querySelectorAll('.cfg_ap_remove').forEach(btn=>{
    btn.onclick = ()=>{
      const i = Number(btn.dataset.idx);
      _arrivalPoints.splice(i,1);
      _renderArrivalPoints();
    };
  });
}

function _collectArrivalPointsFromUI(){
  const box = document.getElementById('cfg_arrivalPoints');
  if (!box) return [];

  const pts = [];
  box.querySelectorAll('.admin-form-grid').forEach(grid=>{
    const name = String(grid.querySelector('.cfg_ap_name')?.value||'').trim();
    const lat = Number(grid.querySelector('.cfg_ap_lat')?.value);
    const lng = Number(grid.querySelector('.cfg_ap_lng')?.value);
    const radiusM = Number(grid.querySelector('.cfg_ap_rad')?.value);
    if (isFinite(lat) && isFinite(lng) && isFinite(radiusM) && radiusM>0){
      pts.push({ id: name || undefined, name: name || undefined, lat, lng, radiusM });
    }
  });
  return pts;
}

function _initArrivalPointsUI(){
  const addBtn = document.getElementById('cfg_addArrivalPoint');
  if (addBtn){
    addBtn.onclick = ()=>{
      _arrivalPoints.push({ name:'', lat:'', lng:'', radiusM:'' });
      _renderArrivalPoints();
    };
  }
  _renderArrivalPoints();
}

function _initStopPointsUI(){
  const addBtn = document.getElementById('cfg_addStopPoint');
  if (addBtn && !addBtn.__bound){
    addBtn.__bound = true;
    addBtn.onclick = ()=>{
      _stopPoints.push({ name:'', lat:'', lng:'', radiusM:'' });
      _initStopPointsUI();
    };
  }

  const box = document.getElementById('cfg_stopPoints');
  if (!box) return;

  const row = (p,i)=>`
    <div class="admin-form-grid" style="margin-top:10px; background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:10px;">
      <div class="form-group">
        <label>Nama Titik</label>
        <input type="text" data-stop-name="${i}" placeholder="Pemberhentian ${i+1}" value="${escAttr(p?.name||'')}"/>
      </div>
      <div class="form-group">
        <label>Lat</label>
        <input type="number" step="any" data-stop-lat="${i}" placeholder="-1.234" value="${escAttr(p?.lat??'')}"/>
      </div>
      <div class="form-group">
        <label>Lng</label>
        <input type="number" step="any" data-stop-lng="${i}" placeholder="102.345" value="${escAttr(p?.lng??'')}"/>
      </div>
      <div class="form-group">
        <label>Radius (m)</label>
        <input type="number" step="1" data-stop-radius="${i}" placeholder="150" value="${escAttr(p?.radiusM??'')}"/>
      </div>
      <div class="form-group" style="display:flex; align-items:flex-end;">
        <button type="button" class="btn btn-secondary" data-stop-del="${i}" style="padding:8px 10px;">
          <i class="fa-solid fa-trash"></i> Hapus
        </button>
      </div>
    </div>
  `;

  box.innerHTML = _stopPoints.length
    ? _stopPoints.map((p,i)=> row(p,i)).join('')
    : `<div style="opacity:.75; padding:10px; border:1px dashed #e5e7eb; border-radius:14px;">Belum ada titik pemberhentian.</div>`;

  box.querySelectorAll('[data-stop-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const i = Number(btn.getAttribute('data-stop-del'));
      if (!Number.isFinite(i)) return;
      _stopPoints.splice(i,1);
      _initStopPointsUI();
    });
  });
}

function _collectStopPointsFromUI(){
  const box = document.getElementById('cfg_stopPoints');
  if (!box) return [];

  const out = [];
  const rows = box.querySelectorAll('[data-stop-name]');
  for (const el of rows){
    const i = Number(el.getAttribute('data-stop-name'));
    const name = String(box.querySelector(`[data-stop-name="${i}"]`)?.value || '').trim();
    const lat = Number(box.querySelector(`[data-stop-lat="${i}"]`)?.value);
    const lng = Number(box.querySelector(`[data-stop-lng="${i}"]`)?.value);
    const radiusM = Number(box.querySelector(`[data-stop-radius="${i}"]`)?.value);
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(radiusM) || radiusM<=0) continue;
    out.push({ name: name || `Stop ${out.length+1}`, lat, lng, radiusM });
  }
  return out;
}


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
          <td>${esc(v.Unit||'')}</td>
          <td>${esc(v.Region||'')}</td>
          <td>${esc(v.Group||'')}</td>
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


let historyPager = null;
let __historySelected = new Set();

function ensureHistoryToolbar_(){
  const tab = document.getElementById('adminHistoryTab');
  if (!tab) return;
  if (tab.querySelector('.history-toolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'history-toolbar';
  toolbar.style.display = 'flex';
  toolbar.style.flexWrap = 'wrap';
  toolbar.style.gap = '8px';
  toolbar.style.alignItems = 'center';
  toolbar.style.margin = '8px 0 12px';

  toolbar.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%">
      <input id="histTripFilter" class="admin-input" placeholder="Filter TripId (opsional)..." style="min-width:220px;flex:1" />
      <select id="histTypeFilter" class="admin-input" style="min-width:160px">
        <option value="">Semua Tipe</option>
        <option value="VEHICLE">VEHICLE</option>
        <option value="PARTICIPANT">PARTICIPANT</option>
        <option value="ARRIVAL">ARRIVAL</option>
        <option value="SESSION">SESSION</option>
      </select>
      <select id="histStatusFilter" class="admin-input" style="min-width:200px">
        <option value="">Semua Status</option>
        <option value="RESTORED">RESTORED</option>
        <option value="SKIPPED_ALREADY_RESTORED">Sudah direstore</option>
        <option value="SKIPPED_DUPLICATE">Duplikat (skip)</option>
        <option value="FAILED_BAD_JSON">Error JSON</option>
        <option value="FAILED_UNKNOWN_TYPE">Tipe tidak dikenal</option>
      </select>
      <button class="btn-primary" id="btnHistRestoreSelected"><i class="fas fa-rotate-left"></i> Restore Terpilih</button>
      <button class="btn-secondary" id="btnHistRestoreTrip"><i class="fas fa-layer-group"></i> Restore Trip</button>
      <button class="btn-danger" id="btnHistRestoreAll"><i class="fas fa-triangle-exclamation"></i> Restore Semua</button>
      <button class="btn-small" id="btnHistClearSel" title="Bersihkan pilihan"><i class="fas fa-broom"></i></button>
    </div>
  `;

  const p = tab.querySelector('p');
  if (p && p.nextSibling) tab.insertBefore(toolbar, p.nextSibling);
  else tab.prepend(toolbar);

  // bind buttons (idempotent)
  $('#btnHistRestoreSelected')?.addEventListener('click', async()=>{
    const rows = Array.from(__historySelected);
    if (!rows.length) return showNotification('Tidak ada item dipilih', 'warning');
    await restoreHistory({ mode:'selected', rows });
  });
  $('#btnHistRestoreTrip')?.addEventListener('click', async()=>{
    const tripId = String($('#histTripFilter')?.value||'').trim();
    if (!tripId) return showNotification('Isi TripId dulu untuk restore per trip', 'warning');
    await restoreHistory({ mode:'trip', tripId });
  });
  $('#btnHistRestoreAll')?.addEventListener('click', async()=>{
    if (!confirm('Restore SEMUA data di History ke sheet asal? Pastikan Anda paham risikonya (duplikat akan di-skip).')) return;
    await restoreHistory({ mode:'all' });
  });
  $('#btnHistClearSel')?.addEventListener('click', ()=>{
    __historySelected.clear();
    // refresh render without re-fetch
    try{ historyPager?.render?.(); }catch{}
    loadHistory(window.__adminSessionForHistory || null, { silent:true });
  });
}

function fmtDate_(d){
  try{
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return esc(d||'');
    return dt.toLocaleString('id-ID', { timeZone:'Asia/Jakarta', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }catch(e){ return esc(d||''); }
}

function summarize_(dtype, obj){
  const t = String(dtype||'').toUpperCase();
  if (!obj) return '-';
  if (t === 'VEHICLE'){
    return `${obj.Code||''} | ${obj.Driver||''} | ${obj.Status||''} | Trip:${obj.TripId||''}`;
  }
  if (t === 'PARTICIPANT'){
    return `${obj.NIK||''} | ${obj.Nama||''} | Veh:${obj.Vehicle||obj.InVehicle||''} | Trip:${obj.TripId||''}`;
  }
  if (t === 'ARRIVAL'){
    return `${obj.NIK||''} | ${obj.ArrivalTime||''} | Trip:${obj.TripId||''}`;
  }
  if (t === 'SESSION'){
    return `${obj.UserId||''} | ${obj.SessionId||''} | Exp:${obj.Expiry||''}`;
  }
  return JSON.stringify(obj).slice(0,120);
}

function statusBadge_(s){
  const st = String(s||'').trim();
  if (!st) return `<span class="badge badge-muted">-</span>`;
  const cls =
    st === 'RESTORED' ? 'badge-success' :
    st.startsWith('SKIPPED') ? 'badge-warning' :
    st.startsWith('FAILED') ? 'badge-danger' :
    'badge-muted';
  return `<span class="badge ${cls}">${esc(st)}</span>`;
}

export async function loadHistory(session, opts={}){
  if (!session) return;
  window.__adminSessionForHistory = session;
  ensureHistoryToolbar_();

  const res = await api.adminGet(session.sessionId, 'history');
  if (!res?.success) return;

  let items = res.history || [];
  // filters (client side)
  const fTrip = String($('#histTripFilter')?.value||'').trim();
  const fType = String($('#histTypeFilter')?.value||'').trim().toUpperCase();
  const fStatus = String($('#histStatusFilter')?.value||'').trim();

  if (fTrip) items = items.filter(h=> String(h._tripId||'') === fTrip);
  if (fType) items = items.filter(h=> String(h.DataType||'').toUpperCase() === fType);
  if (fStatus) items = items.filter(h=> String(h.RestoreStatus||'') === fStatus);

  // sort newest first
  items.sort((a,b)=> new Date(b.ArchivedDate||0).getTime() - new Date(a.ArchivedDate||0).getTime());

  const container = document.querySelector('#adminHistoryTab .admin-table-container');
  const tbody = $('#adminHistoryTable');
  if (!tbody || !container) return;

  if (!historyPager){
    historyPager = createTablePager({
      containerEl: container,
      tbodyEl: tbody,
      searchPlaceholder: 'Cari Code / NIK / TripId / Status...',
      getRowText: (h)=> {
        const obj = h._dataObj || null;
        return `${h.DataType||''} ${h.RestoreStatus||''} ${h._tripId||''} ${summarize_(h.DataType, obj)}`;
      },
      renderRowHtml: (h)=> {
        const rowNum = h.Row;
        const checked = __historySelected.has(rowNum) ? 'checked' : '';
        const obj = h._dataObj || null;
        const detail = summarize_(h.DataType, obj);
        return `
          <tr>
            <td style="width:34px">
              <input type="checkbox" data-row="${rowNum}" class="histChk" ${checked}/>
            </td>
            <td>${fmtDate_(h.ArchivedDate)}</td>
            <td>${esc(h.DataType||'')}</td>
            <td style="max-width:520px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escAttr(detail)}">${esc(detail)}</td>
            <td>${statusBadge_(h.RestoreStatus)}</td>
            <td>
              <button class="btn-small" data-act="restoreOne" data-row="${rowNum}">
                <i class="fas fa-rotate-left"></i>
              </button>
            </td>
          </tr>
        `;
      }
    });

    // delegate checkbox + actions
    tbody.addEventListener('change', (e)=>{
      const cb = e.target.closest?.('.histChk');
      if (!cb) return;
      const row = Number(cb.getAttribute('data-row'));
      if (!row) return;
      if (cb.checked) __historySelected.add(row); else __historySelected.delete(row);
    });
    tbody.addEventListener('click', async(e)=>{
      const btn = e.target.closest?.('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const row = Number(btn.getAttribute('data-row'));
      if (act === 'restoreOne' && row){
        await restoreHistory({ mode:'selected', rows:[row] });
      }
    });

    // refilter on change (no extra buttons needed)
    $('#histTripFilter')?.addEventListener('input', ()=> loadHistory(session, {silent:true}));
    $('#histTypeFilter')?.addEventListener('change', ()=> loadHistory(session, {silent:true}));
    $('#histStatusFilter')?.addEventListener('change', ()=> loadHistory(session, {silent:true}));
  }

  historyPager.setData(items);

  // adjust table head if needed (add columns)
  const thead = document.querySelector('#adminHistoryTab thead tr');
  if (thead && thead.children.length === 4){
    thead.innerHTML = `
      <th></th>
      <th>Tanggal</th>
      <th>Tipe</th>
      <th>Detail</th>
      <th>Status</th>
      <th>Aksi</th>
    `;
  }
}

async function restoreHistory(payload){
  try{
    const sess = window.__adminSessionForHistory;
    if (!sess) return showNotification('Session admin tidak ditemukan', 'error');

    const res = await api.adminUpdate(sess.sessionId, 'history', 'restore', payload);
    if (!res?.success) throw new Error(res?.message || 'Gagal restore');

    showNotification(res.message || 'Restore selesai', 'success');

    // refresh
    __historySelected.clear();
    await loadHistory(sess, { silent:true });
  }catch(err){
    showNotification(err.message||'Gagal restore', 'error');
  }
}


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

  // load tujuan/kedatangan geofence (dipakai untuk Konfirmasi Kedatangan + Live Map + notifikasi)
  try{
    const tid = String(cfg.activeTripId||'').trim();
    const keyP = tid ? `destinationGeofences:${tid}` : 'destinationGeofences';
    const keyS = tid ? `destinationGeofence:${tid}` : 'destinationGeofence';
    // fallback kompatibilitas (versi lama)
    const keyP2 = tid ? `arrivalGeofences:${tid}` : 'arrivalGeofences';
    const keyS2 = tid ? `arrivalGeofence:${tid}` : 'arrivalGeofence';
    const raw = cfg[keyP] || cfg[keyS] || cfg.destinationGeofences || cfg.destinationGeofence ||
                cfg[keyP2] || cfg[keyS2] || cfg.arrivalGeofences || cfg.arrivalGeofence || '';
    if (raw){
      let g=null;
      try{ g = JSON.parse(raw); }catch{}
      if (!g && String(raw).includes(',')){
        const parts = String(raw).split(',').map(x=>x.trim());
        g = { lat:Number(parts[0]), lng:Number(parts[1]), radiusM:Number(parts[2]) };
      }

      // normalize jadi points[]
      let points = [];
      const push = (p, i)=>{
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        const radiusM = Number(p?.radiusM || p?.radius || p?.r || 0);
        if (isFinite(lat) && isFinite(lng) && isFinite(radiusM) && radiusM>0){
          points.push({ name:String(p?.name||p?.label||`Titik ${i+1}`), lat, lng, radiusM });
        }
      };
      if (Array.isArray(g)) g.forEach(push);
      else if (g && Array.isArray(g.points)) g.points.forEach(push);
      else if (g && g.lat!=null && g.lng!=null) push(g,0);

      // isi field utama dari point pertama (jika ada)
      if (points.length){
        const p0 = points[0];
        if (isFinite(p0.lat)) $('#cfg_arrivalLat') && ($('#cfg_arrivalLat').value = p0.lat);
        if (isFinite(p0.lng)) $('#cfg_arrivalLng') && ($('#cfg_arrivalLng').value = p0.lng);
        if (isFinite(p0.radiusM) && p0.radiusM>0) $('#cfg_arrivalRadius') && ($('#cfg_arrivalRadius').value = p0.radiusM);

        // titik tambahan (selain p0)
        _arrivalPoints = points.slice(1);
      } else {
        _arrivalPoints = [];
      }

      // init UI points
      _initArrivalPointsUI();

      // load bypass settings
      const byEnKey = tid ? `arrivalBypassEnabled:${tid}` : 'arrivalBypassEnabled';
      const byHashKey = tid ? `arrivalBypassPinHash:${tid}` : 'arrivalBypassPinHash';
      const enabled = String(cfg[byEnKey] || cfg.arrivalBypassEnabled || '').toLowerCase();
      const isEnabled = (enabled === 'true' || enabled === '1' || enabled === 'yes' || enabled === 'on');
      const hash = String(cfg[byHashKey] || cfg.arrivalBypassPinHash || '').trim();
      const cb = document.getElementById('cfg_arrivalBypassEnabled');
      if (cb) cb.checked = !!isEnabled;
      const hint = document.getElementById('cfg_arrivalBypassHint');
      if (hint){
        hint.textContent = hash ? 'PIN sudah tersimpan. Kosongkan field PIN jika tidak ingin mengubah.' : 'Belum ada PIN tersimpan.';
      }
    }
  }catch(e){}

  // ============================
  // ✅ Load stop points (Pemberhentian Sementara)
  // ============================
  try{
    const tid = String(cfg.activeTripId||'').trim();
    const sKey1 = tid ? `stopGeofences:${tid}` : 'stopGeofences';
    const rawS = String(cfg[sKey1] || cfg.stopGeofences || '').trim();
    _stopPoints = [];
    if (rawS){
      let s=null;
      try{ s = JSON.parse(rawS); }catch{}
      if (Array.isArray(s)){
        _stopPoints = s.map((p,i)=>({
          name: String(p?.name||p?.label||`Stop ${i+1}`),
          lat: Number(p?.lat),
          lng: Number(p?.lng),
          radiusM: Number(p?.radiusM || p?.radius || p?.r || 0)
        })).filter(p=> isFinite(p.lat) && isFinite(p.lng) && isFinite(p.radiusM) && p.radiusM>0);
      }
    }
    _initStopPointsUI();
  }catch(e){
    try{ if (!Array.isArray(_stopPoints)) _stopPoints = []; _initStopPointsUI(); }catch(_){ }
  }
  // pastikan UI multi titik & bypass tetap siap walau geofence belum ada
  try{
    if (!Array.isArray(_arrivalPoints)) _arrivalPoints = [];
    _initArrivalPointsUI();

    const tid2 = String(cfg.activeTripId||'').trim();
    const byEnKey2 = tid2 ? `arrivalBypassEnabled:${tid2}` : 'arrivalBypassEnabled';
    const byHashKey2 = tid2 ? `arrivalBypassPinHash:${tid2}` : 'arrivalBypassPinHash';
    const enabled2 = String(cfg[byEnKey2] || cfg.arrivalBypassEnabled || '').toLowerCase();
    const isEnabled2 = (enabled2 === 'true' || enabled2 === '1' || enabled2 === 'yes' || enabled2 === 'on');
    const hash2 = String(cfg[byHashKey2] || cfg.arrivalBypassPinHash || '').trim();

    const cb2 = document.getElementById('cfg_arrivalBypassEnabled');
    if (cb2) cb2.checked = !!isEnabled2;

    const hint2 = document.getElementById('cfg_arrivalBypassHint');
    if (hint2){
      hint2.textContent = hash2 ? 'PIN sudah tersimpan. Kosongkan field PIN jika tidak ingin mengubah.' : 'Belum ada PIN tersimpan.';
    }
  }catch(e){}



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
  const activeTripId = $('#cfg_activeTrip')?.value.trim();

  const data = {
    appTitle: $('#cfg_appTitle')?.value.trim(),
    eventName: $('#cfg_eventName')?.value.trim(),
    eventSub: $('#cfg_eventSub')?.value.trim(),
    activeTripId
  };

  // geofence per trip (single + multi)
  const lat = Number($('#cfg_arrivalLat')?.value);
  const lng = Number($('#cfg_arrivalLng')?.value);
  const radiusM = Number($('#cfg_arrivalRadius')?.value);

  // titik utama (dari field utama)
  const points = [];
  if (isFinite(lat) && isFinite(lng) && isFinite(radiusM) && radiusM > 0){
    points.push({ name:'Utama', lat, lng, radiusM });
  }

  // titik tambahan (dari UI)
  try{
    const extra = _collectArrivalPointsFromUI();
    extra.forEach(p=> points.push(p));
  }catch(e){}

  // ✅ Simpan sebagai "Tujuan/Kedatangan" (dipakai Arrival + Live Map) + tetap simpan key lama utk kompatibilitas
  const p0 = points[0] || null;
  if (activeTripId){
    if (points.length){
      data[`destinationGeofences:${activeTripId}`] = JSON.stringify(points);
      if (p0) data[`destinationGeofence:${activeTripId}`] = JSON.stringify({ name:'Tujuan', lat:p0.lat, lng:p0.lng, radiusM:p0.radiusM });

      // kompatibilitas versi lama (arrival)
      data[`arrivalGeofences:${activeTripId}`] = JSON.stringify(points);
      if (p0) data[`arrivalGeofence:${activeTripId}`] = JSON.stringify({ lat:p0.lat, lng:p0.lng, radiusM:p0.radiusM });
    }
  } else {
    if (points.length){
      data['destinationGeofences'] = JSON.stringify(points);
      if (p0) data['destinationGeofence'] = JSON.stringify({ name:'Tujuan', lat:p0.lat, lng:p0.lng, radiusM:p0.radiusM });

      data['arrivalGeofences'] = JSON.stringify(points);
      if (p0) data['arrivalGeofence'] = JSON.stringify({ lat:p0.lat, lng:p0.lng, radiusM:p0.radiusM });
    }
  }

  // bypass settings
  const byEnabled = !!document.getElementById('cfg_arrivalBypassEnabled')?.checked;
  const pin = String(document.getElementById('cfg_arrivalBypassPin')?.value||'').trim();

  if (activeTripId){
    data[`arrivalBypassEnabled:${activeTripId}`] = byEnabled ? 'TRUE' : 'FALSE';
    if (pin){
      data[`arrivalBypassPin:${activeTripId}`] = pin; // backend akan hash & simpan sebagai PinHash
    }
  } else {
    data['arrivalBypassEnabled'] = byEnabled ? 'TRUE' : 'FALSE';
    if (pin){
      data['arrivalBypassPin'] = pin;
    }
  }

  // (Destination fields dihapus: destinationGeofence sudah mengikuti points di atas)

  // ============================
  // ✅ Stop geofences (multi titik)
  // Key: stopGeofences:<TripId> (array)
  // ============================
  let stops = [];
  try{ stops = _collectStopPointsFromUI(); }catch(e){ stops = []; }
  if (activeTripId){
    if (stops.length) data[`stopGeofences:${activeTripId}`] = JSON.stringify(stops);
  } else {
    if (stops.length) data['stopGeofences'] = JSON.stringify(stops);
  }

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
