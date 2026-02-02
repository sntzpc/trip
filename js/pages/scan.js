import * as api from '../core/api.js';
import { $, showNotification, setButtonLoading } from '../core/ui.js';
import { startBackgroundTrackingPublic } from './map.js';


let qr = null;
let pendingVehicle = null;

// ✅ keranjang penumpang sementara (sebelum submit ke server)
let selectedNiks = new Set();

export function getPendingVehicle(){ return pendingVehicle; }

// ============================
// OFFLINE MASTER INDICATOR (Scan Page)
// - tampil jika: offline + master cache belum ada
// ============================
export async function updateScanOfflineHint(session){
  const el = document.getElementById('scanOfflineHint');
  const titleEl = document.getElementById('scanOfflineHintTitle');
  const msgEl = document.getElementById('scanOfflineHintMsg');
  if (!el || !titleEl || !msgEl) return;

  // ONLINE => hide
  if (navigator.onLine !== false){
    el.classList.add('hidden');
    return;
  }

  // OFFLINE => cek master
  const ok = await hasOfflineMasterForScan(session).catch(()=>false);

  el.classList.remove('hidden');

  if (ok){
    // ✅ OFFLINE OK (GREEN)
    el.classList.remove('border-amber-300/60','bg-amber-50','text-amber-900');
    el.classList.add('border-emerald-300/70','bg-emerald-50','text-emerald-900');

    titleEl.textContent = 'Offline OK';
    msgEl.innerHTML = 'Data master tersedia. Anda bisa <b>scan</b>, <b>cari peserta</b>, dan <b>submit</b> (akan masuk antrian sinkronisasi).';
  } else {
    // ⚠️ OFFLINE BUTUH SYNC (AMBER)
    el.classList.remove('border-emerald-300/70','bg-emerald-50','text-emerald-900');
    el.classList.add('border-amber-300/60','bg-amber-50','text-amber-900');

    titleEl.textContent = 'Mode Offline';
    msgEl.innerHTML = 'Data master belum ada. Silakan <b>online sekali</b> untuk sinkron awal (download master), lalu Scan dapat dipakai offline.';
  }
}

async function hasOfflineMasterForScan(session){
  if (!session?.sessionId) return false;

  const tripId = session.activeTripId || '';
  const coordinatorNik = session.userId || session.user?.nik || session.user?.NIK || '';

  const r = await api.apiCall('getScanCandidates', {
    sessionId: session.sessionId,
    coordinatorNik,
    tripId,
    q: '',
    limit: 5
  });

  // kalau fallback offline sukses dan ada data minimal => master tersedia
  const hasAny =
    !!(r && r.success) &&
    (
      (Array.isArray(r.affiliated) && r.affiliated.length > 0) ||
      (Array.isArray(r.participants) && r.participants.length > 0) ||
      (Array.isArray(r.vehicles) && r.vehicles.length > 0)
    );

  return !!hasAny;
}

// refresh indikator ketika koneksi berubah (tanpa spam)
(function bindOfflineIndicatorAuto(){
  window.addEventListener('online', ()=>{
    try{
      const el = document.getElementById('scanOfflineHint');
      if (el) el.classList.add('hidden');
    }catch{}
  });

  window.addEventListener('offline', ()=>{
    // indikator akan diperbarui saat user membuka Scan / memulai scan
    // tapi bisa juga langsung tampil (soft):
    try{
      const el = document.getElementById('scanOfflineHint');
      if (el) el.classList.remove('hidden');
    }catch{}
  });
})();

export async function startScanning(session){
  const btn = $('#startScanBtn');
  try{
    setButtonLoading(btn, true);
    try{ await updateScanOfflineHint(session); }catch{}
    if (!window.Html5Qrcode) throw new Error('Library html5-qrcode belum loaded');

    const box = document.getElementById('scannerBox');
    box.innerHTML = '<div id="qrReader" style="width:100%"></div>';

    qr = new Html5Qrcode('qrReader');
    await qr.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async (decodedText) => {
        await handleCode(session, decodedText);
        await stopScanning();
      },
      () => {}
    );
  } catch(err){
    showNotification(err.message || 'Gagal memulai kamera', 'error');
    throw err;
  } finally {
    setButtonLoading(btn, false);
  }
}

export async function stopScanning(){
  try{ if (qr) { await qr.stop(); await qr.clear(); } } catch{}
  qr = null;
}

export async function manualSubmit(session){
  const code = $('#vehicleCodeInput')?.value.trim();
  if (!code) return showNotification('Masukkan kode kendaraan', 'error');

  // ✅ tampilkan hint jika offline & master belum ada
  try{ await updateScanOfflineHint(session); }catch{}

  return handleCode(session, code);
}

async function handleCode(session, codeOrBarcode){
  const tripId = session.activeTripId || '';
  const q = String(codeOrBarcode || '').trim();

  let v = null;

  // 1) Coba API getVehicles (online normal)
  try{
    const res = await api.apiCall('getVehicles', {
      sessionId: session.sessionId,
      q,
      tripId
    });
    v = res?.vehicle || null;
  }catch(e){
    // 2) Jika gagal (umumnya karena offline), fallback ke getScanCandidates(q)
    try{
      const res2 = await api.apiCall('getScanCandidates', {
        sessionId: session.sessionId,
        coordinatorNik: session.userId || session.user?.nik || session.user?.NIK || '',
        tripId,
        q,
        limit: 80
      });

      // offline fallback getScanCandidates akan mengembalikan vehicle jika q cocok Code/Barcode
      if (res2?.success && res2?.vehicle){
        v = res2.vehicle;
      }
    }catch(_e2){
      // biarkan lanjut ke error handling bawah
    }

    // kalau tetap tidak ketemu, lempar error awal
    if (!v) throw e;
  }

  if (!v) throw new Error('Kendaraan tidak ditemukan');

  pendingVehicle = v;
  selectedNiks = new Set();
  renderResult(v);
  try{ await updateScanOfflineHint(session); }catch{}

  try{
    await loadCandidates(session);
  }catch(e){
    showNotification(e?.message || 'Gagal memuat kandidat (offline cache belum ada)', 'info', 3500);
  }
}


function renderResult(v){
  const wrap = $('#scanResult');
  const details = $('#resultDetails');
  if (!wrap || !details) return;

  wrap.style.display = 'block';
  details.innerHTML = `
    <div class="vehicle-card">
      <h4>${escapeHtml(v.Code || v.code)}</h4>
      <p><strong>Jenis:</strong> ${escapeHtml(v.Type || v.type || '-') }</p>
      <p><strong>Kapasitas:</strong> ${escapeHtml(v.Capacity || v.capacity || '-') }</p>
      <p><strong>Driver:</strong> ${escapeHtml(v.Driver || v.driver || '-') }</p>
      <p><strong>Status:</strong> ${escapeHtml(v.Status || v.status || '-') }</p>
    </div>

    <!-- ✅ KERANJANG -->
    <div id="selectedBox" style="margin-top:12px; padding:10px; border:1px solid #eee; border-radius:12px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <h4 style="margin:0;">Penumpang yang akan ditempatkan</h4>
        <button id="btnClearSelected" type="button" class="btn btn-secondary" style="padding:8px 10px;">
          Kosongkan
        </button>
      </div>
      <div id="selectedList" style="margin-top:8px; color:#666;">
        <div style="color:#777;">Belum ada penumpang dipilih.</div>
      </div>
      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <button id="btnAddChecked" type="button" class="btn btn-secondary">
          Tambah Semua yang Dicentang
        </button>
        <div style="font-size:12px; color:#666; line-height:1.3;">
          Anda bisa cari peserta → klik <b>Tambah</b> → cari lagi → tambah lagi.
          Setelah lengkap, klik <b>Konfirmasi Penempatan</b> sekali.
        </div>
      </div>
    </div>
  `;

  // bind clear
  $('#btnClearSelected')?.addEventListener('click', ()=>{
    selectedNiks = new Set();
    syncCheckboxState();
    renderSelectedList();
  });

  // bind add checked
  $('#btnAddChecked')?.addEventListener('click', ()=>{
    const checked = Array.from(document.querySelectorAll('#scanResult .pick-nik:checked'))
      .map(el=> String(el.value||'').trim())
      .filter(Boolean);

    if (!checked.length) return showNotification('Belum ada yang dicentang.', 'info');

    checked.forEach(n=> selectedNiks.add(n));
    syncCheckboxState();
    renderSelectedList();
    showNotification(`Ditambahkan ${checked.length} orang ke daftar penumpang.`, 'success');
  });
}

let scanCandidates = { affiliated: [], search: [] };

async function loadCandidates(session){
  try{ await updateScanOfflineHint(session); }catch{}
  const tripId = session.activeTripId || '';
  const res = await api.apiCall('getScanCandidates', {
    sessionId: session.sessionId,
    coordinatorNik: session.userId || session.user?.nik || session.user?.NIK || '',
    tripId,
    q: '',
    limit: 80
  });
  if (!res.success) throw new Error(res.message || 'Gagal memuat kandidat');

  scanCandidates.affiliated = res.affiliated || [];
  scanCandidates.search = [];

  // ✅ auto-seed: masukkan yang sudah arrived / sudah di kendaraan ini
  autoSeedSelectedFromCandidates();

  renderCandidatesUI(session);
  renderSelectedList();
}

async function searchCandidates(session, q){
  const tripId = session.activeTripId || '';
  const res = await api.apiCall('getScanCandidates', {
    sessionId: session.sessionId,
    coordinatorNik: session.userId || session.user?.nik || session.user?.NIK || '',
    tripId,
    q: q || '',
    limit: 80
  });
  if (!res.success) throw new Error(res.message || 'Gagal mencari');

  scanCandidates.search = res.search || [];
  renderCandidatesUI(session);
  renderSelectedList();
}

// ✅ seed dari afiliasi: arrived=true atau sudah ada di kendaraan ini -> masuk daftar awal
function autoSeedSelectedFromCandidates(){
  const vehicleCode = String(pendingVehicle?.Code || pendingVehicle?.code || '').trim();
  (scanCandidates.affiliated || []).forEach(p=>{
    const nik = String(p.nik||'').trim();
    if (!nik) return;
    if (p.arrived) selectedNiks.add(nik);
    if (String(p.inVehicle||'')===vehicleCode) selectedNiks.add(nik);
  });
}

function renderCandidatesUI(session){
  const details = $('#resultDetails');
  if (!details) return;

  let wrap = document.getElementById('scanCandidatesWrap');
  if (!wrap){
    wrap = document.createElement('div');
    wrap.id = 'scanCandidatesWrap';
    details.insertAdjacentElement('beforeend', wrap);
  }

  const aff = scanCandidates.affiliated || [];
  const srch = scanCandidates.search || [];
  const vehicleCode = String(pendingVehicle?.Code || pendingVehicle?.code || '').trim();

  const row = (p, checked=false, showAddBtn=false)=> {
    const nik = String(p.nik||'').trim();
    const inVeh = String(p.inVehicle||'').trim();

    const note = inVeh
      ? (inVeh === vehicleCode
          ? `<small style="color:#16a34a; font-weight:700;">(sudah di kendaraan ini)</small>`
          : `<small style="color:#b45309; font-weight:700;">(di kendaraan ${escapeHtml(inVeh)} → akan dipindah)</small>`)
      : '';

    const alreadyPicked = selectedNiks.has(nik);

    return `
      <div class="pick-row" style="display:flex; gap:10px; padding:8px 10px; border:1px solid #eee; border-radius:10px; margin:6px 0; align-items:flex-start;">
        <input type="checkbox" class="pick-nik" value="${escapeHtml(nik)}" ${checked ? 'checked':''}/>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; line-height:1.1;">
            ${escapeHtml(p.nama||'-')}
            <small style="color:#666;">(${escapeHtml(nik)})</small>
            ${note}
            ${alreadyPicked ? `<small style="color:#2563eb; font-weight:800;">(dipilih)</small>` : ''}
          </div>
          <div style="font-size:12px; color:#666; margin-top:2px;">
            ${escapeHtml(p.relationship||'-')} • ${escapeHtml(p.region||'-')} • ${escapeHtml(p.estate||'-')}
            ${p.arrived ? ' • <b style="color:#16a34a;">TIBA</b>' : ''}
          </div>
        </div>

        ${showAddBtn ? `
          <button type="button" class="btn btn-secondary btnAddOne"
                  data-nik="${escapeHtml(nik)}"
                  style="padding:8px 10px; white-space:nowrap;">
            Tambah
          </button>
        ` : ``}
      </div>
    `;
  };

  const affHtml = aff.length
    ? aff.map(p=> row(p, !!p.arrived || String(p.inVehicle||'')===vehicleCode, false)).join('')
    : `<div style="color:#777; padding:6px;">Tidak ada afiliasi.</div>`;

  const searchHtml = srch.length
    ? srch.map(p=> row(p, selectedNiks.has(String(p.nik||'').trim()) || String(p.inVehicle||'')===vehicleCode, true)).join('')
    : `<div style="color:#777; padding:6px;">Cari peserta lain dengan NIK/Nama.</div>`;

  wrap.innerHTML = `
    <hr style="margin:12px 0; border:none; border-top:1px solid #eee;">
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <div style="flex:1; min-width:280px;">
        <h4 style="margin:0 0 8px;">Prioritas (Afiliasi Koordinator)</h4>
        <div id="affList">${affHtml}</div>
      </div>

      <div style="flex:1; min-width:280px;">
        <h4 style="margin:0 0 8px;">Tambah Peserta Lain</h4>
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <input id="scanSearchBox" placeholder="Cari NIK / Nama..." style="flex:1; padding:10px; border:1px solid #ddd; border-radius:10px;">
          <button id="scanSearchBtn" type="button" class="btn btn-secondary">Cari</button>
        </div>
        <div id="searchList">${searchHtml}</div>

        <div style="font-size:12px; color:#666; margin-top:6px;">
          Jika peserta lain dipilih, MainNIK bisa dialihkan ke saya.
        </div>
        <label style="display:flex; align-items:center; gap:8px; margin-top:8px;">
          <input type="checkbox" id="takeOverAff" />
          <span style="font-weight:700;">Alihkan MainNIK ke saya</span>
        </label>
      </div>
    </div>
  `;

  // bind search
  const btn = document.getElementById('scanSearchBtn');
  if (btn){
    btn.onclick = async ()=>{
      const q = document.getElementById('scanSearchBox')?.value.trim();
      try{ await searchCandidates(session, q); }
      catch(e){ showNotification(e.message||'Gagal cari', 'error'); }
    };
  }

  // ✅ bind tombol "Tambah" per hasil pencarian
  wrap.querySelectorAll('.btnAddOne').forEach(b=>{
    b.addEventListener('click', ()=>{
      const nik = String(b.dataset.nik||'').trim();
      if (!nik) return;
      selectedNiks.add(nik);

      // ✅ auto-cek checkbox baris itu (biar visual konsisten)
      const chk = wrap.querySelector(`.pick-nik[value="${CSS.escape(nik)}"]`);
      if (chk) chk.checked = true;

      renderSelectedList();
      showNotification('Ditambahkan ke penumpang sementara.', 'success');
    });
  });

  // ✅ kalau user centang manual, kita ikutkan ke keranjang (opsional tapi natural)
  wrap.querySelectorAll('.pick-nik').forEach(ch=>{
    ch.addEventListener('change', ()=>{
      const nik = String(ch.value||'').trim();
      if (!nik) return;
      if (ch.checked) selectedNiks.add(nik);
      else selectedNiks.delete(nik);
      renderSelectedList();
    });
  });
}

function syncCheckboxState(){
  document.querySelectorAll('#scanResult .pick-nik').forEach(ch=>{
    const nik = String(ch.value||'').trim();
    if (!nik) return;
    ch.checked = selectedNiks.has(nik);
  });
}

function renderSelectedList(){
  const box = document.getElementById('selectedList');
  if (!box) return;

  const vehicleCode = String(pendingVehicle?.Code || pendingVehicle?.code || '').trim();

  // buat lookup kandidat biar tampil nama/relasi
  const map = new Map();
  [...(scanCandidates.affiliated||[]), ...(scanCandidates.search||[])].forEach(p=>{
    const nik = String(p.nik||'').trim();
    if (nik) map.set(nik, p);
  });

  const items = Array.from(selectedNiks);

  if (!items.length){
    box.innerHTML = `<div style="color:#777;">Belum ada penumpang dipilih.</div>`;
    return;
  }

  box.innerHTML = items.map(nik=>{
    const p = map.get(nik) || { nik, nama: nik, relationship:'', region:'', estate:'', inVehicle:'' };
    const inVeh = String(p.inVehicle||'').trim();
    const note = inVeh
      ? (inVeh === vehicleCode
          ? `<small style="color:#16a34a;font-weight:800;">(sudah di kendaraan ini)</small>`
          : `<small style="color:#b45309;font-weight:800;">(dari ${escapeHtml(inVeh)} → akan dipindah)</small>`)
      : '';

    return `
      <div style="display:flex; gap:10px; align-items:flex-start; padding:8px 10px; border:1px dashed #e5e7eb; border-radius:10px; margin:6px 0;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:900;">
            ${escapeHtml(p.nama||'-')}
            <small style="color:#666;">(${escapeHtml(nik)})</small>
            ${note}
          </div>
          <div style="font-size:12px; color:#666; margin-top:2px;">
            ${escapeHtml(p.relationship||'-')} • ${escapeHtml(p.region||'-')} • ${escapeHtml(p.estate||'-')}
          </div>
        </div>
        <button type="button" class="btn btn-secondary btnRemoveSel"
                data-nik="${escapeHtml(nik)}"
                style="padding:8px 10px; white-space:nowrap;">
          Hapus
        </button>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.btnRemoveSel').forEach(b=>{
    b.addEventListener('click', ()=>{
      const nik = String(b.dataset.nik||'').trim();
      if (!nik) return;
      selectedNiks.delete(nik);
      syncCheckboxState();
      renderSelectedList();
    });
  });
}

export async function confirmAssignment(session){
  if (!pendingVehicle) return showNotification('Belum ada kendaraan yang dipilih', 'error');

  const btn = $('#scanResult .btn-primary');
  try{
    setButtonLoading(btn, true);

    const vehicleCode = String(pendingVehicle.Code || pendingVehicle.code || '').trim();

    // ✅ ambil dari keranjang (bukan dari checkbox lagi)
    const nikList = Array.from(selectedNiks).filter(Boolean);

    if (!nikList.length){
      showNotification('Belum ada penumpang dipilih. Tambahkan dulu dari hasil pencarian atau centang list.', 'error');
      return;
    }

    const takeOver = !!document.getElementById('takeOverAff')?.checked;

    const payload = {
      sessionId: session.sessionId,
      vehicleCode,
      tripId: session.activeTripId || '',
      nikList: JSON.stringify(nikList),
      moveIfInOtherVehicle: '1'
    };

    if (takeOver){
      payload.setMainNik = String(session.user?.nik || session.user?.NIK || session.userId || '').trim();
    }

    const res = await api.apiCall('assignVehicleStrict', payload);
    // ✅ Jika offline (queued), simpan hint agar map drawer bisa tampilkan penumpang
    try{
      if (res?.queued){
        // kita pakai api.getVehicleManifestOffline() yang membaca queue,
        // jadi tidak perlu simpan apa-apa lagi.
        // Tapi kita simpan last vehicle juga sudah ada.
        showNotification('Mode offline: penempatan disimpan di antrian. Peta akan menampilkan lokasi Anda (kendaraan ini) dan daftar penumpang dari antrian.', 'info', 4500);
      }
    }catch{}
    if (!res.success) throw new Error(res.message || 'Gagal assign');

    const moved = (res.moved||[]).length;
    const added = (res.added||[]).length;

    showNotification(
      `Berhasil. Ditambah: ${added} orang${moved?` • Dipindah dari kendaraan lain: ${moved}`:''}`,
      'success'
    );

        // ✅ simpan kendaraan terakhir agar auto resume saat app dibuka lagi
    try{
      localStorage.setItem('tt_last_vehicle_code', vehicleCode);
    }catch{}

    // ✅ kirim lokasi SEKALI saat ini (biar langsung update)
    try{
      if (navigator.geolocation){
        navigator.geolocation.getCurrentPosition(async (pos)=>{
          try{
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            if (isFinite(lat) && isFinite(lng)){
              await api.apiCall('updateLocation', {
                sessionId: session.sessionId,
                vehicleCode,
                lat,
                lng
              });
            }
          }catch{}
        }, ()=>{}, { enableHighAccuracy:true, timeout: 12000, maximumAge: 2000 });
      }
    }catch{}

    // ✅ mulai tracking periodik selama app masih aktif
    try{
      startBackgroundTrackingPublic(session, vehicleCode);
    }catch{}

    // ✅ beri tahu app.js untuk membuka menu lain
    try{
      window.dispatchEvent(new CustomEvent('tt_trip_started', { detail:{ vehicleCode } }));
    }catch{}

    // ✅ setelah sukses: tetap tutup seperti sebelumnya
    $('#scanResult').style.display = 'none';
    pendingVehicle = null;
    selectedNiks = new Set();

  } catch(err){
    showNotification(err.message || 'Gagal menempatkan', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function escapeHtml(str){
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
