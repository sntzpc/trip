// core/idb.js
// Minimal IndexedDB helper (no deps)

const DB_NAME = 'trip_tracker_offline_v1';
const DB_VERSION = 1;

const STORES = {
  kv: 'kv',           // key -> {key, value, updatedAt}
  queue: 'queue'      // offline ops queue: {id, opId, action, params, createdAt, status, attempts, lastAttemptAt, lastError, result, syncedAt}
};

let _dbPromise = null;

export function getDb(){
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.kv)){
        db.createObjectStore(STORES.kv, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.queue)){
        const st = db.createObjectStore(STORES.queue, { keyPath: 'id', autoIncrement: true });
        st.createIndex('byStatus', 'status', { unique: false });
        st.createIndex('byCreatedAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });

  return _dbPromise;
}

function txp(db, storeName, mode, fn){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const st = tx.objectStore(storeName);
    let out;
    try{ out = fn(st, tx); }
    catch(e){ reject(e); return; }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error || new Error('IDB tx failed'));
    tx.onabort = () => reject(tx.error || new Error('IDB tx aborted'));
  });
}

// ===== KV =====
export async function kvGet(key){
  const db = await getDb();
  return txp(db, STORES.kv, 'readonly', (st)=> new Promise((resolve, reject)=>{
    const r = st.get(String(key));
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  }));
}

export async function kvSet(key, value){
  const db = await getDb();
  const rec = { key: String(key), value, updatedAt: Date.now() };
  return txp(db, STORES.kv, 'readwrite', (st)=> st.put(rec));
}

export async function kvDel(key){
  const db = await getDb();
  return txp(db, STORES.kv, 'readwrite', (st)=> st.delete(String(key)));
}

// ===== QUEUE =====
export async function queueAdd({ opId, action, params }){
  const db = await getDb();
  const rec = {
    opId: String(opId || ''),
    action: String(action || ''),
    params: params || {},
    createdAt: Date.now(),
    status: 'pending',
    attempts: 0,
    lastAttemptAt: 0,
    lastError: '',
    result: null,
    syncedAt: 0
  };
  return txp(db, STORES.queue, 'readwrite', (st)=> st.add(rec));
}

export async function queueList({ status } = {}){
  const db = await getDb();
  return txp(db, STORES.queue, 'readonly', (st)=> new Promise((resolve, reject)=>{
    const out = [];
    const src = status ? st.index('byStatus').openCursor(IDBKeyRange.only(status)) : st.openCursor();
    src.onsuccess = () => {
      const cur = src.result;
      if (!cur){
        out.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        resolve(out);
        return;
      }
      out.push(cur.value);
      cur.continue();
    };
    src.onerror = () => reject(src.error);
  }));
}

export async function queueGet(id){
  const db = await getDb();
  return txp(db, STORES.queue, 'readonly', (st)=> new Promise((resolve, reject)=>{
    const r = st.get(Number(id));
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  }));
}

export async function queueUpdate(id, patch){
  const db = await getDb();
  return txp(db, STORES.queue, 'readwrite', (st)=> new Promise((resolve, reject)=>{
    const r = st.get(Number(id));
    r.onsuccess = () => {
      const rec = r.result;
      if (!rec){ resolve(null); return; }
      const next = { ...rec, ...(patch||{}) };
      const wr = st.put(next);
      wr.onsuccess = () => resolve(next);
      wr.onerror = () => reject(wr.error);
    };
    r.onerror = () => reject(r.error);
  }));
}

export async function queueDelete(id){
  const db = await getDb();
  return txp(db, STORES.queue, 'readwrite', (st)=> st.delete(Number(id)));
}

export async function queueClearAll(){
  const db = await getDb();
  return txp(db, STORES.queue, 'readwrite', (st)=> st.clear());
}

export async function resetAllOfflineData(){
  const db = await getDb();
  await txp(db, STORES.kv, 'readwrite', (st)=> st.clear());
  await txp(db, STORES.queue, 'readwrite', (st)=> st.clear());
}
