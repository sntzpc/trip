/* ==========================
   FG2026 - Family Gathering Backend (Google Apps Script)
   Database: 1 Spreadsheet (Google Sheets)

   Deploy as Web App:
   - Execute as: Me
   - Who has access: Anyone

   IMPORTANT:
   - Semua endpoint via doPost dengan Content-Type x-www-form-urlencoded
   - Parameter:
     - action: string
     - payload: JSON string
     - token: (opsional) session token

   Setup:
   1) Ganti SPREADSHEET_ID
   2) Jalankan setup() sekali dari Script Editor
   3) Deploy Web App, salin URL dan tempel ke config.js (AppConfig.api.url)
   ========================== */

const SPREADSHEET_ID = '1jwYoZfkzJIG_qkWPcx5pjqmeFfeIR_60ccdr5TbKNIY';
const APP_TZ = 'Asia/Jakarta';
const SESSION_DAYS = 7;
const SALT = 'FG2026_SALT_CHANGE_ME';
const PRIZE_IMG_FOLDER_ID = '16EBlzWqYRT-5SAZMSZJdwkc_WyI03qbD';

// Sheet names
const SH = {
  participants: 'participants',
  attendance: 'attendance',
  events: 'events',
  current: 'current_event',
  prizes: 'doorprize_items',
  draws: 'doorprize_draws',
  users: 'panel_users',
  sessions: 'panel_sessions',
  logs: 'logs',
  config: 'app_config'
};

function doPost(e){
  try{
    const action = (e.parameter.action || '').trim();
    const payload = JSON.parse(e.parameter.payload || '{}');
    const token = (e.parameter.token || '').trim();

    const out = route_(action, payload, token);
    return json_({ ok:true, data: out });
  }catch(err){
    return json_({ ok:false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet(){
  return json_({ ok:true, data:{ msg:'FG2026 backend running' } });
}

function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================
// Routing
// ==========================
function route_(action, p, token){
  switch(action){
    // ---- Public (tanpa token) ----
    case 'public.getParticipantByNIK': return public_getParticipantByNIK_(p);
    case 'public.getAttendanceStatus': return public_getAttendanceStatus_(p);
    case 'public.submitAttendance': return public_submitAttendance_(p);
    case 'public.getSchedule': return public_getSchedule_();
    case 'public.getCurrentEvent': return public_getCurrentEvent_();
    case 'public.getDoorprizeFeed': return public_getDoorprizeFeed_(p);

    // ---- Auth (panel) ----
    case 'auth.login': return auth_login_(p);
    case 'auth.me': return auth_me_(token);
    case 'auth.logout': return auth_logout_(token);

    // ---- Admin (token required, role ADMIN) ----
    case 'admin.participantsList': return admin_only_('ADMIN', token, admin_participantsList_);
    case 'admin.participantsUpsert': return admin_only_('ADMIN', token, admin_participantsUpsert_, p);
    case 'admin.participantsDelete': return admin_only_('ADMIN', token, admin_participantsDelete_, p);

    case 'admin.eventsList': return admin_only_('ADMIN', token, admin_eventsList_);
    case 'admin.eventsUpsert': return admin_only_('ADMIN', token, admin_eventsUpsert_, p);
    case 'admin.eventsDelete': return admin_only_('ADMIN', token, admin_eventsDelete_, p);

    case 'admin.prizesList': return admin_only_('ADMIN', token, admin_prizesList_);
    case 'admin.prizesUpsert': return admin_only_('ADMIN', token, admin_prizesUpsert_, p);
    case 'admin.prizesDelete': return admin_only_('ADMIN', token, admin_prizesDelete_, p);

    case 'admin.usersList': return admin_only_('ADMIN', token, admin_usersList_);
    case 'admin.usersUpsert': return admin_only_('ADMIN', token, admin_usersUpsert_, p);
    case 'admin.usersResetPassword': return admin_only_('ADMIN', token, admin_usersResetPassword_, p);

    case 'admin.setCurrentEvent': return admin_only_('ADMIN', token, admin_setCurrentEvent_, p);

    // ---- Operator (token required, role OPERATOR/ADMIN) ----
    case 'operator.drawDoorprize': return operator_any_(token, operator_drawDoorprize_, p);
    case 'operator.doorprizeListByPrize': return operator_any_(token, operator_doorprizeListByPrize_, p);
    case 'operator.doorprizeMarkTaken': return operator_any_(token, operator_doorprizeMarkTaken_, p);
    case 'operator.doorprizeRemoveAndRedraw': return operator_any_(token, operator_doorprizeRemoveAndRedraw_, p);
    case 'operator.setCurrentEvent': return operator_any_(token, operator_setCurrentEvent_, p);
    case 'public.getDoorprizeByNIK': return public_getDoorprizeByNIK_(p);
    case 'admin.uploadPrizeImage': return admin_only_('ADMIN', token, admin_uploadPrizeImage_, p);
    case 'public.getPrizeImageDataUrl': return public_getPrizeImageDataUrl_(p);
    case 'operator.prizesList': return operator_any_(token, operator_prizesList_, p);
    case 'operator.participantsEligible': return operator_any_(token, operator_participantsEligible_, p);
    case 'public.markDoorprizeTaken': return public_markDoorprizeTaken_(p);
    case 'operator.confirmStage':  return operator_any_(token, operator_confirmStage_, p);
    case 'operator.eventsList': return operator_any_(token, operator_eventsList_, p);

    // ---- Public config ----
    case 'public.getConfig': return public_getConfig_();

    // ---- Admin config ----
    case 'admin.configGet': return admin_only_('ADMIN', token, admin_configGet_);
    case 'admin.configSet': return admin_only_('ADMIN', token, admin_configSet_, p);

    default: throw new Error('Unknown action: ' + action);
  }
}

function admin_only_(role, token, fn, payload){
  const u = sessionRequire_(token);
  if(u.role !== role) throw new Error('Forbidden: role ' + role + ' required');
  return fn(payload, u);
}

function operator_any_(token, fn, payload){
  const u = sessionRequire_(token);
  if(u.role !== 'ADMIN' && u.role !== 'OPERATOR') throw new Error('Forbidden: operator role required');
  return fn(payload, u);
}

// ==========================
// Spreadsheet helpers
// ==========================
function ss_(){
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sh_(name){
  const s = ss_();
  const sh = s.getSheetByName(name);
  if(!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function ensureSheet_(name, headers){
  const s = ss_();
  let sh = s.getSheetByName(name);
  if(!sh) sh = s.insertSheet(name);
  if(headers && headers.length){
    const firstRow = sh.getRange(1,1,1,headers.length).getValues()[0];
    const empty = firstRow.every(v=>String(v||'').trim()==='');
    if(empty) sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

function getAll_(sheetName){
  const sh = sh_(sheetName);
  const data = sh.getDataRange().getValues();
  if(data.length < 2) return [];
  const headers = data[0].map(String);
  const out = [];
  for(let i=1;i<data.length;i++){
    const row = data[i];
    if(row.join('').trim()==='') continue;
    const o = {};
    headers.forEach((h,idx)=>o[h]=row[idx]);
    out.push(o);
  }
  return out;
}

function upsertByKey_(sheetName, keyField, obj){
  const sh = sh_(sheetName);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  const keyIdx = headers.indexOf(keyField);
  if(keyIdx < 0) throw new Error('Key field not found: ' + keyField);

  const rowObj = headers.map(h => obj[h] !== undefined ? obj[h] : '');

  // find
  let targetRow = -1;
  for(let i=1;i<data.length;i++){
    if(String(data[i][keyIdx]) === String(obj[keyField])){ targetRow = i+1; break; }
  }
  if(targetRow === -1){
    sh.appendRow(rowObj);
    targetRow = sh.getLastRow();
  }else{
    sh.getRange(targetRow,1,1,headers.length).setValues([rowObj]);
  }
  return { row: targetRow };
}

function deleteByKey_(sheetName, keyField, key){
  const sh = sh_(sheetName);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  const keyIdx = headers.indexOf(keyField);
  if(keyIdx < 0) throw new Error('Key field not found: ' + keyField);
  for(let i=1;i<data.length;i++){
    if(String(data[i][keyIdx]) === String(key)){
      sh.deleteRow(i+1);
      return true;
    }
  }
  return false;
}

function nowIso_(){
  return Utilities.formatDate(new Date(), APP_TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function toLocal_(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return Utilities.formatDate(d, APP_TZ, 'dd MMM yyyy HH:mm');
}

// ==========================
// Auth + sessions
// ==========================
function hash_(s){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s)+SALT);
  return bytes.map(b => (b<0?b+256:b).toString(16).padStart(2,'0')).join('');
}

function sessionCreate_(user){
  const token = Utilities.getUuid();
  const exp = new Date(Date.now() + SESSION_DAYS*24*3600*1000);
  const item = {
    token,
    username: user.username,
    role: user.role,
    name: user.name || user.username,
    expires_at: exp.toISOString()
  };
  upsertByKey_(SH.sessions, 'token', item);
  return token;
}

function sessionRequire_(token){
  if(!token) throw new Error('Unauthorized: token required');
  const rows = getAll_(SH.sessions);
  const r = rows.find(x => String(x.token) === String(token));
  if(!r) throw new Error('Unauthorized: invalid token');
  if(new Date(r.expires_at) < new Date()) throw new Error('Unauthorized: session expired');
  return { username:r.username, role:r.role, name:r.name };
}

function auth_login_(p){
  const username = String(p.username||'').trim();
  const password = String(p.password||'');
  if(!username || !password) throw new Error('Username/password required');

  const users = getAll_(SH.users);
  const u = users.find(x => String(x.username)===username);
  if(!u) throw new Error('User not found');
  if(String(u.active||'TRUE').toUpperCase() === 'FALSE') throw new Error('User disabled');

  const ok = String(u.password_hash) === hash_(password);
  if(!ok) throw new Error('Wrong password');

  const token = sessionCreate_(u);
  return { token, user:{ username:u.username, role:u.role, name:u.name } };
}

function auth_me_(token){
  const u = sessionRequire_(token);
  return { user:u };
}

function auth_logout_(token){
  if(!token) return { ok:true };
  deleteByKey_(SH.sessions, 'token', token);
  return { ok:true };
}

// ==========================
// Public endpoints
// ==========================

function extractDriveId_(s){
  var str = String(s || '').trim();
  if(!str) return '';
  // id mentah
  if(/^[a-zA-Z0-9_-]{20,}$/.test(str) && str.indexOf('http') < 0) return str;

  // uc?export=view&id=ID
  var m = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if(m && m[1]) return m[1];

  // /file/d/ID/
  m = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if(m && m[1]) return m[1];

  // googleusercontent /d/ID
  m = str.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if(m && m[1]) return m[1];

  return '';
}

// ✅ PUBLIC: ambil gambar Doorprize sebagai dataURL (anti ORB)
function public_getPrizeImageDataUrl_(p){
  var any = String((p && (p.fileId || p.id || p.url)) || '').trim();
  var fileId = extractDriveId_(any);
  if(!fileId) throw new Error('fileId required');

  // Ambil blob file dari Drive (script execute as Me -> pasti bisa baca)
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var mime = String(blob.getContentType() || 'image/jpeg');

  // batasi ukuran agar response aman (misal 2MB)
  var bytes = blob.getBytes();
  if(bytes.length > 2 * 1024 * 1024){
    // tetap bisa diubah, tapi aman untuk kuota & performa
    throw new Error('Image too large (>2MB). Compress image before upload.');
  }

  var b64 = Utilities.base64Encode(bytes);
  var dataUrl = 'data:' + mime + ';base64,' + b64;

  return { file_id: fileId, mime: mime, data_url: dataUrl, filename: file.getName() };
}

// Fungsi untuk user mengklaim doorprize
function public_markDoorprizeTaken_(p) {
  const drawId = String(p.drawId||'');
  const nik = String(p.nik||'');
  
  if(!drawId || !nik) throw new Error('drawId dan nik required');
  
  const draws = getAll_(SH.draws);
  const draw = draws.find(d => String(d.draw_id) === drawId && String(d.nik) === nik);
  
  if(!draw) throw new Error('Doorprize tidak ditemukan');
  if(String(draw.status) !== 'WIN') throw new Error('Doorprize sudah diproses');
  
  // Update status
  const obj = Object.assign({}, draw, { 
    status: 'TAKEN', 
    taken_at: nowIso_(),
    taken_by: 'USER_SELF'
  });
  
  upsertByKey_(SH.draws, 'draw_id', obj);
  return { ok: true };
}

function public_getParticipantByNIK_(p){
  const nik = String(p.nik||'').trim();
  if(!nik) throw new Error('NIK required');
  const rows = getAll_(SH.participants);
  const r = rows.find(x => String(x.nik)===nik);
  if(!r) return null;
  return {
    nik: r.nik,
    name: r.name,
    position: r.position,
    department: r.department,
    is_staff: bool_(r.is_staff),
    family: safeJson_(r.family_json, [])
  };
}

function public_getAttendanceStatus_(p){
  const nik = String(p.nik||'').trim();
  if(!nik) throw new Error('NIK required');
  const eventId = currentEventId_();
  const att = getAll_(SH.attendance);
  const already = att.some(x => String(x.event_id)===eventId && String(x.nik)===nik);
  const participant = already ? public_getParticipantByNIK_({nik}) : null;
  return { already, event_id:eventId, participant };
}

function public_submitAttendance_(p){
  const nik = String(p.nik||'').trim();
  let family = Array.isArray(p.family) ? p.family : [];
  if(!nik) throw new Error('NIK required');

  const eventId = currentEventId_();
  const att = getAll_(SH.attendance);
  if(att.some(x => String(x.event_id)===eventId && String(x.nik)===nik)){
    return { ok:true, already:true };
  }

  const part = public_getParticipantByNIK_({nik});
  if(!part) throw new Error('NIK not found');

  // ✅ jika peserta lajang / tidak memilih keluarga, tetap boleh absen:
  // minimal hadir = peserta utama
  if(!family.length){
    family = [ String(part.name || nik) + ' (Peserta Utama)' ];
  }

  const item = {
    id: Utilities.getUuid(),
    event_id: eventId,
    nik: part.nik,
    name: part.name,
    family_json: JSON.stringify(family),
    timestamp: nowIso_()
  };
  sh_(SH.attendance).appendRow(attendanceRow_(item));
  return { ok:true };
}

// ==========================
// App Config (Server-managed)
// ==========================

function configDefault_(){
  // ✅ ini hanya DEFAULT PATCH (bukan seluruh config.js)
  // yang disimpan di server hanya field yang mau dioverride.
  return {
    event: {
      name: "Family Gathering KMP1 Tahun 2026",
      galaDinnerDate: "2026-01-19T07:00:00+07:00",
      galaDinnerEndTime: "2026-01-19T23:50:00+07:00",
      eventStartDate: "2026-01-16T00:00:00+07:00",
      eventEndDate: "2026-01-19T23:59:59+07:00",
      location: {
        name: "Seriang Training Center",
        address: "Desa Kekurak Kecamatan Badau",
        coordinates: { latitude: 0.960484631752835, longitude: 111.89255411462112, accuracy: 50 },
        geofencingRadius: 2500
      }
    },
    app: {
      doorprizeConfirmTimeout: 60000,
      locationUpdateInterval: 30000,
      eventSwitchInterval: 180000,
      notificationTimeout: 5000
    },
    security: {
      nikMinLength: 8,
      enableDateValidation: true,
      enableGeofencing: true,
      debugMode: false
    }
  };
}

function configGet_(){
  var cache = CacheService.getScriptCache();
  var cached = cache.get('FG_APP_CONFIG_V1');
  if(cached){
    try { return JSON.parse(cached); } catch (e) {}
  }

  // ensure sheet exists
  ensureSheet_(SH.config, ['key','value_json','updated_at','updated_by']);

  var rows = getAll_(SH.config);
  var r = rows.find(function(x){ return String(x.key) === 'CFG'; });

  var cfg = null;
  if(r && r.value_json){
    try { cfg = JSON.parse(String(r.value_json || '{}')); } catch(e){ cfg = null; }
  }
  if(!cfg) cfg = configDefault_();

  // ✅ Apps Script cache API: put(), bukan set()
  cache.put('FG_APP_CONFIG_V1', JSON.stringify(cfg), 300); // 5 menit
  return cfg;
}

function configSet_(cfgPatch, username){
  ensureSheet_(SH.config, ['key','value_json','updated_at','updated_by']);

  var obj = {
    key: 'CFG',
    value_json: JSON.stringify(cfgPatch || {}),
    updated_at: nowIso_(),
    updated_by: String(username||'')
  };

  upsertByKey_(SH.config, 'key', obj);

  // ✅ bust cache
  CacheService.getScriptCache().remove('FG_APP_CONFIG_V1');
  return { ok:true };
}

// ✅ PUBLIC: dipakai user app untuk ambil config override
function public_getConfig_(){
  return { config: configGet_() };
}

// ✅ ADMIN: ambil config
function admin_configGet_(p, u){
  const cfg = configGet_();
  return { config: cfg };
}

// ✅ ADMIN: simpan config (patch)
function admin_configSet_(p, u){
  const patch = (p && p.config) ? p.config : {};
  // validasi ringan
  if(!patch || typeof patch !== 'object') throw new Error('config harus object');

  // simpan patch
  configSet_(patch, u.username);
  return { ok:true };
}

function public_getSchedule_(){
  function normDate_(v){
    if(!v) return '';
    if(Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())){
      return Utilities.formatDate(v, APP_TZ, 'yyyy-MM-dd');
    }
    if(typeof v === 'number'){
      var d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return Utilities.formatDate(d, APP_TZ, 'yyyy-MM-dd');
    }
    var s = String(v).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d2 = new Date(s);
    if(!isNaN(d2.getTime())){
      return Utilities.formatDate(d2, APP_TZ, 'yyyy-MM-dd');
    }
    return s;
  }

  const ev = getAll_(SH.events).map(r => ({
    id: String(r.id),
    day: Number(r.day || 1),
    date: normDate_(r.date),   // ✅ ganti ini
    time: String(r.time || ''),
    title: String(r.title || ''),
    description: String(r.description || ''),
    location: String(r.location || ''),
    icon: String(r.icon || ''),
    color: String(r.color || 'blue'),
    sort: Number(r.sort || 0)
  }))
  .map(e => ({ ...e, day: (isFinite(e.day) && e.day >= 1) ? Math.floor(e.day) : 1 }))
  .sort((a,b)=> (a.day - b.day) || (a.sort - b.sort));

  const dailySchedules = {};
  ev.forEach(e=>{
    const key = 'day' + String(e.day);
    if(!dailySchedules[key]){
      dailySchedules[key] = {
        dayNumber: e.day,
        date: e.date,
        title: '',
        theme: 'Rangkaian Kegiatan',
        icon: e.icon || 'fa-calendar',
        color: e.color || 'blue',
        activities: [],
        notes: []
      };
    }

    dailySchedules[key].activities.push({
      time: e.time,
      title: e.title,
      description: e.description,
      location: e.location,
      icon: e.icon || 'fa-circle'
    });

    if(!dailySchedules[key].title && e.title) dailySchedules[key].title = e.title;
    if(dailySchedules[key].date === '' && e.date) dailySchedules[key].date = e.date;
    if((!dailySchedules[key].icon || dailySchedules[key].icon === 'fa-calendar') && e.icon) dailySchedules[key].icon = e.icon;
    if((!dailySchedules[key].color || dailySchedules[key].color === 'blue') && e.color) dailySchedules[key].color = e.color;
  });

  const sortedKeys = Object.keys(dailySchedules).sort((a,b)=>{
    const da = Number(String(a).replace('day','')) || 0;
    const db = Number(String(b).replace('day','')) || 0;
    return da - db;
  });

  const ordered = {};
  sortedKeys.forEach(k => ordered[k] = dailySchedules[k]);

  return { events: ev, dailySchedules: ordered };
}

function public_getCurrentEvent_(){
  const cur = getAll_(SH.current);
  if(!cur.length) return { event:null };
  const id = String(cur[0].event_id||'');
  if(!id) return { event:null };
  const ev = getAll_(SH.events);
  const r = ev.find(x => String(x.id)===id);
  if(!r) return { event:null };
  return { event:{
    id: String(r.id),
    day: Number(r.day||0),
    time: String(r.time||''),
    title: String(r.title||''),
    description: String(r.description||''),
    location: String(r.location||''),
    active: true
  }};
}

function public_getDoorprizeFeed_(p){
  const limit = Number(p.limit||10);
  const rows = getAll_(SH.draws)
    .map(r => ({
      draw_id: String(r.draw_id),
      prize_id: String(r.prize_id),
      prize_name: String(r.prize_name),
      prize_image: String(r.prize_image||''),
      slot: Number(r.slot||0),
      nik: String(r.nik),
      name: String(r.name),
      status: String(r.status||'WIN'),
      timestamp: String(r.timestamp),
      time_local: toLocal_(r.timestamp)
    }))
    .sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
  return { rows };
}

function public_getDoorprizeByNIK_(p){
  const nik = String(p.nik || '').trim();
  const limit = Number(p.limit || 10);
  if(!nik) throw new Error('NIK required');

  const rows = getAll_(SH.draws)
    .filter(r => String(r.nik) === nik) // ✅ hanya milik NIK ini
    .map(r => ({
      draw_id: String(r.draw_id),
      prize_id: String(r.prize_id),
      prize_name: String(r.prize_name),
      prize_image: String(r.prize_image||''),
      slot: Number(r.slot||0),
      nik: String(r.nik),
      name: String(r.name),
      status: String(r.status||'WIN'),
      timestamp: String(r.timestamp),
      time_local: toLocal_(r.timestamp)
    }))
    .sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);

  return { rows };
}

// ==========================
// Admin endpoints
// ==========================
function admin_participantsList_(){
  const rows = getAll_(SH.participants).map(r=>({
    nik:String(r.nik),
    name:String(r.name),
    position:String(r.position),
    department:String(r.department),
    is_staff: bool_(r.is_staff),
    family: safeJson_(r.family_json, [])
  }));
  return { rows };
}

function admin_participantsUpsert_(p){
  const it = p.item || {};
  if(!it.nik) throw new Error('NIK required');
  const obj = {
    nik: String(it.nik),
    name: String(it.name||''),
    position: String(it.position||''),
    department: String(it.department||''),
    is_staff: bool_(it.is_staff) ? 'TRUE' : 'FALSE',
    family_json: JSON.stringify(Array.isArray(it.family)?it.family:[])
  };
  upsertByKey_(SH.participants, 'nik', obj);
  return { ok:true };
}

function admin_participantsDelete_(p){
  const nik = String(p.nik||'');
  if(!nik) throw new Error('NIK required');
  deleteByKey_(SH.participants, 'nik', nik);
  return { ok:true };
}

function admin_eventsList_(){
  const rows = getAll_(SH.events).map(r=>({
    id:String(r.id),
    day:Number(r.day||0),
    date:String(r.date||''),
    time:String(r.time||''),
    title:String(r.title||''),
    description:String(r.description||''),
    location:String(r.location||''),
    icon:String(r.icon||''),
    color:String(r.color||'blue'),
    sort:Number(r.sort||0)
  }));
  return { rows };
}

function admin_eventsUpsert_(p){
  const it = p.item || {};
  if(!it.id) it.id = Utilities.getUuid();
  const obj = {
    id:String(it.id),
    day:Number(it.day||1),
    date:String(it.date||''),
    time:String(it.time||''),
    title:String(it.title||''),
    description:String(it.description||''),
    location:String(it.location||''),
    icon:String(it.icon||'fa-calendar'),
    color:String(it.color||'blue'),
    sort:Number(it.sort||0)
  };
  upsertByKey_(SH.events, 'id', obj);
  return { ok:true, id: obj.id };
}

function admin_eventsDelete_(p){
  const id = String(p.id||'');
  if(!id) throw new Error('id required');
  deleteByKey_(SH.events, 'id', id);
  return { ok:true };
}

function admin_prizesList_(){
  const rows = getAll_(SH.prizes).map(r=>({
    id:String(r.id),
    name:String(r.name),
    qty_total:Number(r.qty_total||0),
    qty_remaining:Number(r.qty_remaining||0),
    image_url:String(r.image_url||''),
    active: bool_(r.active)
  }));
  return { rows };
}

function admin_prizesUpsert_(p){
  const it = p.item || {};
  if(!it.id) it.id = Utilities.getUuid();
  const obj = {
    id:String(it.id),
    name:String(it.name||''),
    qty_total:Number(it.qty_total||0),
    qty_remaining: (it.qty_remaining!==undefined?Number(it.qty_remaining):Number(it.qty_total||0)),
    image_url:String(it.image_url||''),
    active: bool_(it.active) ? 'TRUE' : 'FALSE'
  };
  upsertByKey_(SH.prizes, 'id', obj);
  return { ok:true, id: obj.id };
}

function admin_prizesDelete_(p){
  const id = String(p.id||'');
  if(!id) throw new Error('id required');
  deleteByKey_(SH.prizes, 'id', id);
  return { ok:true };
}

function admin_uploadPrizeImage_(p, u){
  var filename = String((p && p.filename) || '').trim() || ('doorprize_' + Utilities.getUuid() + '.jpg');
  var mimeType = String((p && p.mimeType) || 'image/jpeg').trim() || 'image/jpeg';
  var dataBase64 = String((p && p.dataBase64) || '').trim();

  if(!dataBase64) throw new Error('dataBase64 required');
  if(!PRIZE_IMG_FOLDER_ID) throw new Error('PRIZE_IMG_FOLDER_ID belum diisi');

  // Bersihkan jika ternyata ada "data:image/...;base64," (jaga-jaga)
  var ix = dataBase64.indexOf('base64,');
  if(ix >= 0) dataBase64 = dataBase64.substring(ix + 7);

  // validasi base64 sederhana (tidak wajib, tapi membantu)
  if(!/^[A-Za-z0-9+/=]+$/.test(dataBase64)){
    throw new Error('dataBase64 invalid (harus base64 murni)');
  }

  // Batasi ukuran: ~5MB (base64 lebih besar)
  // pakai angka biasa (tanpa underscore) agar kompatibel
  if(dataBase64.length > 7000000){
    throw new Error('File terlalu besar (maks ~5MB). Kompres gambar dulu.');
  }

  var bytes = Utilities.base64Decode(dataBase64);
  var blob = Utilities.newBlob(bytes, mimeType, filename);

  var folder = DriveApp.getFolderById(PRIZE_IMG_FOLDER_ID);
  var file = folder.createFile(blob);

  // Sharing agar bisa di-load oleh <img> user app
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();

  // ✅ URL paling stabil untuk <img> (menghindari ORB)
  var directUrl = 'https://lh3.googleusercontent.com/d/' + fileId;

  // ✅ fallback (kadang memicu ORB di Chrome/Edge)
  var viewUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;

  var openUrl = file.getUrl();

  return {
    file_id: fileId,
    direct_url: directUrl,
    view_url: viewUrl,
    open_url: openUrl,
    filename: filename
  };

}

function admin_usersList_(){
  const rows = getAll_(SH.users).map(r=>({
    username:String(r.username),
    name:String(r.name||''),
    role:String(r.role||'OPERATOR'),
    active: bool_(r.active)
  }));
  return { rows };
}

function admin_usersUpsert_(p){
  const it = p.item || {};
  if(!it.username) throw new Error('username required');
  const existing = getAll_(SH.users).find(r=>String(r.username)===String(it.username));
  const obj = {
    username:String(it.username),
    name:String(it.name||''),
    role:String(it.role||'OPERATOR'),
    active: bool_(it.active) ? 'TRUE' : 'FALSE',
    password_hash: existing ? String(existing.password_hash) : hash_('user123')
  };
  upsertByKey_(SH.users, 'username', obj);
  return { ok:true };
}

function admin_usersResetPassword_(p){
  const username = String(p.username||'').trim();
  const newPassword = String(p.newPassword||'');
  if(!username || !newPassword) throw new Error('username/newPassword required');
  const users = getAll_(SH.users);
  const u = users.find(r=>String(r.username)===username);
  if(!u) throw new Error('User not found');
  const obj = {
    username:u.username,
    name:u.name,
    role:u.role,
    active:u.active,
    password_hash: hash_(newPassword)
  };
  upsertByKey_(SH.users, 'username', obj);
  return { ok:true };
}

function admin_setCurrentEvent_(p){
  const eventId = String(p.eventId||'');
  if(!eventId) throw new Error('eventId required');
  upsertByKey_(SH.current, 'id', { id:'CUR', event_id:eventId, updated_at: nowIso_() });
  return { ok:true };
}

// ==========================
// Operator endpoints
// ==========================
function operator_setCurrentEvent_(p, u){
  const eventId = String(p.eventId||'');
  if(!eventId) throw new Error('eventId required');
  upsertByKey_(SH.current, 'id', { id:'CUR', event_id:eventId, updated_at: nowIso_(), updated_by:u.username });
  return { ok:true };
}

function operator_drawDoorprize_(p, u){
  const prizeId = String(p.prizeId||'');
  const count = Math.max(1, Number(p.count||1));
  if(!prizeId) throw new Error('prizeId required');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const prize = getAll_(SH.prizes).find(r=>String(r.id)===prizeId);
    if(!prize) throw new Error('Doorprize not found');
    const remain = Number(prize.qty_remaining||0);
    if(remain <= 0) throw new Error('Stok doorprize habis');

    const n = Math.min(count, remain);
    const winners = [];

    for(let i=0;i<n;i++){
      const w = drawOne_(prizeId, i+1, u);
      if(!w) throw new Error('Tidak ada peserta staff yang eligible untuk diundi');
      winners.push(w);
    }

    // update remaining
    const newRemain = remain - n;
    admin_prizesUpsert_({ item: {
      id: prize.id,
      name: prize.name,
      qty_total: Number(prize.qty_total||0),
      qty_remaining: newRemain,
      image_url: prize.image_url,
      active: bool_(prize.active)
    }});

    return { ok:true, winners };
  }finally{
    lock.releaseLock();
  }
}

function operator_doorprizeListByPrize_(p){
  const prizeId = String(p.prizeId||'');
  if(!prizeId) throw new Error('prizeId required');
  const rows = getAll_(SH.draws)
    .filter(r=>String(r.prize_id)===prizeId)
    .sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp))
    .map(r=>({
      draw_id:String(r.draw_id),
      prize_id:String(r.prize_id),
      prize_name:String(r.prize_name),
      prize_image:String(r.prize_image||''),
      slot:Number(r.slot||0),
      nik:String(r.nik),
      name:String(r.name),
      status:String(r.status||'WIN'),
      timestamp:String(r.timestamp),
      time_local: toLocal_(r.timestamp)
    }));
  return { rows };
}

function operator_doorprizeMarkTaken_(p){
  const drawId = String(p.drawId||'');
  if(!drawId) throw new Error('drawId required');
  const draws = getAll_(SH.draws);
  const r = draws.find(x=>String(x.draw_id)===drawId);
  if(!r) throw new Error('draw not found');

  // update row
  const obj = Object.assign({}, r, { status:'TAKEN', taken_at: nowIso_() });
  upsertByKey_(SH.draws, 'draw_id', obj);
  return { ok:true };
}

function operator_doorprizeRemoveAndRedraw_(p, u){
  const drawId = String(p.drawId||'');
  if(!drawId) throw new Error('drawId required');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const draws = getAll_(SH.draws);
    const old = draws.find(x => String(x.draw_id) === drawId);
    if(!old) throw new Error('draw not found');

    const prizeId = String(old.prize_id);
    const prize = getAll_(SH.prizes).find(r => String(r.id) === prizeId);
    if(!prize) throw new Error('Doorprize not found');

    /* ===============================
       1. Tandai pemenang lama NO_SHOW
       =============================== */
    upsertByKey_(SH.draws, 'draw_id', {
      ...old,
      status: 'NO_SHOW',
      removed_at: nowIso_(),
      removed_by: u.username
    });

    /* ===============================
       2. KEMBALIKAN STOK (+1)
       =============================== */
    const restoredRemain = Number(prize.qty_remaining || 0) + 1;

    admin_prizesUpsert_({
      item: {
        id: prize.id,
        name: prize.name,
        qty_total: Number(prize.qty_total || 0),
        qty_remaining: restoredRemain,
        image_url: prize.image_url,
        active: bool_(prize.active)
      }
    });

    /* ===============================
       3. DRAW PENGGANTI
       =============================== */
    const replacement = drawOne_(
      prizeId,
      Number(old.slot || 0),
      u,
      drawId
    );

    if(!replacement)
      throw new Error('Tidak ada peserta eligible untuk pengganti');

    /* ===============================
       4. KURANGI STOK LAGI (-1)
       =============================== */
    admin_prizesUpsert_({
      item: {
        id: prize.id,
        name: prize.name,
        qty_total: Number(prize.qty_total || 0),
        qty_remaining: restoredRemain - 1,
        image_url: prize.image_url,
        active: bool_(prize.active)
      }
    });

    return { ok:true, replacement };

  } finally {
    lock.releaseLock();
  }
}

function operator_prizesList_(p, u){
  // sama seperti admin_prizesList_ tapi boleh OPERATOR
  const rows = getAll_(SH.prizes).map(r=>({
    id:String(r.id),
    name:String(r.name),
    qty_total:Number(r.qty_total||0),
    qty_remaining:Number(r.qty_remaining||0),
    image_url:String(r.image_url||''),
    active: bool_(r.active)
  }));
  return { rows };
}

function operator_participantsEligible_(p, u){
  // pool untuk undian: default hanya STAFF eligible
  const onlyStaff = (p && p.onlyStaff !== undefined) ? bool_(p.onlyStaff) : true;

  const rows = getAll_(SH.participants)
    .filter(r => !onlyStaff || bool_(r.is_staff))
    .map(r=>({
      nik: String(r.nik),
      name: String(r.name||''),
      is_staff: bool_(r.is_staff)
    }));

  return { rows };
}

function operator_confirmStage_(p, u){
  const prizeId = String(p.prizeId||'');
  if(!prizeId) throw new Error('prizeId required');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try{
    const draws = getAll_(SH.draws);
    const now = nowIso_();
    let updated = 0;

    draws.forEach(d => {
      if (String(d.prize_id) === prizeId && String(d.status || '') === 'WIN') {
        upsertByKey_(SH.draws, 'draw_id', {
          ...d,
          status: 'TAKEN',
          taken_at: now,
          taken_by: u.username
        });
        updated++;
      }
    });

    return { ok:true, updated, status:'TAKEN' };
  } finally {
    lock.releaseLock();
  }
}

function operator_eventsList_(p, u){
  return admin_eventsList_();
}


function drawOne_(prizeId, slot, u, replacedDrawId){
  const prize = getAll_(SH.prizes).find(r=>String(r.id)===prizeId);
  const participants = getAll_(SH.participants)
    .filter(r => bool_(r.is_staff));

  // exclude semua yang pernah menang/terundi (apa pun statusnya)
  const drawnNiks = new Set(getAll_(SH.draws).map(r=>String(r.nik)));

  const eligible = participants
    .map(r=>({ nik:String(r.nik), name:String(r.name) }))
    .filter(p => !drawnNiks.has(p.nik));

  if(!eligible.length) return null;
  const pick = eligible[Math.floor(Math.random()*eligible.length)];

  const draw = {
    draw_id: Utilities.getUuid(),
    prize_id: prizeId,
    prize_name: String(prize.name||''),
    prize_image: String(prize.image_url||''),
    slot: Number(slot||0),
    nik: pick.nik,
    name: pick.name,
    status: 'WIN',
    timestamp: nowIso_(),
    by_user: u.username,
    replaced_draw_id: replacedDrawId || ''
  };

  upsertByKey_(SH.draws, 'draw_id', draw);
  return draw;
}

// ==========================
// Utilities
// ==========================
function bool_(x){
  const s = String(x||'').toUpperCase();
  return x === true || s === 'TRUE' || s === '1' || s === 'YES' || s === 'Y';
}

function safeJson_(s, fallback){
  try{ return JSON.parse(String(s||'')); }catch{ return fallback; }
}

function currentEventId_(){
  // gunakan event date sebagai id sederhana
  return 'GALA_' + Utilities.formatDate(new Date(), APP_TZ, 'yyyy');
}

function attendanceRow_(it){
  const headers = sh_(SH.attendance).getRange(1,1,1,sh_(SH.attendance).getLastColumn()).getValues()[0].map(String);
  return headers.map(h => it[h] !== undefined ? it[h] : '');
}

// ==========================
// Setup (jalankan sekali)
// ==========================
function setup(){
  if(SPREADSHEET_ID.indexOf('PASTE_')===0) throw new Error('Isi SPREADSHEET_ID dulu');

  ensureSheet_(SH.participants, ['nik','name','position','department','is_staff','family_json']);
  ensureSheet_(SH.attendance, ['id','event_id','nik','name','family_json','timestamp']);
  ensureSheet_(SH.events, ['id','day','date','time','title','description','location','icon','color','sort']);
  ensureSheet_(SH.current, ['id','event_id','updated_at','updated_by']);
  ensureSheet_(SH.prizes, ['id','name','qty_total','qty_remaining','image_url','active']);
  ensureSheet_(SH.draws, ['draw_id','prize_id','prize_name','prize_image','slot','nik','name','status','timestamp','by_user','replaced_draw_id','taken_at','taken_by','removed_at','removed_by','confirmed_at','confirmed_by']);
  ensureSheet_(SH.users, ['username','name','role','active','password_hash']);
  ensureSheet_(SH.sessions, ['token','username','role','name','expires_at']);
  ensureSheet_(SH.logs, ['ts','action','detail']);
  ensureSheet_(SH.config, ['key','value_json','updated_at','updated_by']);

  seedInitialData_();

  SpreadsheetApp.getActive().toast('Setup selesai. Silakan cek sheet dan Deploy Web App.');
}

function seedInitialData_(){
  // --- Admin default ---
  const users = getAll_(SH.users);
  if(!users.find(r=>String(r.username)==='admin')){
    upsertByKey_(SH.users,'username',{
      username:'admin',
      name:'Administrator',
      role:'ADMIN',
      active:'TRUE',
      password_hash: hash_('admin123')
    });
  }
  if(!users.find(r=>String(r.username)==='operator')){
    upsertByKey_(SH.users,'username',{
      username:'operator',
      name:'Operator',
      role:'OPERATOR',
      active:'TRUE',
      password_hash: hash_('operator123')
    });
  }

  // --- Seed participants (dari prototype) ---
  const p = getAll_(SH.participants);
  if(p.length===0){
    const sample = [
      { nik:'12345678', name:'Budi Santoso', position:'Manager', department:'Produksi', is_staff:'FALSE', family_json: JSON.stringify(['Budi Santoso','Sari Dewi (Istri)','Rizky Pratama (Anak)','Sinta Noviana (Anak)']) },
      { nik:'87654321', name:'Ahmad Hidayat', position:'Supervisor', department:'Keuangan', is_staff:'FALSE', family_json: JSON.stringify(['Ahmad Hidayat','Lisa Permata (Istri)','Fajar Ramadan (Anak)']) },
      { nik:'11223344', name:'Siti Nurhaliza', position:'Staff', department:'SDM', is_staff:'TRUE', family_json: JSON.stringify(['Siti Nurhaliza','Rudi Hartono (Suami)','Maya Indah (Anak)','Dika Pratama (Anak)']) },
      { nik:'55667788', name:'Rina Wijaya', position:'Manager', department:'Marketing', is_staff:'FALSE', family_json: JSON.stringify(['Rina Wijaya','Joko Susilo (Suami)']) },
      { nik:'99887766', name:'Andi Setiawan', position:'Staff', department:'Operasional', is_staff:'TRUE', family_json: JSON.stringify(['Andi Setiawan','Mira Lestari (Istri)','Kevin Maulana (Anak)','Sari Dewi (Anak)','Budi Santoso (Anak)']) }
    ];
    sample.forEach(it=> upsertByKey_(SH.participants,'nik',it));
  }

  // --- Seed events ---
  const e = getAll_(SH.events);
  if(e.length===0){
    const baseDate = 'Minggu, 18 Januari 2026';
    const loc = 'Grand Ballroom';
    const sampleEv = [
      { id:'event-1', day:3, date:baseDate, time:'16:00 - 16:30', title:'Pembukaan Acara', description:'Pembukaan resmi Famili Gathering KMP1 2026', location:loc, icon:'fa-microphone', color:'purple', sort:1 },
      { id:'event-2', day:3, date:baseDate, time:'16:30 - 17:00', title:'Sambutan & Laporan', description:'Sambutan dari manajemen dan laporan kegiatan', location:loc, icon:'fa-chart-line', color:'purple', sort:2 },
      { id:'event-3', day:3, date:baseDate, time:'17:00 - 18:30', title:'Makan Malam', description:'Gala dinner dengan berbagai hidangan spesial', location:loc, icon:'fa-utensils', color:'purple', sort:3 },
      { id:'event-4', day:3, date:baseDate, time:'18:30 - 19:30', title:'Hiburan & Performance', description:'Sesi hiburan dan performance dari peserta', location:loc, icon:'fa-theater-masks', color:'purple', sort:4 },
      { id:'event-5', day:3, date:baseDate, time:'19:30 - 21:00', title:'Pengundian Doorprize', description:'Pengundian doorprize menarik', location:loc, icon:'fa-gift', color:'purple', sort:5 },
      { id:'event-6', day:3, date:baseDate, time:'21:00 - 21:30', title:'Penutupan & Foto Bersama', description:'Penutupan acara dan foto bersama', location:loc, icon:'fa-camera', color:'purple', sort:6 }
    ];
    sampleEv.forEach(it=> upsertByKey_(SH.events,'id',it));
    upsertByKey_(SH.current,'id',{ id:'CUR', event_id:'event-1', updated_at: nowIso_(), updated_by:'setup' });
  }

  // --- Seed prizes ---
  const pr = getAll_(SH.prizes);
  if(pr.length===0){
    const samplePr = [
      { id:'prize-1', name:'Smart TV 55"', qty_total:1, qty_remaining:1, image_url:'', active:'TRUE' },
      { id:'prize-2', name:'Smartphone Flagship', qty_total:2, qty_remaining:2, image_url:'', active:'TRUE' },
      { id:'prize-3', name:'Voucher Belanja', qty_total:3, qty_remaining:3, image_url:'', active:'TRUE' }
    ];
    samplePr.forEach(it=> upsertByKey_(SH.prizes,'id',it));
  }
}
