import * as api from '../core/api.js';
import { showNotification, ensureMapTrackingUI, setMapTrackingButtons, setTrackVehicleOptionsUI, playBeep, speakText } from '../core/ui.js';

let map = null;
let vehicleMarkers = {};
let lastManifestByVehicle = {};
let vehiclesByCode = {};
let mapHasFittedOnce = false;
let invalidatedOnce = false;
let lastServerNowMs = 0; // untuk heat (last-seen)

// === Vehicle filter (Live Maps) ===
let currentRegionFilter = 'all';  // 'all' or region
let currentGroupFilter  = 'all';  // 'all' or group
let currentUnitFilter   = 'all';  // 'all' or unit
let currentVehicleFilter= 'all';  // 'all' or vehicle code
let lastVehiclesSnapshot = [];    // latest vehicles list for cards/options

function getRegionFilterEl(){ return document.getElementById('regionFilter'); }
function getGroupFilterEl(){ return document.getElementById('groupFilter'); }
function getUnitFilterEl(){ return document.getElementById('unitFilter'); }
function getVehicleFilterEl(){ return document.getElementById('vehicleFilter'); }
function getVehicleCardsEl(){ return document.getElementById('vehicleCards'); }

function normalizeCode(code){ return String(code || '').trim(); }

// ============================
// ✅ Destination & Stop Geofence (Live Map + Notifikasi)
// ============================
let _fencesTripId = '';
// dest bisa multi titik (array). stops juga array.
let _fences = { dest: [], stops: [] };
// simpan layers agar bisa di-clear + toggle label
let _fenceLayers = { destCircles: [], destLabels: [], stopCircles: [], stopLabels: [] };

const FENCE_LABEL_MIN_ZOOM = 10; // zoom kecil: tampilkan lingkaran saja

const PROX_THRESH_M = [1000, 500, 400, 300, 200, 100, 50];
let _proxState = { dest: {}, stops: {} }; // per fenceName

function parsePointObj(raw){
  if (!raw) return null;
  let obj = raw;
  try{ if (typeof raw === 'string') obj = JSON.parse(raw); }catch{}
  if (!obj && typeof raw === 'string' && raw.includes(',')){
    const parts = raw.split(',').map(s=>s.trim());
    obj = { lat:Number(parts[0]), lng:Number(parts[1]), radiusM:Number(parts[2]) };
  }
  if (!obj) return null;
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  const radiusM = Number(obj.radiusM || obj.radius || obj.r || 0);
  if (!isFinite(lat) || !isFinite(lng) || !isFinite(radiusM) || radiusM<=0) return null;
  return { name: String(obj.name || obj.label || ''), lat, lng, radiusM };
}

function parsePointsArray(raw){
  if (!raw) return [];
  let obj = raw;
  try{ if (typeof raw === 'string') obj = JSON.parse(raw); }catch{}
  if (Array.isArray(obj)){
    return obj.map(parsePointObj).filter(Boolean);
  }
  return [];
}

async function ensureTripFencesLoaded(session){
  const tripId = String(session?.activeTripId || '').trim();
  if (!tripId) return;
  if (_fencesTripId === tripId && ((_fences?.dest?.length) || (_fences?.stops?.length))) return;

  _fencesTripId = tripId;
  _fences = { dest: [], stops: [] };
  _proxState = { dest: {}, stops: {} };

  try{
    const cfgRes = await api.getConfig(session.sessionId);
    const cfg = cfgRes?.config || cfgRes || {};
    // ✅ Tujuan/Kedatangan: bisa multi titik (plural) atau single
    const rawDestMulti = cfg[`destinationGeofences:${tripId}`] || cfg.destinationGeofences || '';
    const rawDestSingle = cfg[`destinationGeofence:${tripId}`] || cfg.destinationGeofence || '';
    const rawStops = cfg[`stopGeofences:${tripId}`] || cfg.stopGeofences || '';
    const destMulti = parsePointsArray(rawDestMulti);
    const destSingle = parsePointObj(rawDestSingle);
    const dests = destMulti.length ? destMulti : (destSingle ? [destSingle] : []);
    const stops = parsePointsArray(rawStops);
    dests.forEach((d,i)=>{ d.name = d.name || (dests.length>1 ? `Tujuan ${i+1}` : 'Tujuan'); });
    _fences.dest = dests;
    _fences.stops = stops.map((p,i)=>({ ...p, name: p.name || `Stop ${i+1}` }));
  }catch(e){
    // ignore
  }

  // render di peta jika map sudah ada
  try{ renderFencesOnMap(); }catch(e){}
}

function clearFenceLayers(){
  try{
    if (!map) return;
    [...(_fenceLayers.destCircles||[]), ...(_fenceLayers.destLabels||[]), ...(_fenceLayers.stopCircles||[]), ...(_fenceLayers.stopLabels||[])].forEach(l=>{
      try{ map.removeLayer(l); }catch(e){}
    });
  }catch(e){}
  _fenceLayers = { destCircles: [], destLabels: [], stopCircles: [], stopLabels: [] };
}

function makeFenceLabelIcon(text, kind='dest'){
  const safe = esc(text || '');
  const cls = kind === 'stop' ? 'fence-label fence-stop' : 'fence-label fence-dest';
  return L.divIcon({
    className: 'fence-label-wrap',
    html: `<div class="${cls}">${safe}</div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5]
  });
}

function updateFenceLabelVisibility(){
  if (!map) return;
  const z = map.getZoom ? map.getZoom() : 0;
  const show = z >= FENCE_LABEL_MIN_ZOOM;
  const setVis = (layers, vis)=>{
    (layers||[]).forEach(m=>{
      try{
        if (vis){
          if (!map.hasLayer(m)) m.addTo(map);
        } else {
          if (map.hasLayer(m)) map.removeLayer(m);
        }
      }catch(e){}
    });
  };
  setVis(_fenceLayers.destLabels, show);
  setVis(_fenceLayers.stopLabels, show);
}

function renderFencesOnMap(){
  if (!map) return;
  clearFenceLayers();

  // Destination (multi titik) - default: tampilkan circle; label badge muncul saat zoom mendekat
  (_fences?.dest || []).forEach((p,i)=>{
    const circle = L.circle([p.lat, p.lng], { radius: p.radiusM, weight:2, opacity:0.9, fillOpacity:0.08 });
    circle.addTo(map);
    _fenceLayers.destCircles.push(circle);

    const label = L.marker([p.lat, p.lng], { title: p.name || `Tujuan ${i+1}`, icon: makeFenceLabelIcon(p.name || `Tujuan ${i+1}`, 'dest'), interactive:true, keyboard:false });
    label.bindPopup(`<b>${esc(p.name||'Tujuan')}</b><br>Radius: ${Math.round(p.radiusM)} m`);
    _fenceLayers.destLabels.push(label);
  });

  // Stops
  (_fences?.stops || []).forEach((p)=>{
    const circle = L.circle([p.lat, p.lng], { radius: p.radiusM, weight:1, opacity:0.85, fillOpacity:0.06, dashArray:'4 6' });
    circle.addTo(map);
    _fenceLayers.stopCircles.push(circle);

    const label = L.marker([p.lat, p.lng], { title: p.name || 'Stop', icon: makeFenceLabelIcon(p.name || 'Stop', 'stop'), interactive:true, keyboard:false });
    label.bindPopup(`<b>${esc(p.name||'Stop')}</b><br>Radius: ${Math.round(p.radiusM)} m`);
    _fenceLayers.stopLabels.push(label);
  });

  // toggle label sesuai zoom
  try{
    if (!renderFencesOnMap._zoomHooked){
      map.on('zoomend', updateFenceLabelVisibility);
      renderFencesOnMap._zoomHooked = true;
    }
  }catch(e){}
  updateFenceLabelVisibility();
}

function notifyOnce(key, message, withSound=true, voiceText=''){
  // dedupe per key
  if (notifyOnce._seen?.[key]) return;
  notifyOnce._seen = notifyOnce._seen || {};
  notifyOnce._seen[key] = Date.now();

  try{ showNotification(message, 'info', 3000); }catch(e){}
  if (withSound){
    try{ playBeep({ durationMs:160, freq: 880 }); }catch(e){}
  }
  if (voiceText){
    try{ speakText(String(voiceText)); }catch(e){}
  }
  try{ navigator.vibrate?.(120); }catch(e){}
}

function checkProximity(lat, lng){
  const nowKey = ()=> `${Math.floor(Date.now()/60000)}`; // per menit (anti spam)

  // Destination (multi)
  (_fences?.dest || []).forEach((p)=>{
    const d = haversineM(lat, lng, p.lat, p.lng);
    const kBase = `dest:${p.name}`;

    // thresholds
    for (const t of PROX_THRESH_M){
      if (d <= t){
        const k = `${kBase}:t${t}:${nowKey()}`;
        notifyOnce(k, `Mendekati ${p.name||'Tujuan'}: ${Math.round(d)} m (<= ${t} m)`, true, `${t} meter lagi menuju ${p.name||'tujuan'}`);
        break;
      }
    }

    // arrived (inside radius)
    if (d <= p.radiusM){
      const k = `${kBase}:arr:${nowKey()}`;
      notifyOnce(k, `TIBA di ${p.name||'Tujuan'} ✅`, true, `Sudah tiba di ${p.name||'tujuan'}`);
    }
  });

  // Stops
  for (const p of (_fences?.stops || [])){
    const d = haversineM(lat, lng, p.lat, p.lng);
    const kBase = `stop:${p.name}`;
    for (const t of PROX_THRESH_M){
      if (d <= t){
        const k = `${kBase}:t${t}:${nowKey()}`;
        notifyOnce(k, `Mendekati ${p.name||'Pemberhentian'}: ${Math.round(d)} m (<= ${t} m)`, true, `${t} meter lagi menuju ${p.name||'pemberhentian'}`);
        break;
      }
    }
    if (d <= p.radiusM){
      const k = `${kBase}:arr:${nowKey()}`;
      notifyOnce(k, `TIBA di ${p.name||'Pemberhentian'} (stop)`, true, `Sudah tiba di ${p.name||'pemberhentian'}`);
    }
  }
}

function esc(s){
  return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function escAttr(s){ return esc(s).replaceAll('`',''); }

function ensureVehicleFilterOptions(vehicles){
  const rSel = getRegionFilterEl();
  const gSel = getGroupFilterEl();
  const uSel = getUnitFilterEl();
  const vSel = getVehicleFilterEl();
  if (!vSel) return;

  const allVehicles = (vehicles || []).map(v => ({
    ...v,
    region: String(v?.region || v?.Region || '').trim(),
    group:  String(v?.group  || v?.Group  || '').trim(),
    unit:   String(v?.unit   || v?.Unit   || '').trim(),
    code:   normalizeCode(v?.code)
  }));

  // -------- Region options --------
  if (rSel){
    const cur = rSel.value || currentRegionFilter || 'all';
    const regions = Array.from(new Set(allVehicles.map(v=>v.region).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'id'));
    rSel.innerHTML = `<option value="all">Semua Region</option>` + regions.map(x=>`<option value="${escAttr(x)}">${esc(x)}</option>`).join('');
    if (regions.includes(cur)) rSel.value = cur;
  }

  const regionVal = String((rSel?.value || currentRegionFilter || 'all') || 'all');
  const regionFiltered = regionVal !== 'all'
    ? allVehicles.filter(v=>v.region === regionVal)
    : allVehicles;

  // -------- Group options (depends on region) --------
  if (gSel){
    const cur = gSel.value || currentGroupFilter || 'all';
    const groups = Array.from(new Set(regionFiltered.map(v=>v.group).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'id'));
    gSel.innerHTML = `<option value="all">Semua Group</option>` + groups.map(x=>`<option value="${escAttr(x)}">${esc(x)}</option>`).join('');
    if (groups.includes(cur)) gSel.value = cur;
  }

  const groupVal = String((gSel?.value || currentGroupFilter || 'all') || 'all');
  const groupFiltered = groupVal !== 'all'
    ? regionFiltered.filter(v=>v.group === groupVal)
    : regionFiltered;

  // -------- Unit options (depends on region+group) --------
  if (uSel){
    const cur = uSel.value || currentUnitFilter || 'all';
    const units = Array.from(new Set(groupFiltered.map(v=>v.unit).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'id'));
    uSel.innerHTML = `<option value="all">Semua Unit</option>` + units.map(x=>`<option value="${escAttr(x)}">${esc(x)}</option>`).join('');
    if (units.includes(cur)) uSel.value = cur;
  }

  const unitVal = String((uSel?.value || currentUnitFilter || 'all') || 'all');
  const unitFiltered = unitVal !== 'all'
    ? groupFiltered.filter(v=>v.unit === unitVal)
    : groupFiltered;

  // -------- Vehicle options (depends on region+group+unit) --------
  const prev = vSel.value || currentVehicleFilter || 'all';
  const uniq = Array.from(new Set(unitFiltered.map(v=>v.code).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'id'));

  const existing = Array.from(vSel.options).map(o=>o.value);
  const wanted = ['all', ...uniq];
  const same = existing.length === wanted.length && existing.every((v,i)=> v===wanted[i]);

  if (!same){
    vSel.innerHTML = `<option value="all">Semua Kendaraan</option>` + uniq.map(c=>`<option value="${escAttr(c)}">${esc(c)}</option>`).join('');
  }
  if (wanted.includes(prev)) vSel.value = prev;
}



let _vehicleFilterHooksReady = false;
function ensureVehicleFilterHooks(){
  if (_vehicleFilterHooksReady) return;
  const rSel = getRegionFilterEl();
  const gSel = getGroupFilterEl();
  const uSel = getUnitFilterEl();
  const vSel = getVehicleFilterEl();

  const applyAll = ()=>{
    currentRegionFilter  = rSel?.value || 'all';
    currentGroupFilter   = gSel?.value || 'all';
    currentUnitFilter    = uSel?.value || 'all';
    currentVehicleFilter = vSel?.value || 'all';
    applyVehicleFilter(currentVehicleFilter, { focus:true });
  };

  if (rSel){
    rSel.addEventListener('change', ()=>{
      currentRegionFilter = rSel.value || 'all';
      // reset downstream
      if (gSel) gSel.value = 'all';
      if (uSel) uSel.value = 'all';
      if (vSel) vSel.value = 'all';
      ensureVehicleFilterOptions(lastVehiclesSnapshot);
      applyAll();
    });
  }
  if (gSel){
    gSel.addEventListener('change', ()=>{
      currentGroupFilter = gSel.value || 'all';
      if (uSel) uSel.value = 'all';
      if (vSel) vSel.value = 'all';
      ensureVehicleFilterOptions(lastVehiclesSnapshot);
      applyAll();
    });
  }
  if (uSel){
    uSel.addEventListener('change', ()=>{
      currentUnitFilter = uSel.value || 'all';
      if (vSel) vSel.value = 'all';
      ensureVehicleFilterOptions(lastVehiclesSnapshot);
      applyAll();
    });
  }
  if (vSel){
    vSel.addEventListener('change', ()=>{
      applyAll();
    });
  }

  // expose global for inline HTML onchange="filterMapVehicles()"
  window.filterMapVehicles = () => {
    ensureVehicleFilterOptions(lastVehiclesSnapshot);
    applyAll();
  };

  _vehicleFilterHooksReady = true;
}
function markerVisibleFor(code){
  const c = normalizeCode(code);
  const v = vehiclesByCode[c] || {};

  const r = String(v?.region || '').trim();
  const g = String(v?.group  || '').trim();
  const u = String(v?.unit   || '').trim();

  if (currentRegionFilter && currentRegionFilter !== 'all'){
    if (r !== String(currentRegionFilter).trim()) return false;
  }
  if (currentGroupFilter && currentGroupFilter !== 'all'){
    if (g !== String(currentGroupFilter).trim()) return false;
  }
  if (currentUnitFilter && currentUnitFilter !== 'all'){
    if (u !== String(currentUnitFilter).trim()) return false;
  }
  if (currentVehicleFilter && currentVehicleFilter !== 'all'){
    return c === normalizeCode(currentVehicleFilter);
  }
  return true;
}

function applyVehicleFilter(value, { focus=false } = {}){
  currentVehicleFilter = value ? String(value) : 'all';

  // update marker layers based on filter
  try{
    if (map){
      for (const [code, marker] of Object.entries(vehicleMarkers)){
        const shouldShow = markerVisibleFor(code);
        const has = map.hasLayer(marker);
        if (shouldShow && !has){
          marker.addTo(map);
        } else if (!shouldShow && has){
          map.removeLayer(marker);
        }
      }
    }
  }catch(e){}

  // render cards
  try{ renderVehicleCards(lastVehiclesSnapshot); }catch(e){}

  // optionally focus map on selected marker
  if (focus && map && currentVehicleFilter && currentVehicleFilter !== 'all'){
    const code = normalizeCode(currentVehicleFilter);
    const m = vehicleMarkers[code];
    if (m){
      try{
        const ll = m.getLatLng();
        if (ll) map.setView(ll, Math.max(map.getZoom(), 14), { animate:true });
      }catch(e){}
      try{ m.openPopup?.(); }catch(e){}
    }
  }
}

function renderVehicleCards(vehicles){
  const wrap = getVehicleCardsEl();
  if (!wrap) return;

  const list = (vehicles || []).filter(v=>{
    const code = normalizeCode(v?.code);
    if (!code) return false;
    if (currentVehicleFilter && currentVehicleFilter !== 'all') return code === normalizeCode(currentVehicleFilter);
    if (currentGroupFilter && currentGroupFilter !== 'all') return String(v?.group||'').trim() === String(currentGroupFilter).trim();
    return true;
  });

  if (!list.length){
    wrap.innerHTML = `<div style="opacity:.75; padding:10px;">Tidak ada kendaraan.</div>`;
    return;
  }

  // sort by code
  list.sort((a,b)=> normalizeCode(a.code).localeCompare(normalizeCode(b.code), 'id'));

  wrap.innerHTML = list.map(v=>{
    const code = normalizeCode(v.code);
    const type = v.type ? String(v.type) : '';
    const drv  = v.driver ? String(v.driver) : '';
    const st   = v.status ? String(v.status) : '';
    const lat  = Number(v.currentLocation?.lat);
    const lng  = Number(v.currentLocation?.lng);
    const locOk = Number.isFinite(lat) && Number.isFinite(lng);

    return `
      <div class="vehicle-card" data-code="${esc(code)}" title="Klik untuk fokus ke kendaraan">
        <h4>${esc(code)} <span style="font-weight:700; opacity:.75;">${esc(type)}</span></h4>
        <div style="margin-top:6px; font-weight:700;">Status: <span style="font-weight:900;">${esc(st || '-')}</span></div>
        <div style="margin-top:4px; opacity:.85;">Driver: ${esc(drv || '-')}</div>
        <div style="margin-top:4px; opacity:.75; font-size:12px;">
          Lokasi: ${locOk ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '—'}
        </div>
      </div>
    `;
  }).join('');

  // click handlers
  wrap.querySelectorAll('.vehicle-card').forEach(card=>{
    card.addEventListener('click', ()=>{
      const code = card.getAttribute('data-code') || '';
      const sel = getVehicleFilterEl();
      if (sel){
        sel.value = code;
      }
      applyVehicleFilter(code, { focus:true });
      // also open drawer if available (requires last known session in drawerState)
      try{
        if (drawerState?.session) openDrawer(code, drawerState.session);
      }catch(e){}
    });
  });
}

// cache untuk mencegah fetch manifest berulang
let manifestLoadedAt = {}; // { [vehicleCode]: timestamp }
let manifestLoading = {};  // { [vehicleCode]: true/false }

let tracking = {
  watchId: null,
  timer: null,
  lastSentAt: 0,
  vehicleCode: ''
};

let drawerState = {
  code: '',
  session: null,
  loading: false
};

// ===== SCALE SETTINGS (Adaptive Tracking) =====
// Target:
// - Moving: 15–20 detik
// - Idle  : 90–120 detik
// - Sinyal buruk / error streak: otomatis naik interval (moving 30–60 detik; idle 120–180 detik)
const TRACK_MIN_MOVE_M     = 50;    // kirim jika pindah >= 50 meter
const TRACK_JITTER_MAX_MS  = 3000;  // random 0-3 detik agar tidak serentak

const TRACK_MOVING_RANGE_MS     = [15000, 20000];
const TRACK_IDLE_RANGE_MS       = [90000, 120000];
const TRACK_POOR_MOVING_RANGE_MS= [30000, 60000];
const TRACK_POOR_IDLE_RANGE_MS  = [120000, 180000];

function clamp(n, a, b){ return Math.min(Math.max(n, a), b); }
function randBetween(min, max){
  const a = Number(min||0), b = Number(max||0);
  return Math.floor(a + Math.random() * Math.max(0, (b - a)));
}
function randJitterMs(){ return Math.floor(Math.random() * (TRACK_JITTER_MAX_MS + 1)); }

// Network quality (best-effort)
function getNetInfo(){
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return null;
  return {
    effectiveType: String(c.effectiveType||'').toLowerCase(), // '4g','3g','2g','slow-2g'
    downlink: Number(c.downlink||0),
    rtt: Number(c.rtt||0),
    saveData: !!c.saveData
  };
}
function isPoorNetwork(){
  const ni = getNetInfo();
  if (!ni) return false;
  if (ni.saveData) return true;
  if (ni.effectiveType && (ni.effectiveType.includes('2g') || ni.effectiveType.includes('slow'))) return true;
  if (Number.isFinite(ni.downlink) && ni.downlink > 0 && ni.downlink < 0.8) return true;
  if (Number.isFinite(ni.rtt) && ni.rtt > 800) return true;
  return false;
}
function computeAdaptiveGapMs({ isMoving, failStreak = 0 } = {}){
  const poor = isPoorNetwork();
  const range = isMoving
    ? (poor ? TRACK_POOR_MOVING_RANGE_MS : TRACK_MOVING_RANGE_MS)
    : (poor ? TRACK_POOR_IDLE_RANGE_MS   : TRACK_IDLE_RANGE_MS);

  // exponential backoff on consecutive failures (cap x4)
  const mult = clamp(Math.pow(2, clamp(failStreak, 0, 2)), 1, 4);
  return Math.floor(randBetween(range[0], range[1]) * mult);
}

// ===== FAST MAP POLLING (realtime marker) =====
const MAP_FAST_MS = 3000; // 3 detik (naikkan ke 5000 kalau trafik tinggi)
let fastTimer = null;
let fastSession = null;     // simpan session terakhir untuk polling
let fastInFlight = false;   // cegah overlap request

function upsertVehicleMarkerFast(session, code, lat, lng, status, ts){
  if (!map) return;

  // update meta lokal agar drawer/statusBadge ikut update
  const k = String(code || '').trim();
  if (!k) return;

  const prev = vehiclesByCode[k] || {};
  vehiclesByCode[k] = {
    ...prev,
    code: k,
    status: status || prev.status || 'on_the_way',
    currentLocation: { lat, lng },
    lastSeenAt: ts || prev.lastSeenAt || prev.lastLocAt || prev.lastUpdateAt || Date.now(),
    ts: ts || prev.ts || 0
  };

  let marker = vehicleMarkers[k];
  const label = `${k}${prev.type ? ` (${prev.type})` : ''} - ${vehiclesByCode[k].status || ''}`;

  if (!marker){
    marker = L.marker([lat, lng], {
      icon: makeVehicleDivIcon(k, vehiclesByCode[k].status)
    }).addTo(map);

    // klik marker -> drawer (manifest on-demand)
    marker.on('click', ()=> openDrawer(k, session));

    marker.bindPopup(label);
    vehicleMarkers[k] = marker;
  } else {
    marker.setLatLng([lat, lng]);
    updateMarkerIcon(marker, k, vehiclesByCode[k].status);

    const p = marker.getPopup();
    if (p) p.setContent(label);
  }
}

async function refreshMarkersFast(){
  // hanya online, karena endpoint fast dari cache server
  if (!navigator.onLine) return;
  if (!fastSession?.sessionId) return;
  if (!map) return;
  if (fastInFlight) return;

  // daftar codes supaya payload kecil (ambil dari meta yang sudah ada)
  const codes = Object.keys(vehiclesByCode || {});
  if (!codes.length) return;

  fastInFlight = true;
  try{
    const res = await api.mapFast(fastSession.sessionId, codes, 250);
    if (!res || !res.success) return;

    lastServerNowMs = Number(res.now || Date.now());
    const list = res.vehicles || [];
    for (const v of list){
      const lat = Number(v.lat);
      const lng = Number(v.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const ts = toMsMaybe(v.ts || v.lastLocAt || v.lastUpdateAt || v.lastSeenAt);
      upsertVehicleMarkerFast(fastSession, v.code, lat, lng, v.status, ts);
    }

    // optional: update UI last update
    // lastUpd.textContent = new Date(res.now).toLocaleTimeString('id-ID');
  } catch(e){
    // diamkan agar tidak spam notifikasi
  } finally {
    fastInFlight = false;
  }
}

function startFastPolling(session){
  fastSession = session || null;

  if (fastTimer) clearInterval(fastTimer);

  // pause ketika tab tidak terlihat (hemat baterai & request)
  // (tetap aman kalau tidak dipakai)
  const tick = () => refreshMarkersFast().catch(()=>{});

  fastTimer = setInterval(tick, MAP_FAST_MS);

  // initial hit
  tick();
}

function stopFastPolling(){
  if (fastTimer) clearInterval(fastTimer);
  fastTimer = null;
  fastSession = null;
  fastInFlight = false;
}

// optional: auto pause/resume saat tab hide/show
document.addEventListener('visibilitychange', ()=>{
  if (document.hidden){
    // stop total agar request berhenti
    // (kalau ingin hanya pause tanpa reset session, bisa comment stopFastPolling)
    if (fastTimer) clearInterval(fastTimer);
    fastTimer = null;
  } else {
    // resume jika session masih ada
    if (!fastTimer && fastSession?.sessionId){
      fastTimer = setInterval(() => refreshMarkersFast().catch(()=>{}), MAP_FAST_MS);
      refreshMarkersFast().catch(()=>{});
    }
  }
});

// haversine distance (meter)
function haversineM(lat1,lng1,lat2,lng2){
  const R = 6371000;
  const toRad = (x)=> (x * Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function ensureDrawer(){
  if (document.getElementById('vehicleDrawer')) return;

  const d = document.createElement('div');
  d.id = 'vehicleDrawer';
  d.className = 'vehicle-drawer';
  d.innerHTML = `
    <div class="vd-head">
      <div>
        <div class="vd-title" id="vdTitle">Detail Kendaraan</div>
        <div class="vd-sub" id="vdSub">—</div>
      </div>

      <div style="display:flex; gap:8px; align-items:center;">
        <!-- ✅ Refresh -->
        <button class="vd-close" id="vdRefresh" type="button" title="Refresh data">
          <i class="fas fa-rotate-right"></i>
        </button>

        <!-- Close -->
        <button class="vd-close" id="vdClose" type="button">Tutup</button>
      </div>
    </div>

    <div class="vd-body">
      <div class="vd-pills" id="vdPills"></div>
      <div id="vdList"></div>
    </div>
  `;
  document.body.appendChild(d);

  document.getElementById('vdClose')?.addEventListener('click', ()=> d.classList.remove('open'));

  // ✅ refresh handler
  document.getElementById('vdRefresh')?.addEventListener('click', async ()=>{
    if (drawerState.loading) return;
    if (!drawerState.code || !drawerState.session) return;

    try{
      drawerState.loading = true;
      setDrawerRefreshLoading(true);

      // paksa reload manifest dari server
      await ensureManifestForVehicle(drawerState.session, drawerState.code, { force:true });

      // render ulang setelah data terbaru
      renderDrawer(drawerState.code);

      showNotification('Data penumpang diperbarui', 'success');
    }catch(e){
      showNotification(e?.message || 'Gagal refresh data', 'error');
    }finally{
      drawerState.loading = false;
      setDrawerRefreshLoading(false);
    }
  });
}

function setDrawerRefreshLoading(on){
  const btn = document.getElementById('vdRefresh');
  if (!btn) return;
  btn.disabled = !!on;
  const i = btn.querySelector('i');
  if (i){
    i.classList.toggle('fa-spin', !!on);
  }
}

async function openDrawer(code, session){
  ensureDrawer();
  const d = document.getElementById('vehicleDrawer');
  d.classList.add('open');

  drawerState.code = String(code || '');
  drawerState.session = session || null;

  // tampilkan placeholder dulu biar tidak freeze
  document.getElementById('vdTitle').textContent = `Kendaraan ${code}`;
  document.getElementById('vdSub').textContent = `Memuat manifest...`;
  document.getElementById('vdPills').innerHTML = '';
  document.getElementById('vdList').innerHTML = `<div class="vd-item"><div class="mt">Memuat data penumpang...</div></div>`;

  // kalau manifest sudah ada di cache, render cepat
  if (Array.isArray(lastManifestByVehicle[code])) {
    renderDrawer(code);
    return;
  }

  // kalau belum ada: ambil manifest on-demand (sekali saja)
  try{
    await ensureManifestForVehicle(session, code);
  }catch(e){
    document.getElementById('vdSub').textContent = `Gagal memuat manifest`;
    document.getElementById('vdList').innerHTML =
      `<div class="vd-item"><div class="mt">${esc(e?.message || 'Gagal memuat')}</div></div>`;
    return;
  }

  renderDrawer(code);
}

function normalizeRelKey(rel){
  const s = String(rel || '').trim().toLowerCase();
  if (!s) return 'lainnya';
  if (['karyawan','pemanen','borongan','akad'].includes(s)) return 'karyawan';
  if (['staff','pegawai','employee'].includes(s)) return 'staff';
  if (['mentee','magang','training','peserta','participant'].includes(s)) return 'mentee';
  if (['istri','wife'].includes(s)) return 'istri';
  if (['suami','husband'].includes(s)) return 'suami';
  if (['anak','child'].includes(s)) return 'anak';
  if (['ayah','bapak','father'].includes(s)) return 'ayah';
  if (['ibu','mother','mama'].includes(s)) return 'ibu';
  return s;
}

function titleCase(s){
  s = String(s||'');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function statusBadgeHtml(st){
  const s = String(st||'').toLowerCase();
  const label = (s==='arrived') ? 'TIBA' : (s==='on_the_way') ? 'ON ROAD' : (s==='waiting') ? 'WAITING' : (st||'UNKNOWN');
  const cls = (s==='arrived') ? 'success' : (s==='on_the_way') ? 'warning' : 'info';
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function telLink(hp){
  const raw = String(hp||'').trim();
  if (!raw) return '';
  // normalisasi sederhana: buang spasi
  const num = raw.replace(/\s+/g,'');
  return `<a href="tel:${esc(num)}" style="text-decoration:none; font-weight:800;">${esc(raw)}</a>`;
}

function renderDrawer(code){
  const vMeta = vehiclesByCode[String(code)] || {};
  const list = lastManifestByVehicle[code] || [];

  const cap = Number(vMeta.capacity || 0) || 0;
  const total = list.length;
  const status = vMeta.status || '';
  const driver = vMeta.driver || '-';
  const driverPhone = vMeta.driverPhone || '';

  // header
  document.getElementById('vdTitle').textContent = `Kendaraan ${code}`;
  document.getElementById('vdSub').innerHTML = `
    ${statusBadgeHtml(status)}
    <span style="margin-left:8px;">Penumpang: <b>${total}</b>${cap ? ` / ${cap}` : ''}</span>
    <div style="margin-top:6px; font-size:12px; color:#666;">
      Driver: <b>${esc(driver)}</b>${driverPhone ? ` • HP: ${telLink(driverPhone)}` : ''}
    </div>
  `;

  // pills dinamis by relationship
  const counts = {};
  for (const p of list){
    const k = normalizeRelKey(p.rel);
    counts[k] = (counts[k] || 0) + 1;
  }
  const order = ['staff','karyawan','mentee','istri','suami','anak','ayah','ibu','lainnya'];
  const keys = Object.keys(counts).sort((a,b)=>{
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // arrived / not arrived summary
  const arrivedCount = list.filter(p=> !!p.arrived).length;
  const notArrivedCount = total - arrivedCount;

  document.getElementById('vdPills').innerHTML = [
    `<div class="vd-pill">TOTAL: ${total}</div>`,
    `<div class="vd-pill">TIBA: ${arrivedCount}</div>`,
    `<div class="vd-pill">BELUM: ${notArrivedCount}</div>`,
    ...keys.map(k => `<div class="vd-pill">${titleCase(k)}: ${counts[k]}</div>`)
  ].join('');

  // list render (dengan status tiap penumpang)
  const html = list.length ? list.map(p=>{
    const rel = normalizeRelKey(p.rel || '-');
    const st = p.arrived ? `<span class="badge success" style="margin-left:8px;">TIBA</span>`
                         : `<span class="badge info" style="margin-left:8px;">BELUM</span>`;
    const meta = `${rel} • ${p.region||''} • ${p.estate||''}`;
    const arrivedAt = p.arrivedAt ? ` • ${new Date(p.arrivedAt).toLocaleString('id-ID')}` : '';
    return `<div class="vd-item">
      <div class="nm">${esc(p.nama||'-')} <small>(${esc(p.nik||'-')})</small> ${st}</div>
      <div class="mt">${esc(meta)}${esc(arrivedAt)}</div>
    </div>`;
  }).join('') : `<div class="vd-item"><div class="mt">Belum ada manifest untuk kendaraan ini.</div></div>`;

  document.getElementById('vdList').innerHTML = html;

  // warning kalau penumpang 1 tapi capacity besar (indikasi Passengers sheet belum lengkap)
  if (cap && total && total < cap && String(vMeta.passengers||'').length === 0){
    // tidak memaksa, hanya info ringan
  }
}

async function ensureManifestForVehicle(session, code, { force=false } = {}){
  if (!session) throw new Error('Session tidak ada');
  const tripId = session?.activeTripId || '';

  // ✅ OFFLINE: pakai cache/queue/participants
  if (navigator.onLine === false){
    const list = await api.getVehicleManifestOffline(tripId, code);
    lastManifestByVehicle[code] = Array.isArray(list) ? list : [];
    manifestLoadedAt[code] = Date.now();
    return;
  }

  // ✅ ONLINE: cache TTL 60 detik
  const ts = manifestLoadedAt[code] || 0;
  if (!force && lastManifestByVehicle[code] && (Date.now() - ts < 60000)) return;

  if (manifestLoading[code]) return;
  manifestLoading[code] = true;

  try{
    const res = await api.getMapData(session.sessionId, tripId, 1);

    lastManifestByVehicle = res.manifestByVehicle || {};
    Object.keys(lastManifestByVehicle).forEach(k=> manifestLoadedAt[k] = Date.now());

    if (!lastManifestByVehicle[code]) lastManifestByVehicle[code] = [];
  } finally {
    manifestLoading[code] = false;
  }
}

function ensureMapSize(){
  const el = document.getElementById('map');
  if (!el) return;
  const vh = window.visualViewport?.height || window.innerHeight || 600;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  el.style.height = `${isMobile ? Math.max(320, Math.floor(vh*0.55)) : 500}px`;
}

function fixLeafletAfterVisible(){
  if (!map) return;
  ensureMapSize();
  setTimeout(()=>{ try{ map.invalidateSize(true); }catch{} }, 50);
}

function prepareTrackingUI(session){
  ensureMapTrackingUI({
    onStart: () => startTracking(session),
    onStop:  () => stopTracking()
  });
}

// =========================================================
// ✅ PUBLIC: tracking untuk dipakai di mana saja (tanpa harus buka Map)
// - Dipanggil setelah Konfirmasi Penempatan
// - Dipanggil lagi saat app dibuka kembali (auto resume)
// =========================================================
export function startBackgroundTrackingPublic(session, vehicleCode){
  const code = String(vehicleCode||'').trim();
  if (!code) return;

  // set select tersembunyi (kompatibilitas)
  const sel = document.getElementById('trackVehiclePick');
  if (sel){
    sel.innerHTML = `<option value="${esc(code)}">${esc(code)}</option>`;
    sel.value = code;
  }

  // start tracking pakai kode yang dipaksa
  startTracking(session, code);
}

export function initMap(){
  const el = document.getElementById('map');
  if (!el) return;

  // Defensive: pastikan Leaflet sudah ter-load
  if (typeof window.L === 'undefined'){
    try{ showNotification('Leaflet belum ter-load. Pastikan libs/leaflet/leaflet.js dipanggil sebelum js/app.js', 'error'); }catch{}
    return;
  }

  // Pastikan ukuran map tidak 0 ketika pertama kali dibuka (Leaflet butuh element visible)
  const tryInit = (attempt = 0) => {
    ensureMapSize();
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10){
      if (attempt < 12){
        requestAnimationFrame(()=> tryInit(attempt + 1));
      } else {
        try{ showNotification('Map container belum punya ukuran (width/height = 0). Cek CSS #map / parent container.', 'error'); }catch{}
      }
      return;
    }

    if (map){
      fixLeafletAfterVisible();
      return;
    }

    // Prefer default renderer dulu (lebih kompatibel daripada preferCanvas di beberapa device)
    map = L.map(el, { zoomControl:true, preferCanvas:false, updateWhenIdle:true }).setView([-2.5, 114.0], 5);

    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
      crossOrigin: true,
      // ✅ supaya tidak menggantung lama
      timeout: 8000,          // 8 detik
      updateWhenIdle: true,
      keepBuffer: 2
    });

    let tileErrOnce = false;
    tiles.on('tileerror', () => {
      if (tileErrOnce) return;
      tileErrOnce = true;
      try{ showNotification('Tile map gagal dimuat. Cek koneksi / DNS / firewall yang memblokir OpenStreetMap.', 'error'); }catch{}
    });

    tiles.addTo(map);

    window.addEventListener('resize', fixLeafletAfterVisible, { passive:true });
    window.visualViewport?.addEventListener('resize', fixLeafletAfterVisible, { passive:true });

    // invalidateSize beberapa kali agar stabil setelah transisi/animasi UI
    fixLeafletAfterVisible();
    setTimeout(fixLeafletAfterVisible, 200);
    setTimeout(fixLeafletAfterVisible, 600);

    ensureDrawer();
  };

  tryInit(0);
}

function startTracking(session, forcedVehicleCode = ''){
  const vehicleCode = String(forcedVehicleCode || '').trim()
    || String(document.getElementById('trackVehiclePick')?.value || '').trim();

  if (!vehicleCode) return showNotification('Kendaraan belum ditentukan. Scan kendaraan dulu.', 'error');
  if (!navigator.geolocation) return showNotification('Geolocation tidak didukung', 'error');

  // kalau sebelumnya masih tracking, stop dulu biar tidak dobel timer/watch
  stopTracking();

  tracking.vehicleCode = vehicleCode;
  tracking.lastSentAt = 0;
  tracking._lastPos = null;
  tracking._lastSentCoord = null;

  // jitter per start (mencegah serentak)
  tracking._jitterMs = randJitterMs();

  // ✅ load destination/stop geofence untuk notifikasi
  try{ ensureTripFencesLoaded(session); }catch(e){}

  // watch posisi (lebih smooth)
  tracking.watchId = navigator.geolocation.watchPosition(
    (pos)=> { tracking._lastPos = pos; },
    (err)=> showNotification('GPS error: ' + err.message, 'error'),
    { enableHighAccuracy:true, maximumAge: 2000, timeout: 15000 }
  );

  // timer check cepat, tapi send diputuskan oleh throttle + distance
  tracking.timer = setInterval(async ()=>{
    const pos = tracking._lastPos;
    if (!pos) return;

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (!isFinite(lat) || !isFinite(lng)) return;

    // ✅ Proximity notifications (destination + stops)
    try{ checkProximity(lat, lng); }catch(e){}

    const now = Date.now();

    // jarak dari titik terakhir yang pernah DIKIRIM
    let movedM = 999999;
    if (tracking._lastSentCoord){
      movedM = haversineM(tracking._lastSentCoord.lat, tracking._lastSentCoord.lng, lat, lng);
    }

    const isMoving = movedM >= TRACK_MIN_MOVE_M;

    // adaptive gap + jitter (stabil untuk banyak user)
    const desiredGap = computeAdaptiveGapMs({ isMoving, failStreak: tracking._failStreak || 0 });
    const minGap = desiredGap + (tracking._jitterMs || 0);

    if (now - tracking.lastSentAt < minGap) return;

    // allow first send always, else if moved or gap met
    const allowSend = (!tracking._lastSentCoord) || isMoving || (now - tracking.lastSentAt >= minGap);
    if (!allowSend) return;

    tracking.lastSentAt = now;

    try{
      await api.updateLocation(session.sessionId, tracking.vehicleCode, lat, lng);
      tracking._lastSentCoord = { lat, lng };
      tracking._failStreak = 0;
    }catch(e){
      // error → naikkan interval sementara via failStreak
      tracking._failStreak = Math.min((tracking._failStreak || 0) + 1, 5);
    }
  }, 1200);

  // ✅ tidak perlu tombol UI
  try{ setMapTrackingButtons(false); }catch{}
  showNotification('Tracking otomatis aktif: ' + tracking.vehicleCode, 'success');
}

function stopTracking({ silent=false } = {}){
  if (tracking.watchId !== null){
    try{ navigator.geolocation.clearWatch(tracking.watchId); }catch{}
    tracking.watchId = null;
  }
  if (tracking.timer){
    clearInterval(tracking.timer);
    tracking.timer = null;
  }

  tracking._lastPos = null;
  tracking._lastSentCoord = null;
  tracking.lastSentAt = 0;
  tracking.vehicleCode = '';
  tracking._jitterMs = 0;
  tracking._failStreak = 0;

  try{ setMapTrackingButtons(false); }catch{}
  if (!silent) showNotification('Kirim lokasi dihentikan', 'info');
}

function statusClass(st){
  st = String(st || '').toLowerCase();
  if (st === 'waiting') return 'waiting';
  if (st === 'on_the_way' || st === 'onroad' || st === 'on_the_way ') return 'onroad';
  if (st === 'arrived') return 'arrived';
  return 'unknown';
}

function toMsMaybe(x){
  if (x == null || x === '') return 0;
  if (typeof x === 'number') return x;
  const s = String(x);
  // epoch ms?
  const n = Number(s);
  if (Number.isFinite(n) && n > 1000000000) return n;
  const d = new Date(s);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

function heatClassForAgeMs(ageMs){
  const a = Number(ageMs);
  if (!Number.isFinite(a)) return 'heat-unk';
  // thresholds: <30s hot, <2m warm, <5m cool, <15m cold, else offline
  if (a < 30*1000) return 'heat-hot';
  if (a < 2*60*1000) return 'heat-warm';
  if (a < 5*60*1000) return 'heat-cool';
  if (a < 15*60*1000) return 'heat-cold';
  return 'heat-offline';
}


// ambil inisial dari kode kendaraan (biar marker gampang dikenali)
function markerTextFromCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return '';
  // ambil 2 karakter terakhir kalau numeric, kalau tidak ambil 2 awal
  const m = s.match(/(\d{2})$/);
  if (m) return m[1];
  return s.slice(0,2);
}

function makeVehicleDivIcon(code, status){
  const cls = statusClass(status);
  const text = markerTextFromCode(code);

  const v = vehiclesByCode[String(code||'').trim()] || {};
  const ts = toMsMaybe(v.lastLocAt || v.lastUpdateAt || v.lastSeenAt || v.ts);
  const now = Number(lastServerNowMs || Date.now());
  const ageMs = ts ? Math.max(0, now - ts) : Number.POSITIVE_INFINITY;
  const heat = heatClassForAgeMs(ageMs);

  const title = ts ? `${esc(code)} • last: ${new Date(ts).toLocaleTimeString('id-ID')}` : esc(code);
  const html = `<div class="vmk ${cls} ${heat}" title="${title}">${esc(text)}</div>`;

  return L.divIcon({
    className: 'vmk-wrap',
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 28],   // anchor agak bawah biar "pin" terasa
    popupAnchor: [0, -26]
  });
}

function updateMarkerIcon(marker, code, status){
  // Leaflet marker: setIcon saja (lebih aman daripada akses DOM)
  marker.setIcon(makeVehicleDivIcon(code, status));
}

// ==== Refresh Map ====
export async function refreshMap(session, { includeManifest = 0, fitMode = 'none' } = {}){
  try{
    if (!map) initMap();
    if (!map) return;

    fixLeafletAfterVisible();

    const tripId = session?.activeTripId || '';

    // ✅ geofence tujuan/stop (live map + notifikasi)
    try{ await ensureTripFencesLoaded(session); }catch(e){}

    // ✅ default: includeManifest=0 agar tidak freeze
    let res;
      if (navigator.onLine === false){
        res = await api.getMapDataOffline(session.sessionId, tripId);
        // kalau includeManifest diminta, coba ambil cache manifest juga
        if (includeManifest){
          const cachedFull = await api.apiCall('getMapData', { sessionId: session.sessionId, tripId, includeManifest: 1 })
            .catch(()=>null);
          if (cachedFull?.manifestByVehicle){
            res.manifestByVehicle = cachedFull.manifestByVehicle;
          }
        }
      } else {
        res = await api.getMapData(session.sessionId, tripId, includeManifest ? 1 : 0);
      }

    const vehicles = res.vehicles || [];
    lastServerNowMs = Number(res.now || Date.now());

    vehiclesByCode = {};
    for (const v of vehicles){
      if (!v || !v.code) continue;
      const code = String(v.code);
      const ts = toMsMaybe(v.lastLocAt || v.lastUpdateAt || v.ts || v.lastSeenAt);
      vehiclesByCode[code] = { ...v, lastSeenAt: ts || v.lastSeenAt || 0, ts: ts || 0 };
    }
    startFastPolling(session);

    // hanya update manifest cache kalau memang diminta
    if (includeManifest) {
      lastManifestByVehicle = res.manifestByVehicle || {};
      Object.keys(lastManifestByVehicle).forEach(k=> manifestLoadedAt[k] = Date.now());
    }

    // setelah trackbar muncul, invalidate sekali biar leaflet resize clean
    if (!invalidatedOnce){
      invalidatedOnce = true;
      setTimeout(() => { try { map.invalidateSize(true); } catch {} }, 0);
    }

    setTrackVehicleOptionsUI(vehicles, { keepValue: true });

    // ✅ Live Maps: populate & apply vehicle filter
    lastVehiclesSnapshot = vehicles;
    ensureVehicleFilterOptions(vehicles);
    ensureVehicleFilterHooks();
    applyVehicleFilter(currentVehicleFilter, { focus:false });


    const seen = new Set();
    for (const v of vehicles){
      const lat = Number(v.currentLocation?.lat);
      const lng = Number(v.currentLocation?.lng);
      if (!isFinite(lat) || !isFinite(lng)) continue;

      const code = v.code;
      seen.add(code);

      let marker = vehicleMarkers[code];
      const label = `${code} (${v.type||''}) - ${v.status||''}`;

      if (!marker){
        marker = L.marker([lat,lng], {
          icon: makeVehicleDivIcon(code, v.status)
        }).addTo(map);

        // ✅ klik marker: buka drawer & load manifest on-demand
        marker.on('click', ()=> openDrawer(code, session));

        // ✅ bindPopup sekali saja
        marker.bindPopup(label);

        vehicleMarkers[code] = marker;
      } else {
        marker.setLatLng([lat,lng]);
        updateMarkerIcon(marker, code, v.status);

        // update isi popup tanpa re-bind (lebih ringan)
        const p = marker.getPopup();
        if (p) p.setContent(label);
      }
    }

    // hapus marker yang sudah tidak ada
    Object.keys(vehicleMarkers).forEach(code=>{
      if (!seen.has(code)){
        map.removeLayer(vehicleMarkers[code]);
        delete vehicleMarkers[code];
      }
    });

    // ✅ fit bounds: jangan tiap refresh
    if (fitMode === 'first' && !mapHasFittedOnce){
    const coords = vehicles
      .map(v=>[Number(v.currentLocation?.lat), Number(v.currentLocation?.lng)])
      .filter(([lat,lng]) =>
        Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180
      );

    if (coords.length){
      try{
        const bounds = L.latLngBounds(coords);

        // ✅ guard: kalau bounds aneh, jangan fitBounds
        if (bounds.isValid()){
          map.fitBounds(bounds, { padding:[20,20], maxZoom: 13 });
          mapHasFittedOnce = true;
        }
      }catch(e){
        // kalau ada kasus bounds berat, skip saja (peta tetap tampil)
        mapHasFittedOnce = true;
      }
    } else {
      // tidak ada koordinat valid: jangan fit
      mapHasFittedOnce = true;
    }
  }

    fixLeafletAfterVisible();
  }catch(err){
    try{ showNotification(err?.message || 'Gagal memuat peta', 'error'); }catch{}
    console.error(err);
  }
}

export function stopTrackingPublic({ silent=false } = {}){
  stopTracking({ silent });
}