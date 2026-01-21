// ===============================
// FG2026 Family Gathering - API
// Google Apps Script WebApp client
// NOTE: Semua request menggunakan POST x-www-form-urlencoded agar tidak memicu preflight (OPTIONS)
// ===============================

window.FGAPI = (function(){
  const URL = (window.AppConfig?.api?.url || '').trim();

  function ensureUrl(){
    if(!URL || URL.includes('PASTE_YOUR_GAS_WEBAPP_URL_HERE')){
      throw new Error('API URL belum diisi. Buka config.js lalu isi AppConfig.api.url dengan URL Web App GAS Anda.');
    }
  }

  async function post(action, payload = {}, token = ''){
    ensureUrl();
    const params = new URLSearchParams();
    params.set('action', action);
    params.set('payload', JSON.stringify(payload || {}));
    if(token) params.set('token', token);

    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params.toString()
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error('Respon server bukan JSON. Pastikan URL GAS benar & sudah Deploy sebagai Web App (Access: Anyone).');
    }

    if(!json || json.ok !== true){
      const msg = (json && json.error) ? String(json.error) : 'Gagal memanggil API';
      throw new Error(msg);
    }
    return json.data;
  }

  // =========================
  // Public endpoints (no token)
  // =========================
  const publicApi = {
    getParticipantByNIK: (nik) => post('public.getParticipantByNIK', { nik }),
    getAttendanceStatus: (nik) => post('public.getAttendanceStatus', { nik }),
    submitAttendance: (nik, family) => post('public.submitAttendance', { nik, family }),
    getSchedule: () => post('public.getSchedule', {}),
    getCurrentEvent: () => post('public.getCurrentEvent', {}),
    getDoorprizeFeed: (limit=10) => post('public.getDoorprizeFeed', { limit }),
    getDoorprizeByNIK: (nik, limit=10) => post('public.getDoorprizeByNIK', { nik, limit }),
    getPrizeImageDataUrl: (fileIdOrUrl) => post('public.getPrizeImageDataUrl', { fileId: fileIdOrUrl }),
    markDoorprizeTaken: (drawId, nik) => post('public.markDoorprizeTaken', { drawId, nik }),
    getConfig: () => post('public.getConfig', {}),
  };

  // =========================
  // Auth endpoints
  // =========================
  const authApi = {
    login: (username, password) => post('auth.login', { username, password }),
    me: (token) => post('auth.me', {}, token),
    logout: (token) => post('auth.logout', {}, token)
  };

  // =========================
  // Admin endpoints (ADMIN only)
  // =========================
  const adminApi = {
    // Participants (ADMIN)
    participantsList: (token) => post('admin.participantsList', {}, token),
    participantsUpsert: (token, item) => post('admin.participantsUpsert', { item }, token),
    participantsDelete: (token, nik) => post('admin.participantsDelete', { nik }, token),

    // Events (ADMIN)
    eventsList: (token) => post('admin.eventsList', {}, token),
    eventsUpsert: (token, item) => post('admin.eventsUpsert', { item }, token),
    eventsDelete: (token, id) => post('admin.eventsDelete', { id }, token),

    // Prizes master (ADMIN)
    prizesList: (token) => post('admin.prizesList', {}, token),
    prizesUpsert: (token, item) => post('admin.prizesUpsert', { item }, token),
    prizesDelete: (token, id) => post('admin.prizesDelete', { id }, token),
    uploadPrizeImage: (token, filename, mimeType, dataBase64) =>
      post('admin.uploadPrizeImage', { filename, mimeType, dataBase64 }, token),

    // Users (ADMIN)
    usersList: (token) => post('admin.usersList', {}, token),
    usersUpsert: (token, item) => post('admin.usersUpsert', { item }, token),
    usersResetPassword: (token, username, newPassword) =>
      post('admin.usersResetPassword', { username, newPassword }, token),

    // Current event control (ADMIN)
    setCurrentEvent: (token, eventId) => post('admin.setCurrentEvent', { eventId }, token),

    // Config
    configGet: (token) => post('admin.configGet', {}, token),
    configSet: (token, config) => post('admin.configSet', { config }, token),
  };

  // =========================
  // Operator endpoints (OPERATOR or ADMIN)
  // =========================
  const operatorApi = {
    prizesList: (token) => post('operator.prizesList', {}, token),
    participantsEligible: (token, onlyStaff=true) =>     post('operator.participantsEligible', { onlyStaff }, token),

    drawDoorprize: (token, prizeId, count) =>  post('operator.drawDoorprize', { prizeId, count }, token),
    doorprizeListByPrize: (token, prizeId) =>  post('operator.doorprizeListByPrize', { prizeId }, token),
    doorprizeMarkTaken: (token, drawId) =>      post('operator.doorprizeMarkTaken', { drawId }, token),
    doorprizeRemoveAndRedraw: (token, drawId) =>  post('operator.doorprizeRemoveAndRedraw', { drawId }, token),

    setCurrentEvent: (token, eventId) =>  post('operator.setCurrentEvent', { eventId }, token),
    confirmStage: (token, prizeId) =>  post('operator.confirmStage', { prizeId }, token),
    eventsList: (token) => post('operator.eventsList', {}, token),

  };

  return { post, public: publicApi, auth: authApi, admin: adminApi, operator: operatorApi };
})();
