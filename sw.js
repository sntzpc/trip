/* Trip Tracker Service Worker (offline shell) */

const CACHE_NAME = 'trip_tracker_shell_v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './assets/kmp.png',
  './css/all.min.css',
  './webfonts/fa-brands-400.woff2',
  './webfonts/fa-regular-400.woff2',
  './webfonts/fa-solid-900.ttf',
  './webfonts/fa-solid-900.woff2',
  './libs/html5-qrcode.min.js',
  './libs/leaflet/leaflet.css',
  './libs/leaflet/leaflet.js',
  './js/app.js',
  './js/core/api.js',
  './js/core/idb.js',
  './js/core/storage.js',
  './js/core/table_pager.js',
  './js/core/ui.js',
  './js/pages/login.js',
  './js/pages/dashboard.js',
  './js/pages/scan.js',
  './js/pages/map.js',
  './js/pages/arrival.js',
  './js/pages/participants.js',
  './js/pages/admin.js',
  './js/pages/sync.js'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c=>c.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys=>Promise.all(keys.map(k=> (k===CACHE_NAME)?null:caches.delete(k)))),
      self.clients.claim()
    ])
  );
});

// Cache-first for same-origin static files; network-only for GAS/API requests
self.addEventListener('fetch', (event)=>{
  const req = event.request;
  const url = new URL(req.url);

  // never cache Google Apps Script exec calls
  if (url.origin.includes('google') && url.pathname.includes('/macros/')){
    return; // let it go network
  }

  if (url.origin === self.location.origin){
    event.respondWith(
      caches.match(req).then(cached=> cached || fetch(req).then(res=>{
        // put only successful GET responses
        try{
          if (req.method === 'GET' && res && res.ok){
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c=>c.put(req, clone)).catch(()=>{});
          }
        }catch(e){}
        return res;
      }).catch(()=>cached))
    );
  }
});
