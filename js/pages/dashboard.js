import * as api from '../core/api.js';
import { $, showNotification } from '../core/ui.js';
import { createTablePager } from '../core/table_pager.js';

let arrivedPager = null;

// ===== Drilldown modal (STEP: Region -> Unit -> Table) =====
let drill = null;

// ============================
// ✅ Modal Styles (inject once)
// ============================
let _ddStyleInjected = false;
function injectDrillStyles(){
  if (_ddStyleInjected) return;
  _ddStyleInjected = true;

  const st = document.createElement('style');
  st.id = 'dashDrillStyles';
  st.textContent = `
    .dd-backdrop{
      position:fixed; inset:0; z-index:5000;
      display:none;
      background:rgba(0,0,0,.45);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      padding:12px;
    }
    .dd-modal{
      position:relative;
      max-width:1100px;
      margin:auto;
      height: min(760px, calc(100dvh - 24px));
      background:#fff;
      border-radius:18px;
      overflow:hidden;
      box-shadow:0 18px 50px rgba(0,0,0,.22);
      display:flex;
      flex-direction:column;
    }
    .dd-head{
      position:sticky; top:0;
      background:linear-gradient(180deg,#ffffff 0%, #fbfbfb 100%);
      border-bottom:1px solid #eee;
      padding:12px 14px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      z-index:2;
    }
    .dd-title{
      font-weight:1000;
      font-size:16px;
      letter-spacing:.2px;
      display:flex;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
    }
    .dd-sub{
      font-size:12px;
      color:#6b7280;
      margin-top:3px;
      font-weight:700;
    }
    .dd-actions{
      display:flex; gap:8px; align-items:center;
    }
    .dd-btn{
      padding:10px 12px;
      border:2px solid #e5e7eb;
      border-radius:12px;
      background:#fff;
      font-weight:900;
      cursor:pointer;
      display:inline-flex;
      align-items:center;
      gap:8px;
      user-select:none;
      touch-action: manipulation;
    }
    .dd-btn:active{ transform: translateY(1px); }
    .dd-body{
      padding:12px;
      flex:1;
      min-height:0;
      display:flex;
      flex-direction:column;
      gap:12px;
    }
    .dd-breadcrumb{
      font-size:12px;
      color:#374151;
      font-weight:800;
      background:#f8fafc;
      border:1px solid #eef2f7;
      padding:10px 12px;
      border-radius:14px;
    }
    .dd-cards{
      display:grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap:10px;
      overflow:auto;
      padding:4px;
      max-height:260px;
      border-radius:14px;
      background:linear-gradient(180deg,#fff 0%, #fafafa 100%);
      border:1px solid #eef2f7;
    }
    .dd-card{
      text-align:left;
      padding:12px 12px;
      border:1px solid #eef2f7;
      border-radius:14px;
      background:#fff;
      cursor:pointer;
      box-shadow:0 6px 14px rgba(0,0,0,.06);
      transition:transform .08s ease, box-shadow .08s ease;
    }
    .dd-card:hover{
      box-shadow:0 10px 22px rgba(0,0,0,.10);
      transform:translateY(-1px);
    }
    .dd-card-top{
      display:flex; justify-content:space-between; gap:10px; align-items:center;
    }
    .dd-card-label{
      font-weight:1000;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .dd-pill{
      background:#eef2ff;
      color:#1e3a8a;
      padding:6px 12px;
      border-radius:999px;
      font-size:12px;
      font-weight:1000;
      white-space:nowrap;
    }
    .dd-card-sub{
      font-size:12px;
      font-weight:800;
      color:#6b7280;
      margin-top:6px;
    }
    .dd-tableBlock{
      border:1px solid #eef2f7;
      border-radius:16px;
      overflow:hidden;
      min-height:0;
      background:#fff;

      /* ✅ penting: biar tabel bisa ambil tinggi & scroll */
      display:flex;
      flex-direction:column;
      flex: 1 1 auto;
    }
    .dd-tableHead{
      padding:10px 12px;
      font-weight:1000;
      border-bottom:1px solid #eef2f7;
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      flex-wrap:wrap;
    }
    .dd-tableWrap{
      padding:10px;
      min-height:0;

      /* ✅ scroll area */
      overflow:auto;
      -webkit-overflow-scrolling: touch;
      flex: 1 1 auto;
    }

    /* ✅ Mobile: modal jadi "bottom sheet" nyaman */
    @media (max-width: 768px){
      .dd-backdrop{ padding:0; }
      .dd-modal{
        max-width:none;
        width:100%;
        height: calc(100dvh);
        border-radius:18px 18px 0 0;
        margin: 0;
        position:absolute;
        left:0; right:0; bottom:0;
      }
      .dd-cards{
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        max-height:280px;
      }
      .dd-btn{ padding:10px 10px; border-radius:12px; }
    }

    /* Safe area iOS */
    @supports (padding: max(0px)) {
      .dd-modal{
        padding-bottom: max(0px, env(safe-area-inset-bottom));
      }
    }
  `;
  document.head.appendChild(st);
}

function ensureDrillModal(){
  injectDrillStyles();
  if (drill) return drill;

  const wrap = document.createElement('div');
  wrap.id = 'dashDrillModal';
  wrap.className = 'dd-backdrop';
  wrap.style.display = 'none';

  wrap.innerHTML = `
    <div class="dd-modal" role="dialog" aria-modal="true">
      <div class="dd-head">
        <div style="min-width:0;">
          <div class="dd-title">
            <span id="ddTitle">Detail</span>
          </div>
          <div id="ddSub" class="dd-sub">—</div>
        </div>

        <div class="dd-actions">
          <button id="ddBack" type="button" class="dd-btn" style="display:none;">
            <i class="fas fa-arrow-left"></i><span>Kembali</span>
          </button>
          <button id="ddClose" type="button" class="dd-btn">
            <i class="fas fa-xmark"></i><span>Tutup</span>
          </button>
        </div>
      </div>

      <div class="dd-body">
        <div id="ddCrumb" class="dd-breadcrumb">—</div>

        <!-- Level 1 cards (Region) -->
        <div id="ddCardsL1" class="dd-cards"></div>

        <!-- Level 2 cards (Unit) -->
        <div id="ddCardsL2" class="dd-cards" style="display:none;"></div>

        <div id="ddTableBlock" class="dd-tableBlock" style="display:none;">
          <div class="dd-tableHead">
            <div style="font-weight:1000;">Daftar Peserta</div>
            <div id="ddCount" style="font-size:12px; font-weight:900; color:#6b7280;">0</div>
          </div>

          <div class="participant-table-container dd-tableWrap" id="ddTableWrap">
            <table class="participant-table" style="width:100%; min-width:720px;">
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
    cardsL1: wrap.querySelector('#ddCardsL1'),
    cardsL2: wrap.querySelector('#ddCardsL2'),
    tableBlock: wrap.querySelector('#ddTableBlock'),
    tableWrap: wrap.querySelector('#ddTableWrap'),
    tbodyEl: wrap.querySelector('#ddTbody'),

    // ✅ WAJIB (agar renderDrill tidak error)
    crumbEl: wrap.querySelector('#ddCrumb'),
    countEl: wrap.querySelector('#ddCount'),

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
    <button type="button" class="dd-card">
      <div class="dd-card-top">
        <div style="min-width:0;">
          <div class="dd-card-label">${escapeHtml(label)}</div>
          ${sub ? `<div class="dd-card-sub">${escapeHtml(sub)}</div>` : ``}
        </div>
        <div class="dd-pill">${count}</div>
      </div>
    </button>
  `;
}

function renderCards(containerEl, items, onClick){
  if (!containerEl) return;

  containerEl.innerHTML = items.map(it => cardHtml(it.label, it.count, it.sub)).join('')
    || `<div style="color:#777;padding:8px;">Tidak ada data.</div>`;

  Array.from(containerEl.querySelectorAll('button')).forEach((btn, idx)=>{
    btn.addEventListener('click', ()=> onClick(items[idx]));
  });
}

// ---------- Drill renderer ----------
function renderDrill(){
  if (!drill) return;

  const all = drill.all || [];
  const step = drill.step; // 0=Region, 1=Unit, 2=Table

  // tombol back
  drill.backBtn.style.display = (step === 0) ? 'none' : 'inline-block';

  // visibilitas fokus per step
  drill.tableBlock.style.display = (step === 2) ? '' : 'none';
  drill.cardsL1.style.display = (step === 0) ? '' : 'none';
  drill.cardsL2.style.display = (step === 1) ? '' : 'none';

  // reset scroll table saat tidak di table
  if (step !== 2){
    try{ drill.tableWrap.scrollTop = 0; }catch{}
  }

  // ---------- STEP 0: REGION ----------
  if (step === 0){
    drill.titleEl.textContent = drill.titleBase;
    drill.subEl.textContent = 'Pilih Region';
    drill.crumbEl.textContent = `📌 ${drill.titleBase} / Region`;

    // group region
    const byRegion = groupCount(all, p => p.Region);
    const regions = Object.entries(byRegion)
      .sort((a,b)=>b[1]-a[1])
      .map(([label,count])=>({ label, count, sub:'Klik untuk lihat Unit', key: label }));

    renderCards(drill.cardsL1, regions, (it)=>{
      drill.selectedRegion = it.key;
      drill.step = 1;
      renderDrill();
    });

    return;
  }

  // ---------- STEP 1: UNIT ----------
  if (step === 1){
    const region = drill.selectedRegion || '';
    const inRegion = all.filter(p => String(p.Region||'Unknown') === String(region));

    drill.titleEl.textContent = `${drill.titleBase} • ${region}`;
    drill.subEl.textContent = 'Pilih Unit';
    drill.crumbEl.textContent = `📌 ${drill.titleBase} / ${region} / Unit`;

    const byUnit = groupCount(inRegion, p => p.Estate);
    const units = Object.entries(byUnit)
      .sort((a,b)=>b[1]-a[1])
      .map(([label,count])=>({ label, count, sub:'Klik untuk lihat daftar peserta', key: label }));

    renderCards(drill.cardsL2, units, (it)=>{
      drill.selectedUnit = it.key;
      drill.step = 2;
      renderDrill();
    });

    return;
  }

  // ---------- STEP 2: TABLE ----------
  const region = drill.selectedRegion || '';
  const unit = drill.selectedUnit || '';

  const inRegion = all.filter(p => String(p.Region||'Unknown') === String(region));
  const inUnit = inRegion.filter(p => String(p.Estate||'Unknown') === String(unit));

  drill.titleEl.textContent = `${drill.titleBase} • ${region} • ${unit}`;
  drill.subEl.textContent = `${inUnit.length} peserta`;
  drill.crumbEl.textContent = `📌 ${drill.titleBase} / ${region} / ${unit}`;
  drill.countEl && (drill.countEl.textContent = `${inUnit.length} peserta`);

  // ✅ pastikan tableWrap benar-benar scroll
  try{
    drill.tableWrap.style.overflow = 'auto';
    drill.tableWrap.style.webkitOverflowScrolling = 'touch';
  }catch{}

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

  async function fetchVehiclesSmart(){
  const tripId = session?.activeTripId || '';

  // 1) coba adminGet (kalau admin + online)
  try{
    const vRes = await api.adminGet(session.sessionId, 'vehicles', tripId);
    if (vRes && Array.isArray(vRes.vehicles)) return vRes.vehicles;
  }catch(e){}

  // 2) fallback: getVehicles list biasa (lebih aman untuk user & offline-cache)
  try{
    const vRes2 = await api.getVehicles(session.sessionId, tripId, '');
    if (vRes2 && Array.isArray(vRes2.vehicles)) return vRes2.vehicles;
    // kadang backend mengembalikan {vehicle:...} jika q, tapi q='' harusnya list
  }catch(e){}

  return [];
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
    try{
      await showVehicleDrill(session);
    }catch(e){
      showNotification(e?.message || 'Gagal memuat data kendaraan', 'error');
    }
  });

  // 2: Telah Tiba -> peserta arrived
  bindOnce(cards[2], async ()=>{
    const parts = await fetchAllParticipants();
    const subset = parts.filter(p => (p.Arrived===true || String(p.Arrived).toLowerCase()==='true'));
    showDrill('Peserta Telah Tiba', subset);
  });

  // 3: Dalam Perjalanan -> peserta (kendaraan on_the_way) dan belum arrived
  bindOnce(cards[3], async ()=>{
    let parts = [];
    let vehicles = [];
    try{
      [parts, vehicles] = await Promise.all([fetchAllParticipants(), fetchVehiclesSmart()]);
    }catch(e){
      showNotification(e?.message || 'Gagal memuat data untuk drilldown "Dalam Perjalanan"', 'error');
      return;
    }

    if (!vehicles.length){
      showNotification('Data kendaraan tidak tersedia (mungkin offline dan cache belum lengkap). Coba login saat online dulu untuk warmup.', 'warning', 4500);
    }
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
  vdrill.cardsWrap.style.display = (step === 0) ? '' : 'none';

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
  let vRes, pRes;

  try{
    // coba adminGet dulu
    [vRes, pRes] = await Promise.all([
      api.adminGet(session.sessionId, 'vehicles', tripId),
      api.getParticipants(session.sessionId, tripId, 'all')
    ]);
  }catch(_){
    // fallback: getVehicles list biasa
    [vRes, pRes] = await Promise.all([
      api.getVehicles(session.sessionId, tripId, ''),
      api.getParticipants(session.sessionId, tripId, 'all')
    ]);
  }

  // normalisasi shape agar vdrill.vehicles aman
  vdrill.vehicles = vRes?.vehicles || [];
  vdrill.participants = pRes?.participants || [];

  if (!vdrill.vehicles.length){
    showNotification('Data kendaraan tidak tersedia. Pastikan sudah login saat online agar cache terisi.', 'warning', 4500);
  }

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
