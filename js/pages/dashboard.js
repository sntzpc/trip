import * as api from '../core/api.js';
import { $ } from '../core/ui.js';
import { createTablePager } from '../core/table_pager.js';

let arrivedPager = null;

export async function loadDashboard(session){
  const tripId = session?.activeTripId || '';

  const res = await api.getDashboard(session.sessionId, tripId);
  const d = res.data || {};

  $('#totalParticipants').textContent = d.totalParticipants||0;
  $('#totalVehicles').textContent = d.totalVehicles||0;
  $('#totalArrived').textContent = d.totalArrived||0;
  $('#totalOnRoad').textContent = d.totalOnRoad||0;

  renderBreakdown(d.breakdown || {});
  await renderArrivedTable(session); // ✅ baru
}

function renderBreakdown(breakdown){
  const keys = Object.keys(breakdown);
  const mapIds = [
    { key: 'staff', id: 'staffArrived' },
    { key: 'istri', id: 'wifeArrived' },
    { key: 'anak', id: 'childArrived' }
  ];

  mapIds.forEach(({key,id})=>{
    if ($('#'+id)) $('#'+id).textContent = breakdown[key] ?? 0;
  });

  const container = $('#arrivalDetails .summary-cards');
  if (!container) return;

  container.querySelectorAll('[data-dyn="1"]').forEach(el=>el.remove());

  keys
    .filter(k => !mapIds.some(m=>m.key===k))
    .forEach(k=>{
      const card = document.createElement('div');
      card.className = 'summary-card';
      card.dataset.dyn = '1';
      card.innerHTML = `<h4>${escapeHtml(k)}</h4><p>${breakdown[k]||0}</p>`;
      container.appendChild(card);
    });
}

// ===== Arrived table on Dashboard (paging + smart search) =====
async function renderArrivedTable(session){
  const tripId = session?.activeTripId || '';
  const res = await api.getParticipants(session.sessionId, tripId, 'arrived');
  const list = res.participants || [];

  const container = document.querySelector('#arrivalDetails .participant-table-container');
  const tbody = document.querySelector('#arrivedTable tbody');
  if (!container || !tbody) return;

  if (!arrivedPager){
    arrivedPager = createTablePager({
      containerEl: container,
      tbodyEl: tbody,
      searchPlaceholder: 'Cari nama / NIK / kendaraan / hubungan...',
      getRowText: (p)=> `${p.Nama||''} ${p.NIK||''} ${p.Vehicle||''} ${p.Relationship||''} ${p.Region||''} ${p.Estate||''}`,
      renderRowHtml: (p)=> {
        return `
          <tr>
            <td>${escapeHtml(p.Nama||'-')}</td>
            <td>${escapeHtml(p.NIK||'-')}</td>
            <td>${escapeHtml(p.Vehicle||'-')}</td>
            <td>${fmtDt(p.ArrivalTime||'-')}</td>
            <td><span class="badge success">Tiba</span></td>
          </tr>
        `;
      }
    });
  }

  arrivedPager.setData(list);
}

function fmtDt(v){
  try{
    if (!v || v === '-') return '-';
    return new Date(v).toLocaleString('id-ID');
  }catch{ return String(v||'-'); }
}

// ===== Region details (Anda sudah punya) =====
export async function showRegionDetailsUI(session){
  const tripId = session?.activeTripId || '';
  const res = await api.getParticipants(session.sessionId, tripId, 'all');
  const list = res.participants || [];

  const byRegion = {};
  list.forEach(p=>{
    const r = String(p.Region||'Unknown');
    byRegion[r] = (byRegion[r]||0) + 1;
  });

  const box = document.getElementById('regionCards');
  const pane = document.getElementById('regionDetails');
  if (!box || !pane) return;

  box.innerHTML = Object.entries(byRegion)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v])=> `<div class="region-card"><h4>${escapeHtml(k)}</h4><p>${v}</p></div>`)
    .join('');

  pane.style.display = '';
}

export function hideRegionDetailsUI(){
  const pane = document.getElementById('regionDetails');
  if (pane) pane.style.display = 'none';
}

// ===== Vehicle details (NEW) =====
// Dipanggil dari app.js via window.showVehicleDetails()
export async function showVehicleDetailsUI(session){
  const tripId = session?.activeTripId || '';

  // ambil kendaraan + peserta untuk hitung arrived per kendaraan
  const vRes = await api.adminGet(session.sessionId, 'vehicles', tripId);
  const pRes = await api.getParticipants(session.sessionId, tripId, 'all');

  const vehicles = vRes.vehicles || [];
  const parts = pRes.participants || [];

  const arrivedByNik = {};
  parts.forEach(p=>{
    const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
    arrivedByNik[String(p.NIK)] = arrived;
  });

  const pane = document.getElementById('vehicleDetails');
  const listEl = document.getElementById('vehicleList');
  if (!pane || !listEl) return;

  // render kartu kendaraan
  listEl.innerHTML = vehicles.map(v=>{
    const passengers = String(v.Passengers||'').split(',').map(s=>s.trim()).filter(Boolean);
    const total = passengers.length;
    const arrivedCount = passengers.filter(n=> arrivedByNik[String(n)]).length;

    return `
      <div class="vehicle-card" style="background: var(--light-color); border-left:4px solid var(--secondary-color);">
        <h4>${escapeHtml(v.Code||'-')} <small style="color:#666;font-weight:600;">(${escapeHtml(v.Type||'')})</small></h4>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;">
          <span class="vehicle-status status-waiting">Status: ${escapeHtml(v.Status||'')}</span>
          <span class="vehicle-status status-arrived">Tiba: ${arrivedCount}/${total}</span>
          <span class="vehicle-status status-ontheway">Kapasitas: ${escapeHtml(v.Capacity||'-')}</span>
        </div>
        <div style="margin-top:10px; color:#555; font-size:13px;">
          Driver: <b>${escapeHtml(v.Driver||'-')}</b><br/>
          TripId: <b>${escapeHtml(v.TripId||'-')}</b>
        </div>
      </div>
    `;
  }).join('') || `<p class="empty-text">Belum ada kendaraan.</p>`;

  pane.style.display = '';
}

export function hideVehicleDetailsUI(){
  const pane = document.getElementById('vehicleDetails');
  if (pane) pane.style.display = 'none';
}

// expose untuk app.js
window.__showVehicleDetailsUI = showVehicleDetailsUI;
window.__hideVehicleDetailsUI = hideVehicleDetailsUI;

function escapeHtml(str){
  return String(str ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
