import * as api from '../core/api.js';
import { showNotification } from '../core/ui.js';

let map = null;
let vehicleMarkers = {};
let lastManifestByVehicle = {};
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

function openDrawer(code){
  ensureDrawer();
  const d = document.getElementById('vehicleDrawer');
  d.classList.add('open');

  const list = lastManifestByVehicle[code] || [];
  const total = list.length;
  const staff = list.filter(p => String(p.rel||'').toLowerCase()==='staff' || String(p.rel||'').toLowerCase()==='mentee' || String(p.rel||'').toLowerCase()==='karyawan').length;
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

export function initMap(){
  const el = document.getElementById('map');
  if (!el) return;

  ensureMapSize();

  if (map){
    fixLeafletAfterVisible();
    return;
  }

  map = L.map(el, { zoomControl:true, preferCanvas:true }).setView([-2.5, 114.0], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);

  window.addEventListener('resize', fixLeafletAfterVisible, { passive:true });
  window.visualViewport?.addEventListener('resize', fixLeafletAfterVisible, { passive:true });

  fixLeafletAfterVisible();
  ensureDrawer();
}

// ==== Tracking GPS -> updateLocation ====
export function ensureTrackingUI(session){
  const page = document.getElementById('mapPage');
  if (!page) return;

  if (document.getElementById('trackBar')) return;

  const bar = document.createElement('div');
  bar.id = 'trackBar';
  bar.className = 'map-trackbar';
  bar.innerHTML = `
    <button class="btn-primary" id="btnStartTrack"><i class="fas fa-location-arrow"></i> Mulai Kirim Lokasi</button>
    <button class="btn-secondary" id="btnStopTrack" disabled><i class="fas fa-stop"></i> Stop</button>
    <select id="trackVehiclePick" style="padding:12px 15px; border:2px solid #ddd; border-radius:8px;">
      <option value="">Pilih kendaraan untuk tracking...</option>
    </select>
  `;

  // tempatkan di atas map container
  const mapContainer = page.querySelector('.map-container');
  mapContainer?.parentNode?.insertBefore(bar, mapContainer);

  document.getElementById('btnStartTrack').addEventListener('click', ()=> startTracking(session));
  document.getElementById('btnStopTrack').addEventListener('click', stopTracking);
}

function setTrackVehicleOptions(vehicles){
  const sel = document.getElementById('trackVehiclePick');
  if (!sel) return;
  const cur = sel.value;
  const opts = vehicles.map(v=> `<option value="${esc(v.code)}">${esc(v.code)} • ${esc(v.type||'')} • ${esc(v.status||'')}</option>`).join('');
  sel.innerHTML = `<option value="">Pilih kendaraan untuk tracking...</option>${opts}`;
  if (cur) sel.value = cur;
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

  document.getElementById('btnStartTrack').disabled = true;
  document.getElementById('btnStopTrack').disabled = false;
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

  const s = document.getElementById('btnStartTrack');
  const t = document.getElementById('btnStopTrack');
  if (s) s.disabled = false;
  if (t) t.disabled = true;

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
export async function refreshMap(session){
  if (!map) initMap();
  fixLeafletAfterVisible();

  const tripId = session?.activeTripId || '';
  const res = await api.getMapData(session.sessionId, tripId, 1); // includeManifest=1
  const vehicles = res.vehicles || [];
  lastManifestByVehicle = res.manifestByVehicle || {};

  ensureTrackingUI(session);
  setTrackVehicleOptions(vehicles);

  const seen = new Set();
  vehicles.forEach(v=>{
    const lat = Number(v.currentLocation?.lat);
    const lng = Number(v.currentLocation?.lng);
    if (!isFinite(lat) || !isFinite(lng)) return;
    const code = v.code;
    seen.add(code);

    let marker = vehicleMarkers[code];
    const label = `${code} (${v.type||''}) - ${v.status||''}`;

    if (!marker){
      marker = L.marker([lat,lng], {
        icon: makeVehicleDivIcon(code, v.status)
      }).addTo(map);

      marker.on('click', ()=> openDrawer(code));
      vehicleMarkers[code] = marker;
    } else {
      marker.setLatLng([lat,lng]);

      // ✅ update warna kalau status berubah
      updateMarkerIcon(marker, code, v.status);
    }

    marker.bindPopup(label);

  });

  Object.keys(vehicleMarkers).forEach(code=>{
    if (!seen.has(code)){
      map.removeLayer(vehicleMarkers[code]);
      delete vehicleMarkers[code];
    }
  });

  const coords = vehicles
    .map(v=>[Number(v.currentLocation?.lat), Number(v.currentLocation?.lng)])
    .filter(([a,b])=>isFinite(a)&&isFinite(b));

  if (coords.length){
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding:[20,20], maxZoom: 13 });
  }

  fixLeafletAfterVisible();
}
