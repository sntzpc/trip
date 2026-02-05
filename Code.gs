/**
 * Trip Tracker Backend (Google Apps Script)
 * - Deploy as Web App: Execute as Me, Who has access: Anyone
 * - Gunakan URL script.googleusercontent.com untuk frontend (hindari CORS)
 */

const CONFIG = {
  SHEET_ID: '1sVmDbB0DxQWRsx9CTqCZMwf5kLgCkTT0br1ykmVUpGw',
  SHEETS: {
    USERS:'Users',
    VEHICLES:'Vehicles',
    PARTICIPANTS:'Participants',
    ARRIVALS:'Arrivals',
    HISTORY:'History',
    SESSIONS:'Sessions',
    SETTINGS:'Settings',
    TRIPS:'Trips',
    OPS:'ClientOps'
  },
  DEFAULT_PASSWORD: 'user123',
  SESSION_DURATION_DAYS: 3,
  ADMIN_NIK_PREFIX: 'ADM',
  DATA_RETENTION_DAYS: 2
};

function doGet(e){ return handleRequest(e); }
function doPost(e){ return handleRequest(e); }

function handleRequest(e){
  try{
    ensureInitialized();

    const params = extractParams(e);
    const action = params.action || '';
    let result;

    switch(action){
      case 'getConfig':
        result = getConfig();
        break;
      case 'login':
        result = handleLogin(params);
        break;
      case 'logout':
        result = handleLogout(params);
        break;
      case 'getUserData':
        result = getUserData(params);
        break;
      case 'getFamily':
        result = getFamilyMembers(params);
        break;
      case 'getDashboardData':
        result = getDashboardData(params);
        break;
      case 'getMapData':
        result = getMapData(params);
        break;
      case 'getVehicles':
        result = getVehicles(params);
        break;
      case 'getMyVehicle':
        result = getMyVehicle(params);
        break;
      case 'updateLocation':
        result = updateVehicleLocation(params);
        break;
      case 'assignVehicle':
        result = assignToVehicle(params);
        break;
      case 'confirmArrival':
        result = confirmArrival(params);
        break;
      case 'getParticipants':
        result = getParticipants(params);
        break;
      case 'changePassword':
        result = changePassword(params);
        break;
      case 'adminGetData':
        result = adminGetData(params);
        break;
      case 'adminUpdate':
        result = adminUpdate(params);
        break;
      case 'getScanCandidates':
        result = getScanCandidates(params);
        break;
      case 'assignVehicleStrict':
        result = assignVehicleStrict(params);
        break;
      default:
        result = { success:false, message:'Invalid action' };
    }

    return jsonOut(result);
  } catch (err){
    console.error(err);
    return jsonOut({ success:false, message:'Server error: ' + err.message });
  }
}

function extractParams(e){
  const p = (e && e.parameter) ? Object.assign({}, e.parameter) : {};
  // If front-end sends JSON in data field, keep as string.
  // Note: WebApp + form-urlencoded already parsed into e.parameter.
  return p;
}

function jsonOut(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== Idempotent ops (anti-duplicate cross-user) =====
function withIdempotent_(params, actionName, userId, fn){
  var opId = String((params && params._opId) || '').trim();
  if (!opId) return fn(); // no idempotent key

  var sheet = sh(CONFIG.SHEETS.OPS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2){
    sheet.appendRow(['OpId','Action','UserId','CreatedAt','ResultJson']);
    values = sheet.getDataRange().getValues();
  }
  var headers = values[0].map(String);
  var opIdx = headers.indexOf('OpId');
  var resIdx = headers.indexOf('ResultJson');
  for (var i=1;i<values.length;i++){
    if (String(values[i][opIdx]) === opId){
      var raw = values[i][resIdx];
      try{
        var parsed = JSON.parse(String(raw||'{}'));
        // tandai duplicate agar frontend bisa tahu
        if (parsed && typeof parsed === 'object') parsed.duplicate = true;
        return parsed;
      }catch(e){
        return { success:true, duplicate:true, message:'Duplicate op (cached)' };
      }
    }
  }

  var result = fn();
  try{
    sheet.appendRow([opId, String(actionName||''), String(userId||''), new Date(), JSON.stringify(result)]);
  }catch(e){}
  return result;
}

// ===== Sheets =====
function ss(){ return SpreadsheetApp.openById(CONFIG.SHEET_ID); }
function sh(name){
  const s = ss();
  return s.getSheetByName(name) || s.insertSheet(name);
}

function ensureHeader(sheet, headers){
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // sheet benar-benar kosong
  if (lastRow === 0) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  // baca row-1 (kalau belum ada kolom, treat kosong)
  const existing = (lastCol > 0)
    ? sheet.getRange(1,1,1,lastCol).getValues()[0].map(x => String(x || '').trim())
    : [];

  const allEmpty = existing.length === 0 || existing.every(x => !x);
  if (allEmpty) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  // tambah kolom header yang belum ada
  const existingSet = new Set(existing.filter(Boolean));
  const missing = headers.filter(h => !existingSet.has(String(h)));

  if (missing.length) {
    const startCol = existing.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
  }

  sheet.setFrozenRows(1);
}

function ensureInitialized(){
  // dipanggil setiap request webapp
  ensureInitializedHard_(false);
}

function ensureInitializedHard_(force){
  const prop = PropertiesService.getScriptProperties();
  const inited = prop.getProperty('TT_INIT') === '1';
  if (inited && !force) return;

  // Pastikan spreadsheet benar-benar bisa dibuka
  const s = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // Pastikan semua sheet ada + header lengkap
  ensureHeader(sh(CONFIG.SHEETS.USERS), ['NIK','Nama','Region','Estate','Role','PasswordHash']);
  ensureHeader(sh(CONFIG.SHEETS.VEHICLES), ['Code','Type','Capacity','Driver','DriverPhone','Latitude','Longitude','Status','Passengers','Barcode','TripId','LastLocAt','LastLocBy','LastUpdateAt']);
  ensureHeader(sh(CONFIG.SHEETS.PARTICIPANTS), ['NIK','Nama','Relationship','Region','Estate','Vehicle','Arrived','ArrivalTime','MainNIK','TripId','UpdatedAt']);
  ensureHeader(sh(CONFIG.SHEETS.ARRIVALS), ['NIK','ArrivalTime','ConfirmedBy','TripId']);
  ensureHeader(sh(CONFIG.SHEETS.HISTORY), ['DataType','ArchivedDate','Data','RestoredAt','RestoredBy','RestoredTo','RestoredKey','RestoreStatus']);
  ensureHeader(sh(CONFIG.SHEETS.SESSIONS), ['SessionId','UserId','Created','Expiry','Status']);
  ensureHeader(sh(CONFIG.SHEETS.SETTINGS), ['Key','Value']);
  ensureHeader(sh(CONFIG.SHEETS.TRIPS), ['TripId','Name','Start','End','Origin','Destination','Status']);
  ensureHeader(sh(CONFIG.SHEETS.OPS), ['OpId','Action','UserId','CreatedAt','ResultJson']);

  // Default settings jika belum ada
  const setSheet = sh(CONFIG.SHEETS.SETTINGS);
  if (setSheet.getLastRow() <= 1){
    setSheet.getRange(2,1,5,2).setValues([
      ['appTitle','Trip Tracker'],
      ['eventName','Trip Tracker'],
      ['eventSub','Konfigurasi oleh Admin'],
      ['orgName','Karyamas Plantation'],
      ['activeTripId','']
    ]);
  }

  // Pastikan admin ada (kalau tidak ada admin, buat/perbaiki ADM001)
  const userSheet = sh(CONFIG.SHEETS.USERS);
  const users = toObjects(userSheet);
  const hasAdmin = users.some(u => String(u.Role) === 'admin');

  if (!hasAdmin){
    const found = findRowBy(userSheet,'NIK','ADM001');
    if (found.row === -1){
      userSheet.appendRow(['ADM001','ADMINISTRATOR','HEAD OFFICE','HO','admin', hashPassword(CONFIG.DEFAULT_PASSWORD)]);
    } else {
      const headers = found.headers.map(String);
      const roleCol = headers.indexOf('Role') + 1;
      const passCol = headers.indexOf('PasswordHash') + 1;
      userSheet.getRange(found.row, roleCol).setValue('admin');
      userSheet.getRange(found.row, passCol).setValue(hashPassword(CONFIG.DEFAULT_PASSWORD));
    }
  }

  prop.setProperty('TT_INIT','1');
}

function toObjects(sheet){
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  const out = [];
  for (let i=1;i<values.length;i++){
    const row = {};
    for (let c=0;c<headers.length;c++) row[headers[c]] = values[i][c];
    out.push(row);
  }
  return out;
}

function indexBy(arr, key){
  const m = {};
  arr.forEach(o => { m[String(o[key])] = o; });
  return m;
}

// ==========================
// ✅ Helpers: normalisasi & dedupe (anti double-count)
// ==========================

function normalizeRelKey_(rel){
  const s = String(rel || '').trim().toLowerCase();
  if (!s) return 'lainnya';
  // normalisasi variasi
  if (['karyawan','staff','pegawai','employee'].includes(s)) return 'staff';
  if (['mentee','magang','training','peserta','participant'].includes(s)) return 'mentee';
  if (['istri','wife'].includes(s)) return 'istri';
  if (['suami','husband'].includes(s)) return 'suami';
  if (['anak','child'].includes(s)) return 'anak';
  if (['ayah','bapak','father'].includes(s)) return 'ayah';
  if (['ibu','mother','mama'].includes(s)) return 'ibu';
  return s;
}

function isFamilyRel_(rel){
  const k = normalizeRelKey_(rel);
  return ['istri','suami','anak','ayah','ibu','keluarga','family'].includes(k);
}

// Dedupe peserta berdasarkan NIK (+ tripId jika diberikan)
// Jika ada duplikasi baris, pilih baris yang:
// 1) Arrived=true menang
// 2) ArrivalTime paling baru menang
function dedupeParticipants_(rows, tripId){
  const list = (rows || []).filter(p=>!tripId || String(p.TripId||'')===String(tripId));
  const m = {};
  list.forEach(p=>{
    const nik = String(p.NIK||'').trim();
    if (!nik) return;
    const prev = m[nik];
    if (!prev){ m[nik] = p; return; }

    const a1 = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
    const a0 = (prev.Arrived===true || String(prev.Arrived).toLowerCase()==='true');
    if (a1 && !a0){ m[nik] = p; return; }
    if (a1 === a0){
      const t1 = safeTime_(p.ArrivalTime);
      const t0 = safeTime_(prev.ArrivalTime);
      if (t1 > t0){ m[nik] = p; return; }
    }
  });
  return Object.keys(m).map(k=>m[k]);
}

function safeTime_(v){
  try{
    const t = new Date(v).getTime();
    return isFinite(t) ? t : 0;
  }catch(e){
    return 0;
  }
}

function getArrivedNikSet_(tripId){
  const set = new Set();
  const parts = dedupeParticipants_(toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)), tripId);
  parts.forEach(p=>{
    const nik = String(p.NIK||'').trim();
    if (!nik) return;
    const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
    if (arrived) set.add(nik);
  });
  return set;
}

function getArrivalsNikSet_(tripId){
  const set = new Set();
  const sheet = sh(CONFIG.SHEETS.ARRIVALS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return set;
  const headers = values[0].map(String);
  const nikIdx = headers.indexOf('NIK');
  const tripIdx = headers.indexOf('TripId');
  for (let i=1;i<values.length;i++){
    if (tripId && tripIdx>-1 && String(values[i][tripIdx]||'') !== String(tripId)) continue;
    const nik = String(values[i][nikIdx]||'').trim();
    if (nik) set.add(nik);
  }
  return set;
}


function findRowBy(sheet, colName, value){
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { row: -1, headers: values[0]||[] };
  const headers = values[0].map(String);
  const idx = headers.indexOf(colName);
  if (idx === -1) return { row:-1, headers };
  for (let r=1;r<values.length;r++){
    if (String(values[r][idx]) === String(value)) return { row:r+1, headers };
  }
  return { row:-1, headers };
}

function bool_(v){
  return v===true || String(v).toLowerCase()==='true' || String(v)==='TRUE';
}

function uniq_(arr){
  return Array.from(new Set((arr||[]).map(x=>String(x).trim()).filter(Boolean)));
}

function splitCsv_(s){
  return String(s||'').split(';').map(x=>x.trim()).filter(Boolean);
}

function joinCsv_(arr){
  return (arr||[]).map(x=>String(x).trim()).filter(Boolean).join(',');
}

// map nik -> vehicleCode berdasarkan sheet Vehicles.Passengers (trip-filter)
function buildNikToVehicleMap_(tripId){
  const vehicles = toObjects(sh(CONFIG.SHEETS.VEHICLES))
    .filter(v=>!tripId || String(v.TripId||'')===String(tripId));

  const map = {};
  vehicles.forEach(v=>{
    const code = String(v.Code||'').trim();
    const ps = splitCsv_(v.Passengers);
    ps.forEach(nik=>{
      if (!map[nik]) map[nik] = code;
    });
  });
  return map;
}

// ambil peserta dedupe per trip
function getParticipantsDedupe_(tripId){
  return dedupeParticipants_(toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)), tripId);
}

// update participant row berdasarkan NIK + TripId (lebih aman dari fungsi lama)
function updateParticipantRow_(nik, tripId, patch){
  const sheet = sh(CONFIG.SHEETS.PARTICIPANTS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;

  const headers = (values[0]||[]).map(String);
  const nikIdx  = headers.indexOf('NIK');
  const tripIdx = headers.indexOf('TripId');

  // cari row NIK+Trip
  for (let i=1;i<values.length;i++){
    const rowNik = String(values[i][nikIdx]||'').trim();
    const rowTrip = tripIdx>-1 ? String(values[i][tripIdx]||'').trim() : '';
    if (rowNik===String(nik).trim() && (!tripId || rowTrip===String(tripId))){
      Object.keys(patch||{}).forEach(k=>{
        const c = headers.indexOf(k);
        if (c>-1) sheet.getRange(i+1, c+1).setValue(patch[k]);
      });
      return true;
    }
  }
  return false;
}

// ===== Config =====
function getConfig(){
  const setSheet = sh(CONFIG.SHEETS.SETTINGS);
  const data = setSheet.getDataRange().getValues();
  const cfg = {};
  for (let i=1;i<data.length;i++) cfg[String(data[i][0])] = data[i][1];
  return { success:true, config: cfg };
}

function setConfigKV(obj){
  const sheet = sh(CONFIG.SHEETS.SETTINGS);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i=1;i<data.length;i++) map[String(data[i][0])] = i+1;

  Object.keys(obj).forEach(k=>{
    let v = obj[k];

    // keamanan: jangan simpan PIN bypass dalam bentuk plain-text
    // Frontend mengirim: arrivalBypassPin atau arrivalBypassPin:<TripId>
    if (String(k).startsWith('arrivalBypassPin')){
      const suffix = String(k).includes(':') ? String(k).split(':').slice(1).join(':') : '';
      const hashKey = suffix ? ('arrivalBypassPinHash:' + suffix) : 'arrivalBypassPinHash';
      const pinHash = hashPassword(String(v||''));
      k = hashKey;
      v = pinHash;
    }

    if (map[k]) sheet.getRange(map[k],2).setValue(v);
    else sheet.appendRow([k,v]);
  });
}

function getActiveTripId(){
  const cfg = getConfig().config;
  return String(cfg.activeTripId || '').trim();
}


// ===== Arrival Geofence (Per Trip) =====
// Disimpan di sheet SETTINGS (Key/Value)
// Key:
//  - arrivalGeofence:<TripId>  (JSON string: {"lat":-1.23,"lng":102.34,"radiusM":150})
//  - fallback: arrivalGeofence (untuk global)
function getArrivalGeofences_(tripId){
  const sheet = sh(CONFIG.SHEETS.SETTINGS);
  const data = sheet.getDataRange().getValues();
  const tid = String(tripId||'').trim();

  const keyPlural1 = 'arrivalGeofences:' + tid;
  const keyPlural2 = 'arrivalGeofences';
  const keySingle1 = 'arrivalGeofence:' + tid;
  const keySingle2 = 'arrivalGeofence';

  let raw = '';
  for (let i=1;i<data.length;i++){
    const k = String(data[i][0]||'').trim();
    if (tid && k === keyPlural1){ raw = String(data[i][1]||''); break; }
    if (tid && k === keySingle1){ raw = String(data[i][1]||''); break; }
    if (!raw && k === keyPlural2) raw = String(data[i][1]||'');
    if (!raw && k === keySingle2) raw = String(data[i][1]||'');
  }
  raw = String(raw||'').trim();
  if (!raw) return [];

  let parsed = null;
  try{ parsed = JSON.parse(raw); }catch(e){}

  // dukung format "lat,lng,radius"
  if (!parsed && raw.includes(',')){
    const parts = raw.split(',').map(s=>String(s).trim());
    if (parts.length >= 3){
      parsed = { lat:Number(parts[0]), lng:Number(parts[1]), radiusM:Number(parts[2]) };
    }
  }

  const fences = [];
  const push = (obj, idx)=>{
    const lat = Number(obj && obj.lat);
    const lng = Number(obj && obj.lng);
    const radiusM = Number((obj && (obj.radiusM || obj.radius || obj.r)) || 0);
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(radiusM) || radiusM <= 0) return;
    fences.push({
      id: String((obj && (obj.id || obj.name)) || ('P'+(idx+1))),
      name: String((obj && (obj.name || obj.label)) || ('Titik '+(idx+1))),
      lat: lat, lng: lng, radiusM: radiusM
    });
  };

  if (Array.isArray(parsed)){
    parsed.forEach(push);
  } else if (parsed && Array.isArray(parsed.points)){
    parsed.points.forEach(push);
  } else if (parsed && parsed.lat != null && parsed.lng != null){
    push(parsed, 0);
  }

  return fences;
}

// Backward compatible: return fence tunggal (titik pertama)
function getArrivalGeofence_(tripId){
  const fences = getArrivalGeofences_(tripId);
  return fences && fences.length ? { lat:fences[0].lat, lng:fences[0].lng, radiusM:fences[0].radiusM } : null;
}

function haversineMeters_(lat1, lon1, lat2, lon2){
  const R = 6371000; // meter
  const toRad = x => x * Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2)) *
            Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

function getArrivalBypassConfig_(tripId){
  const sheet = sh(CONFIG.SHEETS.SETTINGS);
  const data = sheet.getDataRange().getValues();
  const tid = String(tripId||'').trim();

  const keyEn1 = 'arrivalBypassEnabled:' + tid;
  const keyEn2 = 'arrivalBypassEnabled';
  const keyHash1 = 'arrivalBypassPinHash:' + tid;
  const keyHash2 = 'arrivalBypassPinHash';

  let enabledRaw = '';
  let hashRaw = '';

  for (let i=1;i<data.length;i++){
    const k = String(data[i][0]||'').trim();
    const v = String(data[i][1]||'').trim();

    if (tid && k === keyEn1) enabledRaw = v;
    if (tid && k === keyHash1) hashRaw = v;

    if (!enabledRaw && k === keyEn2) enabledRaw = v;
    if (!hashRaw && k === keyHash2) hashRaw = v;
  }

  const en = String(enabledRaw||'').toLowerCase();
  const enabled = (en === 'true' || en === '1' || en === 'yes' || en === 'on' || en === 'y' || en === 'enable' || en === 'enabled' || en === 'true');
  return { enabled: !!enabled, pinHash: String(hashRaw||'').trim() };
}

// ===== Auth =====
function handleLogin(params){
  const nik = String(params.nik||'').trim();
  const password = String(params.password||'');
  if (!nik || !password) return { success:false, message:'NIK dan password harus diisi' };

  const userSheet = sh(CONFIG.SHEETS.USERS);
  const users = toObjects(userSheet);
  const u = users.find(x=>String(x.NIK)===nik);
  if (!u) return { success:false, message:'User tidak ditemukan' };

  const ok = (password === CONFIG.DEFAULT_PASSWORD) || verifyPassword(password, u.PasswordHash);
  if (!ok) return { success:false, message:'Password salah' };

  const sessionId = createSession(nik);
  const activeTripId = getActiveTripId();

  return {
    success:true,
    sessionId,
    sessionDurationDays: CONFIG.SESSION_DURATION_DAYS,
    activeTripId,
    user: {
      nik: u.NIK,
      name: u.Nama,
      role: u.Role,
      region: u.Region,
      estate: u.Estate
    },
    family: getFamilyMembers({ sessionId, nik, tripId: activeTripId }).family
  };
}

function handleLogout(params){
  const sessionId = String(params.sessionId||'');
  if (!sessionId) return { success:true };
  const sessionSheet = sh(CONFIG.SHEETS.SESSIONS);
  const found = findRowBy(sessionSheet,'SessionId',sessionId);
  if (found.row !== -1){
    const headers = found.headers.map(String);
    const statusCol = headers.indexOf('Status') + 1;
    if (statusCol>0) sessionSheet.getRange(found.row, statusCol).setValue('logout');
  }
  return { success:true };
}

function createSession(userId){
  const sessionId = Utilities.getUuid();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + CONFIG.SESSION_DURATION_DAYS);
  const sessionSheet = sh(CONFIG.SHEETS.SESSIONS);
  sessionSheet.appendRow([sessionId, userId, new Date(), expiry, 'active']);
  cleanupOldSessions();
  return sessionId;
}

function cleanupOldSessions(){
  const sheet = sh(CONFIG.SHEETS.SESSIONS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const expIdx = headers.indexOf('Expiry');
  const statusIdx = headers.indexOf('Status');
  const now = new Date();
  for (let i=values.length-1;i>=1;i--){
    const exp = new Date(values[i][expIdx]);
    const st = String(values[i][statusIdx]||'');
    if (exp < now || st !== 'active') sheet.deleteRow(i+1);
  }
}

function validateSession(sessionId){
  const sid = String(sessionId||'');
  if (!sid) return null;
  const sheet = sh(CONFIG.SHEETS.SESSIONS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  const headers = values[0].map(String);
  const sidIdx = headers.indexOf('SessionId');
  const uidIdx = headers.indexOf('UserId');
  const expIdx = headers.indexOf('Expiry');
  const stIdx  = headers.indexOf('Status');
  for (let i=1;i<values.length;i++){
    if (String(values[i][sidIdx]) === sid && String(values[i][stIdx]) === 'active'){
      const exp = new Date(values[i][expIdx]);
      if (exp > new Date()) return String(values[i][uidIdx]);
    }
  }
  return null;
}

function isAdmin(userId){
  const users = toObjects(sh(CONFIG.SHEETS.USERS));
  const u = users.find(x=>String(x.NIK)===String(userId));
  return u && String(u.Role) === 'admin';
}

function hashPassword(password){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return bytes.map(b=>{
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length===1 ? '0'+v : v;
  }).join('');
}

function verifyPassword(inputPassword, storedHash){
  if (!storedHash) return false;
  return hashPassword(inputPassword) === String(storedHash);
}

// ===== Data: User & Family =====
function getUserData(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
  const nik = String(params.nik||userId);
  const users = toObjects(sh(CONFIG.SHEETS.USERS));
  const u = users.find(x=>String(x.NIK)===nik);
  if (!u) return { success:false, message:'User tidak ditemukan' };
  return { success:true, user: { nik:u.NIK, name:u.Nama, region:u.Region, estate:u.Estate, role:u.Role } };
}

function getFamilyMembers(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
  const nik = String(params.nik||userId);
  const tripId = String(params.tripId||'').trim();

  // ✅ IMPORTANT:
  // MainNIK dipakai untuk:
  // - keluarga (istri/anak/dll)
  // - juga bisa dipakai untuk "koordinator" (magang/training) yang mendaftarkan mentee lain.
  // Jadi, untuk halaman "Konfirmasi Kedatangan Keluarga", kita HARUS filter hanya relasi keluarga.
  const parts = dedupeParticipants_(toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)), tripId);

  const family = parts
    .filter(p=>String(p.MainNIK||'')===nik)
    .filter(p=> isFamilyRel_(p.Relationship))
    .map(p=>({ nik:p.NIK, name:p.Nama, relationship:p.Relationship }));

  return { success:true, family };
}

// ===== Trips =====
function listTrips(){
  return toObjects(sh(CONFIG.SHEETS.TRIPS));
}

// ===== Dashboard =====
function getDashboardData(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
  const tripId = String(params.tripId||'').trim();

  // ✅ dedupe participants by NIK per trip to avoid double rows messing dashboard
  const participants = dedupeParticipants_(toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)), tripId);
  const vehicles = toObjects(sh(CONFIG.SHEETS.VEHICLES)).filter(v=>!tripId || String(v.TripId||'')===tripId);

  const totalParticipants = participants.length;
  const totalVehicles = vehicles.length;
  const totalArrived = participants.filter(p=>p.Arrived===true || String(p.Arrived).toLowerCase()==='true').length;
    // ✅ totalOnRoad = JUMLAH PESERTA (bukan jumlah kendaraan)
  const onRoadCodes = new Set(
    vehicles
      .filter(v => String(v.Status||'').toLowerCase() === 'on_the_way')
      .map(v => String(v.Code||'').trim())
      .filter(Boolean)
  );

  const totalOnRoad = participants.filter(p=>{
    const vc = String(p.Vehicle||'').trim();
    if (!vc || !onRoadCodes.has(vc)) return false;
    const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
    return !arrived;
  }).length;

  // Breakdown by Relationship (dynamic)
  // Breakdown by category/relationship (dynamic)
  // NOTE: untuk mencegah salah tabulasi (koordinator training vs keluarga), kita normalisasi relasi.
  const breakdown = {};
  participants.forEach(p=>{
    const rel = normalizeRelKey_(p.Relationship || p.Category || 'lainnya');
    const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
    if (!arrived) return;
    breakdown[rel] = (breakdown[rel]||0) + 1;
  });

  return { success:true, data:{ totalParticipants, totalVehicles, totalArrived, totalOnRoad, breakdown } };
}

// ===== Map =====
function getMapData(params){
  const userId = validateSessionCached(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  const tripId = String(params.tripId||'').trim();
  const includeManifest = String(params.includeManifest||'0') === '1';

  // ✅ cache response ringan (mis. 5 detik) agar refreshMap tidak “menghajar” Spreadsheet
  const cache = CacheService.getScriptCache();
  const cacheKey = 'MAP:' + (tripId||'ALL') + ':' + (includeManifest ? '1':'0');
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const vSheet = sh(CONFIG.SHEETS.VEHICLES);
  const vLastRow = vSheet.getLastRow();
  const vLastCol = vSheet.getLastColumn();
  if (vLastRow < 2) {
    const out0 = { success:true, vehicles: [], manifestByVehicle: includeManifest ? {} : undefined };
    cache.put(cacheKey, JSON.stringify(out0), 5);
    return out0;
  }

  const vHeaders = vSheet.getRange(1,1,1,vLastCol).getValues()[0].map(String);

  // kolom yang dipakai
  const idx = (name)=> vHeaders.indexOf(name);
  const iCode = idx('Code');
  const iType = idx('Type');
  const iCap  = idx('Capacity');
  const iDrv  = idx('Driver');
  const iDrvHp = idx('DriverPhone');
  const iLat  = idx('Latitude');
  const iLng  = idx('Longitude');
  const iSt   = idx('Status');
  const iPass = idx('Passengers');
  const iTrip = idx('TripId');

  const vVals = vSheet.getRange(2,1,vLastRow-1,vLastCol).getValues();

  const vehicles = [];
  for (let r=0;r<vVals.length;r++){
    const row = vVals[r];
    if (tripId && iTrip>-1 && String(row[iTrip]||'') !== tripId) continue;

    const passengers = (iPass>-1 && row[iPass])
      ? String(row[iPass]).split(';').map(s=>s.trim()).filter(Boolean)
      : [];

    vehicles.push({
      code: (iCode>-1 ? row[iCode] : ''),
      type: (iType>-1 ? row[iType] : ''),
      capacity: (iCap>-1 ? row[iCap] : ''),
      driver: (iDrv>-1 ? row[iDrv] : ''),
      driverPhone: (iDrvHp>-1 ? row[iDrvHp] : ''),
      currentLocation: { lat: (iLat>-1 ? row[iLat] : ''), lng: (iLng>-1 ? row[iLng] : '') },
      status: (iSt>-1 ? row[iSt] : ''),
      tripId: (iTrip>-1 ? row[iTrip] : ''),
      passengers
    });
  }

  let manifestByVehicle = undefined;

  if (includeManifest){
    const pSheet = sh(CONFIG.SHEETS.PARTICIPANTS);
    const pLastRow = pSheet.getLastRow();
    const pLastCol = pSheet.getLastColumn();

    const pMap = {};
    if (pLastRow >= 2){
      const pHeaders = pSheet.getRange(1,1,1,pLastCol).getValues()[0].map(String);
      const pIdx = (name)=> pHeaders.indexOf(name);
      const iNik = pIdx('NIK');
      const iNama= pIdx('Nama');
      const iRel = pIdx('Relationship');
      const iReg = pIdx('Region');
      const iEst = pIdx('Estate');
      const iArr = pIdx('Arrived');
      const iAt  = pIdx('ArrivalTime');
      const iPTrip = pIdx('TripId');

      const pVals = pSheet.getRange(2,1,pLastRow-1,pLastCol).getValues();
      for (let r=0;r<pVals.length;r++){
        const row = pVals[r];
        if (tripId && iPTrip>-1 && String(row[iPTrip]||'') !== tripId) continue;
        const nik = String(row[iNik]||'').trim();
        if (!nik) continue;
        pMap[nik] = {
          Nama: (iNama>-1 ? row[iNama] : ''),
          Relationship: (iRel>-1 ? row[iRel] : ''),
          Region: (iReg>-1 ? row[iReg] : ''),
          Estate: (iEst>-1 ? row[iEst] : ''),
          Arrived: (iArr>-1 ? row[iArr] : false),
          ArrivalTime: (iAt>-1 ? row[iAt] : '')
        };
      }
    }

    manifestByVehicle = {};
    vehicles.forEach(v=>{
      manifestByVehicle[v.code] = (v.passengers||[]).map(nik=>{
        const p = pMap[String(nik)] || {};
        const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
        return {
          nik: String(nik),
          nama: p.Nama || '-',
          rel: p.Relationship || '-',
          region: p.Region || '',
          estate: p.Estate || '',
          arrived,
          arrivedAt: p.ArrivalTime || ''
        };
      });
    });
  }

  const out = { success:true, vehicles, manifestByVehicle };
  cache.put(cacheKey, JSON.stringify(out), 5); // ✅ 5 detik cukup untuk realtime tapi ringan
  return out;
}

function validateSessionCached(sessionId){
  const sid = String(sessionId||'');
  if (!sid) return null;

  const cache = CacheService.getScriptCache();
  const ck = 'SID:' + sid;
  const cached = cache.get(ck);
  if (cached) return cached; // userId

  const uid = validateSession(sid); // pakai fungsi Anda yang lama
  if (uid) cache.put(ck, uid, 60);  // ✅ cache 60 detik
  return uid;
}

function getVehicles(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
  const tripId = String(params.tripId||'').trim();
  const q = String(params.q||'').trim();

  const vehicles = toObjects(sh(CONFIG.SHEETS.VEHICLES)).filter(v=>!tripId || String(v.TripId||'')===tripId);

  let vehicle = null;
  if (q){
    vehicle = vehicles.find(v=>String(v.Code)===q || String(v.Barcode)===q);
  }
  return { success:true, vehicle, vehicles: q ? undefined : vehicles };
}


// Cari kendaraan yang berisi NIK tertentu pada TripId aktif (untuk gating menu sebelum keberangkatan)
function getMyVehicle(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
  const tripId = String(params.tripId||'').trim();
  const nik = String(params.nik||'').trim();
  if (!tripId) return { success:false, message:'tripId kosong' };
  if (!nik) return { success:false, message:'nik kosong' };

  const vehicles = toObjects(sh(CONFIG.SHEETS.VEHICLES))
    .filter(v => String(v.TripId||'') === tripId);

  // kolom penumpang umumnya "Passengers" (string), berisi daftar NIK dipisah ; atau ,
  const findInPassengers = (s)=>{
    const raw = String(s||'').trim();
    if (!raw) return false;
    const parts = raw.split(/[^0-9A-Za-z]+/).filter(Boolean).map(x=>String(x).trim());
    return parts.includes(nik);
  };

  let vehicle = vehicles.find(v => findInPassengers(v.Passengers));
  // fallback: jika ada kolom MainNik / DriverNik / PIC (beberapa versi sheet berbeda)
  if (!vehicle){
    vehicle = vehicles.find(v => String(v.MainNik||v.DriverNik||v.PIC||'').trim() === nik);
  }

  if (!vehicle) return { success:true, found:false, vehicle:null };
  return { success:true, found:true, vehicle:{ code: vehicle.Code, type: vehicle.Type, status: vehicle.Status } };
}


function updateVehicleLocation(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  const vehicleCode = String(params.vehicleCode||'').trim();
  if (!vehicleCode) return { success:false, message:'vehicleCode kosong' };

  const lat = parseCoordinate_(params.lat);
  const lng = parseCoordinate_(params.lng);

  if (!isFinite(lat) || !isFinite(lng)) {
    return { success:false, message:'Koordinat tidak valid (lat/lng bukan angka).' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { success:false, message:`Koordinat di luar range. lat=${lat}, lng=${lng}` };
  }

  const sheet = sh(CONFIG.SHEETS.VEHICLES);
  const found = findRowBy(sheet,'Code',vehicleCode);
  if (found.row === -1) return { success:false, message:'Kendaraan tidak ditemukan' };

  const headers = found.headers.map(String);
  const latCol = headers.indexOf('Latitude') + 1;
  const lngCol = headers.indexOf('Longitude') + 1;
  const stCol  = headers.indexOf('Status') + 1;

  // ✅ lock fields
  const locAtCol = headers.indexOf('LastLocAt') + 1;
  const locByCol = headers.indexOf('LastLocBy') + 1;
  const updAtCol = headers.indexOf('LastUpdateAt') + 1;

  // ====== ✅ SOFT LOCK: hanya 1 tracker aktif per kendaraan ======
  // Jika ada updater lain dalam 90 detik terakhir → tolak update (biar tidak dobel)
  try{
    const lastBy = locByCol>0 ? String(sheet.getRange(found.row, locByCol).getValue()||'').trim() : '';
    const lastAtRaw = locAtCol>0 ? sheet.getRange(found.row, locAtCol).getValue() : '';
    const lastAt = lastAtRaw ? new Date(lastAtRaw).getTime() : 0;

    const nowMs = Date.now();
    const RECENT_MS = 90000; // 90 detik

    if (lastBy && lastBy !== String(userId) && lastAt && (nowMs - lastAt) < RECENT_MS){
      // ✅ anggap tracker lain masih aktif, skip
      return { success:true, skipped:true, message:'Skip: tracker lain aktif' };
    }
  }catch(e){}

  // ✅ simpan lokasi sebagai NUMBER
  sheet.getRange(found.row, latCol).setValue(lat);
  sheet.getRange(found.row, lngCol).setValue(lng);

  // status on_the_way jika belum arrived
  const currentStatus = sheet.getRange(found.row, stCol).getValue();
  if (String(currentStatus) !== 'arrived') sheet.getRange(found.row, stCol).setValue('on_the_way');

  // ✅ stamp
  const now = new Date();
  if (locAtCol>0) sheet.getRange(found.row, locAtCol).setValue(now);
  if (locByCol>0) sheet.getRange(found.row, locByCol).setValue(String(userId));
  if (updAtCol>0) sheet.getRange(found.row, updAtCol).setValue(now);

  return { success:true, message:'Lokasi diperbarui', lat, lng };
}

/**
 * Terima input:
 * - number: 0.9641875
 * - string indo: "0,9641875"
 * - string salah-ketik: "9.641.875" -> jadi 9641875 (tetap akan ditolak oleh range check)
 * - string biasa: "111.8929969"
 */
function parseCoordinate_(v){
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;

  let s = String(v).trim();
  if (!s) return NaN;

  // hilangkan spasi
  s = s.replace(/\s+/g, '');

  const hasComma = s.includes(',');
  const hasDot   = s.includes('.');

  if (hasComma && hasDot){
    // kasus "1.234,56" => dot ribuan, comma desimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma && !hasDot){
    // kasus "0,964" => comma desimal
    s = s.replace(',', '.');
  } else {
    // hanya dot atau tanpa pemisah
    // kalau user mengirim "9.641.875" (dot ribuan), ini akan jadi 9641875
    // dan akan ditolak oleh range check di atas (bagus).
    const dotCount = (s.match(/\./g) || []).length;
    if (dotCount >= 2) s = s.replace(/\./g, '');
  }

  const n = Number(s);
  return n;
}

function assignToVehicle(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  return withIdempotent_(params, 'assignVehicle', userId, function(){

  const vehicleCode = String(params.vehicleCode||'');
  const tripId = String(params.tripId||'').trim();

  let nikList = [];
  if (params.nikList){
    try{ nikList = JSON.parse(params.nikList); }catch{ nikList = String(params.nikList).split(';').map(s=>s.trim()); }
  }
  nikList = (nikList||[]).map(String).filter(Boolean);
  if (!nikList.length) return { success:false, message:'NIK list kosong' };

  const vSheet = sh(CONFIG.SHEETS.VEHICLES);
  const vFound = findRowBy(vSheet,'Code',vehicleCode);
  if (vFound.row === -1) return { success:false, message:'Kendaraan tidak ditemukan' };
  const vHeaders = vFound.headers.map(String);
  const passCol = vHeaders.indexOf('Passengers')+1;
  const capCol = vHeaders.indexOf('Capacity')+1;
  const tripCol = vHeaders.indexOf('TripId')+1;

  const capacity = Number(vSheet.getRange(vFound.row, capCol).getValue() || 0);
  const currentPassengers = String(vSheet.getRange(vFound.row, passCol).getValue()||'')
    .split(';').map(s=>s.trim()).filter(Boolean);

  const merged = Array.from(new Set([...currentPassengers, ...nikList]));
  if (capacity && merged.length > capacity) return { success:false, message:'Kapasitas kendaraan penuh' };

  vSheet.getRange(vFound.row, passCol).setValue(merged.join(','));
  if (tripCol>0 && tripId) vSheet.getRange(vFound.row, tripCol).setValue(tripId);

  // Update participant vehicle assignment
  nikList.forEach(nik=> updateParticipantVehicle(nik, vehicleCode, tripId));

    return { success:true, message:'Berhasil ditambahkan ke kendaraan' };
  });
}

function updateParticipantVehicle(nik, vehicleCode, tripId){
  const pSheet = sh(CONFIG.SHEETS.PARTICIPANTS);
  const values = pSheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const nikIdx = headers.indexOf('NIK');
  const vehIdx = headers.indexOf('Vehicle');
  const tripIdx = headers.indexOf('TripId');

  for (let i=1;i<values.length;i++){
    if (String(values[i][nikIdx]) === String(nik)){
      if (vehIdx>-1) pSheet.getRange(i+1, vehIdx+1).setValue(vehicleCode);
      if (tripIdx>-1 && tripId) pSheet.getRange(i+1, tripIdx+1).setValue(tripId);
      return;
    }
  }
}

function confirmArrival(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  return withIdempotent_(params, 'confirmArrival', userId, function(){

    const tripId = String(params.tripId||'').trim();
    let nikList = [];
    try{ nikList = JSON.parse(params.nikList||'[]'); }catch{ nikList = String(params.nikList||'').split(';'); }
    nikList = (nikList||[]).map(s=>String(s).trim()).filter(Boolean);
    if (!nikList.length) return { success:false, message:'NIK list kosong' };

    const lat = Number(params.lat);
    const lng = Number(params.lng);
    const acc = Number(params.acc || params.accuracy || 0); // meter (opsional)

    // ===== Geofence check (multi titik) =====
    const fences = getArrivalGeofences_(tripId);
    if (!fences.length){
      return { success:false, message:'Lokasi kedatangan belum diatur oleh Admin. Hubungi Admin untuk mengatur geofencing.' };
    }

    // hit jarak terdekat (untuk pesan)
    let best = null;
    if (isFinite(lat) && isFinite(lng)){
      for (let i=0;i<fences.length;i++){
        const f = fences[i];
        const d = haversineMeters_(lat, lng, f.lat, f.lng);
        if (!best || d < best.distM){
          best = { fence:f, distM:d };
        }
      }
    }

    // toleransi = akurasi GPS (maks 50m) + 5m
    const tol = Math.min(Math.max(acc||0, 0), 50) + 5;

    const insideAny = (isFinite(lat) && isFinite(lng)) ? fences.some(f=>{
      const d = haversineMeters_(lat, lng, f.lat, f.lng);
      return d <= (f.radiusM + tol);
    }) : false;

    // ===== bypass (opsional) =====
    const bypassPin = String(params.bypassPin||'').trim();
    const bypassReason = String(params.bypassReason||'').trim();
    let bypassUsed = false;

    if (!insideAny){
      // jika tidak ada GPS valid, langsung tolak kecuali bypass valid
      const bp = getArrivalBypassConfig_(tripId);
      const userRole = (function(){
        try{
          const users = toObjects(sh(CONFIG.SHEETS.USERS));
          const u = users.find(x=>String(x.NIK)===String(userId));
          return String(u?.Role || u?.role || '').toLowerCase();
        }catch(e){ return ''; }
      })();

      const roleOk = (userRole === 'admin' || userRole === 'coordinator' || userRole === 'koordinator');

      const pinOk = (bp.enabled && bp.pinHash && bypassPin && (hashPassword(bypassPin) === String(bp.pinHash)));

      if (roleOk && pinOk){
        bypassUsed = true;
      } else {
        if (!isFinite(lat) || !isFinite(lng)){
          return { success:false, message:'Lokasi GPS tidak valid / belum diizinkan. Aktifkan GPS lalu coba lagi.' };
        }
        const nearestName = best?.fence?.name || 'titik kedatangan';
        const nearestRadius = best?.fence?.radiusM || fences[0].radiusM;
        const distM = best ? best.distM : 999999;
        return {
          success:false,
          message:'Anda belum tiba di lokasi. Jarak Anda ±' + Math.round(distM) + 'm dari ' + nearestName +
                  ' (radius ' + Math.round(nearestRadius) + 'm).'
        };
      }
    }

    const arrivalsSheet = sh(CONFIG.SHEETS.ARRIVALS);
    const now = new Date();

    // ✅ Idempotent: jangan double check-in
    const alreadyArrived = getArrivedNikSet_(tripId);
    const alreadyInArrivals = getArrivalsNikSet_(tripId);

    nikList.forEach(nik=>{
      const k = String(nik);
      if (alreadyArrived.has(k)) return;
      if (alreadyInArrivals.has(k)) return;
      arrivalsSheet.appendRow([k, now, userId, tripId]);
      markParticipantArrived(k, now, tripId);
    });

    // Update vehicle status if all passengers arrived
    nikList.forEach(nik=> updateVehicleArrivalStatus(nik, tripId));

    return {
      success:true,
      message: bypassUsed ? 'Kedatangan dicatat (BYPASS).' : 'Kedatangan dikonfirmasi',
      bypassUsed: bypassUsed,
      bypassReason: bypassReason,
      nearestFence: best ? best.fence : null,
      distM: best ? best.distM : null
    };
  });
}

function markParticipantArrived(nik, now, tripId){
  const pSheet = sh(CONFIG.SHEETS.PARTICIPANTS);
  const values = pSheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const nikIdx = headers.indexOf('NIK');
  const arrivedIdx = headers.indexOf('Arrived');
  const timeIdx = headers.indexOf('ArrivalTime');
  const updIdx = headers.indexOf('UpdatedAt');
  const tripIdx = headers.indexOf('TripId');

  for (let i=1;i<values.length;i++){
    if (String(values[i][nikIdx]) === String(nik)){
      if (arrivedIdx>-1) pSheet.getRange(i+1, arrivedIdx+1).setValue(true);
      if (timeIdx>-1) pSheet.getRange(i+1, timeIdx+1).setValue(now);
      if (tripIdx>-1 && tripId) pSheet.getRange(i+1, tripIdx+1).setValue(tripId);
      if (updIdx>-1) pSheet.getRange(i+1, updIdx+1).setValue(now);
      return;
    }
  }
}

function updateVehicleArrivalStatus(nik, tripId){
  const vSheet = sh(CONFIG.SHEETS.VEHICLES);
  const values = vSheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const passIdx = headers.indexOf('Passengers');
  const stIdx = headers.indexOf('Status');
  const tripIdx = headers.indexOf('TripId');

  for (let i=1;i<values.length;i++){
    if (tripId && tripIdx>-1 && String(values[i][tripIdx]) !== tripId) continue;
    const passengers = String(values[i][passIdx]||'').split(';').map(s=>s.trim()).filter(Boolean);
    if (passengers.indexOf(String(nik)) === -1) continue;
    if (checkAllPassengersArrived(passengers, tripId)){
      vSheet.getRange(i+1, stIdx+1).setValue('arrived');
    }
    return;
  }
}

function checkAllPassengersArrived(passengers, tripId){
  const parts = toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)).filter(p=>!tripId || String(p.TripId||'')===tripId);
  const map = {};
  parts.forEach(p=> map[String(p.NIK)] = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true'));
  return passengers.every(nik=> !!map[String(nik)]);
}

function getParticipants(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
  const tripId = String(params.tripId||'').trim();
  const filter = String(params.filter||'all');

  // ✅ dedupe per trip supaya tabel & rekap tidak ganda
  let participants = dedupeParticipants_(toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)), tripId);

  // Tambahkan field Category (untuk UI) tanpa mengubah sheet
  participants = participants.map(p=>({
    ...p,
    Category: isFamilyRel_(p.Relationship) ? 'keluarga' : normalizeRelKey_(p.Relationship || 'peserta')
  }));

  if (filter === 'arrived') participants = participants.filter(p=>p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
  if (filter === 'not_arrived') participants = participants.filter(p=>!(p.Arrived===true || String(p.Arrived).toLowerCase()==='true'));

  return { success:true, participants };
}

function changePassword(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  return withIdempotent_(params, 'changePassword', userId, function(){
  const oldPassword = String(params.oldPassword||'');
  const newPassword = String(params.newPassword||'');
  if (!oldPassword || !newPassword) return { success:false, message:'Password tidak lengkap' };

  const sheet = sh(CONFIG.SHEETS.USERS);
  const found = findRowBy(sheet,'NIK',userId);
  if (found.row === -1) return { success:false, message:'User tidak ditemukan' };
  const headers = found.headers.map(String);
  const passCol = headers.indexOf('PasswordHash')+1;

  const stored = sheet.getRange(found.row, passCol).getValue();
  const ok = (oldPassword === CONFIG.DEFAULT_PASSWORD) || verifyPassword(oldPassword, stored);
  if (!ok) return { success:false, message:'Password lama salah' };

    sheet.getRange(found.row, passCol).setValue(hashPassword(newPassword));
    return { success:true, message:'Password berhasil diubah' };
  });
}

// ===== Admin =====
function adminGetData(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
  if (!isAdmin(userId)) return { success:false, message:'Akses ditolak' };

  const dataType = String(params.dataType||'');
  const tripId = String(params.tripId||'').trim();

  if (dataType === 'users'){
    const users = toObjects(sh(CONFIG.SHEETS.USERS)).map(u=>{ delete u.PasswordHash; return u; });
    return { success:true, users };
  }
  if (dataType === 'vehicles'){
    const vehicles = toObjects(sh(CONFIG.SHEETS.VEHICLES)).filter(v=>!tripId || String(v.TripId||'')===tripId);
    return { success:true, vehicles };
  }
    if (dataType === 'participants'){
    const parts = toObjects(sh(CONFIG.SHEETS.PARTICIPANTS))
      .filter(p=>!tripId || String(p.TripId||'')===tripId);
    return { success:true, participants: parts };
  }
  if (dataType === 'history'){
    return { success:true, history: listHistory_() };
  }
  if (dataType === 'config'){
    return getConfig();
  }
  if (dataType === 'trips'){
    return { success:true, trips: listTrips() };
  }

  return { success:false, message:'Tipe data tidak valid' };
}

function adminUpdate(params){
  const userId = validateSession(params.sessionId);
  if (!userId || !isAdmin(userId)) return { success:false, message:'Akses ditolak' };

  return withIdempotent_(params, 'adminUpdate', userId, function(){
    const dataType = String(params.dataType||'');
    // ✅ terima op, tapi tetap dukung action lama kalau masih ada
    const op = String(params.op || params.action || '');

    let data = params.data;
    if (typeof data === 'string'){
      try{ data = JSON.parse(data); }catch{}
    }

    switch(dataType){
      case 'user':
        return updateUser(op, data);
      case 'vehicle':
        return updateVehicle(op, data);
      case 'participant':
        return updateParticipant(op, data);
      case 'config':
        setConfigKV(data || {});
        return { success:true, message:'Config updated' };
      case 'trip':
        return updateTrip(op, data);
      case 'history':
        return updateHistory_(op, data, userId);
      default:
        return { success:false, message:'Tipe data tidak valid' };
    }
  });
}

function updateUser(action, userData){
  const sheet = sh(CONFIG.SHEETS.USERS);
  if (action === 'add'){
    if (!userData.NIK || !userData.Nama) return { success:false, message:'NIK/Nama wajib' };
    const found = findRowBy(sheet,'NIK',userData.NIK);
    if (found.row !== -1) return { success:false, message:'NIK sudah ada' };
    sheet.appendRow([
      userData.NIK,
      userData.Nama,
      userData.Region || '',
      userData.Estate || '',
      userData.Role || 'user',
      hashPassword(CONFIG.DEFAULT_PASSWORD)
    ]);
    return { success:true, message:'User berhasil ditambahkan' };
  }
  if (action === 'update'){
    const found = findRowBy(sheet,'NIK',userData.NIK);
    if (found.row === -1) return { success:false, message:'User tidak ditemukan' };
    const headers = found.headers.map(String);
    Object.keys(userData||{}).forEach(k=>{
      if (k === 'PasswordHash') return;
      const col = headers.indexOf(k);
      if (col>-1) sheet.getRange(found.row, col+1).setValue(userData[k]);
    });
    return { success:true, message:'User berhasil diperbarui' };
  }
  return { success:false, message:'Aksi tidak valid' };
}

function updateVehicle(action, vehicleData){
  const sheet = sh(CONFIG.SHEETS.VEHICLES);
  if (action === 'add'){
    if (!vehicleData.Code) return { success:false, message:'Code wajib' };
    const found = findRowBy(sheet,'Code',vehicleData.Code);
    if (found.row !== -1) return { success:false, message:'Kode sudah ada' };
    sheet.appendRow([
      vehicleData.Code,
      vehicleData.Type || '',
      vehicleData.Capacity || '',
      vehicleData.Driver || '',
      vehicleData.DriverPhone || '',
      '',
      '',
      vehicleData.Status || 'waiting',
      '',
      vehicleData.Barcode || '',
      vehicleData.TripId || ''
    ]);
    return { success:true, message:'Kendaraan berhasil ditambahkan' };
  }
  if (action === 'update'){
    const found = findRowBy(sheet,'Code',vehicleData.Code);
    if (found.row === -1) return { success:false, message:'Kendaraan tidak ditemukan' };
    const headers = found.headers.map(String);
    Object.keys(vehicleData||{}).forEach(k=>{
      const col = headers.indexOf(k);
      if (col>-1) sheet.getRange(found.row, col+1).setValue(vehicleData[k]);
    });
    return { success:true, message:'Kendaraan berhasil diperbarui' };
  }
  return { success:false, message:'Aksi tidak valid' };
}

function updateParticipant(action, p){
  const sheet = sh(CONFIG.SHEETS.PARTICIPANTS);
  if (!p || !p.NIK) return { success:false, message:'NIK wajib' };

  const tripId = String(p.TripId || '').trim();
  if (!tripId) return { success:false, message:'TripId wajib (gunakan Active Trip ID)' };

  // cari row berdasarkan NIK + TripId (anti duplikat)
  const values = sheet.getDataRange().getValues();
  const headers = (values[0]||[]).map(String);
  const nikIdx = headers.indexOf('NIK');
  const tripIdx = headers.indexOf('TripId');

  let foundRow = -1;
  for (let i=1;i<values.length;i++){
    if (String(values[i][nikIdx])===String(p.NIK) && String(values[i][tripIdx])===tripId){
      foundRow = i+1;
      break;
    }
  }

  if (action === 'add'){
    if (foundRow !== -1) return { success:false, message:'Participant NIK+TripId sudah ada' };
    sheet.appendRow([
      p.NIK,
      p.Nama || '',
      p.Relationship || p.Category || '',
      p.Region || '',
      p.Estate || '',
      p.Vehicle || '',
      p.Arrived===true || String(p.Arrived).toLowerCase()==='true',
      p.ArrivalTime || '',
      p.MainNIK || '',
      tripId
    ]);
    return { success:true, message:'Participant ditambahkan' };
  }

  if (action === 'update'){
    if (foundRow === -1) return { success:false, message:'Participant tidak ditemukan (berdasarkan NIK+TripId)' };
    Object.keys(p).forEach(k=>{
      const col = headers.indexOf(k);
      if (col>-1) sheet.getRange(foundRow, col+1).setValue(p[k]);
    });
    return { success:true, message:'Participant diperbarui' };
  }

  return { success:false, message:'Aksi tidak valid' };
}

function updateTrip(action, trip){
  const sheet = sh(CONFIG.SHEETS.TRIPS);
  if (!trip || !trip.TripId) return { success:false, message:'TripId wajib' };

  if (action === 'add'){
    const found = findRowBy(sheet,'TripId',trip.TripId);
    if (found.row !== -1) return { success:false, message:'TripId sudah ada' };
    sheet.appendRow([
      trip.TripId,
      trip.Name || '',
      trip.Start || '',
      trip.End || '',
      trip.Origin || '',
      trip.Destination || '',
      trip.Status || 'active'
    ]);
    return { success:true, message:'Trip ditambahkan' };
  }

  if (action === 'update'){
    const found = findRowBy(sheet,'TripId',trip.TripId);
    if (found.row === -1) return { success:false, message:'Trip tidak ditemukan' };
    const headers = found.headers.map(String);
    Object.keys(trip||{}).forEach(k=>{
      const col = headers.indexOf(k);
      if (col>-1) sheet.getRange(found.row, col+1).setValue(trip[k]);
    });
    return { success:true, message:'Trip diperbarui' };
  }

  return { success:false, message:'Aksi tidak valid' };
}

// ===== Optional daily cleanup trigger =====
function autoCleanup(){
  moveOldDataToHistory();
  moveOldVehicleParticipantToHistory_();
  cleanupOldSessions();
}

function moveOldDataToHistory(){
  const now = new Date();
  const cutoff = new Date(now.getTime() - (CONFIG.DATA_RETENTION_DAYS*24*60*60*1000));

  const arrivals = sh(CONFIG.SHEETS.ARRIVALS);
  const history = sh(CONFIG.SHEETS.HISTORY);
  const values = arrivals.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const timeIdx = headers.indexOf('ArrivalTime');

  for (let i=values.length-1;i>=1;i--){
    const t = new Date(values[i][timeIdx]);
    if (t < cutoff){
      history.appendRow(['ARRIVAL', new Date(), JSON.stringify(objectFrom(headers, values[i]))]);
      arrivals.deleteRow(i+1);
    }
  }
}

function moveOldVehicleParticipantToHistory_(){
  const now = new Date();
  const cutoff = new Date(now.getTime() - (CONFIG.DATA_RETENTION_DAYS*24*60*60*1000));

  const history = sh(CONFIG.SHEETS.HISTORY);

  // ===== Vehicles =====
  const vSheet = sh(CONFIG.SHEETS.VEHICLES);
  const vVals = vSheet.getDataRange().getValues();
  if (vVals.length >= 2){
    const h = vVals[0].map(String);
    const iCode = h.indexOf('Code');
    const iLat  = h.indexOf('Latitude');
    const iLng  = h.indexOf('Longitude');
    const iSt   = h.indexOf('Status');
    const iPass = h.indexOf('Passengers');
    const iTrip = h.indexOf('TripId');
    const iLocAt= h.indexOf('LastLocAt');
    const iLocBy= h.indexOf('LastLocBy');
    const iUpd  = h.indexOf('LastUpdateAt');

    for (let r=1;r<vVals.length;r++){
      const row = vVals[r];
      const t1 = iLocAt>-1 ? row[iLocAt] : '';
      const t2 = iUpd>-1 ? row[iUpd] : '';
      const ts = (t1 ? new Date(t1) : (t2 ? new Date(t2) : null));

      if (!ts || !(ts instanceof Date) || isNaN(ts.getTime())) continue;
      if (ts >= cutoff) continue;

      const snap = {
        Code: row[iCode],
        TripId: iTrip>-1 ? row[iTrip] : '',
        Latitude: iLat>-1 ? row[iLat] : '',
        Longitude: iLng>-1 ? row[iLng] : '',
        Status: iSt>-1 ? row[iSt] : '',
        Passengers: iPass>-1 ? row[iPass] : '',
        LastLocAt: iLocAt>-1 ? row[iLocAt] : '',
        LastLocBy: iLocBy>-1 ? row[iLocBy] : '',
        LastUpdateAt: iUpd>-1 ? row[iUpd] : ''
      };

      history.appendRow(['VEHICLE', now, JSON.stringify(snap)]);

      // ✅ kosongkan field sensitif 2 hari
      if (iLat>-1) vSheet.getRange(r+1, iLat+1).setValue('');
      if (iLng>-1) vSheet.getRange(r+1, iLng+1).setValue('');
      if (iSt>-1)  vSheet.getRange(r+1, iSt+1).setValue('waiting');
      if (iPass>-1) vSheet.getRange(r+1, iPass+1).setValue('');
      if (iLocAt>-1) vSheet.getRange(r+1, iLocAt+1).setValue('');
      if (iLocBy>-1) vSheet.getRange(r+1, iLocBy+1).setValue('');
      if (iUpd>-1)   vSheet.getRange(r+1, iUpd+1).setValue('');
    }
  }

  // ===== Participants =====
  const pSheet = sh(CONFIG.SHEETS.PARTICIPANTS);
  const pVals = pSheet.getDataRange().getValues();
  if (pVals.length >= 2){
    const h = pVals[0].map(String);
    const iNik = h.indexOf('NIK');
    const iTrip = h.indexOf('TripId');
    const iVeh = h.indexOf('Vehicle');
    const iArr = h.indexOf('Arrived');
    const iAt  = h.indexOf('ArrivalTime');
    const iUpd = h.indexOf('UpdatedAt');

    for (let r=1;r<pVals.length;r++){
      const row = pVals[r];
      const t0 = iUpd>-1 ? row[iUpd] : '';
      const t1 = iAt>-1 ? row[iAt] : '';
      const ts = (t0 ? new Date(t0) : (t1 ? new Date(t1) : null));

      if (!ts || !(ts instanceof Date) || isNaN(ts.getTime())) continue;
      if (ts >= cutoff) continue;

      const snap = {
        NIK: row[iNik],
        TripId: iTrip>-1 ? row[iTrip] : '',
        Vehicle: iVeh>-1 ? row[iVeh] : '',
        Arrived: iArr>-1 ? row[iArr] : '',
        ArrivalTime: iAt>-1 ? row[iAt] : '',
        UpdatedAt: iUpd>-1 ? row[iUpd] : ''
      };

      history.appendRow(['PARTICIPANT', now, JSON.stringify(snap)]);

      // ✅ kosongkan field sensitif 2 hari
      if (iVeh>-1) pSheet.getRange(r+1, iVeh+1).setValue('');
      if (iArr>-1) pSheet.getRange(r+1, iArr+1).setValue(false);
      if (iAt>-1)  pSheet.getRange(r+1, iAt+1).setValue('');
      if (iUpd>-1) pSheet.getRange(r+1, iUpd+1).setValue('');
    }
  }
}

function objectFrom(headers, row){
  const o = {};
  headers.forEach((h,i)=> o[h]=row[i]);
  return o;
}

/************** SETUP TOOLS (RUN ONCE) **************/
function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu('Trip Tracker')
    .addItem('✅ Setup: Init Sheets', 'SETUP_INIT')
    .addItem('🔎 Setup: Status Check', 'SETUP_STATUS')
    .addItem('♻️ Setup: Reset Init Flag', 'SETUP_RESET')
    .addToUi();
}

// Jalankan INI pertama kali
function SETUP_INIT(){
  ensureInitializedHard_(true); // force init
  const info = SETUP_STATUS();
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

function SETUP_STATUS(){
  const s = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const names = s.getSheets().map(x=>x.getName());

  const required = Object.values(CONFIG.SHEETS);
  const missingSheets = required.filter(n => names.indexOf(n) === -1);

  // cek admin
  let hasAdmin = false;
  let adminRow = null;
  try{
    const uSheet = s.getSheetByName(CONFIG.SHEETS.USERS);
    if (uSheet){
      const rows = uSheet.getDataRange().getValues();
      const headers = (rows[0]||[]).map(String);
      const nikIdx = headers.indexOf('NIK');
      const roleIdx = headers.indexOf('Role');
      for (let i=1;i<rows.length;i++){
        if (String(rows[i][roleIdx]) === 'admin'){
          hasAdmin = true;
          adminRow = rows[i][nikIdx];
          break;
        }
      }
    }
  }catch(e){}

  const result = {
    spreadsheetName: s.getName(),
    spreadsheetUrl: s.getUrl(),
    sheetNames: names,
    missingSheets,
    hasAdmin,
    sampleAdminNik: adminRow,
    TT_INIT: PropertiesService.getScriptProperties().getProperty('TT_INIT')
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// kalau TT_INIT sudah 1 tapi sheet belum kebentuk, jalankan ini dulu
function SETUP_RESET(){
  PropertiesService.getScriptProperties().deleteProperty('TT_INIT');
  Logger.log('TT_INIT reset');
  return { success:true, message:'TT_INIT reset' };
}

function getScanCandidates(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  const tripId = String(params.tripId||'').trim();
  const q = String(params.q||'').trim().toLowerCase(); // optional search
  const limit = Math.min(Math.max(Number(params.limit||60), 10), 200);

  const parts = getParticipantsDedupe_(tripId);

  // mapping nik -> vehicle existing
  const nikToVeh = buildNikToVehicleMap_(tripId);

  // 1) afiliasi utama (MainNIK=userId) + dirinya sendiri (kalau ada di participants)
  let aff = parts.filter(p=> String(p.MainNIK||'').trim()===String(userId));
  const self = parts.find(p=> String(p.NIK||'').trim()===String(userId));
  if (self && !aff.some(x=>String(x.NIK).trim()===String(userId))) aff.unshift(self);

  // 2) optional search peserta lain (bisa untuk “ambil peserta lain”)
  let other = [];
  if (q){
    other = parts.filter(p=>{
      const nik = String(p.NIK||'').toLowerCase();
      const nama = String(p.Nama||'').toLowerCase();
      const rel = String(p.Relationship||'').toLowerCase();
      return nik.includes(q) || nama.includes(q) || rel.includes(q);
    }).slice(0, limit);
  }

  // format response (ringkas + status)
  const pack = (p)=> {
    const nik = String(p.NIK||'').trim();
    return {
      nik,
      nama: p.Nama || '',
      relationship: p.Relationship || '',
      region: p.Region || '',
      estate: p.Estate || '',
      arrived: bool_(p.Arrived),
      vehicle: p.Vehicle || '',
      mainNik: p.MainNIK || '',
      // kendaraan dari Vehicles.Passengers (sumber kebenaran “siapa penumpang di kendaraan mana”)
      inVehicle: nikToVeh[nik] || ''
    };
  };

  return {
    success:true,
    coordinatorNik: userId,
    affiliated: aff.map(pack),
    search: other.map(pack)
  };
}

function assignVehicleStrict(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  return withIdempotent_(params, 'assignVehicleStrict', userId, function(){

  const vehicleCode = String(params.vehicleCode||'').trim();
  const tripId = String(params.tripId||'').trim();
  if (!vehicleCode) return { success:false, message:'vehicleCode kosong' };
  if (!tripId) return { success:false, message:'tripId kosong' };

  // nikList wajib
  let nikList = [];
  try{ nikList = JSON.parse(params.nikList||'[]'); }
  catch{ nikList = String(params.nikList||'').split(';'); }
  nikList = uniq_(nikList);
  if (!nikList.length) return { success:false, message:'NIK list kosong' };

  const setMainNik = String(params.setMainNik||'').trim(); // optional (untuk ambil peserta lain)
  const moveIfInOther = (String(params.moveIfInOtherVehicle||'1') === '1');

  // valid vehicle
  const vSheet = sh(CONFIG.SHEETS.VEHICLES);
  const vFound = findRowBy(vSheet,'Code',vehicleCode);
  if (vFound.row === -1) return { success:false, message:'Kendaraan tidak ditemukan' };

  const vHeaders = vFound.headers.map(String);
  const passCol = vHeaders.indexOf('Passengers')+1;
  const capCol  = vHeaders.indexOf('Capacity')+1;
  const tripCol = vHeaders.indexOf('TripId')+1;

  // pastikan trip id kendaraan terset
  if (tripCol>0) vSheet.getRange(vFound.row, tripCol).setValue(tripId);

  const capacity = Number(vSheet.getRange(vFound.row, capCol).getValue() || 0);

  // mapping nik->veh existing
  const nikToVeh = buildNikToVehicleMap_(tripId);

  // 1) remove nik dari kendaraan lain jika perlu
  const moved = [];
  const blocked = [];

  if (moveIfInOther){
    const vehicles = toObjects(vSheet).filter(v=>!tripId || String(v.TripId||'')===tripId);
    // index code->rowNumber untuk update cepat
    const allValues = vSheet.getDataRange().getValues();
    const hdr = allValues[0].map(String);
    const codeIdx = hdr.indexOf('Code');
    const passIdx = hdr.indexOf('Passengers');
    const tripIdx = hdr.indexOf('TripId');

    const codeToRow = {};
    for (let i=1;i<allValues.length;i++){
      const code = String(allValues[i][codeIdx]||'').trim();
      const rowTrip = tripIdx>-1 ? String(allValues[i][tripIdx]||'').trim() : '';
      if (!code) continue;
      if (tripId && rowTrip !== tripId) continue;
      codeToRow[code] = i+1;
    }

    nikList.forEach(nik=>{
      const inVeh = nikToVeh[nik];
      if (inVeh && inVeh !== vehicleCode){
        // pindahkan: hapus dari kendaraan lama
        const oldRow = codeToRow[inVeh];
        if (oldRow){
          const oldPassengers = splitCsv_(vSheet.getRange(oldRow, passIdx+1).getValue());
          const kept = oldPassengers.filter(x=>x!==nik);
          vSheet.getRange(oldRow, passIdx+1).setValue(joinCsv_(kept));
          moved.push({ nik, from: inVeh, to: vehicleCode });
        }
      }
    });
  } else {
    nikList.forEach(nik=>{
      const inVeh = nikToVeh[nik];
      if (inVeh && inVeh !== vehicleCode){
        blocked.push({ nik, inVehicle: inVeh });
      }
    });
    if (blocked.length){
      return { success:false, message:'Ada peserta sudah terdaftar di kendaraan lain', blocked };
    }
  }

  // 2) add ke kendaraan target (anti-double)
  const currentPassengers = splitCsv_(vSheet.getRange(vFound.row, passCol).getValue());
  const currentSet = new Set(currentPassengers);

  const added = [];
  nikList.forEach(nik=>{
    if (!currentSet.has(nik)){
      currentPassengers.push(nik);
      currentSet.add(nik);
      added.push(nik);
    }
  });

  // cek kapasitas
  if (capacity && currentPassengers.length > capacity){
    return {
      success:false,
      message:`Kapasitas penuh (kapasitas ${capacity}, akan terisi ${currentPassengers.length}). Kurangi centang dulu.`,
      added,
      moved
    };
  }

  vSheet.getRange(vFound.row, passCol).setValue(joinCsv_(currentPassengers));

    // ✅ stamp kendaraan (Passengers berubah)
  const vHeaders2 = vFound.headers.map(String);
  const updAtCol = vHeaders2.indexOf('LastUpdateAt') + 1;
  if (updAtCol>0) vSheet.getRange(vFound.row, updAtCol).setValue(new Date());

  // 3) update Participants.Vehicle + optional update MainNIK
  const updated = [];
  nikList.forEach(nik=>{
    const patch = { Vehicle: vehicleCode, TripId: tripId, UpdatedAt: new Date() };
    if (setMainNik) patch.MainNIK = setMainNik;
    const ok = updateParticipantRow_(nik, tripId, patch);
    if (ok) updated.push(nik);
  });

    return {
      success:true,
      message:'Penempatan kendaraan berhasil',
      vehicleCode,
      tripId,
      added,
      moved,
      updated,
      totalPassengers: currentPassengers.length
    };
  });
}

/***********************
 * AUTO PURGE @ 01:00–02:00
 * Archive -> History (DataType | ArchivedDate | Data)
 * Then delete all rows in: Sessions; Arrivals; Participants; Vehicles
 ***********************/

function installDailyPurgeTrigger_0100(){
  // hapus trigger lama agar tidak dobel
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'autoPurge_0100') ScriptApp.deleteTrigger(t);
  });

  // pasang trigger harian jam 01:00 (akan dieksekusi sekitar 01:00–02:00)
  ScriptApp.newTrigger('autoPurge_0100')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();
}

function autoPurge_0100(){
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;

  try{
    // pastikan History ada + header benar
    ensureHeader(sh(CONFIG.SHEETS.HISTORY), ['DataType','ArchivedDate','Data']);

    // archive + clear
    archiveAndClearSheet_(CONFIG.SHEETS.SESSIONS,    'SESSION');
    archiveAndClearSheet_(CONFIG.SHEETS.ARRIVALS,    'ARRIVAL');
    archiveAndClearSheet_(CONFIG.SHEETS.PARTICIPANTS,'PARTICIPANT');
    archiveAndClearSheet_(CONFIG.SHEETS.VEHICLES,    'VEHICLE');

    // optional: catat log ke Logger
    console.log('autoPurge_0100 done at ' + new Date().toISOString());

  } finally {
    lock.releaseLock();
  }
}

/**
 * Arsipkan semua baris data (mulai row 2) ke History sebagai JSON per baris,
 * lalu hapus semua data di sheet asal (row 2 dst), header tetap.
 */
function archiveAndClearSheet_(sheetName, dataType){
  const src = sh(sheetName);
  const history = sh(CONFIG.SHEETS.HISTORY);

  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();
  if (lastRow <= 1 || lastCol <= 0) return; // tidak ada data

  const headers = src.getRange(1,1,1,lastCol).getValues()[0].map(h => String(h||'').trim());

  const values = src.getRange(2,1,lastRow-1,lastCol).getValues();
  if (!values.length) return;

  const now = new Date();

  // buat payload history: [DataType, ArchivedDate, DataJson]
  const out = values.map(row => {
    const obj = {};
    for (let c=0;c<headers.length;c++){
      const key = headers[c] || ('COL_' + (c+1));
      obj[key] = row[c];
    }
    return [String(dataType), now, JSON.stringify(obj)];
  });

  // append bulk ke History
  const startRow = history.getLastRow() + 1;
  history.getRange(startRow, 1, out.length, 3).setValues(out);

  // hapus data sumber (row2 dst), header tetap
  src.getRange(2, 1, lastRow-1, lastCol).clearContent();
}

// ==========================
// History restore (Admin)
// ==========================
function listHistory_(){
  const sheet = sh(CONFIG.SHEETS.HISTORY);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol <= 0) return [];

  const headers = sheet.getRange(1,1,1,lastCol).getValues()[0].map(h => String(h||'').trim());
  const values = sheet.getRange(2,1,lastRow-1,lastCol).getValues();

  const out = [];
  for (let i=0;i<values.length;i++){
    const rowObj = { Row: i + 2 }; // 1-based row index in sheet
    for (let c=0;c<headers.length;c++){
      rowObj[headers[c] || ('COL_' + (c+1))] = values[i][c];
    }
    // parse JSON for quick filter
    try{
      rowObj._dataObj = JSON.parse(String(rowObj.Data||'{}'));
      rowObj._tripId = String(rowObj._dataObj.TripId || '').trim();
    }catch(e){
      rowObj._dataObj = null;
      rowObj._tripId = '';
    }
    out.push(rowObj);
  }
  return out;
}

function updateHistory_(op, data, restoredByUserId){
  const action = String(op||'').toLowerCase();
  if (action === 'restore') return restoreHistory_(data || {}, restoredByUserId);
  return { success:false, message:'Aksi history tidak valid' };
}

function restoreHistory_(payload, restoredByUserId){
  // payload:
  //  - mode: selected | trip | all
  //  - rows: [sheetRowNumber...]
  //  - tripId: 'TRIP-...'
  //  - force: true/false (restore ulang walau sudah restored)
  const mode = String(payload.mode||'selected').toLowerCase();
  const force = !!payload.force;

  const history = sh(CONFIG.SHEETS.HISTORY);
  ensureHeader(history, ['DataType','ArchivedDate','Data','RestoredAt','RestoredBy','RestoredTo','RestoredKey','RestoreStatus']);

  const lastRow = history.getLastRow();
  const lastCol = history.getLastColumn();
  if (lastRow <= 1) return { success:true, restored:0, skipped:0, failed:0, message:'History kosong' };

  const headers = history.getRange(1,1,1,lastCol).getValues()[0].map(h => String(h||'').trim());
  const col = (name)=> headers.indexOf(name) + 1;
  const cDataType = col('DataType');
  const cArchived = col('ArchivedDate');
  const cData = col('Data');
  const cRestoredAt = col('RestoredAt');
  const cRestoredBy = col('RestoredBy');
  const cRestoredTo = col('RestoredTo');
  const cRestoredKey = col('RestoredKey');
  const cStatus = col('RestoreStatus');

  const values = history.getRange(2,1,lastRow-1,lastCol).getValues();

  // target selector
  let selectedIdx = [];
  if (mode === 'all'){
    selectedIdx = values.map((_,i)=> i);
  } else if (mode === 'trip'){
    const tripId = String(payload.tripId||'').trim();
    if (!tripId) return { success:false, message:'tripId wajib untuk mode trip' };
    for (let i=0;i<values.length;i++){
      const dataJson = String(values[i][cData-1]||'');
      let obj=null;
      try{ obj = JSON.parse(dataJson); }catch(e){}
      const t = String(obj?.TripId || '').trim();
      if (t && t === tripId) selectedIdx.push(i);
    }
  } else {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const want = new Set(rows.map(r=>Number(r)).filter(n=>n>=2));
    for (let i=0;i<values.length;i++){
      const sheetRow = i + 2;
      if (want.has(sheetRow)) selectedIdx.push(i);
    }
  }

  if (!selectedIdx.length) return { success:true, restored:0, skipped:0, failed:0, message:'Tidak ada item yang dipilih' };

  // Prepare target sheets + existing keys
  const typeMap = {
    'VEHICLE': CONFIG.SHEETS.VEHICLES,
    'PARTICIPANT': CONFIG.SHEETS.PARTICIPANTS,
    'ARRIVAL': CONFIG.SHEETS.ARRIVALS,
    'SESSION': CONFIG.SHEETS.SESSIONS
  };

  const existingKeyByType = {};
  const targetHeadersByType = {};

  function getKey_(dtype, obj){
    const t = String(dtype||'').toUpperCase();
    if (t === 'VEHICLE'){
      return String(obj.Code||'') + '|' + String(obj.TripId||'');
    }
    if (t === 'PARTICIPANT'){
      return String(obj.NIK||'') + '|' + String(obj.TripId||'');
    }
    if (t === 'ARRIVAL'){
      return String(obj.NIK||'') + '|' + String(obj.TripId||'');
    }
    if (t === 'SESSION'){
      return String(obj.SessionId||'');
    }
    return '';
  }

  function loadExistingKeys_(dtype){
    const t = String(dtype||'').toUpperCase();
    if (existingKeyByType[t]) return;

    const sheetName = typeMap[t];
    if (!sheetName) { existingKeyByType[t] = new Set(); return; }

    const s = sh(sheetName);
    const lr = s.getLastRow();
    const lc = s.getLastColumn();
    if (lr <= 1 || lc <= 0) { existingKeyByType[t] = new Set(); targetHeadersByType[t] = []; return; }

    const hdr = s.getRange(1,1,1,lc).getValues()[0].map(h=>String(h||'').trim());
    targetHeadersByType[t] = hdr;

    const vals = s.getRange(2,1,lr-1,lc).getValues();
    const set = new Set();
    for (let i=0;i<vals.length;i++){
      const rowObj = {};
      for (let c=0;c<hdr.length;c++) rowObj[hdr[c]] = vals[i][c];
      const k = getKey_(t, rowObj);
      if (k) set.add(k);
    }
    existingKeyByType[t] = set;
  }

  let restored=0, skipped=0, failed=0;
  const updates = []; // {row, values: {col:value}}
  const appendByType = {}; // t -> [obj...]
  const idxToRowNum = (idx)=> idx + 2;

  // build selected items
  selectedIdx.forEach(i=>{
    const rowNum = idxToRowNum(i);
    const dtype = String(values[i][cDataType-1]||'').toUpperCase().trim();
    const dataJson = String(values[i][cData-1]||'');
    const already = values[i][cRestoredAt-1];

    if (already && !force){
      skipped++;
      updates.push({ row: rowNum, status: 'SKIPPED_ALREADY_RESTORED' });
      return;
    }

    let obj=null;
    try{ obj = JSON.parse(dataJson); }catch(e){}
    if (!obj || typeof obj !== 'object'){
      failed++;
      updates.push({ row: rowNum, status: 'FAILED_BAD_JSON' });
      return;
    }
    if (!typeMap[dtype]){
      failed++;
      updates.push({ row: rowNum, status: 'FAILED_UNKNOWN_TYPE' });
      return;
    }

    const key = getKey_(dtype, obj);
    loadExistingKeys_(dtype);

    if (key && existingKeyByType[dtype].has(key)){
      skipped++;
      updates.push({ row: rowNum, status: 'SKIPPED_DUPLICATE', key, to: typeMap[dtype] });
      return;
    }

    // ensure header includes all keys
    const target = sh(typeMap[dtype]);
    const keys = Object.keys(obj||{});
    ensureHeader(target, keys);

    // refresh header after ensure
    const lc = target.getLastColumn();
    const hdr = target.getRange(1,1,1,lc).getValues()[0].map(h=>String(h||'').trim());
    targetHeadersByType[dtype] = hdr;

    appendByType[dtype] = appendByType[dtype] || [];
    appendByType[dtype].push({ obj, key, rowNum });
  });

  // append per type (bulk)
  Object.keys(appendByType).forEach(dtype=>{
    const sheetName = typeMap[dtype];
    const target = sh(sheetName);
    const hdr = targetHeadersByType[dtype] || target.getRange(1,1,1,target.getLastColumn()).getValues()[0].map(h=>String(h||'').trim());

    const rows = appendByType[dtype].map(({obj})=>{
      return hdr.map(h=> (h in obj) ? obj[h] : '');
    });

    if (rows.length){
      const start = target.getLastRow() + 1;
      target.getRange(start, 1, rows.length, hdr.length).setValues(rows);
      // update existing key set
      appendByType[dtype].forEach(({key})=>{
        if (key) existingKeyByType[dtype].add(key);
      });
      restored += rows.length;

      // mark updates for each history row
      appendByType[dtype].forEach(({key,rowNum})=>{
        updates.push({ row: rowNum, status:'RESTORED', key, to: sheetName });
      });
    }
  });

  // Apply status updates to History
  const now = new Date();
  const restoredBy = String(restoredByUserId || '');

  updates.forEach(u=>{
    const r = u.row;
    if (cRestoredAt) history.getRange(r, cRestoredAt).setValue(now);
    if (cRestoredBy) history.getRange(r, cRestoredBy).setValue(restoredBy);
    if (cRestoredTo && u.to) history.getRange(r, cRestoredTo).setValue(u.to);
    if (cRestoredKey && u.key) history.getRange(r, cRestoredKey).setValue(u.key);
    if (cStatus) history.getRange(r, cStatus).setValue(u.status);
  });

  return {
    success:true,
    restored, skipped, failed,
    message: `Restore selesai. Restored: ${restored}, Skipped: ${skipped}, Failed: ${failed}`
  };
}


