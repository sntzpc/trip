import * as api from '../core/api.js';
import { $, showNotification, setButtonLoading } from '../core/ui.js';
import { saveSession } from '../core/storage.js';

export async function doLogin(){
  const nik = $('#nik')?.value.trim();
  const password = $('#password')?.value || '';
  if (!nik) return showNotification('Masukkan NIK Anda', 'error');
  if (!password) return showNotification('Masukkan password Anda', 'error');

  const btn = $('#loginBtn');
  try{
    setButtonLoading(btn, true);
    const res = await api.login(nik, password);
    // res: {success, sessionId, user, family, config}
    const expiry = Date.now() + (res.sessionDurationDays || 3)*24*60*60*1000;
    const session = {
      sessionId: res.sessionId,
      userId: res.user?.nik,
      role: res.user?.role,
      expiry,
      activeTripId: res.activeTripId || null
    };
    saveSession(session);
    return res;
  } catch(err){
    showNotification(err.message || 'Login gagal', 'error');
    throw err;
  } finally {
    setButtonLoading(btn, false);
  }
}

export function bindLoginEnter(){
  $('#password')?.addEventListener('keypress', (e)=>{
    if (e.key === 'Enter') window.login?.();
  });
}
