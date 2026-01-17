import * as api from '../core/api.js';
import { $ } from '../core/ui.js';
import { createTablePager } from '../core/table_pager.js';

let arrivedPager = null;

// ===== Drilldown modal (STEP: Region -> Unit -> Table) =====
let drill = null;

function ensureDrillModal(){
  if (drill) return drill;

  const wrap = document.createElement('div');
  wrap.id = 'dashDrillModal';
  wrap.style.position = 'fixed';
  wrap.style.inset = '0';
  wrap.style.zIndex = '5000';
  wrap.style.display = 'none';
  wrap.style.background = 'rgba(0,0,0,.45)';
  wrap.style.backdropFilter = 'blur(2px)';

  wrap.innerHTML = `
    <div style="position:absolute; inset:12px; max-width:1100px; margin:auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 12px 30px rgba(0,0,0,.18); display:flex; flex-direction:column;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid #eee;">
        <div>
          <div id="ddTitle" style="font-weight:900; font-size:16px;">Detail</div>
          <div id="ddSub" style="font-size:12px; color:#666; margin-top:2px;">—</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="ddBack" type="button" style="display:none; padding:10px 12px; border:2px solid #ddd; border-radius:10px; background:#fff; font-weight:800; cursor:pointer;">Kembali</button>
          <button id="ddClose" type="button" style="padding:10px 12px; border:2px solid #ddd; border-radius:10px; background:#fff; font-weight:800; cursor:pointer;">Tutup</button>
        </div>
      </div>

      <div style="padding:12px; flex:1; min-height:0;">
        <!-- STEP CARDS -->
        <div id="ddCardsWrap" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:10px; overflow:auto; max-height:240px; padding:4px;">
        </div>

        <!-- TABLE (muncul di step 2) -->
        <div id="ddTableBlock" style="display:none; margin-top:12px; border:1px solid #eee; border-radius:14px; overflow:hidden; min-height:0;">
          <div style="padding:10px 12px; font-weight:900; border-bottom:1px solid #eee;">Daftar Peserta</div>
          <div class="participant-table-container" id="ddTableWrap" style="padding:10px; min-height:0;">
            <table class="participant-table" style="width:100%;">
              <thead>
                <tr>
                  <th style="width:64px;">No.</th>
                  <th>Nama</th>
                  <th>NIK</th>
                  <th>Hubungan</th>
                  <th style="width:160px;">Kendaraan</th>
                </tr>
              </thead>
              <tbody id="ddTbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  // close by backdrop click
  wrap.addEventListener('click', (e)=>{
    if (e.target === wrap) hideDrill();
  });

  document.body.appendChild(wrap);
  wrap.querySelector('#ddClose').addEventListener('click', hideDrill);

  drill = {
    el: wrap,
    titleEl: wrap.querySelector('#ddTitle'),
    subEl: wrap.querySelector('#ddSub'),
    backBtn: wrap.querySelector('#ddBack'),
    cardsWrap: wrap.querySelector('#ddCardsWrap'),
    tableBlock: wrap.querySelector('#ddTableBlock'),
    tableWrap: wrap.querySelector('#ddTableWrap'),
    tbodyEl: wrap.querySelector('#ddTbody'),
    pager: null,

    // state
    step: 0,           // 0=region cards, 1=unit cards, 2=table
    titleBase: 'Detail',
    all: [],
    selectedRegion: '',
    selectedUnit: ''
  };

  drill.backBtn.addEventListener('click', ()=>{
    if (drill.step === 2){
      drill.step = 1; // balik ke unit cards
      drill.selectedUnit = '';
      renderDrill();
      return;
    }
    if (drill.step === 1){
      drill.step = 0; // balik ke region cards
      drill.selectedRegion = '';
      renderDrill();
      return;
    }
  });

  return drill;
}

function showDrill(title, list){
  ensureDrillModal();
  drill.titleBase = title;
  drill.titleEl.textContent = title;
  drill.subEl.textContent = '—';

  drill.all = Array.isArray(list) ? list : [];
  drill.step = 0;
  drill.selectedRegion = '';
  drill.selectedUnit = '';

  drill.el.style.display = 'block';
  renderDrill();
}

function hideDrill(){
  if (!drill) return;
  drill.el.style.display = 'none';
}

// ---------- Card helpers ----------
function groupCount(list, keyFn){
  const m = {};
  for (const x of list){
    const k = String(keyFn(x) || 'Unknown').trim() || 'Unknown';
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function cardHtml(label, count, sub=''){
  return `
    <button type="button"
      style="
        text-align:left;
        padding:12px 12px;
        border:2px solid #eee;
        border-radius:14px;
        background:#fff;
        cursor:pointer;
        font-weight:900;
        box-shadow:0 4px 10px rgba(0,0,0,.06);
      ">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
        <div style="min-width:0;">
          <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(label)}</div>
          ${sub ? `<div style="font-size:12px; font-weight:700; color:#666; margin-top:2px;">${escapeHtml(sub)}</div>` : ``}
        </div>
        <div style="background:#ecf0f1; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:900;">${count}</div>
      </div>
    </button>
  `;
}

function renderCards(items, onClick){
  // items: [{label,count,sub,dataKey}]
  drill.cardsWrap.innerHTML = items.map(it => cardHtml(it.label, it.count, it.sub)).join('')
    || `<div style="color:#777;padding:8px;">Tidak ada data.</div>`;

  Array.from(drill.cardsWrap.querySelectorAll('button')).forEach((btn, idx)=>{
    btn.addEventListener('click', ()=> onClick(items[idx]));
  });
}

// ---------- Drill renderer ----------
function renderDrill(){
  if (!drill) return;

  const all = drill.all || [];
  const step = drill.step;

  // Back button state
  drill.backBtn.style.display = (step === 0) ? 'none' : 'inline-block';

  // Hide table by default
  drill.tableBlock.style.display = (step === 2) ? '' : 'none';

  if (step === 0){
    // REGION cards
    drill.titleEl.textContent = drill.titleBase;
    const byRegion = groupCount(all, p => p.Region);
    const regions = Object.entries(byRegion)
      .sort((a,b)=>b[1]-a[1])
      .map(([label,count])=>({ label, count, sub:'Klik untuk lihat Unit', key: label }));

    drill.subEl.textContent = `${all.length} peserta • pilih Region`;
    renderCards(regions, (it)=>{
      drill.selectedRegion = it.key;
      drill.step = 1;
      renderDrill();
    });
    return;
  }

  if (step === 1){
    // UNIT cards in selected region
    const region = drill.selectedRegion || '';
    const inRegion = all.filter(p => String(p.Region||'Unknown') === String(region));

    drill.titleEl.textContent = `${drill.titleBase} • ${region}`;
    drill.subEl.textContent = `${inRegion.length} peserta • pilih Unit`;

    const byUnit = groupCount(inRegion, p => p.Estate);
    const units = Object.entries(byUnit)
      .sort((a,b)=>b[1]-a[1])
      .map(([label,count])=>({ label, count, sub:'Klik untuk lihat daftar peserta', key: label }));

    renderCards(units, (it)=>{
      drill.selectedUnit = it.key;
      drill.step = 2;
      renderDrill();
    });
    return;
  }

  // step === 2 => TABLE
  const region = drill.selectedRegion || '';
  const unit = drill.selectedUnit || '';

  const inRegion = all.filter(p => String(p.Region||'Unknown') === String(region));
  const inUnit = inRegion.filter(p => String(p.Estate||'Unknown') === String(unit));

  drill.titleEl.textContent = `${drill.titleBase} • ${region} • ${unit}`;
  drill.subEl.textContent = `${inUnit.length} peserta`;

  // ensure pager
  if (!drill.pager){
    drill.pager = createTablePager({
      containerEl: drill.tableWrap,
      tbodyEl: drill.tbodyEl,
      searchPlaceholder: 'Cari nama / NIK / hubungan / kendaraan...',
      getRowText: (p)=> `${p.Nama||''} ${p.NIK||''} ${p.Relationship||p.Category||''} ${p.Vehicle||''}`,
      renderRowHtml: (p, idx)=> `
        <tr>
          <td>${idx}</td>
          <td>${escapeHtml(p.Nama||'-')}</td>
          <td>${escapeHtml(p.NIK||'-')}</td>
          <td>${escapeHtml(p.Relationship||p.Category||'-')}</td>
          <td>${escapeHtml(p.Vehicle||'-')}</td>
        </tr>
      `
    });
  }
  drill.pager.setData(inUnit);
}

// ===== Main Dashboard =====
export async function loadDashboard(session){
  const tripId = session?.activeTripId || '';

  const res = await api.getDashboard(session.sessionId, tripId);
  const d = res.data || {};

  $('#totalParticipants').textContent = d.totalParticipants||0;
  $('#totalVehicles').textContent = d.totalVehicles||0;
  $('#totalArrived').textContent = d.totalArrived||0;
  $('#totalOnRoad').textContent = d.totalOnRoad||0;

  renderBreakdown(d.breakdown || {});
  await renderArrivedTable(session);

  bindStatCardClicks(session);
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
      searchPlaceholder: 'Cari nama / NIK / hubungan / region / unit / kendaraan...',
      getRowText: (p)=> `${p.Nama||''} ${p.NIK||''} ${p.Relationship||''} ${p.Region||''} ${p.Estate||''} ${p.Vehicle||''}`,
      renderRowHtml: (p, idx)=> {
        return `
          <tr>
            <td>${idx}</td>
            <td>${escapeHtml(p.Nama||'-')}</td>
            <td>${escapeHtml(p.NIK||'-')}</td>
            <td>${escapeHtml(p.Relationship||p.Category||'-')}</td>
            <td>${escapeHtml(p.Region||'-')}</td>
            <td>${escapeHtml(p.Estate||'-')}</td>
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

// ===== Klik kartu stats -> Drilldown =====
async function bindStatCardClicks(session){
  const cards = document.querySelectorAll('.stats-cards .stat-card');
  if (!cards || cards.length < 4) return;

  async function fetchAllParticipants(){
    const tripId = session?.activeTripId || '';
    const res = await api.getParticipants(session.sessionId, tripId, 'all');
    return res.participants || [];
  }

  async function fetchVehicles(){
    const tripId = session?.activeTripId || '';
    const vRes = await api.adminGet(session.sessionId, 'vehicles', tripId);
    return vRes.vehicles || [];
  }

  // helper bind once
  const bindOnce = (el, fn)=>{
    if (!el || el.dataset.ddHooked) return;
    el.dataset.ddHooked = '1';
    el.style.cursor = 'pointer';
    el.addEventListener('click', fn);
  };

  // 0: Total Peserta -> drill region/unit/table (pakai modal drill existing)
  bindOnce(cards[0], async ()=>{
    const parts = await fetchAllParticipants();
    showDrill('Total Peserta', parts);
  });

  // 1: Kendaraan -> tampilkan KARTU KENDARAAN -> klik => tabel penumpang
  bindOnce(cards[1], async ()=>{
    await showVehicleDrill(session);
  });

  // 2: Telah Tiba -> peserta arrived
  bindOnce(cards[2], async ()=>{
    const parts = await fetchAllParticipants();
    const subset = parts.filter(p => (p.Arrived===true || String(p.Arrived).toLowerCase()==='true'));
    showDrill('Peserta Telah Tiba', subset);
  });

  // 3: Dalam Perjalanan -> peserta (kendaraan on_the_way) dan belum arrived
  bindOnce(cards[3], async ()=>{
    const [parts, vehicles] = await Promise.all([fetchAllParticipants(), fetchVehicles()]);
    const onRoadCodes = new Set(
      vehicles
        .filter(v => String(v.Status||'').toLowerCase() === 'on_the_way')
        .map(v => String(v.Code||'').trim())
        .filter(Boolean)
    );

    const subset = parts.filter(p=>{
      const vc = String(p.Vehicle||'').trim();
      if (!vc || !onRoadCodes.has(vc)) return false;
      const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
      return !arrived; // ✅ hanya yang belum tiba
    });

    showDrill('Peserta Dalam Perjalanan', subset); // ✅ tetap Region -> Unit -> Table
  });
}

// =========================================================
// ✅ VEHICLE DRILLDOWN (Kendaraan cards -> Passenger table)
// =========================================================
let vdrill = null;

function ensureVehicleModal(){
  if (vdrill) return vdrill;

  const wrap = document.createElement('div');
  wrap.id = 'dashVehicleModal';
  wrap.style.position = 'fixed';
  wrap.style.inset = '0';
  wrap.style.zIndex = '5100';
  wrap.style.display = 'none';
  wrap.style.background = 'rgba(0,0,0,.45)';
  wrap.style.backdropFilter = 'blur(2px)';

  wrap.innerHTML = `
    <div style="position:absolute; inset:12px; max-width:1100px; margin:auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 12px 30px rgba(0,0,0,.18); display:flex; flex-direction:column;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid #eee;">
        <div>
          <div id="vdTitle" style="font-weight:900; font-size:16px;">Detail Kendaraan</div>
          <div id="vdSub" style="font-size:12px; color:#666; margin-top:2px;">—</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="vdBack" type="button" style="display:none; padding:10px 12px; border:2px solid #ddd; border-radius:10px; background:#fff; font-weight:800; cursor:pointer;">Kembali</button>
          <button id="vdClose" type="button" style="padding:10px 12px; border:2px solid #ddd; border-radius:10px; background:#fff; font-weight:800; cursor:pointer;">Tutup</button>
        </div>
      </div>

      <div style="padding:12px; flex:1; min-height:0;">
        <!-- VEHICLE CARDS -->
        <div id="vdCardsWrap" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px; overflow:auto; max-height:260px; padding:4px;">
        </div>

        <!-- PASSENGER TABLE -->
        <div id="vdTableBlock" style="display:none; margin-top:12px; border:1px solid #eee; border-radius:14px; overflow:hidden; min-height:0;">
          <div style="padding:10px 12px; font-weight:900; border-bottom:1px solid #eee;">
            Daftar Penumpang • <span id="vdVehLabel">-</span>
          </div>
          <div class="participant-table-container" id="vdTableWrap" style="padding:10px; min-height:0;">
            <table class="participant-table" style="width:100%;">
              <thead>
                <tr>
                  <th style="width:64px;">No.</th>
                  <th>Nama</th>
                  <th>NIK</th>
                  <th>Hubungan</th>
                  <th>Region</th>
                  <th>Unit</th>
                  <th style="width:120px;">Status</th>
                </tr>
              </thead>
              <tbody id="vdTbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  // close by backdrop click
  wrap.addEventListener('click', (e)=>{
    if (e.target === wrap) hideVehicleDrill();
  });

  document.body.appendChild(wrap);
  wrap.querySelector('#vdClose').addEventListener('click', hideVehicleDrill);

  vdrill = {
    el: wrap,
    titleEl: wrap.querySelector('#vdTitle'),
    subEl: wrap.querySelector('#vdSub'),
    backBtn: wrap.querySelector('#vdBack'),
    cardsWrap: wrap.querySelector('#vdCardsWrap'),
    tableBlock: wrap.querySelector('#vdTableBlock'),
    tableWrap: wrap.querySelector('#vdTableWrap'),
    tbodyEl: wrap.querySelector('#vdTbody'),
    vehLabelEl: wrap.querySelector('#vdVehLabel'),
    pager: null,

    // state
    step: 0, // 0=vehicle cards, 1=passenger table
    vehicles: [],
    participants: [],
    selectedCode: ''
  };

  vdrill.backBtn.addEventListener('click', ()=>{
    if (vdrill.step === 1){
      vdrill.step = 0;
      vdrill.selectedCode = '';
      renderVehicleDrill();
    }
  });

  return vdrill;
}

function hideVehicleDrill(){
  if (!vdrill) return;
  vdrill.el.style.display = 'none';
}

function renderVehicleCards(items, onClick){
  vdrill.cardsWrap.innerHTML = items.map(it => `
    <button type="button"
      style="
        text-align:left;
        padding:12px 12px;
        border:2px solid #eee;
        border-radius:14px;
        background:#fff;
        cursor:pointer;
        font-weight:900;
        box-shadow:0 4px 10px rgba(0,0,0,.06);
      ">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🚐 ${escapeHtml(it.code)}</div>
          <div style="font-size:12px; font-weight:800; color:#444; margin-top:4px;">
            ${escapeHtml(it.type || '-')} • Kap: ${escapeHtml(String(it.capacity ?? '-'))} • Penumpang: ${escapeHtml(String(it.passengerCount))}
          </div>
          <div style="font-size:12px; font-weight:700; color:#666; margin-top:4px;">
            Driver: ${escapeHtml(it.driver || '-')}${it.driverPhone ? ` • ${escapeHtml(it.driverPhone)}` : ``}
          </div>
        </div>
        <div style="background:#ecf0f1; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:900;">
          ${escapeHtml(it.statusLabel)}
        </div>
      </div>
    </button>
  `).join('') || `<div style="color:#777;padding:8px;">Tidak ada kendaraan.</div>`;

  Array.from(vdrill.cardsWrap.querySelectorAll('button')).forEach((btn, idx)=>{
    btn.addEventListener('click', ()=> onClick(items[idx]));
  });
}

function renderVehicleDrill(){
  if (!vdrill) return;

  const step = vdrill.step;
  vdrill.backBtn.style.display = (step === 0) ? 'none' : 'inline-block';
  vdrill.tableBlock.style.display = (step === 1) ? '' : 'none';

  if (step === 0){
    vdrill.titleEl.textContent = 'Detail Kendaraan';
    vdrill.subEl.textContent = `${vdrill.vehicles.length} kendaraan • klik untuk lihat penumpang`;

    const items = (vdrill.vehicles || []).map(v=>{
      const code = String(v.Code||'').trim();
      const cap = v.Capacity ?? '';
      const passengersCsv = String(v.Passengers||'').trim();
      const passengerCountByCsv = passengersCsv ? passengersCsv.split(',').map(x=>x.trim()).filter(Boolean).length : 0;

      // fallback count by participant Vehicle field (lebih “nyata” di UI)
      const passengerCountByParts = (vdrill.participants || []).filter(p => String(p.Vehicle||'').trim() === code).length;
      const passengerCount = Math.max(passengerCountByCsv, passengerCountByParts);

      const st = String(v.Status||'').toLowerCase();
      const statusLabel = st === 'on_the_way' ? 'On Road' : (st === 'arrived' ? 'Arrived' : 'Waiting');

      return {
        code,
        type: v.Type || '',
        capacity: cap,
        driver: v.Driver || '',
        driverPhone: v.DriverPhone || '',
        passengerCount,
        statusLabel
      };
    }).sort((a,b)=>{
      // On Road dulu, lalu by passengerCount desc
      const p = (x)=> (x.statusLabel==='On Road' ? 0 : (x.statusLabel==='Waiting' ? 1 : 2));
      const d = p(a) - p(b);
      if (d !== 0) return d;
      return (b.passengerCount||0) - (a.passengerCount||0);
    });

    renderVehicleCards(items, (it)=>{
      vdrill.selectedCode = it.code;
      vdrill.step = 1;
      renderVehicleDrill();
    });

    return;
  }

  // step 1: passenger table
  const code = vdrill.selectedCode || '';
  vdrill.titleEl.textContent = `Detail Kendaraan • ${code}`;
  vdrill.vehLabelEl.textContent = code;

  const rows = (vdrill.participants || []).filter(p => String(p.Vehicle||'').trim() === code);

  vdrill.subEl.textContent = `${rows.length} penumpang`;

  if (!vdrill.pager){
    vdrill.pager = createTablePager({
      containerEl: vdrill.tableWrap,
      tbodyEl: vdrill.tbodyEl,
      searchPlaceholder: 'Cari nama / NIK / hubungan / region / unit...',
      getRowText: (p)=> `${p.Nama||''} ${p.NIK||''} ${p.Relationship||p.Category||''} ${p.Region||''} ${p.Estate||''}`,
      renderRowHtml: (p, idx)=> {
        const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
        return `
          <tr>
            <td>${idx}</td>
            <td>${escapeHtml(p.Nama||'-')}</td>
            <td>${escapeHtml(p.NIK||'-')}</td>
            <td>${escapeHtml(p.Relationship||p.Category||'-')}</td>
            <td>${escapeHtml(p.Region||'-')}</td>
            <td>${escapeHtml(p.Estate||'-')}</td>
            <td>${arrived ? `<span class="badge success">Tiba</span>` : `<span class="badge warning">On Road</span>`}</td>
          </tr>
        `;
      }
    });
  }

  vdrill.pager.setData(rows);
}

async function showVehicleDrill(session){
  ensureVehicleModal();

  const tripId = session?.activeTripId || '';
  const [vRes, pRes] = await Promise.all([
    api.adminGet(session.sessionId, 'vehicles', tripId),
    api.getParticipants(session.sessionId, tripId, 'all')
  ]);

  vdrill.vehicles = vRes.vehicles || [];
  vdrill.participants = pRes.participants || [];

  vdrill.step = 0;
  vdrill.selectedCode = '';
  vdrill.el.style.display = 'block';
  renderVehicleDrill();
}

// optional: expose untuk tombol lain (sudah disiapkan di app.js)
window.__showVehicleDetailsUI = async (session)=> showVehicleDrill(session);
window.__hideVehicleDetailsUI = ()=> hideVehicleDrill();

// ===== Region details lama (tetap) =====
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

function escapeHtml(str){
  return String(str ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
