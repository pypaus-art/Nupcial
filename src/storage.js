import { seed, validate } from "./domain.js";
const NAME = "nupcial-preview-v1";
let db;
const clone = (x) => structuredClone(x);
export function openDatabase() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("state");
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(
        new Error(
          "Cierra otras pestañas de Nupcial para actualizar el almacenamiento.",
        ),
      );
    r.onsuccess = () => {
      db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
export function load() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state");
    let state;
    const r = store.get("current");
    r.onsuccess = () => {
      try {
        state = r.result ? validate(r.result) : seed();
        if (!r.result) store.put(state, "current");
      } catch (e) {
        reject(e);
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(clone(state));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("No se pudo leer el almacenamiento."));
  });
}
export function commit(expectedRevision, transform, backup = false) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state");
    let next, reason;
    const r = store.get("current");
    r.onsuccess = () => {
      try {
        const current = validate(r.result);
        if (current.revision !== expectedRevision)
          throw new Error(
            "Los datos cambiaron en otra pestaña. Vuelve a abrir la ficha e intenta de nuevo.",
          );
        next = validate(transform(clone(current)));
        next.revision = current.revision + 1;
        next.updatedAt = new Date().toISOString();
        if (backup) store.put(current, "before-restore");
        store.put(next, "current");
      } catch (e) {
        reason = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(clone(next));
    tx.onabort = () =>
      reject(
        reason ||
          tx.error ||
          new Error(
            "No se pudo guardar. Tus datos anteriores siguen intactos.",
          ),
      );
    tx.onerror = () => {
      reason = reason || tx.error;
    };
  });
}
export function recovery() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state");
    const r = tx.objectStore("state").get("before-restore");
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
