import * as api from '../core/api.js';
import { $, showNotification, setButtonLoading } from '../core/ui.js';

let qr = null;
let pendingVehicle = null;

// ✅ keranjang penumpang sementara (sebelum submit ke server)
let selectedNiks = new Set();

export function getPendingVehicle(){ return pendingVehicle; }

export async function startScanning(session){
  const btn = $('#startScanBtn');
  try{
    setButtonLoading(btn, true);
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
  return handleCode(session, code);
}

async function handleCode(session, codeOrBarcode){
  const res = await api.apiCall('getVehicles', {
    sessionId: session.sessionId,
    q: codeOrBarcode,
    tripId: session.activeTripId || ''
  });

  const v = res.vehicle;
  if (!v) throw new Error('Kendaraan tidak ditemukan');

  pendingVehicle = v;

  // ✅ reset keranjang setiap kendaraan baru
  selectedNiks = new Set();

  renderResult(v);

  try{
    await loadCandidates(session);
  }catch(e){
    showNotification(e.message || 'Gagal memuat kandidat', 'warning');
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
  const tripId = session.activeTripId || '';
  const res = await api.apiCall('getScanCandidates', {
    sessionId: session.sessionId,
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
    if (!res.success) throw new Error(res.message || 'Gagal assign');

    const moved = (res.moved||[]).length;
    const added = (res.added||[]).length;

    showNotification(
      `Berhasil. Ditambah: ${added} orang${moved?` • Dipindah dari kendaraan lain: ${moved}`:''}`,
      'success'
    );

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
