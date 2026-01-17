// js/core/api.js

export const API = {
  url: 'https://script.google.com/macros/s/AKfycbyKnP2oqjMMDyVuadCba839aSM_pnm4y4VBTS-DMyBoQEvApBJ-tEi2uUUbt5wqtWvF/exec'
};

import { kvGet, kvSet, queueAdd, queueList, queueUpdate } from './idb.js';

function isOnline(){
  try{ return navigator.onLine !== false; }catch{ return true; }
}

function uuid(){
  try{ return crypto.randomUUID(); }catch{}
  return 'op_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

const CACHEABLE = new Set([
  'getConfig',
  'getUserData',
  'getFamily',
  'getDashboardData',
  'getMapData',
  'getVehicles',
  'getParticipants',
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

function normalizeGasUrl(url){
  url = String(url || '').trim();
  if (!url) return url;

  // jangan pakai echo/lib untuk API
  if (url.includes('/macros/echo') || url.includes('&lib=')) {
    throw new Error('URL salah: jangan pakai /macros/echo atau &lib= untuk API WebApp.');
  }

  // ✅ kalau user sudah pakai googleusercontent + user_content_key, biarkan
  if (url.includes('script.googleusercontent.com') && url.includes('user_content_key=')) {
    return url;
  }

  // ✅ kalau user pakai script.google.com/exec, BIARKAN (jangan replace otomatis)
  if (url.includes('script.google.com') && url.includes('/exec')) {
    return url;
  }

  // kalau user pakai googleusercontent tapi belum ada user_content_key, ini rawan 307
  if (url.includes('script.googleusercontent.com') && url.includes('/exec')) {
    throw new Error(
      'URL googleusercontent Anda masih versi pendek dan memicu 307. ' +
      'Ambil URL final (yang ada user_content_key=...) dengan cara buka URL /exec di browser lalu copy URL setelah redirect.'
    );
  }

  return url;
}

function toSearchParams(obj){
  const sp = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k,v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v) || typeof v === 'object') sp.set(k, JSON.stringify(v));
    else sp.set(k, String(v));
  });
  return sp;
}

export async function apiCall(action, params = {}, { timeoutMs = 20000 } = {}){
  const baseUrl = String(API.url || '').trim();
  if (!baseUrl || !baseUrl.includes('/exec')) {
    throw new Error('API.url belum benar. Pastikan URL WebApp mengandung /exec');
  }

  const ck = CACHEABLE.has(action) ? cacheKey(action, params) : '';

  // ✅ kalau offline dan aksi bisa di-cache, kembalikan cache dulu
  if (!isOnline() && ck){
    const cached = await kvGet(ck);
    if (cached && cached.value) return cached.value;
  }

  // ✅ kalau offline dan aksi bisa di-queue, simpan antrian lalu return sukses (queued)
  if (!isOnline() && QUEUEABLE.has(action)){
    const opId = uuid();
    const toQueue = { ...(params||{}), _opId: opId };
    await queueAdd({ opId, action, params: toQueue });
    return { success:true, queued:true, opId, message:'Tersimpan di antrian. Akan dikirim saat online.' };
  }

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

    // ✅ simpan cache
    if (ck){
      try{ await kvSet(ck, json); }catch{}
    }
    return json;
  } catch(err){
    // ✅ fallback cache jika error jaringan
    if (ck){
      try{
        const cached = await kvGet(ck);
        if (cached && cached.value) return cached.value;
      }catch{}
    }
    // ✅ jika request gagal karena offline, dan queueable -> queue
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

// ===== Sync Queue Processor =====
export async function processOfflineQueue(sessionId, { max = 50 } = {}){
  if (!isOnline()) return { success:false, message:'Offline', processed:0 };
  const items = await queueList({});
  const pending = items.filter(x => x.status === 'pending' || x.status === 'failed').slice(0, max);
  let processed = 0;
  for (const it of pending){
    const id = it.id;
    const action = it.action;
    const params = { ...(it.params||{}), sessionId };
    const now = Date.now();
    try{
      await queueUpdate(id, { status:'sending', lastAttemptAt: now, attempts: (it.attempts||0)+1, lastError:'' });
      const res = await apiCall(action, params, { timeoutMs: 25000 });
      if (res && res.success !== false){
        await queueUpdate(id, { status:'synced', result: res, syncedAt: Date.now(), lastError:'' });
      } else {
        await queueUpdate(id, { status:'failed', result: res, lastError: (res?.message||'Gagal') });
      }
      processed++;
    } catch(e){
      await queueUpdate(id, { status:'failed', lastError: String(e?.message||e) });
      processed++;
    }
  }
  return { success:true, processed };
}

// ===== wrappers (kompatibel dengan pemanggilan api.login(), api.getConfig(), dst) =====

export async function getConfig(){
  // aman pakai GET
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
  // nikList boleh array
  return apiCall('assignVehicle', { sessionId, vehicleCode, nikList, tripId });
}

export async function confirmArrival(sessionId, nikList, tripId){
  return apiCall('confirmArrival', { sessionId, nikList, tripId });
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
  // op = 'add' | 'update' | dll
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
// Offline Queue Sync Processor
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
      await queueUpdate(id, { attempts:(item.attempts||0)+1, lastAttemptAt:Date.now(), lastError:'' });
      const p = item.params || {};
      // pastikan sessionId terbaru
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
  // ubah status failed -> pending lalu proses
  const failed = (await queueList({ status:'failed' })) || [];
  for (const it of failed.slice(0, maxItems)){
    await queueUpdate(it.id, { status:'pending', lastError:'' });
  }
  return processQueue(sessionId, { maxItems });
}

