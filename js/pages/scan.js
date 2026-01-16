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

export async function confirmAssignment(session, nikList){
  if (!pendingVehicle) return showNotification('Belum ada kendaraan yang dipilih', 'error');
  const btn = $('#scanResult .btn-primary');
  try{
    setButtonLoading(btn, true);
    const vehicleCode = pendingVehicle.Code || pendingVehicle.code;
    await api.apiCall('assignVehicle', { sessionId: session.sessionId, vehicleCode, nikList: JSON.stringify(nikList), tripId: session.activeTripId || '' });
    showNotification('Berhasil ditempatkan ke kendaraan', 'success');
    $('#scanResult').style.display = 'none';
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
