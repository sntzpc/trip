// ===============================
// FG2026 Branding Loader (Multi-Event)
// - Pull config from server (public.getConfig)
// - Apply branding/text to pages (index/doorprize/rundown)
// ===============================
(function(){
  const FGBranding = {};

  function getCfg(){
    try{ return window.AppConfig || {}; }catch{ return {}; }
  }

  function setText(id, value){
    const el = document.getElementById(id);
    if(!el) return;
    if(value === undefined || value === null) return;
    el.textContent = String(value);
  }

  function tpl(str, ctx){
    if(str === undefined || str === null) return '';
    const s = String(str);
    return s.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_, key)=>{
      // support {a.b.c} lookup
      let v = '';
      try{
        if(!ctx) v = '';
        else if(Object.prototype.hasOwnProperty.call(ctx, key)) v = ctx[key];
        else if(key.includes('.')){
          v = key.split('.').reduce((a,k)=> (a && typeof a === 'object') ? a[k] : undefined, ctx);
        }
      }catch(e){
        v = '';
      }
      return v === undefined || v === null ? '' : String(v);
    });
  }

  async function loadRemoteConfig(){
    try{
      if(!window.FGAPI || !window.FGAPI.public || !window.FGAPI.public.getConfig) return false;
      const r = await window.FGAPI.public.getConfig();
      const patch = r && r.config ? r.config : null;
      if(patch && window.AppConfig && typeof window.AppConfig.applyPatch === 'function'){
        window.AppConfig.applyPatch(patch, true);
        return true;
      }
    }catch(e){
      // ignore
    }
    return false;
  }

  function detectPageKey(){
    const body = document.body;
    if(body && body.dataset && body.dataset.page) return body.dataset.page;
    const p = (location && location.pathname) ? String(location.pathname).toLowerCase() : '';
    if(p.includes('doorprize')) return 'doorprize';
    if(p.includes('rundown')) return 'rundown';
    return 'index';
  }

  function apply(pageKey){
    const cfg = getCfg();
    const brand = cfg.app && cfg.app.brand ? cfg.app.brand : {};
    const pages = cfg.app && cfg.app.pages ? cfg.app.pages : {};

    // Year token (prefer eventStartDate year, fallback current year)
    let year = '';
    try{
      const d = (cfg.event && cfg.event.eventStartDate) ? new Date(cfg.event.eventStartDate) : new Date();
      const y = d.getFullYear();
      year = Number.isFinite(y) ? String(y) : '';
    }catch(e){
      try{ year = String(new Date().getFullYear()); }catch(_){ year=''; }
    }

    const ctx = {
      // most-used tokens
      appName: brand.appName || '',
      shortName: brand.shortName || '',
      headerTitle: brand.headerTitle || '',
      headerSubtitle: brand.headerSubtitle || '',
      adminSubtitle: brand.adminSubtitle || '',
      eventName: (cfg.event && cfg.event.name) ? cfg.event.name : '',
      year,
      // optional tokens
      eventStartDate: (cfg.event && cfg.event.eventStartDate) ? cfg.event.eventStartDate : '',
      eventEndDate: (cfg.event && cfg.event.eventEndDate) ? cfg.event.eventEndDate : '',
      galaStart: (cfg.event && cfg.event.galaDinnerDate) ? cfg.event.galaDinnerDate : '',
      galaEnd: (cfg.event && cfg.event.galaDinnerEndTime) ? cfg.event.galaDinnerEndTime : '',
      locationName: (cfg.event && cfg.event.location && cfg.event.location.name) ? cfg.event.location.name : '',
      locationAddress: (cfg.event && cfg.event.location && cfg.event.location.address) ? cfg.event.location.address : '',

      // nested (for {brand.appName}, {event.name}, dll)
      brand: {
        appName: brand.appName || '',
        shortName: brand.shortName || '',
        headerTitle: brand.headerTitle || '',
        headerSubtitle: brand.headerSubtitle || '',
        adminSubtitle: brand.adminSubtitle || ''
      },
      event: {
        name: (cfg.event && cfg.event.name) ? cfg.event.name : '',
        eventStartDate: (cfg.event && cfg.event.eventStartDate) ? cfg.event.eventStartDate : '',
        eventEndDate: (cfg.event && cfg.event.eventEndDate) ? cfg.event.eventEndDate : '',
        galaDinnerDate: (cfg.event && cfg.event.galaDinnerDate) ? cfg.event.galaDinnerDate : '',
        galaDinnerEndTime: (cfg.event && cfg.event.galaDinnerEndTime) ? cfg.event.galaDinnerEndTime : '',
        location: {
          name: (cfg.event && cfg.event.location && cfg.event.location.name) ? cfg.event.location.name : '',
          address: (cfg.event && cfg.event.location && cfg.event.location.address) ? cfg.event.location.address : ''
        }
      }
    };

    // --- common header on index (if exists) ---
    if(brand.appName) document.title = brand.appName;
    if(brand.headerTitle) setText('main-event-title', brand.headerTitle);
    if(brand.headerSubtitle) setText('main-event-date', brand.headerSubtitle);

    const p = pages[pageKey] || {};

    // page-level title override
    if(p.docTitle) document.title = tpl(p.docTitle, ctx) || document.title;

    if(pageKey === 'index'){
      setText('presence-title', tpl(p.presenceTitle || '', ctx));
      setText('presence-subtitle', tpl(p.presenceSubtitle || '', ctx));
      setText('presence-location-note', tpl(p.presenceLocationNote || '', ctx));

      setText('already-attended-msg', tpl(p.alreadyAttendedMsg || '', ctx));

      setText('app-event-title', tpl(p.appHeaderTitle || '', ctx));
      setText('app-event-subtitle', tpl(p.appHeaderSubtitle || '', ctx));

      setText('schedule-title', tpl(p.scheduleTitle || '', ctx));
      setText('current-event-card-title', tpl(p.currentEventCardTitle || '', ctx));
      setText('doorprize-card-title', tpl(p.doorprizeCardTitle || '', ctx));

      setText('footer-org', tpl(p.footerOrg || '', ctx));
      setText('footer-event', tpl(p.footerEvent || '', ctx));
      setText('footer-date', tpl(p.footerDate || '', ctx));
      setText('footer-copy', tpl(p.footerCopy || '', ctx));
    }

    if(pageKey === 'doorprize'){
      setText('dp-header-title', tpl(p.headerTitle || '', ctx));
      setText('dp-header-subtitle', tpl(p.headerSubtitle || '', ctx));
      setText('dp-machine-event', tpl(p.machineEventName || '', ctx));
      setText('stage-label', tpl(p.stageLabel || '', ctx));
    }

    if(pageKey === 'rundown'){
      setText('rd-header-title', tpl(p.headerTitle || '', ctx));
      setText('rd-header-subtitle', tpl(p.headerSubtitle || '', ctx));
    }
  }

  FGBranding.loadAndApply = async function(pageKey){
    const key = pageKey || detectPageKey();
    // apply local defaults first
    apply(key);
    // then remote override
    const changed = await loadRemoteConfig();
    if(changed) apply(key);
  };

  window.FGBranding = FGBranding;

  document.addEventListener('DOMContentLoaded', ()=>{
    FGBranding.loadAndApply();
  });
})();
