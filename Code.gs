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
    TRIPS:'Trips'
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
  ensureHeader(sh(CONFIG.SHEETS.VEHICLES), ['Code','Type','Capacity','Driver','Latitude','Longitude','Status','Passengers','Barcode','TripId']);
  ensureHeader(sh(CONFIG.SHEETS.PARTICIPANTS), ['NIK','Nama','Relationship','Region','Estate','Vehicle','Arrived','ArrivalTime','MainNIK','TripId']);
  ensureHeader(sh(CONFIG.SHEETS.ARRIVALS), ['NIK','ArrivalTime','ConfirmedBy','TripId']);
  ensureHeader(sh(CONFIG.SHEETS.HISTORY), ['DataType','ArchivedDate','Data']);
  ensureHeader(sh(CONFIG.SHEETS.SESSIONS), ['SessionId','UserId','Created','Expiry','Status']);
  ensureHeader(sh(CONFIG.SHEETS.SETTINGS), ['Key','Value']);
  ensureHeader(sh(CONFIG.SHEETS.TRIPS), ['TripId','Name','Start','End','Origin','Destination','Status']);

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
    const v = obj[k];
    if (map[k]) sheet.getRange(map[k],2).setValue(v);
    else sheet.appendRow([k,v]);
  });
}

function getActiveTripId(){
  const cfg = getConfig().config;
  return String(cfg.activeTripId || '').trim();
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

  const parts = toObjects(sh(CONFIG.SHEETS.PARTICIPANTS));
  const family = parts
    .filter(p=>String(p.MainNIK)===nik && (!tripId || String(p.TripId||'')===tripId))
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

  const participants = toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)).filter(p=>!tripId || String(p.TripId||'')===tripId);
  const vehicles = toObjects(sh(CONFIG.SHEETS.VEHICLES)).filter(v=>!tripId || String(v.TripId||'')===tripId);

  const totalParticipants = participants.length;
  const totalVehicles = vehicles.length;
  const totalArrived = participants.filter(p=>p.Arrived===true || String(p.Arrived).toLowerCase()==='true').length;
  const totalOnRoad = vehicles.filter(v=>String(v.Status)==='on_the_way').length;

  // Breakdown by Relationship (dynamic)
  const breakdown = {};
  participants.forEach(p=>{
    const rel = String(p.Relationship || 'lainnya').trim() || 'lainnya';
    const arrived = (p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
    if (!arrived) return;
    breakdown[rel] = (breakdown[rel]||0) + 1;
  });

  return { success:true, data:{ totalParticipants, totalVehicles, totalArrived, totalOnRoad, breakdown } };
}

// ===== Map =====
function getMapData(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  const tripId = String(params.tripId||'').trim();
  const includeManifest = String(params.includeManifest||'0') === '1';

  const vehiclesRaw = toObjects(sh(CONFIG.SHEETS.VEHICLES))
    .filter(v=>!tripId || String(v.TripId||'')===tripId);

  const participantsRaw = includeManifest
    ? toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)).filter(p=>!tripId || String(p.TripId||'')===tripId)
    : [];

  const pByNik = includeManifest ? indexBy(participantsRaw, 'NIK') : {};

  const vehicles = vehiclesRaw.map(v=>{
    const passengers = v.Passengers ? String(v.Passengers).split(',').map(s=>s.trim()).filter(Boolean) : [];
    return {
      code: v.Code,
      type: v.Type,
      capacity: v.Capacity,
      driver: v.Driver,
      currentLocation: { lat: v.Latitude, lng: v.Longitude },
      status: v.Status,
      tripId: v.TripId || '',
      passengers
    };
  });

  let manifestByVehicle = undefined;

  if (includeManifest){
    manifestByVehicle = {};
    vehicles.forEach(v=>{
      manifestByVehicle[v.code] = (v.passengers||[]).map(nik=>{
        const p = pByNik[String(nik)] || {};
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

  return { success:true, vehicles, manifestByVehicle };
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

function updateVehicleLocation(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
  const vehicleCode = String(params.vehicleCode||'');
  const lat = params.lat;
  const lng = params.lng;

  const sheet = sh(CONFIG.SHEETS.VEHICLES);
  const found = findRowBy(sheet,'Code',vehicleCode);
  if (found.row === -1) return { success:false, message:'Kendaraan tidak ditemukan' };

  const headers = found.headers.map(String);
  const latCol = headers.indexOf('Latitude')+1;
  const lngCol = headers.indexOf('Longitude')+1;
  const stCol  = headers.indexOf('Status')+1;
  sheet.getRange(found.row, latCol).setValue(lat);
  sheet.getRange(found.row, lngCol).setValue(lng);
  const currentStatus = sheet.getRange(found.row, stCol).getValue();
  if (String(currentStatus) !== 'arrived') sheet.getRange(found.row, stCol).setValue('on_the_way');

  return { success:true, message:'Lokasi diperbarui' };
}

function assignToVehicle(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };

  const vehicleCode = String(params.vehicleCode||'');
  const tripId = String(params.tripId||'').trim();

  let nikList = [];
  if (params.nikList){
    try{ nikList = JSON.parse(params.nikList); }catch{ nikList = String(params.nikList).split(',').map(s=>s.trim()); }
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
    .split(',').map(s=>s.trim()).filter(Boolean);

  const merged = Array.from(new Set([...currentPassengers, ...nikList]));
  if (capacity && merged.length > capacity) return { success:false, message:'Kapasitas kendaraan penuh' };

  vSheet.getRange(vFound.row, passCol).setValue(merged.join(','));
  if (tripCol>0 && tripId) vSheet.getRange(vFound.row, tripCol).setValue(tripId);

  // Update participant vehicle assignment
  nikList.forEach(nik=> updateParticipantVehicle(nik, vehicleCode, tripId));

  return { success:true, message:'Berhasil ditambahkan ke kendaraan' };
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

  const tripId = String(params.tripId||'').trim();
  let nikList = [];
  try{ nikList = JSON.parse(params.nikList||'[]'); }catch{ nikList = String(params.nikList||'').split(','); }
  nikList = (nikList||[]).map(s=>String(s).trim()).filter(Boolean);
  if (!nikList.length) return { success:false, message:'NIK list kosong' };

  const arrivalsSheet = sh(CONFIG.SHEETS.ARRIVALS);
  const now = new Date();

  // Mark participants arrived + add arrivals rows
  nikList.forEach(nik=>{
    arrivalsSheet.appendRow([nik, now, userId, tripId]);
    markParticipantArrived(nik, now, tripId);
  });

  // Update vehicle status if all passengers arrived
  nikList.forEach(nik=> updateVehicleArrivalStatus(nik, tripId));

  return { success:true, message:'Kedatangan dikonfirmasi' };
}

function markParticipantArrived(nik, now, tripId){
  const pSheet = sh(CONFIG.SHEETS.PARTICIPANTS);
  const values = pSheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const nikIdx = headers.indexOf('NIK');
  const arrivedIdx = headers.indexOf('Arrived');
  const timeIdx = headers.indexOf('ArrivalTime');
  const tripIdx = headers.indexOf('TripId');

  for (let i=1;i<values.length;i++){
    if (String(values[i][nikIdx]) === String(nik)){
      if (arrivedIdx>-1) pSheet.getRange(i+1, arrivedIdx+1).setValue(true);
      if (timeIdx>-1) pSheet.getRange(i+1, timeIdx+1).setValue(now);
      if (tripIdx>-1 && tripId) pSheet.getRange(i+1, tripIdx+1).setValue(tripId);
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
    const passengers = String(values[i][passIdx]||'').split(',').map(s=>s.trim()).filter(Boolean);
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

  let participants = toObjects(sh(CONFIG.SHEETS.PARTICIPANTS)).filter(p=>!tripId || String(p.TripId||'')===tripId);
  if (filter === 'arrived') participants = participants.filter(p=>p.Arrived===true || String(p.Arrived).toLowerCase()==='true');
  if (filter === 'not_arrived') participants = participants.filter(p=>!(p.Arrived===true || String(p.Arrived).toLowerCase()==='true'));

  return { success:true, participants };
}

function changePassword(params){
  const userId = validateSession(params.sessionId);
  if (!userId) return { success:false, message:'Session expired' };
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
  if (dataType === 'history'){
    return { success:true, history: toObjects(sh(CONFIG.SHEETS.HISTORY)) };
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
    case 'config':
      setConfigKV(data || {});
      return { success:true, message:'Config updated' };
    case 'trip':
      return updateTrip(op, data);
    default:
      return { success:false, message:'Tipe data tidak valid' };
  }
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

