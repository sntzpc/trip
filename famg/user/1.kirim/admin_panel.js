/* ==========================
   FG2026 - Admin Panel
   Role: ADMIN
   FIX: kompatibel dengan schema backend Code.gs (rows, qty_total, image_url, dll)
   ========================== */

(()=>{
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
  const KEY = 'fg_admin_token_v1';
  let token = localStorage.getItem(KEY)||'';
  let me = null;

  function setBusy(on){
    const b = $('#btn-login');
    if(b) b.disabled = !!on;
  }

  function htmlEsc(s){
    return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  function driveIdFromAny(s){
  const str = String(s||'').trim();
  if(!str) return '';
  // kalau sudah id mentah
  if(/^[a-zA-Z0-9_-]{20,}$/.test(str) && !str.includes('http')) return str;

  // uc?export=view&id=ID
  let m = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if(m && m[1]) return m[1];

  // /file/d/ID/
  m = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if(m && m[1]) return m[1];

  // lh3 googleusercontent /d/ID
  m = str.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if(m && m[1]) return m[1];

  return '';
}

// ✅ sumber <img> yang paling stabil untuk Drive image
function driveImgSrc(urlOrId, size=800){
  const id = driveIdFromAny(urlOrId);
  if(!id) return String(urlOrId||'').trim();

  // thumbnail endpoint untuk gambar (paling stabil)
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${Number(size)||800}`;
}

// ✅ fallback chain jika thumbnail gagal load
function bindImgFallback(imgEl, urlOrId){
  const id = driveIdFromAny(urlOrId);
  if(!imgEl || !id) return;

  const fallbacks = [
    `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}`
  ];

  let i = 0;
  imgEl.addEventListener('error', ()=>{
    if(i >= fallbacks.length) return;
    imgEl.src = fallbacks[i++];
  }, { once:false });
}

// ✅ cache dataUrl agar tidak request berulang
const prizeImgCache = new Map(); // key=fileId -> dataUrl

async function loadPrizeImgToEl(imgEl, fileIdOrUrl){
  try{
    const id = driveIdFromAny(fileIdOrUrl);
    if(!id) return;

    if(prizeImgCache.has(id)){
      imgEl.src = prizeImgCache.get(id);
      return;
    }

    // ambil dari GAS (anti ORB)
    const res = await FGAPI.public.getPrizeImageDataUrl(id);
    const dataUrl = res?.data_url || '';
    if(dataUrl){
      prizeImgCache.set(id, dataUrl);
      imgEl.src = dataUrl;
    }
  }catch(err){
    // kalau gagal, biarkan placeholder icon tetap tampil
    console.warn('loadPrizeImgToEl error:', err);
  }
}

  async function ensureMe(){
    if(!token) return null;
    try{
      const r = await FGAPI.auth.me(token);
      me = r.user;
      return me;
    }catch(e){
      token='';
      localStorage.removeItem(KEY);
      return null;
    }
  }

  function showLogin(){
    $('#login')?.classList.remove('hidden');
    $('#panel')?.classList.add('hidden');
    $('#btn-logout')?.classList.add('hidden');
  }
  function showApp(){
    $('#login')?.classList.add('hidden');
    $('#panel')?.classList.remove('hidden');
    $('#btn-logout')?.classList.remove('hidden');
  }

  async function doLogin(){
    const u = $('#username').value.trim();
    const p = $('#password').value;
    if(!u||!p){ utils.showNotification('Isi username & password','warning'); return; }
    setBusy(true);
    try{
      const data = await FGAPI.auth.login(u,p);
      token = data.token;
      localStorage.setItem(KEY, token);
      me = data.user;
      if(me.role !== 'ADMIN'){
        utils.showNotification('Akun ini bukan ADMIN','error');
        await FGAPI.auth.logout(token).catch(()=>{});
        token=''; localStorage.removeItem(KEY);
        showLogin();
        return;
      }
      utils.showNotification('Login berhasil','success');
      showApp();
      await loadAll();
    }catch(e){
      utils.showNotification(String(e.message||e),'error');
    }finally{ setBusy(false); }
  }

  async function doLogout(){
    if(token) await FGAPI.auth.logout(token).catch(()=>{});
    token=''; me=null; localStorage.removeItem(KEY);
    showLogin();
    utils.showNotification('Logout','info');
  }

  // ------- Tabs -------
  function bindTabs(){
    $$('.tab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const tab = btn.dataset.tab;
        $$('.tab-btn').forEach(b=>b.className = 'tab-btn px-4 py-2 rounded-xl bg-gray-100');
        btn.className = 'tab-btn px-4 py-2 rounded-xl bg-blue-600 text-white';
        $$('.tab').forEach(t=>t.classList.add('hidden'));
        $('#tab-'+tab)?.classList.remove('hidden');
      });
    });
  }

  // ------- Render helpers -------
  function renderTable(container, cols, rows, actions){
    const head = cols.map(c=>`<th class="text-left p-2 text-xs uppercase tracking-wider text-gray-500">${htmlEsc(c.label)}</th>`).join('');
    const body = (rows||[]).map(r=>{
      const tds = cols.map(c=>`<td class="p-2 text-sm text-gray-700 whitespace-nowrap">${htmlEsc(r[c.key])}</td>`).join('');
      const act = actions ? `<td class="p-2 text-sm whitespace-nowrap">${actions(r)}</td>` : '';
      return `<tr class="border-t">${tds}${act}</tr>`;
    }).join('');
    container.innerHTML = `
      <div class="overflow-auto">
        <table class="min-w-full">
          <thead><tr>${head}${actions?'<th class="p-2"></th>':''}</tr></thead>
          <tbody>${body||''}</tbody>
        </table>
      </div>
    `;
  }

  function getRows(data){
    if(!data) return [];
    if(Array.isArray(data.rows)) return data.rows;
    if(Array.isArray(data.items)) return data.items; // fallback backend lama
    return [];
  }

  function openModal({ title='Form', bodyHtml='', onSave=async()=>{}, saveText='Simpan' }){
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4';

  overlay.innerHTML = `
    <div class="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden">
      <div class="px-5 py-4 bg-gradient-to-r from-blue-600 to-teal-500 text-white flex items-center justify-between">
        <div class="font-bold text-lg">${htmlEsc(title)}</div>
        <button class="modal-x w-9 h-9 rounded-lg hover:bg-white/15 grid place-items-center">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="p-5 max-h-[75vh] overflow-auto">
        ${bodyHtml}
      </div>

      <div class="px-5 py-4 bg-gray-50 flex items-center justify-end gap-2">
        <button class="modal-cancel px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300">Batal</button>
        <button class="modal-save px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white font-semibold hover:opacity-90">
          ${htmlEsc(saveText)}
        </button>
      </div>
    </div>
  `;

  const close = ()=> overlay.remove();
  overlay.querySelector('.modal-x')?.addEventListener('click', close);
  overlay.querySelector('.modal-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });

  overlay.querySelector('.modal-save')?.addEventListener('click', async ()=>{
    const btn = overlay.querySelector('.modal-save');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Menyimpan...`;
    try{
      await onSave({ root: overlay, close });
    }finally{
      btn.disabled = false;
      btn.innerHTML = htmlEsc(saveText);
    }
  });

  document.body.appendChild(overlay);
  return overlay;
}

function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload = ()=> resolve(String(fr.result||''));
    fr.onerror = ()=> reject(new Error('Gagal membaca file'));
    fr.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl){
  // "data:image/png;base64,AAAA..."
  const i = dataUrl.indexOf('base64,');
  if(i < 0) return '';
  return dataUrl.slice(i + 'base64,'.length);
}

function familyRowTemplate(idx){
  return `
    <div class="fam-row grid grid-cols-12 gap-2 items-center" data-idx="${idx}">
      <div class="col-span-4">
        <select class="fam-rel w-full p-3 border rounded-xl">
          <option value="Istri">Istri</option>
          <option value="Suami">Suami</option>
          <option value="Anak">Anak</option>
          <option value="Orang Tua">Orang Tua</option>
          <option value="Saudara">Saudara</option>
          <option value="Lainnya">Lainnya</option>
        </select>
      </div>
      <div class="col-span-7">
        <input class="fam-name w-full p-3 border rounded-xl" placeholder="Nama anggota keluarga" />
      </div>
      <div class="col-span-1 flex justify-end">
        <button class="fam-del w-10 h-10 rounded-xl bg-red-50 text-red-600 hover:bg-red-100" title="Hapus">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `;
}

function collectFamily(root){
  // hasil: ["Sari Dewi (Istri)", "Rizky (Anak)"]
  const rows = Array.from(root.querySelectorAll('.fam-row'));
  const out = [];
  rows.forEach(r=>{
    const rel = r.querySelector('.fam-rel')?.value?.trim() || 'Lainnya';
    const name = r.querySelector('.fam-name')?.value?.trim() || '';
    if(!name) return;
    out.push(`${name} (${rel})`);
  });
  return out;
}

function setFamilyFromArray(root, arr){
  const wrap = root.querySelector('#fam-wrap');
  wrap.innerHTML = '';
  (arr||[]).forEach((s, i)=>{
    wrap.insertAdjacentHTML('beforeend', familyRowTemplate(i));
    const row = wrap.lastElementChild;
    // parse "Nama (Rel)" jika formatnya demikian
    const m = String(s).match(/^(.*)\s+\((.*)\)\s*$/);
    const name = m ? m[1].trim() : String(s).trim();
    const rel  = m ? m[2].trim() : 'Lainnya';
    row.querySelector('.fam-name').value = name;
    row.querySelector('.fam-rel').value = rel;
  });
  bindFamilyRowActions(root);
}

function bindFamilyRowActions(root){
  root.querySelectorAll('.fam-del').forEach(btn=>{
    btn.onclick = ()=> btn.closest('.fam-row')?.remove();
  });
}

  // ------- Loaders -------
  let cache = { participants:[], events:[], prizes:[], users:[] };

  async function loadAll(){
    await Promise.all([loadParticipants(), loadEvents(), loadPrizes(), loadUsers(), renderControl()]);
  }

  async function loadParticipants(){
  const data = await FGAPI.admin.participantsList(token);
  cache.participants = getRows(data);

  const box = $('#tab-participants');
  box.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <div>
        <h3 class="text-xl font-bold text-gray-800">Peserta</h3>
        <p class="text-gray-600 text-sm">
          Nama peserta utama otomatis dari data NIK (kolom <b>Nama</b>).
          Di daftar keluarga hanya isi anggota keluarga (Istri/Suami/Anak/dll) — <b>jangan isi nama peserta utama</b>.
        </p>
      </div>
      <button id="p-add" class="bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 rounded-xl">
        <i class="fas fa-plus mr-2"></i>Tambah Peserta
      </button>
    </div>
  `;

  const tableWrap = document.createElement('div');
  box.appendChild(tableWrap);

  renderTable(tableWrap,
    [
      {key:'nik',label:'NIK'},
      {key:'name',label:'Nama'},
      {key:'position',label:'Jabatan'},
      {key:'department',label:'Dept'},
      {key:'is_staff',label:'Staff?'},
      {key:'family_count',label:'Anggota Keluarga'}
    ],
    cache.participants.map(x=>({
      nik:x.nik, name:x.name, position:x.position, department:x.department,
      is_staff: (x.is_staff===true || String(x.is_staff||'').toUpperCase()==='TRUE') ? 'Y' : 'N',
      family_count:(x.family||[]).length
    })),
    (r)=>`<button class="p-edit text-blue-700" data-nik="${htmlEsc(r.nik)}" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="p-del text-red-600 ml-2" data-nik="${htmlEsc(r.nik)}" title="Hapus"><i class="fas fa-trash"></i></button>`
  );

  function openParticipantForm(cur){
    const isEdit = !!cur;
    openModal({
      title: isEdit ? `Edit Peserta (${cur.nik})` : 'Tambah Peserta',
      saveText: isEdit ? 'Simpan Perubahan' : 'Simpan',
      bodyHtml: `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">NIK</label>
            <input id="p_nik" class="w-full p-3 border rounded-xl" placeholder="Contoh: 12345678" ${isEdit?'disabled':''} />
            ${isEdit?'<div class="text-xs text-gray-500 mt-1">NIK tidak bisa diubah</div>':''}
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Nama Peserta Utama</label>
            <input id="p_name" class="w-full p-3 border rounded-xl" placeholder="Nama sesuai NIK" />
            <div class="text-xs text-gray-500 mt-1">Nama ini otomatis menjadi peserta utama (tidak perlu ditulis di keluarga).</div>
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Jabatan</label>
            <input id="p_position" class="w-full p-3 border rounded-xl" placeholder="Mis: Staff / Supervisor / Manager" />
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Departemen</label>
            <input id="p_department" class="w-full p-3 border rounded-xl" placeholder="Mis: SDM / Produksi / Keuangan" />
          </div>

          <div class="md:col-span-2">
            <label class="inline-flex items-center gap-2 p-3 border rounded-xl bg-gray-50 cursor-pointer">
              <input id="p_is_staff" type="checkbox" class="w-4 h-4" />
              <span class="font-semibold text-gray-800">Termasuk STAFF (eligible untuk undian doorprize)</span>
            </label>
          </div>
        </div>

        <div class="mt-6 p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-teal-50 border">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div>
              <div class="font-bold text-gray-800">Daftar Keluarga</div>
              <div class="text-sm text-gray-600">Isi anggota keluarga saja. Contoh: <b>Sari Dewi (Istri)</b>, <b>Rizky (Anak)</b>.</div>
            </div>
            <button id="fam-add" class="px-4 py-2 rounded-xl bg-white border hover:bg-gray-50">
              <i class="fas fa-plus mr-2"></i>Tambah
            </button>
          </div>

          <div id="fam-wrap" class="space-y-2"></div>

          <div class="mt-3 text-xs text-gray-600">
            Tips: untuk undangan/absensi, peserta utama tetap dihitung walaupun tidak ada di list keluarga.
          </div>
        </div>
      `,
      onSave: async ({ root, close })=>{
        const nik = root.querySelector('#p_nik')?.value?.trim() || (cur?.nik||'');
        const name = root.querySelector('#p_name')?.value?.trim() || '';
        const position = root.querySelector('#p_position')?.value?.trim() || '';
        const department = root.querySelector('#p_department')?.value?.trim() || '';
        const is_staff = !!root.querySelector('#p_is_staff')?.checked;

        if(!nik){ utils.showNotification('NIK wajib diisi','warning'); return; }
        if(!name){ utils.showNotification('Nama peserta wajib diisi','warning'); return; }

        // keluarga hanya anggota keluarga (tidak boleh mengandung nama utama)
        let family = collectFamily(root);

        // ✅ buang jika ada yang input peserta utama (dengan atau tanpa "(Peserta Utama)")
        const main1 = String(name).trim().toLowerCase();
        family = family.filter(x => {
          const v = String(x||'').trim().toLowerCase();
          if(!v) return false;
          if(v === main1) return false;
          if(v.startsWith(main1 + ' (')) return false; // "Nama (Istri/Suami/..)" tapi itu bisa salah
          if(v === (main1 + ' (peserta utama)')) return false;
          return true;
        });

        await FGAPI.admin.participantsUpsert(token, { nik, name, position, department, is_staff, family });
        utils.showNotification('Peserta tersimpan','success');
        close();
        await loadParticipants();
      }
    });

    // init values + bind add family row
    const overlay = document.querySelector('.fixed.inset-0.z-\\[9999\\]'); // modal terakhir
    const nikEl = overlay.querySelector('#p_nik');
    const nameEl = overlay.querySelector('#p_name');
    const posEl = overlay.querySelector('#p_position');
    const depEl = overlay.querySelector('#p_department');
    const staffEl = overlay.querySelector('#p_is_staff');

    if(cur){
      nikEl.value = cur.nik || '';
      nameEl.value = cur.name || '';
      posEl.value = cur.position || '';
      depEl.value = cur.department || '';
      staffEl.checked = (cur.is_staff===true || String(cur.is_staff||'').toUpperCase()==='TRUE');
      setFamilyFromArray(overlay, cur.family||[]);
    }else{
      // default 1 row keluarga agar langsung terlihat
      setFamilyFromArray(overlay, []);
      overlay.querySelector('#fam-wrap')?.insertAdjacentHTML('beforeend', familyRowTemplate(0));
      bindFamilyRowActions(overlay);
    }

    overlay.querySelector('#fam-add')?.addEventListener('click', ()=>{
      const wrap = overlay.querySelector('#fam-wrap');
      const idx = wrap.querySelectorAll('.fam-row').length;
      wrap.insertAdjacentHTML('beforeend', familyRowTemplate(idx));
      bindFamilyRowActions(overlay);
    });
  }

  $('#p-add').onclick = ()=> openParticipantForm(null);

  $$('.p-edit', box).forEach(btn=>btn.onclick = ()=>{
    const nik = btn.dataset.nik;
    const cur = cache.participants.find(x=>String(x.nik)===String(nik));
    if(cur) openParticipantForm(cur);
  });

  $$('.p-del', box).forEach(btn=>btn.onclick = async ()=>{
    const nik = btn.dataset.nik;
    if(!confirm('Hapus peserta '+nik+'?')) return;
    await FGAPI.admin.participantsDelete(token, nik);
    utils.showNotification('Peserta terhapus','info');
    await loadParticipants();
  });
}

  async function loadEvents(){
  const data = await FGAPI.admin.eventsList(token);
  cache.events = getRows(data);

  const box = $('#tab-events');
  box.innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div class="min-w-0">
        <h3 class="text-xl font-bold text-gray-800">Rundown</h3>
        <p class="text-gray-600 text-sm">
          Kelola rundown lengkap. Admin dapat memilih 1 event aktif untuk ditampilkan di User App.
        </p>
        <p class="text-xs text-gray-500 mt-1">
          Import Excel: kolom minimal <b>day</b>, <b>time</b>, <b>title</b>. Kolom lain opsional.
        </p>
      </div>
      <div class="flex gap-2">
        <button id="e-import" class="bg-white border px-4 py-2 rounded-xl hover:bg-gray-50">
          <i class="fas fa-file-excel mr-2 text-green-700"></i>Import XLSX
        </button>
        <button id="e-add" class="bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 rounded-xl">
          <i class="fas fa-plus mr-2"></i>Tambah
        </button>
      </div>
    </div>
  `;

  // table
  const tableWrap = document.createElement('div');
  box.appendChild(tableWrap);

  const curData = await FGAPI.public.getCurrentEvent().catch(()=>({event:null}));
  const curId = curData?.event?.id || '';

  renderTable(tableWrap,
    [
      {key:'id',label:'ID'},
      {key:'day',label:'Hari'},
      {key:'time',label:'Waktu'},
      {key:'title',label:'Judul'},
    ],
    cache.events
      .slice()
      .sort((a,b)=>Number(a.sort||0)-Number(b.sort||0))
      .map(x=>({
        id:x.id,
        day:x.day,
        time:x.time,
        title:x.title + (String(x.id)===String(curId) ? '  (AKTIF)' : '')
      })),
    (r)=>`<button class="e-set text-green-700" data-id="${htmlEsc(r.id)}" title="Set sebagai aktif"><i class="fas fa-bolt"></i></button>
          <button class="e-edit text-blue-700 ml-2" data-id="${htmlEsc(r.id)}" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="e-del text-red-600 ml-2" data-id="${htmlEsc(r.id)}" title="Hapus"><i class="fas fa-trash"></i></button>`
  );

  function openEventForm(cur){
    const isEdit = !!cur;
    const overlay = openModal({
      title: isEdit ? `Edit Rundown (${cur.id})` : 'Tambah Rundown',
      saveText: isEdit ? 'Simpan Perubahan' : 'Simpan',
      bodyHtml: `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">ID</label>
            <input id="e_id" class="w-full p-3 border rounded-xl" placeholder="kosongkan agar otomatis" ${isEdit?'disabled':''}/>
            <div class="text-xs text-gray-500 mt-1">Boleh kosong, backend akan buat ID otomatis.</div>
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Urutan (sort)</label>
            <input id="e_sort" type="number" class="w-full p-3 border rounded-xl" placeholder="1" />
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Hari</label>
            <select id="e_day" class="w-full p-3 border rounded-xl">
              <option value="1">Hari 1</option>
              <option value="2">Hari 2</option>
              <option value="3">Hari 3</option>
              <option value="4">Hari 4</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Tanggal (opsional)</label>
            <input id="e_date" class="w-full p-3 border rounded-xl" placeholder="Minggu, 18 Januari 2026" />
          </div>

          <div class="md:col-span-2">
            <label class="block text-sm font-semibold text-gray-700 mb-1">Waktu</label>
            <input id="e_time" class="w-full p-3 border rounded-xl" placeholder="19:30 - 21:00" />
          </div>

          <div class="md:col-span-2">
            <label class="block text-sm font-semibold text-gray-700 mb-1">Judul</label>
            <input id="e_title" class="w-full p-3 border rounded-xl" placeholder="Pengundian Doorprize" />
          </div>

          <div class="md:col-span-2">
            <label class="block text-sm font-semibold text-gray-700 mb-1">Deskripsi</label>
            <textarea id="e_desc" class="w-full p-3 border rounded-xl" rows="3" placeholder="Deskripsi kegiatan"></textarea>
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Lokasi</label>
            <input id="e_loc" class="w-full p-3 border rounded-xl" placeholder="Grand Ballroom" />
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Icon (FontAwesome)</label>
            <input id="e_icon" class="w-full p-3 border rounded-xl" placeholder="fa-calendar" />
            <div class="text-xs text-gray-500 mt-1">Contoh: fa-gift, fa-utensils, fa-microphone</div>
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Warna</label>
            <select id="e_color" class="w-full p-3 border rounded-xl">
              <option value="blue">Blue</option>
              <option value="green">Green</option>
              <option value="purple">Purple</option>
              <option value="orange">Orange</option>
            </select>
          </div>

          <div class="md:col-span-2 p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-teal-50 border">
            <div class="text-sm text-gray-700 font-semibold mb-1">Tips:</div>
            <div class="text-sm text-gray-600">
              Urutan (sort) menentukan urutan tampil di User App. Untuk Hari yang sama, sort 1..n.
            </div>
          </div>
        </div>
      `,
      onSave: async ({ root, close })=>{
        const item = {
          id: getVal(root,'#e_id') || (isEdit ? String(cur.id) : ''),
          day: getNum(root,'#e_day', 1),
          date: getVal(root,'#e_date'),
          time: getVal(root,'#e_time'),
          title: getVal(root,'#e_title'),
          description: getVal(root,'#e_desc'),
          location: getVal(root,'#e_loc'),
          icon: getVal(root,'#e_icon') || 'fa-calendar',
          color: getVal(root,'#e_color') || 'blue',
          sort: getNum(root,'#e_sort', 0),
        };

        // Auto-ID kecil kalau add dan ID kosong (biar manusiawi)
        if(!isEdit && !item.id){
          item.id = uniqEventIdLike(item.day, item.sort);
        }

        const err = validateEventItem(item);
        if(err){ utils.showNotification(err,'warning'); return; }

        await FGAPI.admin.eventsUpsert(token, item);
        utils.showNotification('Rundown tersimpan','success');
        close();
        await loadEvents();
      }
    });

    // init values
    overlay.querySelector('#e_id').value = isEdit ? (cur.id||'') : '';
    overlay.querySelector('#e_day').value = String(isEdit ? (cur.day||1) : 3);
    overlay.querySelector('#e_date').value = isEdit ? (cur.date||'') : '';
    overlay.querySelector('#e_time').value = isEdit ? (cur.time||'') : '';
    overlay.querySelector('#e_title').value = isEdit ? (cur.title||'') : '';
    overlay.querySelector('#e_desc').value = isEdit ? (cur.description||'') : '';
    overlay.querySelector('#e_loc').value = isEdit ? (cur.location||'') : '';
    overlay.querySelector('#e_icon').value = isEdit ? (cur.icon||'fa-calendar') : 'fa-calendar';
    overlay.querySelector('#e_color').value = isEdit ? (cur.color||'blue') : 'blue';
    overlay.querySelector('#e_sort').value = String(isEdit ? (cur.sort||0) : 1);
  }

  // Tambah event
  $('#e-add').onclick = ()=> openEventForm(null);

  // Set current event
  $$('.e-set', box).forEach(btn=>btn.onclick = async ()=>{
    await FGAPI.admin.setCurrentEvent(token, btn.dataset.id);
    utils.showNotification('Current event diubah','success');
    await renderControl();
    await loadEvents();
  });

  // Edit
  $$('.e-edit', box).forEach(btn=>btn.onclick = ()=>{
    const id = btn.dataset.id;
    const cur = cache.events.find(x=>String(x.id)===String(id));
    if(cur) openEventForm(cur);
  });

  // Delete
  $$('.e-del', box).forEach(btn=>btn.onclick = async ()=>{
    const id = btn.dataset.id;
    if(!confirm('Hapus event '+id+'?')) return;
    await FGAPI.admin.eventsDelete(token, id);
    utils.showNotification('Terhapus','info');
    await loadEvents();
  });

  // =========================
  // Import XLSX (Modal)
  // =========================
  $('#e-import').onclick = ()=>{
    const overlay = openModal({
      title: 'Import Rundown dari Excel (.xlsx)',
      saveText: 'Import Sekarang',
      bodyHtml: `
        <div class="space-y-4">
          <div class="p-4 rounded-2xl bg-yellow-50 border border-yellow-200 text-yellow-900">
            <div class="font-bold mb-1"><i class="fas fa-info-circle mr-2"></i>Format Excel</div>
            <div class="text-sm">
              Header fleksibel. Minimal: <b>day</b>, <b>time</b>, <b>title</b>.<br/>
              Kolom opsional: id, date, description, location, icon, color, sort.
            </div>
          </div>

          <label class="px-4 py-3 rounded-xl bg-white border hover:bg-gray-50 cursor-pointer inline-flex items-center gap-2">
            <i class="fas fa-file-upload"></i> Pilih File XLSX
            <input id="x_file" type="file" accept=".xlsx" class="hidden" />
          </label>

          <div id="x_stat" class="text-sm text-gray-600"></div>

          <div class="border rounded-2xl overflow-hidden">
            <div class="px-4 py-2 bg-gray-50 text-sm font-semibold text-gray-700">Preview (maks 20 baris)</div>
            <div class="p-4 overflow-auto">
              <table class="min-w-full text-sm">
                <thead>
                  <tr class="text-gray-500">
                    <th class="text-left p-2">day</th>
                    <th class="text-left p-2">time</th>
                    <th class="text-left p-2">title</th>
                    <th class="text-left p-2">sort</th>
                  </tr>
                </thead>
                <tbody id="x_prev"></tbody>
              </table>
            </div>
          </div>

          <div class="text-xs text-gray-500">
            Import akan melakukan <b>upsert</b> berdasarkan ID (jika ada). Jika ID kosong, akan dibuat ID otomatis.
          </div>
        </div>
      `,
      onSave: async ({ root, close })=>{
        const file = root.querySelector('#x_file')?.files?.[0];
        if(!file){ utils.showNotification('Pilih file XLSX dulu','warning'); return; }

        root.querySelector('#x_stat').innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Membaca file...`;

        const raw = await readXlsxToJson(file);
        const mapped = (raw||[]).map(mapXlsxRowToEvent).filter(x=>x.title || x.time || x.day);

        // validasi minimal
        const invalid = mapped
          .map((it,idx)=>({idx,err:validateEventItem(it)}))
          .filter(x=>x.err);

        if(invalid.length){
          utils.showNotification(`Ada ${invalid.length} baris invalid. Periksa minimal day/time/title.`, 'error');
          root.querySelector('#x_stat').textContent = `Invalid rows: ${invalid.slice(0,5).map(x=>x.idx+2).join(', ')} (baris excel, asumsi header di baris 1)`;
          return;
        }

        root.querySelector('#x_stat').innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Import ${mapped.length} baris...`;

        // upsert satu per satu (aman & sederhana)
        for(let i=0;i<mapped.length;i++){
          const it = mapped[i];
          if(!it.id) it.id = uniqEventIdLike(it.day, it.sort);
          await FGAPI.admin.eventsUpsert(token, it);
        }

        utils.showNotification(`Import selesai: ${mapped.length} rundown`, 'success');
        close();
        await loadEvents();
      }
    });

    // bind file change -> preview
    const stat = overlay.querySelector('#x_stat');
    const prev = overlay.querySelector('#x_prev');
    overlay.querySelector('#x_file')?.addEventListener('change', async (e)=>{
      const file = e.target.files?.[0];
      if(!file) return;
      stat.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Memuat preview...`;
      prev.innerHTML = '';
      try{
        const raw = await readXlsxToJson(file);
        const mapped = (raw||[]).map(mapXlsxRowToEvent).filter(x=>x.title || x.time || x.day);
        stat.textContent = `Terbaca ${mapped.length} baris dari sheet pertama.`;

        mapped.slice(0,20).forEach(it=>{
          const tr = document.createElement('tr');
          tr.className = 'border-t';
          tr.innerHTML = `
            <td class="p-2">${htmlEsc(it.day)}</td>
            <td class="p-2">${htmlEsc(it.time)}</td>
            <td class="p-2">${htmlEsc(it.title)}</td>
            <td class="p-2">${htmlEsc(it.sort)}</td>
          `;
          prev.appendChild(tr);
        });
      }catch(err){
        console.warn(err);
        stat.textContent = 'Gagal membaca XLSX: ' + String(err.message||err);
      }
    });
  };
}

  async function loadPrizes(){
  const data = await FGAPI.admin.prizesList(token);
  cache.prizes = getRows(data);

  const box = $('#tab-prizes');
  box.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <div>
        <h3 class="text-xl font-bold text-gray-800">Doorprize</h3>
        <p class="text-gray-600 text-sm">
          Bisa upload gambar dari HP/Laptop. File akan disimpan ke Google Drive folder yang sudah Anda siapkan.
        </p>
      </div>
      <button id="d-add" class="bg-gradient-to-r from-purple-600 to-pink-500 text-white px-4 py-2 rounded-xl">
        <i class="fas fa-plus mr-2"></i>Tambah Doorprize
      </button>
    </div>
  `;

  // render sebagai cards + table (lebih visual)
  const list = document.createElement('div');
  list.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';
  box.appendChild(list);

  (cache.prizes||[]).forEach(p=>{
    const active = (p.active===true || String(p.active||'').toUpperCase()==='TRUE');
    const imgIdOrUrl = (p.image_url || '').trim();
  const img = imgIdOrUrl
    ? `
      <div class="w-full h-40 rounded-xl border bg-white overflow-hidden relative">
        <div class="absolute inset-0 grid place-items-center text-gray-300" data-ph="1">
          <i class="fas fa-image text-3xl"></i>
        </div>
        <img data-prize-img="1" data-src="${htmlEsc(imgIdOrUrl)}"
            src="" class="w-full h-40 object-cover opacity-0 transition-opacity duration-300" />
      </div>`
    : `<div class="w-full h-40 rounded-xl border bg-gray-50 grid place-items-center text-gray-400"><i class="fas fa-image text-3xl"></i></div>`;

    const card = document.createElement('div');
    card.className = 'bg-white rounded-2xl shadow-lg p-4';
    card.innerHTML = `
      ${img}
      <div class="mt-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-bold text-gray-800 truncate">${htmlEsc(p.name||'-')}</div>
            <div class="text-xs text-gray-500">ID: ${htmlEsc(p.id||'-')}</div>
          </div>
          <span class="text-xs px-2 py-1 rounded-full ${active?'bg-green-100 text-green-800':'bg-gray-100 text-gray-600'}">
            ${active?'AKTIF':'NONAKTIF'}
          </span>
        </div>

        <div class="mt-2 text-sm text-gray-700">
          Total: <b>${Number(p.qty_total||0)}</b> &nbsp; | &nbsp; Sisa: <b>${Number(p.qty_remaining||0)}</b>
        </div>

        <div class="mt-3 flex gap-2">
          <button class="d-edit flex-1 px-3 py-2 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100" data-id="${htmlEsc(p.id)}">
            <i class="fas fa-pen mr-2"></i>Edit
          </button>
          <button class="d-del px-3 py-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100" data-id="${htmlEsc(p.id)}" title="Hapus">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
    list.appendChild(card);
    const imgEl = card.querySelector('img[data-prize-img="1"]');
    if(imgEl){
      const srcVal = imgEl.getAttribute('data-src') || '';
      // ketika dataUrl siap, tampilkan
      imgEl.onload = ()=>{
        imgEl.classList.remove('opacity-0');
        const ph = card.querySelector('[data-ph="1"]');
        if(ph) ph.remove();
      };
      loadPrizeImgToEl(imgEl, srcVal);
    }
  });

  function openPrizeForm(cur){
  const isEdit = !!cur;

  // ✅ helper lokal (hindari ORB) – ubah URL drive uc -> googleusercontent
  function normalizeDriveImgUrl(url){
    // simpan sebagai ID saja (paling stabil buat backend ambil blob)
    const id = driveIdFromAny(url);
    return id || String(url||'').trim();
  }

  openModal({
    title: isEdit ? `Edit Doorprize (${cur.id})` : 'Tambah Doorprize',
    saveText: isEdit ? 'Simpan Perubahan' : 'Simpan',
    bodyHtml: `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">ID</label>
          <input id="d_id" class="w-full p-3 border rounded-xl" placeholder="mis: prize-4" ${isEdit?'disabled':''} />
          ${isEdit?'<div class="text-xs text-gray-500 mt-1">ID tidak bisa diubah</div>':''}
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Nama Doorprize</label>
          <input id="d_name" class="w-full p-3 border rounded-xl" placeholder='mis: Smart TV 55"' />
        </div>

        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Qty Total</label>
          <input id="d_total" type="number" class="w-full p-3 border rounded-xl" />
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Qty Sisa</label>
          <input id="d_remain" type="number" class="w-full p-3 border rounded-xl" />
          <div class="text-xs text-gray-500 mt-1">Jika kosong, akan disamakan dengan Total.</div>
        </div>

        <div class="md:col-span-2">
          <label class="inline-flex items-center gap-2 p-3 border rounded-xl bg-gray-50 cursor-pointer">
            <input id="d_active" type="checkbox" class="w-4 h-4" />
            <span class="font-semibold text-gray-800">Aktif</span>
          </label>
        </div>
      </div>

      <div class="mt-6 p-4 rounded-2xl bg-gradient-to-r from-purple-50 to-pink-50 border">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-bold text-gray-800">Gambar Doorprize</div>
            <div class="text-sm text-gray-600">Pilih file dari HP/Laptop, lalu upload. URL otomatis tersimpan.</div>
          </div>
          <label class="px-4 py-2 rounded-xl bg-white border hover:bg-gray-50 cursor-pointer">
            <i class="fas fa-upload mr-2"></i>Pilih File
            <input id="d_file" type="file" accept="image/*" class="hidden" />
          </label>
        </div>

        <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div>
            <div class="text-xs text-gray-500 mb-1">Preview</div>
            <div id="d_preview" class="w-full h-44 rounded-xl border bg-white overflow-hidden grid place-items-center text-gray-400">
              <i class="fas fa-image text-3xl"></i>
            </div>
            <div id="d_up_status" class="mt-2 text-sm text-gray-600"></div>
          </div>

          <div>
            <div class="text-xs text-gray-500 mb-1">Image URL (otomatis)</div>
            <input id="d_img_url" class="w-full p-3 border rounded-xl" placeholder="akan terisi setelah upload" />
            <div class="mt-2 text-xs text-gray-500">
              Jika Anda sudah punya URL, boleh paste manual. Namun disarankan upload agar konsisten.
            </div>
          </div>
        </div>
      </div>
    `,
    onSave: async ({ root, close })=>{
      const id = root.querySelector('#d_id')?.value?.trim() || (cur?.id||'');
      const name = root.querySelector('#d_name')?.value?.trim() || '';
      const qty_total = Number(root.querySelector('#d_total')?.value || 0);
      const qty_remain_raw = root.querySelector('#d_remain')?.value;
      const qty_remaining = (qty_remain_raw === '' || qty_remain_raw == null) ? undefined : Number(qty_remain_raw);
      const active = !!root.querySelector('#d_active')?.checked;

      // ✅ normalisasi URL supaya anti ORB
      const image_url = normalizeDriveImgUrl(root.querySelector('#d_img_url')?.value?.trim() || '');

      if(!id){ utils.showNotification('ID wajib diisi','warning'); return; }
      if(!name){ utils.showNotification('Nama doorprize wajib diisi','warning'); return; }
      if(!qty_total || qty_total < 1){ utils.showNotification('Qty total minimal 1','warning'); return; }

      await FGAPI.admin.prizesUpsert(token, {
        id, name, qty_total,
        qty_remaining: (qty_remaining===undefined ? qty_total : qty_remaining),
        image_url,
        active
      });

      utils.showNotification('Doorprize tersimpan','success');
      close();
      await loadPrizes();
    }
  });

  // =========================
// Helpers: Modal Field Utils
// =========================
function getVal(root, sel){ return root.querySelector(sel)?.value?.trim() || ''; }
function getNum(root, sel, def=0){
  const v = root.querySelector(sel)?.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function getChecked(root, sel){ return !!root.querySelector(sel)?.checked; }

function uniqEventIdLike(day, sort){
  const d = String(day||1);
  const s = String(sort||0);
  return `event-${d}-${s}-${Date.now().toString(36)}`;
}

// =========================
// XLSX Import (Rundown)
// =========================
async function readXlsxToJson(file){
  if(!window.XLSX) throw new Error('Library XLSX belum dimuat. Pastikan admin.html sudah tambah xlsx.full.min.js');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type:'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  // header: pakai baris pertama
  const rows = XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
  return rows; // array of objects by header
}

/**
 * Normalisasi header excel -> field event
 * Dukungan header fleksibel:
 * id, day/hari, date/tanggal, time/waktu, title/judul, description/deskripsi, location/lokasi, icon, color/warna, sort/urutan
 */
function mapXlsxRowToEvent(obj){
  const pick = (keys)=> {
    for(const k of keys){
      const v = obj[k];
      if(v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  const id = pick(['id','ID','Id','event_id','EventID']);
  const dayRaw = pick(['day','Day','hari','Hari','HARI']);
  const date = pick(['date','Date','tanggal','Tanggal','TANGGAL']);
  const time = pick(['time','Time','waktu','Waktu','WAKTU']);
  const title = pick(['title','Title','judul','Judul','JUDUL']);
  const description = pick(['description','Description','deskripsi','Deskripsi']);
  const location = pick(['location','Location','lokasi','Lokasi']);
  const icon = pick(['icon','Icon']) || 'fa-calendar';
  const color = pick(['color','Color','warna','Warna']) || 'blue';
  const sortRaw = pick(['sort','Sort','urutan','Urutan']) || '0';

  const day = Number(dayRaw || 0) || 1;
  const sort = Number(sortRaw || 0) || 0;

  return {
    id: id || '',                 // boleh kosong -> backend bikin UUID
    day,
    date,
    time,
    title,
    description,
    location,
    icon,
    color,
    sort
  };
}

function validateEventItem(it){
  if(!it) return 'Item kosong';
  if(!it.title) return 'Judul wajib';
  if(!it.time) return 'Waktu wajib';
  if(!it.day || it.day < 1) return 'Hari wajib (>=1)';
  return '';
}

  // init
  const overlay = document.querySelector('.fixed.inset-0.z-\\[9999\\]');
  const idEl = overlay.querySelector('#d_id');
  const nameEl = overlay.querySelector('#d_name');
  const totalEl = overlay.querySelector('#d_total');
  const remEl = overlay.querySelector('#d_remain');
  const activeEl = overlay.querySelector('#d_active');
  const urlEl = overlay.querySelector('#d_img_url');
  const preview = overlay.querySelector('#d_preview');
  const status = overlay.querySelector('#d_up_status');

  if(cur){
    idEl.value = cur.id || '';
    nameEl.value = cur.name || '';
    totalEl.value = Number(cur.qty_total||0);
    remEl.value = Number(cur.qty_remaining||0);
    activeEl.checked = (cur.active===true || String(cur.active||'').toUpperCase()==='TRUE');

    // ✅ normalisasi url lama (uc/file/d) -> googleusercontent
    const safeUrl = normalizeDriveImgUrl(cur.image_url || '');
    urlEl.value = safeUrl;

    if(safeUrl){
      const src = driveImgSrc(safeUrl, 900);
      preview.innerHTML = `<img id="d_prev_img" src="${htmlEsc(src)}" class="w-full h-full object-cover" />`;
      const imgEl = overlay.querySelector('#d_prev_img');
      bindImgFallback(imgEl, safeUrl);
    }
  }else{
    // default
    activeEl.checked = true;
    totalEl.value = 1;
    remEl.value = 1;
  }

  // upload handler
  overlay.querySelector('#d_file')?.addEventListener('change', async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;

    status.textContent = 'Membaca file...';
    const dataUrl = await readFileAsDataURL(file);

    // preview tetap pakai dataURL lokal (pasti tampil)
    preview.innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover" />`;

    status.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Upload ke Google Drive...`;

    try{
      const b64 = dataUrlToBase64(dataUrl);
      const up = await FGAPI.admin.uploadPrizeImage(token, file.name, file.type || 'image/jpeg', b64);

      // ✅ utamakan direct_url (anti ORB), fallback ke view_url lalu normalisasi kalau perlu
      const chosen =
        (up && (up.direct_url || up.directUrl)) ||
        (up && (up.view_url || up.viewUrl)) ||
        '';

      // simpan canonical: kalau ada file_id, simpan sebagai uc?export=view&id=ID (paling kompatibel)
      const fileId = (up && (up.file_id || up.fileId)) ? String(up.file_id || up.fileId) : '';
      let finalUrl = '';
      if(fileId){
        finalUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
      }else{
        finalUrl = String(chosen||'').trim();
      }
      urlEl.value = finalUrl;

      // OPTIONAL: tes load remote setelah upload (pakai thumbnail + fallback chain)
      const src = driveImgSrc(finalUrl, 900);
      preview.innerHTML = `<img id="d_prev_img" src="${htmlEsc(src)}" class="w-full h-full object-cover" />`;
      bindImgFallback(overlay.querySelector('#d_prev_img'), finalUrl);


      // (opsional) kalau mau test load remote image, uncomment:
      // preview.innerHTML = safe ? `<img src="${htmlEsc(safe)}" class="w-full h-full object-cover" />` : preview.innerHTML;

      status.innerHTML = `<span class="text-green-700 font-semibold"><i class="fas fa-check-circle mr-2"></i>Upload berhasil</span>`;
    }catch(err){
      console.warn(err);
      status.innerHTML = `<span class="text-red-600 font-semibold"><i class="fas fa-exclamation-circle mr-2"></i>Upload gagal: ${htmlEsc(String(err.message||err))}</span>`;
    }
  });
}


  // add
  $('#d-add').onclick = ()=> openPrizeForm(null);

  // edit & delete
  $$('.d-edit', box).forEach(btn=>btn.onclick = ()=>{
    const id = btn.dataset.id;
    const cur = cache.prizes.find(x=>String(x.id)===String(id));
    if(cur) openPrizeForm(cur);
  });

  $$('.d-del', box).forEach(btn=>btn.onclick = async ()=>{
    const id = btn.dataset.id;
    if(!confirm('Hapus doorprize '+id+'?')) return;
    await FGAPI.admin.prizesDelete(token, id);
    utils.showNotification('Doorprize terhapus','info');
    await loadPrizes();
  });
}

  async function loadUsers(){
  const data = await FGAPI.admin.usersList(token);
  cache.users = getRows(data);

  const box = $('#tab-users');
  box.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <div>
        <h3 class="text-xl font-bold text-gray-800">User Panel</h3>
        <p class="text-gray-600 text-sm">Kelola akun login untuk Admin/Operator.</p>
      </div>
      <button id="u-add" class="bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 rounded-xl">
        <i class="fas fa-plus mr-2"></i>Tambah
      </button>
    </div>
  `;

  const tableWrap = document.createElement('div');
  box.appendChild(tableWrap);

  renderTable(tableWrap,
    [
      {key:'username',label:'Username'},
      {key:'name',label:'Nama'},
      {key:'role',label:'Role'},
      {key:'active',label:'Aktif'}
    ],
    cache.users.map(x=>({
      username:x.username,
      name:x.name,
      role:x.role,
      active:(x.active===true || String(x.active||'').toUpperCase()==='TRUE') ? 'Y' : 'N'
    })),
    (r)=>`<button class="u-edit text-blue-700" data-u="${htmlEsc(r.username)}" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="u-pass text-purple-700 ml-2" data-u="${htmlEsc(r.username)}" title="Reset password"><i class="fas fa-key"></i></button>`
  );

  function openUserForm(cur){
    const isEdit = !!cur;
    const overlay = openModal({
      title: isEdit ? `Edit User (${cur.username})` : 'Tambah User',
      saveText: isEdit ? 'Simpan Perubahan' : 'Buat User',
      bodyHtml: `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Username</label>
            <input id="u_username" class="w-full p-3 border rounded-xl" placeholder="mis: operator2" ${isEdit?'disabled':''}/>
            ${isEdit?'<div class="text-xs text-gray-500 mt-1">Username tidak bisa diubah</div>':''}
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Nama</label>
            <input id="u_name" class="w-full p-3 border rounded-xl" placeholder="Nama tampilan" />
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Role</label>
            <select id="u_role" class="w-full p-3 border rounded-xl">
              <option value="OPERATOR">OPERATOR</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>

          <div class="flex items-center gap-2 p-3 border rounded-xl bg-gray-50">
            <input id="u_active" type="checkbox" class="w-4 h-4" />
            <label for="u_active" class="font-semibold text-gray-800 cursor-pointer">Aktif</label>
          </div>

          <div class="md:col-span-2 p-4 rounded-2xl bg-gradient-to-r from-purple-50 to-pink-50 border">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-bold text-gray-800">Password</div>
                <div class="text-sm text-gray-600">
                  ${isEdit ? 'Isi jika ingin reset password. Kosongkan jika tidak diubah.' : 'Isi password awal (jika kosong, default: user123).'}
                </div>
              </div>
            </div>
            <div class="mt-3">
              <input id="u_pass" type="password" class="w-full p-3 border rounded-xl" placeholder="${isEdit?'(opsional) reset password':'user123'}" />
            </div>
          </div>
        </div>
      `,
      onSave: async ({ root, close })=>{
        const username = getVal(root,'#u_username') || (isEdit ? String(cur.username) : '');
        const name = getVal(root,'#u_name') || username;
        const role = (getVal(root,'#u_role') || 'OPERATOR').toUpperCase();
        const active = getChecked(root,'#u_active');
        const pass = root.querySelector('#u_pass')?.value || '';

        if(!username){ utils.showNotification('Username wajib','warning'); return; }

        await FGAPI.admin.usersUpsert(token, { username, name, role, active });

        // reset password jika diisi
        const finalPass = (pass && pass.trim()) ? pass.trim() : '';
        if(finalPass){
          await FGAPI.admin.usersResetPassword(token, username, finalPass);
        }else if(!isEdit){
          // user baru tanpa password -> set default user123 (biar pasti)
          await FGAPI.admin.usersResetPassword(token, username, 'user123');
        }

        utils.showNotification('User tersimpan','success');
        close();
        await loadUsers();
      }
    });

    // init
    overlay.querySelector('#u_username').value = isEdit ? (cur.username||'') : '';
    overlay.querySelector('#u_name').value = isEdit ? (cur.name||cur.username||'') : '';
    overlay.querySelector('#u_role').value = isEdit ? (String(cur.role||'OPERATOR').toUpperCase()) : 'OPERATOR';
    overlay.querySelector('#u_active').checked = isEdit ? (cur.active===true || String(cur.active||'').toUpperCase()==='TRUE') : true;
  }

  function openResetPass(username){
    const overlay = openModal({
      title: `Reset Password (${username})`,
      saveText: 'Reset Password',
      bodyHtml: `
        <div class="space-y-3">
          <div class="p-4 rounded-2xl bg-yellow-50 border border-yellow-200 text-yellow-900">
            Masukkan password baru untuk user <b>${htmlEsc(username)}</b>.
          </div>
          <input id="rp_pass" type="password" class="w-full p-3 border rounded-xl" placeholder="Password baru" />
        </div>
      `,
      onSave: async ({ root, close })=>{
        const np = root.querySelector('#rp_pass')?.value || '';
        if(!np.trim()){ utils.showNotification('Password tidak boleh kosong','warning'); return; }
        await FGAPI.admin.usersResetPassword(token, username, np.trim());
        utils.showNotification('Password direset','success');
        close();
      }
    });
    overlay.querySelector('#rp_pass')?.focus();
  }

  // add
  $('#u-add').onclick = ()=> openUserForm(null);

  // edit
  $$('.u-edit', box).forEach(btn=>btn.onclick = ()=>{
    const username = btn.dataset.u;
    const cur = cache.users.find(x=>String(x.username)===String(username));
    if(cur) openUserForm(cur);
  });

  // reset pass
  $$('.u-pass', box).forEach(btn=>btn.onclick = ()=>{
    const username = btn.dataset.u;
    openResetPass(username);
  });
}

  async function renderControl(){
    const box = $('#tab-control');
    let cur = null;
    try{ cur = await FGAPI.public.getCurrentEvent(); }catch{}
    const curTitle = cur?.event?.title || '-';
    const curId = cur?.event?.id || '';

    box.innerHTML = `
      <h3 class="text-xl font-bold text-gray-800 mb-2">Kontrol Cepat</h3>

      <div class="p-4 bg-gradient-to-r from-blue-50 to-teal-50 rounded-2xl mb-6">
        <div class="text-gray-700">Current Event:</div>
        <div class="text-lg font-bold text-gray-900">${htmlEsc(curTitle)}</div>
        <div class="text-sm text-gray-500">${htmlEsc(curId)}</div>
        <div class="mt-4 flex flex-wrap gap-3">
          <a href="doorprize.html" class="bg-gradient-to-r from-purple-600 to-pink-500 text-white px-4 py-2 rounded-xl">
            <i class="fas fa-gift mr-2"></i>Operator Doorprize
          </a>
          <a href="rundown.html" class="bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 rounded-xl">
            <i class="fas fa-calendar mr-2"></i>Operator Rundown
          </a>
        </div>
      </div>

      <!-- ✅ NEW: Pengaturan Aplikasi -->
      <div class="bg-white rounded-2xl border p-5">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <div class="text-lg font-bold text-gray-800">Pengaturan Aplikasi</div>
            <div class="text-sm text-gray-600">
              Kelola konfigurasi event/app/security langsung dari Admin Panel (tanpa edit config.js).
            </div>
            <div class="text-xs text-gray-500 mt-1">
              Perubahan disimpan di server & dicache di user app (cepat, tidak berat).
            </div>
          </div>
          <div class="flex gap-2">
            <button id="cfg-edit" class="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white">
              <i class="fas fa-sliders-h mr-2"></i>Atur Config
            </button>
            <button id="cfg-reset" class="px-4 py-2 rounded-xl bg-white border hover:bg-gray-50">
              <i class="fas fa-undo mr-2"></i>Reset Override
            </button>
          </div>
        </div>
      </div>
    `;

    $('#cfg-edit')?.addEventListener('click', openConfigModal);
    $('#cfg-reset')?.addEventListener('click', openConfigResetModal);
  }

  async function openConfigModal(){
    // ambil patch config dari server
    let cfg = {};
    try{
      const res = await FGAPI.admin.configGet(token);
      cfg = res?.config || {};
    }catch(e){
      utils.showNotification('Gagal memuat config: ' + String(e.message||e), 'error');
      return;
    }

    const overlay = openModal({
      title: 'Pengaturan Config (Server Override)',
      saveText: 'Simpan Config',
      bodyHtml: `
        <div class="space-y-6">
          <div class="p-4 rounded-2xl bg-yellow-50 border border-yellow-200 text-yellow-900">
            <div class="font-bold"><i class="fas fa-info-circle mr-2"></i>Catatan</div>
            <div class="text-sm mt-1">
              Yang disimpan adalah <b>override/patch</b> saja. Default tetap di config.js.
              Setelah disimpan, user app akan otomatis ikut perubahan (cache beberapa menit).
            </div>
          </div>

          <!-- EVENT -->
          <div class="p-4 rounded-2xl border bg-white">
            <div class="font-bold text-gray-800 mb-3"><i class="fas fa-calendar-alt mr-2 text-blue-600"></i>Event</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="md:col-span-2">
                <label class="block text-sm font-semibold text-gray-700 mb-1">Nama Acara</label>
                <input id="cfg_event_name" class="w-full p-3 border rounded-xl" placeholder="Family Gathering ..." />
              </div>

              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Event Start (ISO)</label>
                <input id="cfg_event_start" class="w-full p-3 border rounded-xl" placeholder="2026-01-16T00:00:00+07:00" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Event End (ISO)</label>
                <input id="cfg_event_end" class="w-full p-3 border rounded-xl" placeholder="2026-01-19T23:59:59+07:00" />
              </div>

              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Gala Dinner Start (ISO)</label>
                <input id="cfg_gala_start" class="w-full p-3 border rounded-xl" placeholder="2026-01-19T07:00:00+07:00" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Gala Dinner End (ISO)</label>
                <input id="cfg_gala_end" class="w-full p-3 border rounded-xl" placeholder="2026-01-19T23:50:00+07:00" />
              </div>
            </div>
          </div>

          <!-- LOCATION -->
          <div class="p-4 rounded-2xl border bg-white">
            <div class="font-bold text-gray-800 mb-3"><i class="fas fa-map-marker-alt mr-2 text-teal-600"></i>Lokasi & Geofence</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Nama Lokasi</label>
                <input id="cfg_loc_name" class="w-full p-3 border rounded-xl" placeholder="Seriang Training Center" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Alamat</label>
                <input id="cfg_loc_addr" class="w-full p-3 border rounded-xl" placeholder="Desa ... " />
              </div>

              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Latitude</label>
                <input id="cfg_lat" type="number" step="any" class="w-full p-3 border rounded-xl" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Longitude</label>
                <input id="cfg_lng" type="number" step="any" class="w-full p-3 border rounded-xl" />
              </div>

              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Accuracy (meter)</label>
                <input id="cfg_acc" type="number" class="w-full p-3 border rounded-xl" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Geofence Radius (meter)</label>
                <input id="cfg_radius" type="number" class="w-full p-3 border rounded-xl" />
              </div>
            </div>
          </div>

          <!-- APP -->
          <div class="p-4 rounded-2xl border bg-white">
            <div class="font-bold text-gray-800 mb-3"><i class="fas fa-cogs mr-2 text-purple-600"></i>Aplikasi</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Doorprize Confirm Timeout (ms)</label>
                <input id="cfg_dp_timeout" type="number" class="w-full p-3 border rounded-xl" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Notification Timeout (ms)</label>
                <input id="cfg_notif_timeout" type="number" class="w-full p-3 border rounded-xl" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Location Update Interval (ms)</label>
                <input id="cfg_loc_interval" type="number" class="w-full p-3 border rounded-xl" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Event Switch Interval (ms)</label>
                <input id="cfg_event_switch" type="number" class="w-full p-3 border rounded-xl" />
              </div>
            </div>
          </div>

          <!-- SECURITY -->
          <div class="p-4 rounded-2xl border bg-white">
            <div class="font-bold text-gray-800 mb-3"><i class="fas fa-shield-alt mr-2 text-orange-600"></i>Security</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">NIK Min Length</label>
                <input id="cfg_nik_len" type="number" class="w-full p-3 border rounded-xl" />
              </div>

              <label class="inline-flex items-center gap-2 p-3 border rounded-xl bg-gray-50 cursor-pointer">
                <input id="cfg_enable_date" type="checkbox" class="w-4 h-4" />
                <span class="font-semibold text-gray-800">Enable Date Validation</span>
              </label>

              <label class="inline-flex items-center gap-2 p-3 border rounded-xl bg-gray-50 cursor-pointer">
                <input id="cfg_enable_geo" type="checkbox" class="w-4 h-4" />
                <span class="font-semibold text-gray-800">Enable Geofencing</span>
              </label>

              <label class="inline-flex items-center gap-2 p-3 border rounded-xl bg-gray-50 cursor-pointer md:col-span-3">
                <input id="cfg_debug" type="checkbox" class="w-4 h-4" />
                <span class="font-semibold text-gray-800">Debug Mode</span>
              </label>
            </div>
          </div>
        </div>
      `,
      onSave: async ({ root, close })=>{
        const num = (sel, def=0)=> {
          const v = root.querySelector(sel)?.value;
          const n = Number(v);
          return Number.isFinite(n) ? n : def;
        };
        const val = (sel)=> (root.querySelector(sel)?.value||'').trim();
        const chk = (sel)=> !!root.querySelector(sel)?.checked;

        // ✅ build patch (override saja)
        const patch = {
          event: {
            name: val('#cfg_event_name'),
            galaDinnerDate: val('#cfg_gala_start'),
            galaDinnerEndTime: val('#cfg_gala_end'),
            eventStartDate: val('#cfg_event_start'),
            eventEndDate: val('#cfg_event_end'),
            location: {
              name: val('#cfg_loc_name'),
              address: val('#cfg_loc_addr'),
              coordinates: {
                latitude: num('#cfg_lat', 0),
                longitude: num('#cfg_lng', 0),
                accuracy: num('#cfg_acc', 50)
              },
              geofencingRadius: num('#cfg_radius', 2500)
            }
          },
          app: {
            doorprizeConfirmTimeout: num('#cfg_dp_timeout', 60000),
            notificationTimeout: num('#cfg_notif_timeout', 5000),
            locationUpdateInterval: num('#cfg_loc_interval', 30000),
            eventSwitchInterval: num('#cfg_event_switch', 180000)
          },
          security: {
            nikMinLength: num('#cfg_nik_len', 8),
            enableDateValidation: chk('#cfg_enable_date'),
            enableGeofencing: chk('#cfg_enable_geo'),
            debugMode: chk('#cfg_debug')
          }
        };

        await FGAPI.admin.configSet(token, patch);
        utils.showNotification('Config tersimpan di server', 'success');
        close();
      }
    });

    // init form values dari cfg server (patch)
    const g = (path, def='')=>{
      try{
        return path.split('.').reduce((a,k)=>a?.[k], cfg) ?? def;
      }catch{ return def; }
    };
    overlay.querySelector('#cfg_event_name').value = g('event.name','');
    overlay.querySelector('#cfg_event_start').value = g('event.eventStartDate','');
    overlay.querySelector('#cfg_event_end').value = g('event.eventEndDate','');
    overlay.querySelector('#cfg_gala_start').value = g('event.galaDinnerDate','');
    overlay.querySelector('#cfg_gala_end').value = g('event.galaDinnerEndTime','');

    overlay.querySelector('#cfg_loc_name').value = g('event.location.name','');
    overlay.querySelector('#cfg_loc_addr').value = g('event.location.address','');
    overlay.querySelector('#cfg_lat').value = g('event.location.coordinates.latitude','');
    overlay.querySelector('#cfg_lng').value = g('event.location.coordinates.longitude','');
    overlay.querySelector('#cfg_acc').value = g('event.location.coordinates.accuracy', 50);
    overlay.querySelector('#cfg_radius').value = g('event.location.geofencingRadius', 2500);

    overlay.querySelector('#cfg_dp_timeout').value = g('app.doorprizeConfirmTimeout', 60000);
    overlay.querySelector('#cfg_notif_timeout').value = g('app.notificationTimeout', 5000);
    overlay.querySelector('#cfg_loc_interval').value = g('app.locationUpdateInterval', 30000);
    overlay.querySelector('#cfg_event_switch').value = g('app.eventSwitchInterval', 180000);

    overlay.querySelector('#cfg_nik_len').value = g('security.nikMinLength', 8);
    overlay.querySelector('#cfg_enable_date').checked = !!g('security.enableDateValidation', true);
    overlay.querySelector('#cfg_enable_geo').checked = !!g('security.enableGeofencing', true);
    overlay.querySelector('#cfg_debug').checked = !!g('security.debugMode', false);
  }

  function openConfigResetModal(){
    const overlay = openModal({
      title: 'Reset Override Config',
      saveText: 'Reset Sekarang',
      bodyHtml: `
        <div class="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800">
          <div class="font-bold mb-1"><i class="fas fa-exclamation-triangle mr-2"></i>Peringatan</div>
          <div class="text-sm">
            Ini akan menghapus override config di server (kembali ke default config.js / default backend).
            User app akan ikut kembali setelah cache lewat (beberapa menit) atau setelah refresh.
          </div>
        </div>
      `,
      onSave: async ({ close })=>{
        await FGAPI.admin.configSet(token, {}); // simpan patch kosong
        utils.showNotification('Override config direset', 'success');
        close();
      }
    });
  }

  // ------- Init -------
  document.addEventListener('DOMContentLoaded', async ()=>{
    bindTabs();
    $('#btn-login')?.addEventListener('click', doLogin);
    $('#password')?.addEventListener('keypress', (e)=>{ if(e.key==='Enter') doLogin(); });
    $('#btn-logout')?.addEventListener('click', doLogout);

    const ok = await ensureMe();
    if(ok && ok.role==='ADMIN'){
      showApp();
      await loadAll();
    }else{
      showLogin();
    }
  });
})();