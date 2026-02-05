// js/core/api.js

export const API = {
  url: 'https://script.google.com/macros/s/AKfycbyKnP2oqjMMDyVuadCba839aSM_pnm4y4VBTS-DMyBoQEvApBJ-tEi2uUUbt5wqtWvF/exec'
};

import { kvGet, kvSet, queueAdd, queueList, queueUpdate } from './idb.js';

// =====================
// Utils
// =====================
function isOnline(){
  try{ return navigator.onLine !== false; }catch{ return true; }
}

function uuid(){
  try{ return crypto.randomUUID(); }catch{}
  return 'op_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

function boolish(x){
  if (x === true) return true;
  const s = String(x||'').toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

// ===== Normalizers =====
function normStr(x){
  return String(x ?? '').trim();
}
function normKey(x){
  return normStr(x).toLowerCase();
}

// ===== Field getters (tahan variasi GAS) =====
function getNik(p){
  return normStr(p?.NIK ?? p?.nik ?? p?.Nik ?? p?.id ?? '');
}
function getNama(p){
  return normStr(p?.Nama ?? p?.nama ?? p?.Name ?? p?.name ?? '');
}
function getRel(p){
  return normStr(p?.Relationship ?? p?.relationship ?? p?.Rel ?? p?.rel ?? '');
}
function getMainNik(p){
  return normStr(p?.MainNIK ?? p?.mainNik ?? p?.MainNik ?? p?.main_nik ?? p?.mainNik ?? '');
}
function getVehicleField(p){
  return normStr(p?.Vehicle ?? p?.vehicle ?? p?.InVehicle ?? p?.inVehicle ?? '');
}
function getArrivedField(p){
  return boolish(p?.Arrived ?? p?.arrived ?? p?.isArrived ?? p?.IsArrived ?? false);
}

// =====================
// Cache/Queue configuration
// =====================
const CACHEABLE = new Set([
  'getConfig',
  'getUserData',
  'getFamily',
  'getDashboardData',
  'getMapData',
  'getVehicles',
  'getParticipants',
  'getScanCandidates',
  'adminGetData'
]);

const QUEUEABLE = new Set([
  'assignVehicle',
  'assignVehicleStrict',
  'confirmArrival',
  'adminUpdate',
  'changePassword'
  // updateLocation sengaja tidak di-queue (terlalu sering), hanya realtime
]);

function cacheKey(action, params){
  // key harus stabil; sessionId tidak ikut biar cache bisa dipakai offline
  const p = { ...(params||{}) };
  delete p.sessionId;

  // normalisasi filter yg sering dipakai
  if (p.filter && typeof p.filter !== 'string') {
    try{ p.filter = JSON.stringify(p.filter); }catch{}
  }
  return `api_cache:${action}:${JSON.stringify(p)}`;
}

// =====================
// Helpers untuk offline-derivation
// =====================
async function getCachedJson(action, params){
  try{
    const ck = cacheKey(action, params);
    const rec = await kvGet(ck);
    return rec?.value || null;
  }catch{ return null; }
}

async function getCachedParticipantsAll(tripId){
  const v = await getCachedJson('getParticipants', { tripId, filter:'all' });
  return (v && Array.isArray(v.participants)) ? v.participants : [];
}

async function getCachedVehicles(tripId){
  // untuk user biasa, gunakan cache getVehicles (tidak butuh admin)
  const v1 = await getCachedJson('getVehicles', { tripId, q: '' });
  if (v1 && Array.isArray(v1.vehicles)) return v1.vehicles;

  // fallback: adminGetData(vehicles)
  const v2 = await getCachedJson('adminGetData', { dataType:'vehicles', tripId });
  return (v2 && Array.isArray(v2.vehicles)) ? v2.vehicles : [];
}

function buildNikToVehicleFromVehicles(vehicles){
  const map = {};
  (vehicles||[]).forEach(v=>{
    const code = normStr(v.Code || v.code || '');
    if (!code) return;

    const csv = normStr(v.Passengers || v.passengers || '');
    if (!csv) return;

    csv.split(',')
      .map(x=>normStr(x))
      .filter(Boolean)
      .forEach(nik => { map[String(nik)] = code; });
  });
  return map;
}

// (fungsi ini belum dipakai, biarkan tetap kalau Anda butuh nanti)
function normalizeGasUrl(url){
  url = String(url || '').trim();
  if (!url) return url;

  if (url.includes('/macros/echo') || url.includes('&lib=')) {
    throw new Error('URL salah: jangan pakai /macros/echo atau &lib= untuk API WebApp.');
  }
  if (url.includes('script.googleusercontent.com') && url.includes('user_content_key=')) {
    return url;
  }
  if (url.includes('script.google.com') && url.includes('/exec')) {
    return url;
  }
  if (url.includes('script.googleusercontent.com') && url.includes('/exec')) {
    throw new Error(
      'URL googleusercontent Anda masih versi pendek dan memicu 307. ' +
      'Ambil URL final (yang ada user_content_key=...) dengan cara buka URL /exec di browser lalu copy URL setelah redirect.'
    );
  }
  return url;
}

// (fungsi ini juga belum dipakai, tapi aman dibiarkan)
function toSearchParams(obj){
  const sp = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k,v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v) || typeof v === 'object') sp.set(k, JSON.stringify(v));
    else sp.set(k, String(v));
  });
  return sp;
}

// =====================
// Core API Call
// =====================
export async function apiCall(action, params = {}, { timeoutMs = 20000 } = {}){
  const baseUrl = String(API.url || '').trim();
  if (!baseUrl || !baseUrl.includes('/exec')) {
    throw new Error('API.url belum benar. Pastikan URL WebApp mengandung /exec');
  }

  const ck = CACHEABLE.has(action) ? cacheKey(action, params) : '';

  // =====================================================
  // OFFLINE SMART FALLBACKS (tanpa harus memanggil server)
  // =====================================================

  // 1) getScanCandidates harus tetap bisa jalan offline (scan + input manual)
  if (!isOnline() && action === 'getScanCandidates'){
    const tripId = normStr(params.tripId || '');
    const q = normKey(params.q || '');
    const limit = Math.min(Math.max(Number(params.limit || 80), 10), 200);

    // userId (nik) tidak kita simpan di cacheKey, jadi ambil dari params
    const coordinatorNik = normStr(params.coordinatorNik || params.nik || '');

    const parts = await getCachedParticipantsAll(tripId);
    const vehicles = await getCachedVehicles(tripId);
    const nikToVeh = buildNikToVehicleFromVehicles(vehicles);

    const cn = normStr(coordinatorNik);

    // affiliated: MainNIK == coordinatorNik, plus self
    const aff = cn ? parts.filter(p => getMainNik(p) === cn) : [];
    if (cn){
      const self = parts.find(p => getNik(p) === cn);
      if (self && !aff.some(x => getNik(x) === cn)) aff.unshift(self);
    }

    const pack = (p)=>{
      const nik = getNik(p);
      return {
        nik,
        nama: getNama(p),
        relationship: getRel(p),
        region: normStr(p?.Region ?? p?.region ?? ''),
        estate: normStr(p?.Estate ?? p?.estate ?? ''),
        arrived: getArrivedField(p),
        vehicle: getVehicleField(p),
        mainNik: getMainNik(p),
        inVehicle: nikToVeh[nik] || ''
      };
    };

    // search
    let other = [];
    if (q){
      other = parts.filter(p=>{
        const nik  = normKey(getNik(p));
        const nama = normKey(getNama(p));
        const rel  = normKey(getRel(p));
        return nik.includes(q) || nama.includes(q) || rel.includes(q);
      }).slice(0, limit);
    }

    return {
      success: true,
      offline: true,
      coordinatorNik,
      affiliated: (aff||[]).map(pack),
      search: (other||[]).map(pack)
    };
  }

  // 2) getVehicles(q) harus bisa offline: cari dari cache getVehicles(q:'')
  // FIX: normalize + toleransi format scan "berisik"
  if (!isOnline() && action === 'getVehicles'){
    const tripId = normStr(params.tripId || '');
    const qRaw = normStr(params.q || '');
    const q = normKey(qRaw);

    if (q){
      const list = await getCachedVehicles(tripId);

      const found = (list||[]).find(v=>{
        const code = normKey(v.Code || v.code);
        const barcode = normKey(v.Barcode || v.barcode);
        return (code && code === q) || (barcode && barcode === q);
      });

      if (found){
        return { success:true, offline:true, vehicle: found };
      }

      // bonus: kalau hasil scan berisi tambahan karakter (mis: "CODE|xxx" atau "CODE-2026")
      const found2 = (list||[]).find(v=>{
        const code = normKey(v.Code || v.code);
        const barcode = normKey(v.Barcode || v.barcode);
        return (code && q.includes(code)) || (barcode && q.includes(barcode));
      });

      if (found2){
        return { success:true, offline:true, vehicle: found2 };
      }
      // kalau tidak ketemu, lanjut ke mekanisme cacheKey biasa (kalau pernah tersimpan spesifik q)
    }
  }
  // ✅ OFFLINE: updateLocation disimpan ke QUEUE (khusus offline saja)
  // supaya map bisa tampil posisi kendaraan Anda saat offline
  if (!isOnline() && action === 'updateLocation'){
    const opId = uuid();
    const toQueue = { ...(params||{}), _opId: opId };
    try{ await queueAdd({ opId, action, params: toQueue }); }catch{}
    return { success:true, queued:true, opId, offline:true, message:'Lokasi disimpan (offline). Akan dikirim saat online.' };
  }

  // 3) kalau offline dan aksi bisa di-cache, kembalikan cache dulu
  if (!isOnline() && ck){
    const cached = await kvGet(ck);
    if (cached && cached.value) return cached.value;
  }

  // 4) kalau offline dan aksi bisa di-queue, simpan antrian lalu return sukses (queued)
  if (!isOnline() && QUEUEABLE.has(action)){
    const opId = uuid();
    const toQueue = { ...(params||{}), _opId: opId };
    await queueAdd({ opId, action, params: toQueue });
    return { success:true, queued:true, opId, message:'Tersimpan di antrian. Akan dikirim saat online.' };
  }

  // =====================
  // Network call
  // =====================
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try{
    const u = new URL(baseUrl);
    u.searchParams.set('action', action);

    Object.entries(params || {}).forEach(([k,v]) => {
      if (k === 'action') {
        throw new Error("Jangan kirim param bernama 'action' ke apiCall(). Pakai 'op' atau nama lain.");
      }
      if (v === undefined || v === null) return;
      if (Array.isArray(v) || typeof v === 'object') u.searchParams.set(k, JSON.stringify(v));
      else u.searchParams.set(k, String(v));
    });

    const res = await fetch(u.toString(), {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store'
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error('Respon server bukan JSON: ' + text.slice(0,180)); }

    if (!json || json.success === false) {
      const msg = json?.message || 'Request gagal';
      const err = new Error(msg);
      err.payload = json;
      throw err;
    }

    // simpan cache
    if (ck){
      try{ await kvSet(ck, json); }catch{}
    }
    return json;

  } catch(err){

    // fallback cache jika error jaringan
    if (ck){
      try{
        const cached = await kvGet(ck);
        if (cached && cached.value) return cached.value;
      }catch{}
    }

    // jika request gagal karena offline, dan queueable -> queue
    if (!isOnline() && QUEUEABLE.has(action)){
      const opId = uuid();
      const toQueue = { ...(params||{}), _opId: opId };
      try{ await queueAdd({ opId, action, params: toQueue }); }catch{}
      return { success:true, queued:true, opId, message:'Tersimpan di antrian. Akan dikirim saat online.' };
    }

    throw err;

  } finally {
    clearTimeout(t);
  }
}

// =============================
// ✅ Offline helpers for MAP
// - mengambil lokasi dari cache map terakhir + queue updateLocation
// - mengambil manifest dari cache map includeManifest + queue assignVehicleStrict
// =============================

async function _getCached(action, params){
  try{
    const ck = cacheKey(action, params); // ✅ pakai yang sudah ada
    const rec = await kvGet(ck);
    return rec?.value || null;
  }catch{ return null; }
}

// ambil lokasi terakhir kendaraan dari QUEUE updateLocation
async function _getQueuedLastLocationsByVehicle(){
  const out = {}; // { [vehicleCode]: {lat,lng,ts} }
  try{
    const list = await queueList({});
    for (const it of list || []){
      if (!it || it.status === 'synced') continue;
      if (it.action !== 'updateLocation') continue;

      const p = it.params || {};
      const code = String(p.vehicleCode || '').trim();
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      if (!code || !isFinite(lat) || !isFinite(lng)) continue;

      const ts = Number(it.createdAt || it.lastAttemptAt || Date.now());
      if (!out[code] || ts > out[code].ts){
        out[code] = { lat, lng, ts };
      }
    }
  }catch{}
  return out;
}

// ambil nikList pending dari QUEUE assignVehicleStrict / assignVehicle
async function _getQueuedAssignments(){
  // { [vehicleCode]: { nikList:[], ts, opId } }
  const out = {};
  try{
    const list = await queueList({});
    for (const it of list || []){
      if (!it || it.status === 'synced') continue;
      if (!(it.action === 'assignVehicleStrict' || it.action === 'assignVehicle')) continue;

      const p = it.params || {};
      const code = String(p.vehicleCode || '').trim();
      if (!code) continue;

      let nikList = [];
      try{
        if (Array.isArray(p.nikList)) nikList = p.nikList;
        else if (typeof p.nikList === 'string') nikList = JSON.parse(p.nikList);
      }catch{}

      nikList = (nikList || []).map(x=>String(x||'').trim()).filter(Boolean);
      if (!nikList.length) continue;

      const ts = Number(it.createdAt || Date.now());
      if (!out[code] || ts > out[code].ts){
        out[code] = { nikList, ts, opId: it.opId || '' };
      }
    }
  }catch{}
  return out;
}

// ✅ PUBLIC: ambil map data offline-first
export async function getMapDataOffline(sessionId, tripId){
  // 1) cache map terakhir (tanpa manifest)
  const cached = await _getCached('getMapData', { tripId, includeManifest: 0 }) 
              || await _getCached('getMapData', { tripId, includeManifest: 1 });

  // struktur default
  const base = cached || { success:true, offline:true, vehicles:[], manifestByVehicle:{} };

  // 2) overlay lokasi dari queue updateLocation
  const lastLoc = await _getQueuedLastLocationsByVehicle();

  const vehicles = Array.isArray(base.vehicles) ? base.vehicles.map(v=>({ ...v })) : [];
  const vehiclesByCode = {};
  vehicles.forEach(v=>{
    const code = String(v?.code||v?.Code||'').trim();
    if (code) vehiclesByCode[code] = v;
  });

  Object.entries(lastLoc).forEach(([code, loc])=>{
    // pastikan kendaraan ada (kalau tidak ada di cache, buat minimal record)
    let v = vehiclesByCode[code];
    if (!v){
      v = { code, type:'', status:'on_the_way', currentLocation:{} };
      vehicles.push(v);
      vehiclesByCode[code] = v;
    }
    v.currentLocation = { lat: loc.lat, lng: loc.lng, ts: loc.ts, source:'queue' };
  });

  return {
    ...base,
    offline: true,
    vehicles,
    manifestByVehicle: base.manifestByVehicle || {}
  };
}

export async function mapFast(sessionId, codes = [], limit = 250){
  // backend map.fast mengharapkan codes sebagai CSV string
  const codesCsv = Array.isArray(codes)
    ? codes.map(x => String(x || '').trim()).filter(Boolean).join(',')
    : String(codes || '').trim();

  return apiCall('map.fast', {
    sessionId,
    limit: Number(limit || 250),
    ...(codesCsv ? { codes: codesCsv } : {})
  }, { timeoutMs: 12000 });
}

// ✅ PUBLIC: ambil manifest offline-first untuk 1 vehicle
export async function getVehicleManifestOffline(tripId, vehicleCode){
  const code = String(vehicleCode||'').trim();
  if (!code) return [];

  // 1) dari cache getMapData(includeManifest=1)
  const cached = await _getCached('getMapData', { tripId, includeManifest: 1 });
  const byVeh = cached?.manifestByVehicle || {};
  if (Array.isArray(byVeh[code]) && byVeh[code].length) return byVeh[code];

  // 2) fallback: dari cache participants all (pakai field Vehicle)
  const pAll = await _getCached('getParticipants', { tripId, filter:'all' });
  const src = (pAll?.participants || []);
  const rows = [];

  for (const p of src){
    const veh = normStr(p?.Vehicle ?? p?.vehicle ?? '');
    if (veh !== code) continue;

    rows.push({
      nik: getNik(p),
      nama: getNama(p) || getNik(p),
      rel:  getRel(p) || (p?.Category || ''),
      region: normStr(p?.Region ?? p?.region ?? ''),
      estate: normStr(p?.Estate ?? p?.estate ?? ''),
      arrived: getArrivedField(p),
      arrivedAt: p?.ArrivalTime || p?.arrivedAt || ''
    });
  }

  if (rows.length) return rows;

  // 3) terakhir: dari queue assignVehicleStrict (nikList)
  const qa = await _getQueuedAssignments();
  const qit = qa[code];
  if (!qit) return [];

  // map nik->data participant kalau ada
  const map = new Map();
  (pAll?.participants || []).forEach(p=>{
    const nik = String(p.NIK||p.nik||'').trim();
    if (nik) map.set(nik, p);
  });

  return qit.nikList.map(nik=>{
  const p = map.get(nik) || {};
  return {
    nik,
    nama: getNama(p) || nik,
    rel:  getRel(p) || (p?.Category || ''),
    region: normStr(p?.Region ?? p?.region ?? ''),
    estate: normStr(p?.Estate ?? p?.estate ?? ''),
    arrived: getArrivedField(p),
    arrivedAt: p?.ArrivalTime || p?.arrivedAt || ''
  };
});
}

// =====================
// Wrappers
// =====================
export async function getConfig(){
  return apiCall('getConfig', {}, { method: 'GET' });
}

export async function login(nik, password){
  return apiCall('login', { nik, password });
}

export async function logout(sessionId){
  return apiCall('logout', { sessionId });
}

export async function getUserData(sessionId, nik){
  return apiCall('getUserData', { sessionId, nik }, { method: 'GET' });
}

export async function getFamily(sessionId, nik, tripId){
  return apiCall('getFamily', { sessionId, nik, tripId }, { method: 'GET' });
}

export async function getDashboard(sessionId, tripId){
  return apiCall('getDashboardData', { sessionId, tripId }, { method: 'GET' });
}

export async function getVehicles(sessionId, tripId, q){
  return apiCall('getVehicles', { sessionId, tripId, q }, { method: 'GET' });
}

export async function updateLocation(sessionId, vehicleCode, lat, lng){
  return apiCall('updateLocation', { sessionId, vehicleCode, lat, lng });
}

export async function assignVehicle(sessionId, vehicleCode, nikList, tripId){
  return apiCall('assignVehicle', { sessionId, vehicleCode, nikList, tripId });
}

export async function confirmArrival(sessionId, nikList, tripId, lat, lng, acc, opts={}){
  const payload = { sessionId, nikList, tripId, lat, lng, acc };
  if (opts && typeof opts === 'object'){
    if (opts.bypassPin) payload.bypassPin = opts.bypassPin;
    if (opts.bypassReason) payload.bypassReason = opts.bypassReason;
    if (opts.fenceId) payload.fenceId = opts.fenceId;
  }
  return apiCall('confirmArrival', payload);
}

export async function getParticipants(sessionId, tripId, filter){
  return apiCall('getParticipants', { sessionId, tripId, filter }, { method: 'GET' });
}

export async function changePassword(sessionId, oldPassword, newPassword){
  return apiCall('changePassword', { sessionId, oldPassword, newPassword });
}

// Admin
export async function adminGet(sessionId, dataType, tripId){
  return apiCall('adminGetData', { sessionId, dataType, tripId }, { method: 'GET' });
}

export async function adminUpdate(sessionId, dataType, op, data){
  return apiCall('adminUpdate', {
    sessionId,
    dataType,
    op, // ✅ jangan pakai nama 'action'
    data: JSON.stringify(data)
  });
}

export async function getMapData(sessionId, tripId, includeManifest = 0){
  return apiCall('getMapData', { sessionId, tripId, includeManifest }, { method: 'GET' });
}

// =============================
// Offline Queue Sync Processor (UI uses this)
// =============================
export async function getQueueSummary(){
  const all = await queueList();
  const sum = { pending:0, failed:0, synced:0, total:0 };
  all.forEach(x=>{
    sum.total++;
    if (x.status === 'pending') sum.pending++;
    else if (x.status === 'failed') sum.failed++;
    else if (x.status === 'synced') sum.synced++;
  });
  return sum;
}

export async function processQueue(sessionId, { maxItems = 50 } = {}){
  if (!isOnline()) return { success:false, message:'Offline', processed:0 };

  const list = (await queueList({ status:'pending' })) || [];
  let processed = 0;

  for (const item of list.slice(0, maxItems)){
    const id = item.id;
    try{
      if (item.action === 'updateLocation'){
        await queueUpdate(item.id, { status: 'synced', result: { success:true, skipped:true, message:'updateLocation di-skip (realtime)' }, syncedAt: Date.now() });
        processed++;
        continue;
      }
      await queueUpdate(id, { attempts:(item.attempts||0)+1, lastAttemptAt:Date.now(), lastError:'' });

      const p = item.params || {};
      p.sessionId = sessionId;

      const res = await apiCall(item.action, p, { timeoutMs: 25000 });

      if (res && res.success){
        await queueUpdate(id, { status:'synced', result:res, syncedAt:Date.now() });
      } else {
        await queueUpdate(id, { status:'failed', lastError: res?.message || 'Gagal' });
      }
    } catch(e){
      await queueUpdate(id, { status:'failed', lastError: String(e?.message||e||'Error') });
    }
    processed++;
  }

  return { success:true, processed };
}

export async function retryFailed(sessionId, { maxItems = 50 } = {}){
  const failed = (await queueList({ status:'failed' })) || [];
  for (const it of failed.slice(0, maxItems)){
    await queueUpdate(it.id, { status:'pending', lastError:'' });
  }
  return processQueue(sessionId, { maxItems });
}
