// core/storage.js
export const LS = {
  session: 'trip_tracker_session_v1',
  cfg: 'trip_tracker_cfg_v1'
};

export function loadSession(){
  try{ return JSON.parse(localStorage.getItem(LS.session) || 'null'); }catch{ return null; }
}
export function saveSession(session){
  localStorage.setItem(LS.session, JSON.stringify(session));
}
export function clearSession(){
  localStorage.removeItem(LS.session);
}

export function loadCfg(){
  try{ return JSON.parse(localStorage.getItem(LS.cfg) || 'null'); }catch{ return null; }
}
export function saveCfg(cfg){
  localStorage.setItem(LS.cfg, JSON.stringify(cfg));
}
