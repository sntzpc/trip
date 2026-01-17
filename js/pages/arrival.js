import * as api from '../core/api.js';
import { $, showNotification, setButtonLoading } from '../core/ui.js';

let _arrivalLocked = false;

// ✅ panggil ini saat halaman Arrival dibuka (setelah login) agar UI langsung terkunci bila sudah tiba
export async function initArrivalPage(session, user){
  try{
    const tripId = session?.activeTripId || '';
    const res = await api.getParticipants(session.sessionId, tripId, 'all');
    const list = res.participants || [];

    const me = list.find(p => String(p.NIK||p.nik||'').trim() === String(user?.nik||'').trim());
    const arrived = !!(me && (me.Arrived===true || String(me.Arrived).toLowerCase()==='true'));

    _arrivalLocked = arrived;
    renderFamily(user, arrived);
    updateStatusUI(arrived);
    setArrivalControlsDisabled(arrived);
  }catch(e){
    // kalau gagal fetch, tetap render normal (tidak fatal)
    renderFamily(user, false);
  }
}

export function renderFamily(user, arrived = false){
  const list = $('#familyList');
  if (!list) return;

  const fam = user?.family || [];
  if (!fam.length){
    list.innerHTML = '<p class="empty-text">Tidak ada data keluarga.</p>';
    return;
  }

  // ✅ tetap tampilkan daftar, tapi kalau arrived=true -> checkbox disabled
  list.innerHTML = fam.map(m=>`
    <div class="family-member">
      <label style="opacity:${arrived ? 0.7 : 1}; cursor:${arrived ? 'not-allowed' : 'pointer'};">
        <input type="checkbox"
               class="famChk"
               value="${escapeHtml(m.nik)}"
               ${arrived ? 'checked disabled' : 'checked'}>
        <span>${escapeHtml(m.name)} <small>(${escapeHtml(m.relationship||m.category||'-')})</small></span>
      </label>
    </div>
  `).join('');
}

// ✅ helper disable tombol + checklist
function setArrivalControlsDisabled(disabled){
  const btn = $('#confirmArrivalBtn');
  if (btn){
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? 0.6 : '';
    btn.style.cursor = disabled ? 'not-allowed' : '';
  }

  document.querySelectorAll('.famChk').forEach(ch=>{
    ch.disabled = !!disabled;
  });
}

export async function confirmArrival(session, user){
  // ✅ kalau sudah arrived, stop di UI (supaya tidak update time)
  if (_arrivalLocked) {
    showNotification('Anda sudah konfirmasi kedatangan. Tidak bisa konfirmasi ulang.', 'info');
    setArrivalControlsDisabled(true);
    updateStatusUI(true);
    return;
  }

  const btn = $('#confirmArrivalBtn');
  try{
    setButtonLoading(btn,true);

    const nikList = [user.nik];
    document.querySelectorAll('.famChk:checked').forEach(ch=> nikList.push(ch.value));

    await api.confirmArrival(session.sessionId, JSON.stringify(nikList), session.activeTripId || '');

    showNotification('Kedatangan berhasil dikonfirmasi', 'success');

    // ✅ kunci permanen UI setelah sukses
    _arrivalLocked = true;
    updateStatusUI(true);
    setArrivalControlsDisabled(true);

  } catch(err){
    showNotification(err.message||'Gagal konfirmasi', 'error');
    throw err;
  } finally {
    setButtonLoading(btn,false);
  }
}

export function updateStatusUI(arrived){
  const card = $('#userArrivalStatus');
  if (!card) return;

  if (arrived){
    card.classList.add('arrived');
    card.querySelector('.status-icon i').className = 'fas fa-check-circle';
    card.querySelector('.status-details h4').textContent = 'Telah Konfirmasi';
    card.querySelector('.status-details p').textContent = 'Terima kasih. Status Anda sudah tercatat.';
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
