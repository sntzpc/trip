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


// ===== Geofence state (diambil dari SETTINGS via getConfig) =====
let _fences = [];      // [{id,name,lat,lng,radiusM}]
let _activeFence = null; // fence terpilih/terdekat
let _lastPos = null;    // {lat,lng,acc}
let _lastDistM = null;  // jarak ke _activeFence

function haversineMeters(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = x => x * Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2)) *
            Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

async function loadFences(tripId){
  try{
    const cfgRes = await api.getConfig();
    const cfg = cfgRes?.config || {};
    const tid = String(tripId||'').trim();

    // dukung beberapa key (prefer plural)
    const keyPlural = tid ? `arrivalGeofences:${tid}` : 'arrivalGeofences';
    const keySingle = tid ? `arrivalGeofence:${tid}` : 'arrivalGeofence';

    const raw = cfg[keyPlural] || cfg[keySingle] || cfg.arrivalGeofences || cfg.arrivalGeofence || '';
    if (!raw) return [];

    let parsed = null;
    try{ parsed = JSON.parse(raw); }catch(e){}

    // format "lat,lng,radius"
    if (!parsed && String(raw).includes(',')){
      const parts = String(raw).split(',').map(x=>x.trim());
      parsed = { lat:Number(parts[0]), lng:Number(parts[1]), radiusM:Number(parts[2]) };
    }

    const fences = [];

    const pushFence = (obj, idx)=>{
      const lat = Number(obj?.lat);
      const lng = Number(obj?.lng);
      const radiusM = Number(obj?.radiusM || obj?.radius || obj?.r || 0);
      if (!isFinite(lat) || !isFinite(lng) || !isFinite(radiusM) || radiusM<=0) return;
      fences.push({
        id: String(obj?.id || obj?.name || `P${idx+1}`),
        name: String(obj?.name || obj?.label || `Titik ${idx+1}`),
        lat, lng, radiusM
      });
    };

    if (Array.isArray(parsed)){
      parsed.forEach((p,i)=> pushFence(p,i));
    } else if (parsed && Array.isArray(parsed.points)){
      parsed.points.forEach((p,i)=> pushFence(p,i));
    } else if (parsed && (parsed.lat!=null) && (parsed.lng!=null)){
      pushFence(parsed, 0);
    }

    return fences;
  }catch(e){}
  return [];
}


function renderFenceInfo(){
  const el = $('#arrivalFenceInfo');
  if (!el) return;

  if (!_fences || !_fences.length){
    el.innerHTML = `<div style="padding:10px;border:1px dashed #f59e0b;border-radius:12px;background:#fffbeb;color:#92400e;">
      <b>Lokasi kedatangan belum diatur oleh Admin.</b><br>
      Konfirmasi kedatangan <b>dikunci</b> sampai geofence diatur.
    </div>`;
    return;
  }

  if (!_activeFence) _activeFence = _fences[0];

  const distTxt = (typeof _lastDistM === 'number') ? `${Math.round(_lastDistM)} m` : '-';
  const accTxt = (typeof _lastPos?.acc === 'number') ? `${Math.round(_lastPos.acc)} m` : '-';

  const hasMulti = _fences.length > 1;
  const options = _fences.map((f)=>{
    const sel = (_activeFence && f.id === _activeFence.id) ? 'selected' : '';
    return `<option value="${esc(f.id)}" ${sel}>${esc(f.name)} (r=${Math.round(f.radiusM)}m)</option>`;
  }).join('');

  el.innerHTML = `<div style="padding:10px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;color:#0f172a;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
      <div style="font-size:12px;color:#64748b;">Geofence Kedatangan (Trip: <b>${esc(_tripId||'-')}</b>)</div>
      <button id="arrivalCheckBtn" type="button" class="btn btn-secondary" style="padding:6px 10px; font-size:12px;">
        <i class="fa-solid fa-location-crosshairs"></i> Cek Lokasi
      </button>
    </div>

    ${hasMulti ? `
      <div style="margin-top:8px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Pilih titik kedatangan</div>
        <select id="arrivalFenceSelect" class="form-control" style="max-width:100%; padding:8px; border-radius:10px; border:1px solid #e5e7eb;">
          ${options}
        </select>
      </div>
    ` : ''}

    <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;margin-top:10px;">
      <span>Titik: <b>${esc(_activeFence.name)}</b></span>
      <span>Radius: <b>${Math.round(_activeFence.radiusM)} m</b></span>
      <span>Jarak Anda: <b>${distTxt}</b></span>
      <span>Akurasi GPS: <b>${accTxt}</b></span>
    </div>

    <div style="font-size:11px;color:#64748b;margin-top:6px;">
      Koordinat: ${_activeFence.lat.toFixed(6)}, ${_activeFence.lng.toFixed(6)}
      ${hasMulti ? ` • Total titik: <b>${_fences.length}</b>` : ''}
    </div>
  </div>`;

  const btn = $('#arrivalCheckBtn');
  if (btn) btn.onclick = async ()=> { try{ await checkFenceAndToggleButtons(true); }catch(e){} };

  const sel = $('#arrivalFenceSelect');
  if (sel){
    sel.onchange = ()=>{
      const id = String(sel.value||'');
      const found = _fences.find(x=>x.id===id) || _fences[0];
      _activeFence = found;
      if (_lastPos && isFinite(_lastPos.lat) && isFinite(_lastPos.lng)){
        _lastDistM = haversineMeters(_lastPos.lat, _lastPos.lng, _activeFence.lat, _activeFence.lng);
      } else {
        _lastDistM = null;
      }
      renderFenceInfo();
      checkFenceAndToggleButtons(false);
    };
  }
}


async function getCurrentPos(){
  if (!navigator.geolocation) throw new Error('Geolocation tidak didukung.');
  return await new Promise((resolve, reject)=>{
    navigator.geolocation.getCurrentPosition(
      (pos)=> resolve(pos),
      (err)=> reject(err),
      { enableHighAccuracy:true, timeout:12000, maximumAge:5000 }
    );
  });
}

async function checkFenceAndToggleButtons(showToast=false){
  const msg = $('#arrivalGeoMsg');
  const btnVeh = $('#confirmArrivalBtn');
  const btnOther = $('#confirmArrivalOtherBtn');

  const lock = (why)=>{
    if (btnVeh) { btnVeh.disabled = true; btnVeh.style.opacity=0.6; btnVeh.title = why||''; }
    if (btnOther){ btnOther.disabled = true; btnOther.style.opacity=0.6; btnOther.title = why||''; }
    if (msg) msg.innerHTML = `<div style="margin-top:10px;padding:10px;border-radius:12px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;">
      <b>Anda belum tiba di lokasi.</b><br>${esc(why||'Silakan menuju titik kedatangan.')}
    </div>`;
  };

  const unlock = ()=>{
    if (msg) msg.innerHTML = `<div style="margin-top:10px;padding:10px;border-radius:12px;background:#ecfdf5;border:1px solid #bbf7d0;color:#166534;">
      <b>Anda sudah berada dalam radius lokasi.</b> Tombol konfirmasi aktif.
    </div>`;
  };

  if (!_fences || !_fences.length){
    lock('Lokasi kedatangan belum diatur oleh Admin.');
    return { ok:false };
  }

  try{
    const pos = await getCurrentPos();
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = pos.coords.accuracy;
    _lastPos = { lat, lng, acc };

    // hitung jarak ke semua titik → pilih terdekat
    let best = null;
    for (const f of _fences){
      const d = haversineMeters(lat, lng, f.lat, f.lng);
      if (!best || d < best.distM){
        best = { fence:f, distM:d };
      }
    }
    _activeFence = best?.fence || _fences[0];
    _lastDistM = best?.distM ?? null;

    renderFenceInfo();

    const tol = Math.min(Math.max(acc||0,0), 50) + 5;

    const okAny = _fences.some(f=>{
      const d = haversineMeters(lat, lng, f.lat, f.lng);
      return d <= (f.radiusM + tol);
    });

    if (!okAny){
      lock(`Jarak Anda ±${Math.round(_lastDistM)}m dari titik kedatangan terdekat (radius ${Math.round(_activeFence.radiusM)}m).`);
      if (showToast) showNotification('Anda belum berada dalam radius lokasi.', 'info');
      return { ok:false, distM:_lastDistM, fence:_activeFence };
    }

    if (btnOther){ btnOther.disabled = false; btnOther.style.opacity=''; btnOther.title=''; }
    if (btnVeh && !btnVeh.disabled){ btnVeh.style.opacity=''; btnVeh.title=''; }
    unlock();
    if (showToast) showNotification('Lokasi OK. Anda sudah dalam radius.', 'success');
    return { ok:true, distM:_lastDistM, fence:_activeFence };
  }catch(e){
    renderFenceInfo();
    lock('Aktifkan GPS/izin lokasi lalu coba lagi.');
    if (showToast) showNotification('Gagal mengambil lokasi. Aktifkan GPS/izin lokasi.', 'error');
    return { ok:false };
  }
}
// ✅ panggil saat halaman Arrival dibuka (setelah login)
export async function initArrivalPage(session, user){
  try{
    _tripId = session?.activeTripId || '';
    _userNik = String(user?.nik || user?.NIK || '').trim();

    const res = await api.getParticipants(session.sessionId, _tripId, 'all');
    _parts = res.participants || [];

    _me = _parts.find(p => String(p.NIK||p.nik||'').trim() === _userNik) || null;

    // load geofence config (per trip)
    _fences = await loadFences(_tripId);
    _activeFence = _fences[0] || null;

    // render UI sesuai kendaraan + jalur berbeda
    renderArrivalLists(session, user);

    // status card = hanya status user (saya)
    const arrivedMe = !!(_me && isArrived(_me));
    updateStatusUI(arrivedMe);

    // cek lokasi & toggle tombol
    try{ await checkFenceAndToggleButtons(); }catch(e){}

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
  const vehTitle = myVeh ? `Rombongan Saya (${esc(myVeh)})` : 'Rombongan Saya';
  const vehEmpty = myVeh
    ? `<div style="color:#777;">Tidak ada peserta lain ${esc(myVeh)}.</div>`
    : `<div style="color:#777;">Anda belum terkait kendaraan. Konfirmasi diri sendiri.</div>`;

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
    : `<div style="color:#777;">Tidak ada data.</div>`;

  box.innerHTML = `
    <div id="arrivalFenceInfo"></div>
    <div id="arrivalGeoMsg"></div>

    <div id="arrivalBypassBox" style="display:none; margin-top:10px; padding:10px; border:1px dashed #cbd5e1; border-radius:12px; background:#f1f5f9;">
      <div style="font-size:12px; color:#0f172a; font-weight:800; margin-bottom:6px;">
        Bypass (Admin/Koordinator)
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <input id="arrivalBypassPin" type="password" inputmode="numeric" placeholder="PIN/OTP" style="flex:1; min-width:150px; padding:8px 10px; border:1px solid #e5e7eb; border-radius:10px;">
        <input id="arrivalBypassReason" type="text" placeholder="Alasan (opsional)" style="flex:2; min-width:180px; padding:8px 10px; border:1px solid #e5e7eb; border-radius:10px;">
        <button id="arrivalBypassBtn" type="button" class="btn btn-secondary" style="padding:8px 12px;">
          <i class="fa-solid fa-key"></i> Bypass
        </button>
      </div>
      <div style="font-size:11px; color:#64748b; margin-top:6px; line-height:1.3;">
        Bypass hanya untuk kondisi khusus dan akan tercatat di log server.
      </div>
    </div>

    <div style="padding:10px; border:1px solid #eee; border-radius:12px; margin-top:10px; margin-bottom:10px;">
      <h4 style="margin:0 0 8px;">${vehTitle}</h4>
      <div id="arrivalVehList">${listVeh}</div>

      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <button id="confirmArrivalBtn" type="button" class="btn btn-primary">
          Konfirmasi Rombongan
        </button>
        <div style="font-size:12px; color:#666; line-height:1.3;">
          Hanya peserta <b>di kendaraan yang sama</b> di sini.
          ${myArrived ? `<br><b style="color:#b91c1c;">Sudah tiba → konfirmasi dikunci.</b>` : ''}
        </div>
      </div>
    </div>

    <div style="padding:10px; border:1px solid #eee; border-radius:12px;">
      <h4 style="margin:0 0 8px;">Jalur Berbeda</h4>
      <div style="font-size:12px; color:#666; margin:-2px 0 8px;">
        Peserta datang mandiri.
      </div>
      <div id="arrivalOtherList">${listOther}</div>

      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <button id="confirmArrivalOtherBtn" type="button" class="btn btn-secondary">
          Konfirmasi
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
    // bypass UI: hanya admin/koordinator (opsional)
  try{
    const role = String(user?.role || user?.Role || user?.ROLE || '').toLowerCase();
    const canBypass = (role === 'admin' || role === 'coordinator' || role === 'koordinator');
    const boxBy = $('#arrivalBypassBox');
    if (boxBy && canBypass){
      boxBy.style.display = '';
      const btnBy = $('#arrivalBypassBtn');
      if (btnBy){
        btnBy.onclick = async ()=>{
          try{
            const pin = String($('#arrivalBypassPin')?.value||'').trim();
            const reason = String($('#arrivalBypassReason')?.value||'').trim();
            if (!pin){
              showNotification('PIN/OTP bypass masih kosong.', 'error');
              return;
            }

            // ambil nikList sama seperti rombongan (default: saya saja)
            const nikList = [];
            document.querySelectorAll('#arrivalVehList .arrChk:checked').forEach(ch=>{
              const nik = String(ch.dataset.nik||'').trim();
              if (nik) nikList.push(nik);
            });
            if (_userNik && !nikList.includes(_userNik)) nikList.unshift(_userNik);
            if (!nikList.length && _userNik) nikList.push(_userNik);

            // ambil posisi jika bisa (untuk log)
            try{ await checkFenceAndToggleButtons(false); }catch(e){}
            const lat = _lastPos?.lat;
            const lng = _lastPos?.lng;
            const acc = _lastPos?.acc;

            await api.confirmArrival(session.sessionId, JSON.stringify(nikList), _tripId, lat, lng, acc, {
              bypassPin: pin,
              bypassReason: reason,
              fenceId: _activeFence?.id
            });

            showNotification('Bypass berhasil. Kedatangan dicatat.', 'success');
            await initArrivalPage(session, session.user || { nik:_userNik });
          }catch(err){
            showNotification(err.message||'Bypass gagal', 'error');
          }
        };
      }
    } else if (boxBy){
      boxBy.style.display = 'none';
    }
  }catch(e){}
}
  // bypass UI: hanya admin/koordinator (opsional)
  try{
    const role = String(user?.role || user?.Role || user?.ROLE || '').toLowerCase();
    const canBypass = (role === 'admin' || role === 'coordinator' || role === 'koordinator');
    const boxBy = $('#arrivalBypassBox');
    if (boxBy && canBypass){
      boxBy.style.display = '';
      const btnBy = $('#arrivalBypassBtn');
      if (btnBy){
        btnBy.onclick = async ()=>{
          try{
            const pin = String($('#arrivalBypassPin')?.value||'').trim();
            const reason = String($('#arrivalBypassReason')?.value||'').trim();
            if (!pin){
              showNotification('PIN/OTP bypass masih kosong.', 'error');
              return;
            }

            // ambil nikList sama seperti rombongan (default: saya saja)
            const nikList = [];
            document.querySelectorAll('#arrivalVehList .arrChk:checked').forEach(ch=>{
              const nik = String(ch.dataset.nik||'').trim();
              if (nik) nikList.push(nik);
            });
            if (_userNik && !nikList.includes(_userNik)) nikList.unshift(_userNik);
            if (!nikList.length && _userNik) nikList.push(_userNik);

            // ambil posisi jika bisa (untuk log)
            try{ await checkFenceAndToggleButtons(false); }catch(e){}
            const lat = _lastPos?.lat;
            const lng = _lastPos?.lng;
            const acc = _lastPos?.acc;

            await api.confirmArrival(session.sessionId, JSON.stringify(nikList), _tripId, lat, lng, acc, {
              bypassPin: pin,
              bypassReason: reason,
              fenceId: _activeFence?.id
            });

            showNotification('Bypass berhasil. Kedatangan dicatat.', 'success');
            await initArrivalPage(session, session.user || { nik:_userNik });
          }catch(err){
            showNotification(err.message||'Bypass gagal', 'error');
          }
        };
      }
    } else if (boxBy){
      boxBy.style.display = 'none';
    }
  }catch(e){}
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

    // pastikan saya ikut (rombongan saya)
    if (_userNik && !nikList.includes(_userNik)) nikList.unshift(_userNik);

    // safety: pastikan minimal ada 1 (biasanya saya)
    if (!nikList.length) {
      showNotification('Centang minimal 1 peserta pada rombongan.', 'error');
      return;
    }

    await checkFenceAndToggleButtons();

    const lat = _lastPos?.lat;
    const lng = _lastPos?.lng;
    const acc = _lastPos?.acc;

    await api.confirmArrival(session.sessionId, JSON.stringify(nikList), _tripId, lat, lng, acc);

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

    await checkFenceAndToggleButtons();

    const lat = _lastPos?.lat;
    const lng = _lastPos?.lng;
    const acc = _lastPos?.acc;

    await api.confirmArrival(session.sessionId, JSON.stringify(nikList), _tripId, lat, lng, acc);

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
