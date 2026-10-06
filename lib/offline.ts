// Device-local outbox holds only unsent actions and temporary offline snapshots.
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('naryadai-device', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('drafts');
      r.result.createObjectStore('queue', { keyPath: 'requestId' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function putLocal(store: string, key: string, value: any) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    if (store === 'queue') tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function readLocal(store: string, key?: string) {
  const db = await open();
  return new Promise<any>((resolve, reject) => {
    const r = key
      ? db.transaction(store).objectStore(store).get(key)
      : db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => {
      db.close();
      resolve(r.result);
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}
export async function removeLocal(store: string, key: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
