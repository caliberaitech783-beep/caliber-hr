type ResultFile = {id: string; file: File};
const storeName = 'resultFiles';
let connection: Promise<IDBDatabase> | undefined;

function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('caliber-hr-trial-results', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, {keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    connection = undefined;
    throw error;
  });
}

async function writeFiles(write: (store: IDBObjectStore) => void) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    write(transaction.objectStore(storeName));
  });
}

export function saveTrialResultFiles(files: ResultFile[]) {
  return writeFiles(store => files.forEach(file => store.add(file)));
}

export function removeTrialResultFiles(ids: string[]) {
  return writeFiles(store => ids.forEach(id => store.delete(id)));
}

export async function getTrialResultFile(id: string) {
  const db = await database();
  return new Promise<File | undefined>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(id);
    request.onsuccess = () => resolve((request.result as ResultFile | undefined)?.file);
    request.onerror = () => reject(request.error);
  });
}
