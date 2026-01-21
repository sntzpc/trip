/* ==========================
   FG2026 - Doorprize Operator (Revisi)
   Role: OPERATOR / ADMIN

   Perubahan:
   - Jumlah undian otomatis = qty_remaining prize terpilih
   - Pemenang tampil dulu di winner-stage-list (besar & jelas)
   - Tiap pemenang hanya tombol Hapus:
       Hapus => operator.doorprizeRemoveAndRedraw(drawId)
              (tercatat NO_SHOW di riwayat + otomatis cari pengganti)
   - Tombol Simpan: kosongkan stage list + refresh riwayat
   ========================== */

(() => {
  const $ = (s, r = document) => r.querySelector(s);

  const KEY = 'fg_operator_token_v1';
  let token = localStorage.getItem(KEY) || '';

  let prizesCache = [];
  let selectedPrize = '';
  let rollingTimer = null;
  let isRolling = false;

  let poolNames = [];
  const imgCache = new Map();

  // Stage (pemenang yang baru saja diumumkan sebelum masuk “riwayat” di UI)
  let stageWinners = [];      // [{draw_id,name,nik,slot,prize_name,status,time_local}]
  let stageSize = 0;          // jumlah yang diundi pada sesi ini

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function setStage(label, statusText) {
    const a = $('#stage-label'); if (a) a.textContent = label || 'Doorprize';
    const b = $('#roll-status'); if (b) b.textContent = statusText || 'Idle';
  }

  // -------- Drive image helpers (anti ORB) --------
  function driveIdFromAny(s) {
    const str = String(s || '').trim();
    if (!str) return '';
    if (/^[a-zA-Z0-9_-]{20,}$/.test(str) && !str.includes('http')) return str;

    let m = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m && m[1]) return m[1];

    m = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) return m[1];

    m = str.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) return m[1];

    return '';
  }

  async function loadPrizeImageToMain(prize) {
    const img = $('#prize-img');
    const ph = $('#prize-img-ph');
    if (!img || !ph) return;

    img.classList.add('opacity-0');
    ph.classList.remove('hidden');

    const id = driveIdFromAny(prize?.image_url || '');
    if (!id) {
      img.removeAttribute('src');
      ph.classList.remove('hidden');
      return;
    }

    try {
      if (imgCache.has(id)) {
        img.src = imgCache.get(id);
        img.onload = () => {
          img.classList.remove('opacity-0');
          ph.classList.add('hidden');
        };
        return;
      }

      const res = await FGAPI.public.getPrizeImageDataUrl(id);
      const dataUrl = res?.data_url || '';
      if (dataUrl) {
        imgCache.set(id, dataUrl);
        img.src = dataUrl;
        img.onload = () => {
          img.classList.remove('opacity-0');
          ph.classList.add('hidden');
        };
      }
    } catch (e) {
      console.warn(e);
      ph.classList.remove('hidden');
    }
  }

  // -------- Auth --------
  async function ensureLogged() {
    if (!token) return false;
    try { await FGAPI.auth.me(token); return true; } catch { return false; }
  }

  async function login() {
    const u = $('#username').value.trim();
    const p = $('#password').value;
    try {
      const r = await FGAPI.auth.login(u, p);
      token = r.token;
      localStorage.setItem(KEY, token);

      $('#login').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#btn-logout').classList.remove('hidden');

      await loadPrizes();
      await buildPoolNames();
      await refreshHistory();

      utils.showNotification('Login berhasil', 'success');
    } catch (e) {
      utils.showNotification(String(e.message || e), 'error');
    }
  }

  function logout() {
    token = '';
    localStorage.removeItem(KEY);
    location.reload();
  }

  // -------- Prizes --------
  function getPrizeById(id) {
    return prizesCache.find(x => String(x.id) === String(id));
  }

  function setPrizeInfoUI(prize){
  const nameEl = $('#prize-name');
  const stockEl = $('#prize-stock');

  if(!nameEl || !stockEl) return;

  if(!prize){
    nameEl.textContent = '-';
    stockEl.textContent = 'Total: -';
    return;
  }

  const total = Number(prize.qty_total ?? 0);
  const rem = Number(prize.qty_remaining ?? 0);

  nameEl.textContent = String(prize.name || '-');
  stockEl.textContent = `Sisa: ${rem} • Total: ${total}`;
}

function refreshPrizePanel(){
  const p = getPrizeById(selectedPrize);
  setPrizeInfoUI(p);
  loadPrizeImageToMain(p);
}

  async function loadPrizes() {
    const r = await FGAPI.operator.prizesList(token);
    prizesCache = (r.rows || []);

    const sel = $('#prize');
    sel.innerHTML = '<option value="">Pilih doorprize...</option>';

    prizesCache.forEach(it => {
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = `${it.name} (sisa: ${it.qty_remaining})`;
      sel.appendChild(opt);
    });

    if (!selectedPrize && prizesCache.length) {
      selectedPrize = prizesCache[0].id;
      sel.value = selectedPrize;
    }

    refreshPrizePanel();
  }

  // -------- Pool peserta (untuk animasi rolling saja) --------
  async function buildPoolNames() {
    poolNames = [];
    try {
      const r = await FGAPI.operator.participantsEligible(token, true);
      const rows = r.rows || [];
      poolNames = rows.map(x => String(x.name || '').trim()).filter(Boolean);
    } catch (e) {
      poolNames = ['Peserta 001', 'Peserta 002', 'Peserta 003', 'Peserta 004', 'Peserta 005'];
    }
  }

  function randomName() {
    if (!poolNames.length) return '—';
    return poolNames[Math.floor(Math.random() * poolNames.length)];
  }

  function startRolling() {
    isRolling = true;
    setStage('Mengacak…', 'Rolling');

    $('#btn-draw')?.classList.add('hidden');
    $('#btn-stop')?.classList.remove('hidden');

    const disp = $('#roll-display');
    if (!disp) return;

    if (rollingTimer) clearInterval(rollingTimer);
    rollingTimer = setInterval(() => {
      disp.textContent = randomName().toUpperCase();
    }, 55);
  }

  function stopRolling() {
    isRolling = false;

    if (rollingTimer) clearInterval(rollingTimer);
    rollingTimer = null;

    $('#btn-stop')?.classList.add('hidden');
    $('#btn-draw')?.classList.remove('hidden');

    setStage('Doorprize', 'Idle');
  }

  function setSlot(i, total) {
    const a = $('#slot-now');
    const b = $('#slot-total');
    if (a) a.textContent = String(i);
    if (b) b.textContent = String(total);
  }

  // -------- UI: Stage winners (sebelum riwayat) --------
  async function fetchLatestWinWinnerExcluding(excludeIds = []) {
  if (!selectedPrize) return null;
  const r = await FGAPI.operator.doorprizeListByPrize(token, selectedPrize);
  const rows = (r.rows || []);
  const ex = new Set((excludeIds || []).map(String));

  const win = rows.find(x =>
    String(x.status || '').toUpperCase() === 'WIN' &&
    !ex.has(String(x.draw_id || ''))
  );
  return win || null;
}

/**
 * Reroll: hapus pemenang tertentu, lalu ganti tepat pada index yang sama di stageWinners.
 * Ini memastikan UI "menggantikan pemenang lama" bukan sekadar refresh daftar.
 */
async function rerollReplaceAtIndex(indexToReplace) {
  const old = stageWinners[indexToReplace];
  if (!old?.draw_id) throw new Error('Data pemenang tidak valid');

  // Lock UI tombol stop/draw biar tidak ada interaksi aneh
  const drawBtn = $('#btn-draw');
  const stopBtn = $('#btn-stop');

  try {
    // 1) Rolling sebentar (biar terlihat proses)
    setStage('Mengacak pengganti…', 'Rolling');
    setSlot(0, stageSize || '-');
    startRolling();

    // rolling minimal 700ms
    await new Promise(r => setTimeout(r, 700));

    // 2) STOP rolling → JANGAN tampilkan nama apa pun
    if (rollingTimer) clearInterval(rollingTimer);
    rollingTimer = null;
    isRolling = false;

    // sembunyikan tombol stop/draw sementara menunggu server
    stopBtn?.classList.add('hidden');
    drawBtn?.classList.add('hidden');

    // reset display agar tidak ada “nama palsu”
    $('#roll-display').textContent = '——————';
    setStage('Mencari pengganti…', 'Waiting');

    // 3) Call server (mark NO_SHOW + restore stock + draw replacement)
    const res = await FGAPI.operator.doorprizeRemoveAndRedraw(token, old.draw_id);

    // 4) Ambil pengganti yang SAH dari response (paling aman, minim latency mismatch)
    const newW = res?.replacement;
    if (!newW?.draw_id) {
      // fallback: kalau backend lama tidak return replacement
      const excludeIds = stageWinners.map(w => String(w?.draw_id || '')).filter(Boolean);
      const fetched = await fetchLatestWinWinnerExcluding(excludeIds);

      if (!fetched) {
        await rebuildStageFromServer();
        await refreshHistory();
        return;
      }
      stageWinners[indexToReplace] = fetched;
      $('#roll-display').textContent = String(fetched.name || '—').toUpperCase();
    } else {
      // 5) Replace tepat pada index yg dihapus
      stageWinners[indexToReplace] = newW;

      // tampilkan nama pengganti SAH
      $('#roll-display').textContent = String(newW.name || '—').toUpperCase();
    }

    // 6) Render UI & refresh table
    renderStageWinners();
    await loadPrizes();
    await refreshHistory();

    setStage('Pengganti ditemukan', 'Done');

  } finally {
    // balikan tombol
    drawBtn?.classList.remove('hidden');
    stopBtn?.classList.add('hidden');
  }
}

/**
 * Render stage winners:
 * - terbaru di atas (stageWinners sudah unshift)
 * - tombol Hapus mengganti item yang dipilih
 */
function renderStageWinners() {
  const box = $('#winner-stage-list');
  if (!box) return;

  box.innerHTML = '';

  if (!stageWinners.length) {
    box.innerHTML = `<div class="text-gray-500 text-sm">Belum ada pemenang yang ditampilkan.</div>`;
    return;
  }

  stageWinners.forEach((w, idx) => {
    const row = document.createElement('div');
    row.className = 'rounded-2xl border bg-slate-50 p-5 flex items-center justify-center gap-3';

    row.innerHTML = `
      <div class="w-full text-center">
        <div class="text-xs text-gray-500 mb-2">
          Pemenang #${idx + 1} • Slot ${esc(w.slot ?? '')}
        </div>

        <div class="text-3xl md:text-5xl font-extrabold text-gray-900 leading-tight">
          ${esc(w.name || '-')}
        </div>

        <div class="mt-2 text-base md:text-xl text-gray-700">
          NIK: <b>${esc(w.nik || '-')}</b>
        </div>
      </div>

      <button class="btn-stage-delete shrink-0 ml-4 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition"
        data-idx="${idx}" title="Hapus & acak pengganti">
        <i class="fas fa-trash mr-2"></i>Hapus
      </button>
    `;
    box.appendChild(row);
  });

  // ✅ bind delete (pakai data-idx, bukan drawid)
  box.querySelectorAll('.btn-stage-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx || '-1', 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= stageWinners.length) return;

      const w = stageWinners[idx];
      if (!w?.name) return;

      if (!confirm(`Hapus pemenang "${w.name}"? (Akan tercatat Tidak Diambil dan otomatis mencari pengganti)`)) return;

      // ✅ disable tombol agar tidak double-click
      btn.disabled = true;
      btn.classList.add('opacity-60', 'cursor-not-allowed');

      try {
        await rerollReplaceAtIndex(idx);
        utils.showNotification('Pemenang dihapus & diganti', 'success');
      } catch (e) {
        stopRolling();
        utils.showNotification(String(e.message || e), 'error');
      } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    });
  });
}

  async function rebuildStageFromServer() {
    if (!selectedPrize) return;

    // Ambil data terbaru, ambil yang status WIN saja untuk “stage”
    const r = await FGAPI.operator.doorprizeListByPrize(token, selectedPrize);
    const rows = (r.rows || []);

    const winRows = rows.filter(x => String(x.status || '').toUpperCase() === 'WIN');

    stageWinners = winRows.slice(0, stageSize); // asumsi server mengurutkan terbaru dulu
    renderStageWinners();
  }

  async function fetchLatestWinWinner() {
    if (!selectedPrize) return null;
    const r = await FGAPI.operator.doorprizeListByPrize(token, selectedPrize);
    const rows = (r.rows || []);
    const win = rows.find(x => String(x.status || '').toUpperCase() === 'WIN');
    return win || null; // asumsi server newest-first (sesuai riwayat Anda)
  }

  // -------- UI: History table --------
  function statusBadge(status) {
    const s = String(status || 'WIN').toUpperCase();
    if (s === 'TAKEN') return `<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Diambil</span>`;
    if (s === 'NO_SHOW') return `<span class="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full">Tidak Diambil</span>`;
    if (s === 'WIN') return `<span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">Menunggu</span>`;
    return `<span class="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded-full">${esc(s)}</span>`;
  }

  async function refreshHistory() {
    const tb = $('#winner-history-tbody');
    if (!tb) return;

    if (!selectedPrize) {
      tb.innerHTML = `<tr><td class="px-3 py-3 text-gray-500" colspan="5">Pilih doorprize dulu.</td></tr>`;
      return;
    }

    const r = await FGAPI.operator.doorprizeListByPrize(token, selectedPrize);
    const rows = (r.rows || []);

    if (!rows.length) {
      tb.innerHTML = `<tr><td class="px-3 py-3 text-gray-500" colspan="5">Belum ada riwayat pemenang.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map(w => `
      <tr class="align-top">
        <td class="px-3 py-2 whitespace-nowrap text-gray-600">${esc(w.time_local || '')}</td>
        <td class="px-3 py-2 whitespace-nowrap text-gray-700 font-semibold">${esc(w.slot || '')}</td>
        <td class="px-3 py-2 text-gray-900 font-semibold">${esc(w.name || '')}</td>
        <td class="px-3 py-2 text-gray-700">${esc(w.nik || '')}</td>
        <td class="px-3 py-2 whitespace-nowrap">${statusBadge(w.status)}</td>
      </tr>
    `).join('');
  }

  // -------- Draw (count otomatis dari qty_remaining) --------
  async function drawAnimatedAuto() {
    if (isRolling) return;

    if (!selectedPrize) {
      utils.showNotification('Pilih doorprize dulu', 'warning');
      return;
    }

    const prize = getPrizeById(selectedPrize);
    const rem = Math.max(0, Number(prize?.qty_remaining || 0));

    if (!rem) {
      utils.showNotification('Stok doorprize sudah habis.', 'warning');
      return;
    }

    // ✅ count otomatis = qty_remaining
    const n = rem;
    stageSize = n;
    stageWinners = [];
    renderStageWinners();

    setSlot(0, n);
    startRolling();

    const stopBtn = $('#btn-stop');
    if (stopBtn) {
      stopBtn.onclick = () => {
        utils.showNotification('Animasi dihentikan (hasil tetap tersimpan di server).', 'info');
        stopRolling();
      };
    }

    try {
      const res = await FGAPI.operator.drawDoorprize(token, selectedPrize, n);
      const winners = (res && res.winners) ? res.winners : [];

      if (!winners.length) {
        stopRolling();
        utils.showNotification('Tidak ada pemenang (mungkin peserta eligible habis).', 'warning');
        await loadPrizes();
        await refreshHistory();
        return;
      }

      setStage('Menentukan…', 'Revealing');

      for (let i = 0; i < winners.length; i++) {
        setSlot(i + 1, winners.length);

        // rolling lebih lambat sedikit tiap slot biar dramatis
        if (rollingTimer) {
          clearInterval(rollingTimer);
          rollingTimer = setInterval(() => {
            $('#roll-display').textContent = randomName().toUpperCase();
          }, 90 + (i * 15));
        }

        await new Promise(r => setTimeout(r, 900 + (i * 180)));

        if (rollingTimer) { clearInterval(rollingTimer); rollingTimer = null; }

        const w = winners[i];
        $('#roll-display').textContent = String(w.name || '—').toUpperCase();

        // Simpan ke stage list (tampil besar di bawah mesin)
        stageWinners.unshift(w);
        renderStageWinners();

        await new Promise(r => setTimeout(r, 650));
      }

      stopRolling();
      setStage('Selesai', 'Done');

      utils.showNotification(`Undian selesai (${winners.length} pemenang)`, 'success');

      await loadPrizes();
      await refreshHistory();

    } catch (e) {
      stopRolling();
      utils.showNotification(String(e.message || e), 'error');
    }
  }

  // -------- Save (UI clear stage + refresh history) --------
  async function saveStageToHistoryUI() {
  if (!selectedPrize) return;

  // pastikan tidak sedang rolling
  if (rollingTimer) { clearInterval(rollingTimer); rollingTimer = null; }
  isRolling = false;

  // reset mesin dulu agar aman di layar
  $('#roll-display').textContent = '——————';
  setStage('Menyimpan…', 'Saving');

  // ✅ backend: ubah semua WIN -> TAKEN untuk prize ini
  const res = await FGAPI.operator.confirmStage(token, selectedPrize);

  // kosongkan stage UI
  stageWinners = [];
  stageSize = 0;
  renderStageWinners();

  setSlot('-', '-');
  setStage('Doorprize', 'Idle');

  await refreshHistory();
  await loadPrizes();

  utils.showNotification(
    `Simpan berhasil. Status pemenang: DIAMBIL (${res?.updated ?? 0} orang)`,
    'success'
  );
}

  // -------- UI events --------
  document.addEventListener('DOMContentLoaded', async () => {
    $('#btn-login')?.addEventListener('click', login);
    $('#btn-logout')?.addEventListener('click', logout);

    $('#prize')?.addEventListener('change', async (e) => {
      selectedPrize = e.target.value;

      refreshPrizePanel();

      // reset stage ketika ganti doorprize
      stageWinners = [];
      stageSize = 0;
      renderStageWinners();
      $('#roll-display').textContent = '——————';

      await refreshHistory();
    });

    $('#btn-draw')?.addEventListener('click', drawAnimatedAuto);
    $('#btn-save-stage')?.addEventListener('click', saveStageToHistoryUI);

    // boot
    if (await ensureLogged()) {
      $('#login').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#btn-logout').classList.remove('hidden');

      await loadPrizes();
      await buildPoolNames();
      await refreshHistory();

      renderStageWinners();
      setStage('Doorprize', 'Idle');
    } else {
      setStage('Doorprize', 'Idle');
    }
  });
})();
