const DB_NAME = 'xiaowu-web-jpeg-cache-v1';
const STORE = 'outputs';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (error: unknown) => void) => void): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      transaction.onerror = () => reject(transaction.error);
      action(transaction.objectStore(STORE), resolve, reject);
    });
  } finally {
    database.close();
  }
}

export function clearCache(): Promise<void> {
  return withStore('readwrite', (store, resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function putCached(id: string, blob: Blob): Promise<void> {
  const bytes = await blob.arrayBuffer();
  return withStore('readwrite', (store, resolve, reject) => {
    const request = store.put(bytes, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function getCached(id: string): Promise<Blob | undefined> {
  return withStore('readonly', (store, resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const value = request.result as ArrayBuffer | Blob | undefined;
      resolve(value instanceof ArrayBuffer ? new Blob([value], { type: 'image/jpeg' }) : value);
    };
    request.onerror = () => reject(request.error);
  });
}

export function deleteCached(id: string): Promise<void> {
  return withStore('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
