/**
 * Dashboard Kedatangan Peserta - GAS Backend (API)
 * Deploy as Web App:
 *  - Execute as: Me
 *  - Who has access: Anyone
 *
 * Endpoint:
 *  - ?action=dashboard.get      -> JSON / JSONP (callback=...)
 *  - ?action=ping              -> HTML untuk ambil URL redirect Chrome mobile
 */

const CFG = {
  SPREADSHEET_ID: null,

  SHEET_CANDIDATES: {
    PARTICIPANTS: ["Participants", "participants", "Peserta", "peserta"],
    ARRIVALS:      ["Arrivals", "arrivals", "Kedatangan", "kedatangan"]
  }
};

function doGet(e){ return handle_(e); }
function doPost(e){ return handle_(e); }

function handle_(e){
  const p = (e && e.parameter) ? e.parameter : {};
  const action = String(p.action || "").trim() || "dashboard.get";
  const cb = p.callback || p.cb || "";

  try{
    if (action === "ping") return ping_();

    if (action === "dashboard.get"){
      const data = buildDashboard_();
      return respond_(data, cb);
    }

    return respond_({ success:false, error:"Unknown action: " + action }, cb);

  }catch(err){
    return respond_({
      success:false,
      error: String(err && err.message ? err.message : err),
      stack: String(err && err.stack ? err.stack : "")
    }, cb);
  }
}

/** ---------- PING (untuk ambil URL redirect) ---------- */
function ping_(){
  const html = HtmlService.createHtmlOutput(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>GAS Redirect URL</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:18px;line-height:1.35}
    .box{border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fff}
    code{display:block;word-break:break-all;background:#f3f4f6;padding:10px;border-radius:10px}
    button{padding:10px 12px;border-radius:10px;border:1px solid #d1d5db;background:#111827;color:#fff;cursor:pointer}
    .muted{color:#6b7280;font-size:13px}
  </style>
</head>
<body>
  <h2>Ambil URL Redirect (Chrome Mobile)</h2>
  <p class="muted">
    Buka halaman ini di <b>Chrome (HP)</b>. Biasanya URL akan berubah menjadi domain
    <code>script.googleusercontent.com</code>. Copy BASE URL tersebut (tanpa parameter) ke variabel <b>GAS_URL_GUC</b> di script.js.
  </p>

  <div class="box">
    <div class="muted">URL saat ini (copy ini):</div>
    <code id="u"></code>
    <div style="height:10px"></div>
    <button id="copy">Copy</button>
  </div>

  <script>
    const full = location.href;
    document.getElementById('u').textContent = full;

    document.getElementById('copy').onclick = async () => {
      try{
        await navigator.clipboard.writeText(full);
        alert('Tersalin ke clipboard');
      }catch(e){
        prompt('Copy manual:', full);
      }
    };
  </script>
</body>
</html>`);
  return html.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** ---------- DATA BUILDER ---------- */
function buildDashboard_(){
  const ss = CFG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CFG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  const shP = findSheet_(ss, CFG.SHEET_CANDIDATES.PARTICIPANTS);
  const shA = findSheet_(ss, CFG.SHEET_CANDIDATES.ARRIVALS);

  if (!shP) throw new Error("Sheet Participants tidak ditemukan. Coba salah satu: " + CFG.SHEET_CANDIDATES.PARTICIPANTS.join(", "));
  if (!shA) throw new Error("Sheet Arrivals tidak ditemukan. Coba salah satu: " + CFG.SHEET_CANDIDATES.ARRIVALS.join(", "));

  const participants = readObjects_(shP);
  const arrivals = readObjects_(shA);

  // index arrival latest by NIK
  const latestArrivalByNik = {};
  arrivals.forEach(r=>{
    const nik = norm_(r.NIK || r.nik);
    if (!nik) return;

    const t = parseDate_(r.ArrivalTime || r.arrivalTime || r.arrival_time || r.updated_at || r.created_at);
    const prev = latestArrivalByNik[nik];

    if (!prev){
      const row = Object.assign({}, r);
      row.__t = t || null;
      latestArrivalByNik[nik] = row;
      return;
    }

    // pilih yang paling baru
    const pt = prev.__t;
    if (t && (!pt || t > pt)){
      const row = Object.assign({}, r);
      row.__t = t;
      latestArrivalByNik[nik] = row;
    }
  });

  const arrivedPeserta = [];
  const notArrivedPeserta = [];

  participants.forEach(p=>{
    const nik = norm_(p.NIK || p.nik);
    if (!nik) return;

    const a = latestArrivalByNik[nik];
    const joined = {
      NIK: nik,
      Nama: p.Nama || p.nama || "",
      Region: p.Region || p.region || "",
      Estate: p.Estate || p.estate || "",
      Vehicle: p.Vehicle || p.vehicle || "",
      TripId: p.TripId || p.tripId || p.trip_id || (a ? (a.TripId || a.tripId || a.trip_id || "") : ""),
      MainNIK: p.MainNIK || p.mainNik || p.main_nik || ""
    };

    if (a){
      joined.ArrivalTime = a.ArrivalTime || a.arrivalTime || a.arrival_time || (a.__t ? a.__t.toISOString() : "");
      arrivedPeserta.push(joined);
    }else{
      joined.ArrivalTime = "";
      notArrivedPeserta.push(joined);
    }
  });

  // summary
  const totalPeserta = participants.length;
  const totalArrived = arrivedPeserta.length;
  const arrivalPercentage = totalPeserta ? Math.round((totalArrived / totalPeserta) * 100) : 0;

  // stats
  const regionStats = groupStatsByRegion_(participants, arrivedPeserta);
  const estateStats = groupStatsByEstate_(participants, arrivedPeserta);

  // Sort arrived by time desc
  arrivedPeserta.sort((a,b)=>{
    const ta = Date.parse(a.ArrivalTime || "") || 0;
    const tb = Date.parse(b.ArrivalTime || "") || 0;
    return tb - ta;
  });

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    summary: { totalPeserta, totalArrived, arrivalPercentage },
    regionStats,
    estateStats,
    arrivedPeserta,
    notArrivedPeserta
  };
}

function groupStatsByRegion_(participants, arrivedList){
  const totalBy = {};
  const arrivedBy = {};

  participants.forEach(p=>{
    const k = String(p.Region || p.region || "").trim() || "(Unknown)";
    totalBy[k] = (totalBy[k] || 0) + 1;
  });

  arrivedList.forEach(p=>{
    const k = String(p.Region || "").trim() || "(Unknown)";
    arrivedBy[k] = (arrivedBy[k] || 0) + 1;
  });

  return Object.keys(totalBy).map(region=>{
    const total = totalBy[region] || 0;
    const arrived = arrivedBy[region] || 0;
    const percentage = total ? ((arrived/total)*100).toFixed(1) : "0.0";
    return { region, total, arrived, percentage };
  });
}

// estateStats butuh field region (frontend Anda pakai)
function groupStatsByEstate_(participants, arrivedList){
  const totalBy = {};
  const arrivedBy = {};
  const regionCountByEstate = {}; // { estate: { region: count } }

  participants.forEach(p=>{
    const estate = String(p.Estate || p.estate || "").trim() || "(Unknown)";
    const region = String(p.Region || p.region || "").trim() || "(Unknown)";

    totalBy[estate] = (totalBy[estate] || 0) + 1;

    regionCountByEstate[estate] = regionCountByEstate[estate] || {};
    regionCountByEstate[estate][region] = (regionCountByEstate[estate][region] || 0) + 1;
  });

  arrivedList.forEach(p=>{
    const estate = String(p.Estate || "").trim() || "(Unknown)";
    arrivedBy[estate] = (arrivedBy[estate] || 0) + 1;
  });

  function pickMainRegion_(estate){
    const m = regionCountByEstate[estate] || {};
    let best = "(Unknown)";
    let bestN = -1;
    Object.keys(m).forEach(r=>{
      if (m[r] > bestN){
        bestN = m[r];
        best = r;
      }
    });
    return best;
  }

  return Object.keys(totalBy).map(estate=>{
    const total = totalBy[estate] || 0;
    const arrived = arrivedBy[estate] || 0;
    const percentage = total ? ((arrived/total)*100).toFixed(1) : "0.0";
    return { estate, region: pickMainRegion_(estate), total, arrived, percentage };
  });
}

/** ---------- UTIL ---------- */
function findSheet_(ss, names){
  for (var i=0;i<names.length;i++){
    var sh = ss.getSheetByName(names[i]);
    if (sh) return sh;
  }
  return null;
}

function readObjects_(sh){
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  const headers = values[0].map(h => String(h||"").trim());
  const out = [];

  for (let r=1; r<values.length; r++){
    const row = values[r];
    if (row.join("").trim() === "") continue;

    const obj = {};
    for (let c=0; c<headers.length; c++){
      const h = headers[c];
      if (!h) continue;
      obj[h] = row[c];
    }
    out.push(obj);
  }
  return out;
}

function norm_(v){
  return String(v || "").trim();
}

function parseDate_(v){
  if (!v) return null;
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) return v;
  const t = Date.parse(String(v).trim());
  if (!isNaN(t)) return new Date(t);
  return null;
}

/**
 * Response JSON / JSONP:
 * - Jika callback ada -> balas JS: callback({...});
 * - Jika tidak -> JSON biasa
 */
function respond_(obj, callback){
  const json = JSON.stringify(obj);

  const cb = String(callback || "").trim();
  if (cb){
    const safeCb = cb.replace(/[^\w\.\$]/g, "");
    const body = safeCb + "(" + json + ");";
    return ContentService
      .createTextOutput(body)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
