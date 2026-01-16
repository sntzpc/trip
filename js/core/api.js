// js/core/api.js

export const API = {
  url: 'https://script.google.com/macros/s/AKfycbyKnP2oqjMMDyVuadCba839aSM_pnm4y4VBTS-DMyBoQEvApBJ-tEi2uUUbt5wqtWvF/exec'
};

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
    return json;
  } finally {
    clearTimeout(t);
  }
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

export async function getMapData(sessionId, tripId){
  return apiCall('getMapData', { sessionId, tripId }, { method: 'GET' });
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