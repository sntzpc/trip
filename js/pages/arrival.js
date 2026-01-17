import * as api from '../core/api.js';
import { $, showNotification, setButtonLoading } from '../core/ui.js';

// cache data participants terakhir (biar bisa re-render tanpa fetch berulang)
let _parts = [];
let _me = null;
let _tripId = '';
let _userNik = '';

// ===== utils =====
function isArrived(p){
  return (p && (p.Arrived===true || String(p.Arrived).toLowerCase()==='true' || String(p.Arrived)==='TRUE'));
}

// keluarga/afiliasi yang dianggap “keluarga” di UI arrival (boleh Anda sesuaikan)
function isFamilyRel(rel){
  const s = String(rel||'').trim().toLowerCase();
  return ['istri','suami','anak','ayah','ibu','keluarga','family'].includes(s);
}

function esc(s){
  return String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

// ✅ panggil saat halaman Arrival dibuka (setelah login)
export async function initArrivalPage(session, user){
  try{
    _tripId = session?.activeTripId || '';
    _userNik = String(user?.nik || user?.NIK || '').trim();

    const res = await api.getParticipants(session.sessionId, _tripId, 'all');
    _parts = res.participants || [];

    _me = _parts.find(p => String(p.NIK||p.nik||'').trim() === _userNik) || null;

    // render UI sesuai kendaraan + jalur berbeda
    renderArrivalLists(session, user);

    // status card = hanya status user (saya)
    const arrivedMe = !!(_me && isArrived(_me));
    updateStatusUI(arrivedMe);

  } catch(e){
    // fallback: minimal tetap tampilkan UI kosong
    $('#familyList') && ($('#familyList').innerHTML = `<p class="empty-text">Gagal memuat data peserta.</p>`);
  }
}

// ===== Render UI (2 kelompok: rombongan kendaraan & jalur berbeda) =====
function renderArrivalLists(session, user){
  const box = $('#familyList');
  if (!box) return;

  const myVeh = String(_me?.Vehicle || '').trim(); // kendaraan saya
  const myArrived = !!(_me && isArrived(_me));

  // === Semua afiliasi di bawah koordinator (keluarga + staff + mentee) ===
  const affiliatedAll = _parts.filter(p=>{
    return String(p.MainNIK||'').trim() === _userNik;
  });

  // === Kelompok A: Rombongan Kendaraan Saya (SEMUA yang satu kendaraan) ===
  const groupVehicle = _parts.filter(p=>{
    return myVeh && String(p.Vehicle||'').trim() === myVeh;
  });

  // pastikan saya ada di list
  if (_me && !groupVehicle.some(p=>String(p.NIK)===_userNik)) {
    groupVehicle.unshift(_me);
  }

  // === Kelompok B: Jalur Berbeda ===
  const groupOther = affiliatedAll.filter(p=>{
    if (!myVeh) return true;
    return String(p.Vehicle||'').trim() !== myVeh;
  });

  const row = (p, checkedDefault=true, nameSuffix='')=>{
    const nik = String(p.NIK||p.nik||'').trim();
    const arrived = isArrived(p);
    const disabled = arrived ? 'disabled' : '';
    const checked = (checkedDefault && !arrived) ? 'checked' : '';
    const rel = p.Relationship || p.Category || '-';
    const veh = String(p.Vehicle||'').trim();

    return `
      <div class="family-member" style="margin:6px 0;">
        <label style="display:flex; gap:10px; align-items:flex-start; opacity:${arrived?0.7:1}; cursor:${arrived?'not-allowed':'pointer'};">
          <input type="checkbox" class="arrChk" data-nik="${esc(nik)}" ${checked} ${disabled}>
          <span style="flex:1; min-width:0;">
            <b>${esc(p.Nama||p.name||'-')}</b> <small>(${esc(nik)})</small> ${nameSuffix}
            <div style="font-size:12px; color:#666; margin-top:2px;">
              ${esc(rel)}${veh ? ` • Kendaraan: <b>${esc(veh)}</b>` : ''}
              ${arrived ? ` • <b style="color:#16a34a;">SUDAH TIBA</b>` : ''}
            </div>
          </span>
        </label>
      </div>
    `;
  };

  // UI: 2 section + 2 tombol (rombongan & jalur berbeda)
  const vehTitle = myVeh ? `Rombongan Kendaraan Saya (${esc(myVeh)})` : 'Rombongan Kendaraan Saya';
  const vehEmpty = myVeh
    ? `<div style="color:#777;">Tidak ada peserta lain yang tercatat di kendaraan ${esc(myVeh)}.</div>`
    : `<div style="color:#777;">Anda belum terkait kendaraan. Konfirmasi hanya untuk diri sendiri.</div>`;

  const listVeh = groupVehicle.length
    ? groupVehicle.map((p)=>{
        const nik = String(p.NIK||'').trim();
        const suffix = (nik === _userNik) ? `<small style="color:#2563eb;font-weight:800;">(Saya)</small>` : '';
        // default checked: yang BELUM arrived (agar cepat)
        return row(p, true, suffix);
      }).join('')
    : vehEmpty;

  const listOther = groupOther.length
    ? groupOther.map(p=>{
        const veh = String(p.Vehicle||'').trim();
        const suffix = veh
          ? `<small style="color:#b45309;font-weight:800;">(kendaraan lain: ${esc(veh)})</small>`
          : `<small style="color:#b45309;font-weight:800;">(belum ada kendaraan / jalur berbeda)</small>`;
        // default unchecked (jalur berbeda biasanya tidak ikut rombongan)
        return row(p, false, suffix);
      }).join('')
    : `<div style="color:#777;">Tidak ada anggota keluarga yang jalur berbeda.</div>`;

  box.innerHTML = `
    <div style="padding:10px; border:1px solid #eee; border-radius:12px; margin-bottom:10px;">
      <h4 style="margin:0 0 8px;">${vehTitle}</h4>
      <div id="arrivalVehList">${listVeh}</div>

      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <button id="confirmArrivalBtn" type="button" class="btn btn-primary">
          Konfirmasi Kedatangan Rombongan
        </button>
        <div style="font-size:12px; color:#666; line-height:1.3;">
          Hanya peserta yang <b>tercatat di kendaraan yang sama</b> yang muncul di sini.
          ${myArrived ? `<br><b style="color:#b91c1c;">Anda sudah tiba → konfirmasi rombongan dikunci.</b>` : ''}
        </div>
      </div>
    </div>

    <div style="padding:10px; border:1px solid #eee; border-radius:12px;">
      <h4 style="margin:0 0 8px;">Kedatangan Jalur Berbeda (Opsional)</h4>
      <div style="font-size:12px; color:#666; margin:-2px 0 8px;">
        Anggota keluarga/afiliasi dengan <b>MainNIK sama</b> tetapi <b>bukan</b> di kendaraan yang sama.
        Konfirmasi ini dipakai jika mereka datang belakangan/mandiri.
      </div>
      <div id="arrivalOtherList">${listOther}</div>

      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <button id="confirmArrivalOtherBtn" type="button" class="btn btn-secondary">
          Konfirmasi Jalur Berbeda
        </button>
      </div>
    </div>
  `;

  // bind tombol konfirmasi rombongan
  const btnVeh = $('#confirmArrivalBtn');
  if (btnVeh){
    btnVeh.disabled = !!myArrived; // ✅ jika saya sudah tiba, rombongan terkunci
    btnVeh.style.opacity = myArrived ? 0.6 : '';
    btnVeh.style.cursor = myArrived ? 'not-allowed' : '';
    btnVeh.onclick = async ()=> confirmArrivalVehicle(session);
  }

  // bind tombol konfirmasi jalur berbeda (tetap boleh walau saya sudah tiba)
  const btnOther = $('#confirmArrivalOtherBtn');
  if (btnOther){
    btnOther.onclick = async ()=> confirmArrivalOther(session);
  }
}

// ===== Confirm: Rombongan kendaraan saya =====
async function confirmArrivalVehicle(session){
  const myArrived = !!(_me && isArrived(_me));
  if (myArrived){
    showNotification('Anda sudah tiba. Konfirmasi rombongan dikunci.', 'info');
    return;
  }

  const btn = $('#confirmArrivalBtn');
  try{
    setButtonLoading(btn, true);

    // ambil checklist dari section rombongan (yang belum arrived & dicentang)
    const nikList = [];
    document.querySelectorAll('#arrivalVehList .arrChk:checked').forEach(ch=>{
      const nik = String(ch.dataset.nik||'').trim();
      if (nik) nikList.push(nik);
    });

    // safety: pastikan minimal ada 1 (biasanya saya)
    if (!nikList.length) {
      showNotification('Centang minimal 1 peserta pada rombongan.', 'error');
      return;
    }

    await api.confirmArrival(session.sessionId, JSON.stringify(nikList), _tripId);

    showNotification('Kedatangan rombongan berhasil dikonfirmasi.', 'success');

    // refresh data biar checkbox yang sudah arrived jadi disabled
    await initArrivalPage(session, session.user || { nik:_userNik });

  } catch(err){
    showNotification(err.message||'Gagal konfirmasi rombongan', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

// ===== Confirm: Jalur berbeda =====
async function confirmArrivalOther(session){
  const btn = $('#confirmArrivalOtherBtn');
  try{
    setButtonLoading(btn, true);

    const nikList = [];
    document.querySelectorAll('#arrivalOtherList .arrChk:checked').forEach(ch=>{
      const nik = String(ch.dataset.nik||'').trim();
      if (nik) nikList.push(nik);
    });

    if (!nikList.length){
      showNotification('Pilih (centang) minimal 1 peserta jalur berbeda.', 'error');
      return;
    }

    await api.confirmArrival(session.sessionId, JSON.stringify(nikList), _tripId);

    showNotification('Kedatangan jalur berbeda berhasil dikonfirmasi.', 'success');

    // refresh
    await initArrivalPage(session, session.user || { nik:_userNik });

  } catch(err){
    showNotification(err.message||'Gagal konfirmasi jalur berbeda', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

// ===== Status card (tetap untuk saya) =====
export function updateStatusUI(arrived){
  const card = $('#userArrivalStatus');
  if (!card) return;

  if (arrived){
    card.classList.add('arrived');
    card.querySelector('.status-icon i').className = 'fas fa-check-circle';
    card.querySelector('.status-details h4').textContent = 'Telah Konfirmasi';
    card.querySelector('.status-details p').textContent = 'Terima kasih. Status Anda sudah tercatat.';
  } else {
    // optional: kalau mau reset saat belum arrived
    card.classList.remove('arrived');
  }
}

// kompatibilitas: jika ada pemanggilan lama renderFamily/confirmArrival dari app.js,
// kita arahkan ke initArrivalPage & confirmArrivalVehicle (rombongan).
export function renderFamily(user){
  // render ulang berbasis data terakhir (jika sudah ada)
  if (_parts.length) {
    renderArrivalLists({ activeTripId:_tripId }, user);
  }
}

export async function confirmArrival(session, user){
  // default tombol lama = konfirmasi rombongan
  await confirmArrivalVehicle(session);
}
