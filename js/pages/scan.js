import * as api from '../core/api.js';
import { $, showNotification, setButtonLoading } from '../core/ui.js';

let qr = null;
let pendingVehicle = null;

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
  const res = await api.apiCall('getVehicles', { sessionId: session.sessionId, q: codeOrBarcode, tripId: session.activeTripId || '' });
  const v = res.vehicle;
  if (!v) throw new Error('Kendaraan tidak ditemukan');

  pendingVehicle = v;
  renderResult(v);

  // ✅ setelah kendaraan ketemu, muat daftar afiliasi + checklist
  try{
    await loadCandidates(session);
  }catch(e){
    // tidak fatal
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
  `;
}

let scanCandidates = { affiliated: [], search: [] };

async function loadCandidates(session){
  const tripId = session.activeTripId || '';
  const res = await api.apiCall('getScanCandidates', {
    sessionId: session.sessionId,
    tripId,
    q: '', // awal kosong
    limit: 80
  });
  if (!res.success) throw new Error(res.message || 'Gagal memuat kandidat');
  scanCandidates.affiliated = res.affiliated || [];
  scanCandidates.search = [];
  renderCandidatesUI(session);
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
}

function renderCandidatesUI(session){
  const details = $('#resultDetails');
  if (!details) return;

  // ✅ siapkan container khusus agar tidak dobel append
  let wrap = document.getElementById('scanCandidatesWrap');
  if (!wrap){
    wrap = document.createElement('div');
    wrap.id = 'scanCandidatesWrap';
    details.insertAdjacentElement('beforeend', wrap);
  }

  const aff = scanCandidates.affiliated || [];
  const srch = scanCandidates.search || [];

  const vehicleCode = String(pendingVehicle?.Code || pendingVehicle?.code || '').trim();

  const row = (p, checked=false)=> {
    const inVeh = String(p.inVehicle||'').trim();

    const note = inVeh
      ? (inVeh === vehicleCode
          ? `<small style="color:#16a34a; font-weight:700;">(sudah di kendaraan ini)</small>`
          : `<small style="color:#b45309; font-weight:700;">(di kendaraan ${escapeHtml(inVeh)} → akan dipindah)</small>`)
      : '';

    return `
      <label class="pick-row" style="display:flex; gap:10px; padding:8px 10px; border:1px solid #eee; border-radius:10px; margin:6px 0; align-items:flex-start;">
        <input type="checkbox" class="pick-nik" value="${escapeHtml(p.nik)}" ${checked ? 'checked':''}/>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; line-height:1.1;">
            ${escapeHtml(p.nama||'-')}
            <small style="color:#666;">(${escapeHtml(p.nik)})</small>
            ${note}
          </div>
          <div style="font-size:12px; color:#666; margin-top:2px;">
            ${escapeHtml(p.relationship||'-')} • ${escapeHtml(p.region||'-')} • ${escapeHtml(p.estate||'-')}
            ${p.arrived ? ' • <b style="color:#16a34a;">TIBA</b>' : ''}
          </div>
        </div>
      </label>
    `;
  };

  // ✅ default checked: arrived=true ATAU sudah ada di kendaraan ini
  const affHtml = aff.length
    ? aff.map(p=> row(p, !!p.arrived || String(p.inVehicle||'')===vehicleCode)).join('')
    : `<div style="color:#777; padding:6px;">Tidak ada afiliasi.</div>`;

  const searchHtml = srch.length
    ? srch.map(p=> row(p, String(p.inVehicle||'')===vehicleCode)).join('')
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
          Jika peserta lain dipilih, afiliasi (MainNIK) bisa dialihkan ke koordinator (opsional).
        </div>
        <label style="display:flex; align-items:center; gap:8px; margin-top:8px;">
          <input type="checkbox" id="takeOverAff" />
          <span style="font-weight:700;">Alihkan afiliasi (MainNIK) ke saya (koordinator)</span>
        </label>
      </div>
    </div>
  `;

  // ✅ bind search (tanpa dobel event)
  const btn = document.getElementById('scanSearchBtn');
  if (btn){
    btn.onclick = async ()=>{
      const q = document.getElementById('scanSearchBox')?.value.trim();
      try{ await searchCandidates(session, q); }
      catch(e){ showNotification(e.message||'Gagal cari', 'error'); }
    };
  }
}

export async function confirmAssignment(session){
  if (!pendingVehicle) return showNotification('Belum ada kendaraan yang dipilih', 'error');

  const btn = $('#scanResult .btn-primary');
  try{
    setButtonLoading(btn, true);

    const vehicleCode = pendingVehicle.Code || pendingVehicle.code;

    const checked = Array.from(document.querySelectorAll('#scanResult .pick-nik:checked'))
      .map(el=> el.value)
      .filter(Boolean);

    if (!checked.length){
      showNotification('Silakan centang minimal 1 peserta yang akan masuk.', 'error');
      return;
    }

    const takeOver = !!document.getElementById('takeOverAff')?.checked;

    const payload = {
      sessionId: session.sessionId,
      vehicleCode,
      tripId: session.activeTripId || '',
      nikList: JSON.stringify(checked),
      moveIfInOtherVehicle: '1'
    };

    // ✅ setMainNik: ambil dari session.user (jika app.js sudah set), fallback ke userId
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

    $('#scanResult').style.display = 'none';
    pendingVehicle = null;

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
