/* ==========================
   FG2026 - Rundown Operator
   Role: OPERATOR / ADMIN
   ========================== */

(()=>{
  const $ = (s,r=document)=>r.querySelector(s);
  const KEY = 'fg_operator_token_v1';
  let token = localStorage.getItem(KEY)||'';

  function esc(s){
    return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  async function login(){
    const u = $('#username').value.trim();
    const p = $('#password').value;
    try{
      const r = await FGAPI.auth.login(u,p);
      token = r.token;
      localStorage.setItem(KEY, token);
      $('#login').classList.add('hidden');
      $('#panel').classList.remove('hidden');
      $('#btn-logout').classList.remove('hidden');
      await refresh();
      utils.showNotification('Login berhasil', 'success');
    }catch(e){
      utils.showNotification(String(e.message||e), 'error');
    }
  }

  async function ensureLogged(){
    if(!token) return false;
    try{ await FGAPI.auth.me(token); return true; }catch{ return false; }
  }

  async function refresh(){
    const cur = await FGAPI.public.getCurrentEvent();
    $('#current').textContent = cur?.event?.title ? cur.event.title : 'Belum dipilih';

    // ✅ OPERATOR boleh list event
    const ev = await FGAPI.operator.eventsList(token);
    const rows = (ev.rows||[]).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));

    const box = $('#events');
    box.innerHTML='';
    rows.forEach(r=>{
      const el = document.createElement('div');
      el.className = 'p-4 bg-gray-50 border rounded-xl flex items-start justify-between gap-4';
      const active = (cur?.event?.id && cur.event.id === r.id);
      el.innerHTML = `
        <div>
          <div class="font-bold text-gray-800">${esc(r.title)}</div>
          <div class="text-sm text-gray-600">${esc(r.time)} | Hari ${esc(r.day)}</div>
          <div class="text-xs text-gray-500 mt-1">${esc(r.description||'')}</div>
        </div>
        <div class="flex flex-col gap-2">
          <button class="btn-set px-3 py-2 rounded-lg ${active?'bg-green-600 text-white':'bg-blue-600 text-white'}" data-id="${esc(r.id)}">
            <i class="fas fa-bolt mr-1"></i>${active?'Aktif':'Tampilkan'}
          </button>
        </div>
      `;
      box.appendChild(el);
    });

    box.querySelectorAll('.btn-set').forEach(b=>b.addEventListener('click', async ()=>{
      try{
        // ✅ pakai operator endpoint
        await FGAPI.operator.setCurrentEvent(token, b.dataset.id);
        await refresh();
        utils.showNotification('Acara ditampilkan', 'success');
      }catch(e){
        utils.showNotification(String(e.message||e), 'error');
      }
    }));
  }

  function logout(){
    token='';
    localStorage.removeItem(KEY);
    location.reload();
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    $('#btn-login').addEventListener('click', login);
    $('#btn-logout').addEventListener('click', logout);
    $('#btn-refresh').addEventListener('click', refresh);

    if(await ensureLogged()){
      $('#login').classList.add('hidden');
      $('#panel').classList.remove('hidden');
      $('#btn-logout').classList.remove('hidden');
      await refresh();
    }
  });
})();
