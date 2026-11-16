import type { SceneDocument } from './shared/types';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Preserve the established database so the Palmivo rename retains saved projects.
    const request = indexedDB.open('signtoast-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveProject(scene: SceneDocument): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(structuredClone(scene), 'current');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function loadProject(): Promise<SceneDocument | null> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('projects', 'readonly').objectStore('projects').get('current');
    request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
