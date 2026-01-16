import * as api from '../core/api.js';

let map = null;
let vehicleMarkers = {};

function ensureMapSize(){
  const el = document.getElementById('map');
  if (!el) return;

  // tinggi responsif: di mobile pakai viewport height
  // fallback aman jika browser tidak dukung dvh
  const vh = window.visualViewport?.height || window.innerHeight || 600;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  // map-controls di bawah map pada mobile, jadi map bisa lebih tinggi
  const h = isMobile ? Math.max(320, Math.floor(vh * 0.55)) : 500;
  el.style.height = `${h}px`;
}

function fixLeafletAfterVisible(){
  if (!map) return;
  ensureMapSize();

  // Leaflet wajib invalidate setelah elemen visible
  setTimeout(() => {
    try {
      map.invalidateSize(true);
    } catch {}
  }, 50);
}

export function initMap(){
  const el = document.getElementById('map');
  if (!el) return;

  ensureMapSize();

  if (map) {
    fixLeafletAfterVisible();
    return;
  }

  // Default center: Indonesia
  map = L.map(el, {
    zoomControl: true,
    preferCanvas: true
  }).setView([-2.5, 114.0], 5);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // resize saat rotate / address bar mobile berubah
  window.addEventListener('resize', fixLeafletAfterVisible, { passive: true });
  window.visualViewport?.addEventListener('resize', fixLeafletAfterVisible, { passive: true });

  fixLeafletAfterVisible();
}

export async function refreshMap(session){
  if (!map) initMap();
  fixLeafletAfterVisible();

  const tripId = session?.activeTripId || '';
  const res = await api.getMapData(session.sessionId, tripId);
  const vehicles = res.vehicles || [];

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
      marker = L.marker([lat,lng]).addTo(map).bindPopup(label);
      vehicleMarkers[code] = marker;
    } else {
      marker.setLatLng([lat,lng]);
      marker.setPopupContent(label);
    }
  });

  // remove missing
  Object.keys(vehicleMarkers).forEach(code=>{
    if (!seen.has(code)){
      map.removeLayer(vehicleMarkers[code]);
      delete vehicleMarkers[code];
    }
  });

  // Fit bounds if any
  const coords = vehicles
    .map(v=>[Number(v.currentLocation?.lat), Number(v.currentLocation?.lng)])
    .filter(([a,b])=>isFinite(a)&&isFinite(b));

  if (coords.length){
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [20,20], maxZoom: 13 });
  }

  // invalidate lagi setelah fitBounds (kadang mobile blank setelah animasi)
  fixLeafletAfterVisible();
}

export function destroyMap(){
  // optional: jika nanti ingin benar2 destroy
}
