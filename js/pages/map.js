import * as api from '../core/api.js';
import { showNotification, ensureMapTrackingUI, setMapTrackingButtons, setTrackVehicleOptionsUI } from '../core/ui.js';

let map = null;
let vehicleMarkers = {};
let lastManifestByVehicle = {};
let mapHasFittedOnce = false;
let invalidatedOnce = false;

if (!invalidatedOnce){
  invalidatedOnce = true;
  setTimeout(() => { try { map.invalidateSize(true); } catch {} }, 0);
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
      <button class="vd-close" id="vdClose">Tutup</button>
    </div>
    <div class="vd-body">
      <div class="vd-pills" id="vdPills"></div>
      <div id="vdList"></div>
    </div>
  `;
  document.body.appendChild(d);
  document.getElementById('vdClose')?.addEventListener('click', ()=> d.classList.remove('open'));
}

async function openDrawer(code, session){
  ensureDrawer();
  const d = document.getElementById('vehicleDrawer');
  d.classList.add('open');

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

function renderDrawer(code){
  const list = lastManifestByVehicle[code] || [];
  const total = list.length;
  const staff = list.filter(p => ['staff','mentee','karyawan'].includes(String(p.rel||'').toLowerCase())).length;
  const istri = list.filter(p => String(p.rel||'').toLowerCase()==='istri').length;
  const anak  = list.filter(p => String(p.rel||'').toLowerCase()==='anak').length;

  document.getElementById('vdTitle').textContent = `Kendaraan ${code}`;
  document.getElementById('vdSub').textContent = `Penumpang: ${total}`;

  document.getElementById('vdPills').innerHTML = `
    <div class="vd-pill">TOTAL: ${total}</div>
    <div class="vd-pill">STAFF: ${staff}</div>
    <div class="vd-pill">ISTRI: ${istri}</div>
    <div class="vd-pill">ANAK: ${anak}</div>
  `;

  const html = list.length ? list.map(p=>{
    const meta = `${p.rel||'-'} • ${p.region||''} • ${p.estate||''}${p.arrived? ' • Tiba':''}`;
    return `<div class="vd-item">
      <div class="nm">${esc(p.nama||'-')} <small>(${esc(p.nik||'-')})</small></div>
      <div class="mt">${esc(meta)}</div>
    </div>`;
  }).join('') : `<div class="vd-item"><div class="mt">Belum ada manifest untuk kendaraan ini.</div></div>`;

  document.getElementById('vdList').innerHTML = html;
}

async function ensureManifestForVehicle(session, code){
  if (!session) throw new Error('Session tidak ada');

  // sudah pernah diload dan masih fresh 60 detik, skip
  const ts = manifestLoadedAt[code] || 0;
  if (lastManifestByVehicle[code] && (Date.now() - ts < 60000)) return;

  if (manifestLoading[code]) return; // sedang loading, biarkan
  manifestLoading[code] = true;

  try{
    const tripId = session?.activeTripId || '';
    // ⚠️ backend Anda saat ini hanya punya getMapData(includeManifest=1) untuk semua kendaraan.
    // Ini tetap berat, tapi hanya terjadi saat user klik 1 kendaraan (bukan saat buka map).
    const res = await api.getMapData(session.sessionId, tripId, 1);

    lastManifestByVehicle = res.manifestByVehicle || {};
    manifestLoadedAt = manifestLoadedAt || {};
    Object.keys(lastManifestByVehicle).forEach(k=> manifestLoadedAt[k] = Date.now());

    if (!lastManifestByVehicle[code]) lastManifestByVehicle[code] = [];
  } finally {
    manifestLoading[code] = false;
  }
}

function esc(s){
  return String(s??'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
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

function startTracking(session){
  const sel = document.getElementById('trackVehiclePick');
  const vehicleCode = (sel?.value || '').trim();
  if (!vehicleCode) return showNotification('Pilih kendaraan dulu untuk tracking', 'error');
  if (!navigator.geolocation) return showNotification('Geolocation tidak didukung', 'error');

  tracking.vehicleCode = vehicleCode;

  // watch posisi (lebih smooth)
  tracking.watchId = navigator.geolocation.watchPosition(
    (pos)=> tracking._lastPos = pos,
    (err)=> showNotification('GPS error: ' + err.message, 'error'),
    { enableHighAccuracy:true, maximumAge: 2000, timeout: 15000 }
  );

  // kirim tiap ~6 detik (hemat)
  tracking.timer = setInterval(async ()=>{
    const pos = tracking._lastPos;
    if (!pos) return;
    const now = Date.now();
    if (now - tracking.lastSentAt < 5500) return;
    tracking.lastSentAt = now;

    try{
      await api.updateLocation(
        session.sessionId,
        tracking.vehicleCode,
        pos.coords.latitude,
        pos.coords.longitude
      );
    }catch(e){}
  }, 1200);

  setMapTrackingButtons(true);
  showNotification('Kirim lokasi aktif untuk ' + tracking.vehicleCode, 'success');
}

function stopTracking(){
  if (tracking.watchId !== null){
    navigator.geolocation.clearWatch(tracking.watchId);
    tracking.watchId = null;
  }
  if (tracking.timer){
    clearInterval(tracking.timer);
    tracking.timer = null;
  }
  tracking._lastPos = null;

  setMapTrackingButtons(false);

  showNotification('Kirim lokasi dihentikan', 'info');
}

function statusClass(st){
  st = String(st || '').toLowerCase();
  if (st === 'waiting') return 'waiting';
  if (st === 'on_the_way' || st === 'onroad' || st === 'on_the_way ') return 'onroad';
  if (st === 'arrived') return 'arrived';
  return 'unknown';
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

  const html = `<div class="vmk ${cls}" title="${esc(code)}">${esc(text)}</div>`;

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

    // ✅ default: includeManifest=0 agar tidak freeze
    const res = await api.getMapData(session.sessionId, tripId, includeManifest ? 1 : 0);

    const vehicles = res.vehicles || [];

    // hanya update manifest cache kalau memang diminta
    if (includeManifest) {
      lastManifestByVehicle = res.manifestByVehicle || {};
      Object.keys(lastManifestByVehicle).forEach(k=> manifestLoadedAt[k] = Date.now());
    }

    prepareTrackingUI(session);

    // setelah trackbar muncul, invalidate sekali biar leaflet resize clean
    setTimeout(() => { try { map.invalidateSize(true); } catch {} }, 0);

    setTrackVehicleOptionsUI(vehicles, { keepValue: true });


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
