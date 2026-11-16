import { seed, validate, migrate } from "./domain.js";
import {
  diffState,
  applyChanges,
  authorizeChanges,
  equal,
} from "./sync-model.js";
const NAME = "nupcial-preview-v1";
let db;
let cloudContext = null;
const currentKey = () =>
  cloudContext
    ? `cloud:${cloudContext.eventId}:${cloudContext.userId}`
    : "current";
const metaKey = () => `sync:${cloudContext.eventId}:${cloudContext.userId}`;
export const getCloudContext = () => cloudContext && { ...cloudContext };
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
    const key = currentKey(),
      r = store.get(key);
    r.onsuccess = () => {
      try {
        if (!r.result && cloudContext)
          throw new Error(
            "Conéctate para abrir tu evento compartido por primera vez.",
          );
        state = r.result ? migrate(r.result) : seed();
        if (r.result && r.result.schemaVersion !== state.schemaVersion) {
          store.put(r.result, "before-migration-v2");
          store.put(state, key);
        }
        if (!r.result) store.put(state, key);
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
    const key = currentKey(),
      context = cloudContext && { ...cloudContext },
      metadataKey = context && metaKey();
    const r = store.get(key);
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
        if (backup)
          store.put(
            current,
            context ? `${key}:before-restore` : "before-restore",
          );
        if (context) {
          const changes = diffState(current, next);
          const metadata = store.get(metadataKey);
          metadata.onsuccess = () => {
            try {
              const meta = metadata.result;
              if (!meta)
                throw new Error("No se encontró la sesión del evento.");
              if (meta.blocked)
                throw new Error(
                  "Tu acceso necesita revisión. Tus cambios pendientes se conservan en Equipo.",
                );
              if (changes.length) {
                authorizeChanges(changes, meta.member, current);
                meta.queue.push({ mutationId: crypto.randomUUID(), changes });
                store.put(meta, metadataKey);
              }
              store.put(next, key);
            } catch (e) {
              reason = e;
              tx.abort();
            }
          };
        } else store.put(next, key);
      } catch (e) {
        reason = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      resolve(clone(next));
      if (context) window.dispatchEvent(new Event("nupcial:local-change"));
    };
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
export function recovery(key = "before-restore") {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state");
    const r = tx
      .objectStore("state")
      .get(cloudContext ? `${currentKey()}:${key}` : key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

function records(mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", mode),
      store = tx.objectStore("state");
    let result, reason;
    const finish = (value) => {
      result = value;
    };
    const fail = (error) => {
      reason = error;
      tx.abort();
    };
    try {
      callback(store, finish, fail);
    } catch (e) {
      fail(e);
    }
    tx.oncomplete = () => resolve(clone(result));
    tx.onabort = () =>
      reject(
        reason ||
          tx.error ||
          new Error("No se pudo guardar la sincronización."),
      );
    tx.onerror = () => {};
  });
}
export async function selectCloud(context) {
  const key = `cloud:${context.eventId}:${context.userId}`;
  const cached = await records("readonly", (store, done) => {
    const q = store.get(key);
    q.onsuccess = () => done(!!q.result);
  });
  if (cached) cloudContext = { ...context };
  return cached;
}
export function selectLocal() {
  cloudContext = null;
}
export function readSync() {
  if (!cloudContext) return Promise.resolve(null);
  const key = metaKey();
  return records("readonly", (store, done) => {
    const q = store.get(key);
    q.onsuccess = () => done(q.result);
  });
}
export async function openCloud(snapshot, userId) {
  const previous = cloudContext;
  cloudContext = { eventId: snapshot.eventId, userId };
  try {
    await acceptCloud(snapshot);
  } catch (e) {
    cloudContext = previous;
    throw e;
  }
}
export function acceptCloud(snapshot, acknowledged = null) {
  const key = currentKey(),
    metadataKey = metaKey();
  validate(snapshot.state);
  return records("readwrite", (store, done, fail) => {
    const q = store.get(metadataKey);
    q.onsuccess = () => {
      const old = q.result || { queue: [] };
      if (old.revision > snapshot.revision)
        snapshot = {
          ...snapshot,
          revision: old.revision,
          state: old.remote,
          member: old.member,
          attributions: old.attributions,
        };
      const meta = {
        ...old,
        member: snapshot.member,
        revision: snapshot.revision,
        remote: snapshot.state,
        attributions: snapshot.attributions || [],
        blocked: false,
      };
      meta.queue = old.queue.filter(
        (entry) => entry.mutationId !== acknowledged,
      );
      let next = clone(snapshot.state);
      try {
        for (const entry of meta.queue) {
          authorizeChanges(entry.changes, meta.member, next);
          next = applyChanges(next, entry.changes);
        }
        meta.conflicts = [];
      } catch (e) {
        meta.conflicts = e.conflicts?.length
          ? e.conflicts
          : [{ title: e.message }];
        store.put(meta, metadataKey);
        done({ conflict: true });
        return;
      }
      const cached = store.get(key);
      cached.onsuccess = () => {
        try {
          const changed =
            !cached.result ||
            diffState(cached.result, next).length > 0 ||
            !equal(old.attributions || [], meta.attributions);
          next.revision = changed
            ? Math.max(cached.result?.revision || 0, snapshot.revision) + 1
            : cached.result.revision;
          store.put(next, key);
          store.put(meta, metadataKey);
          done({ changed });
        } catch (e) {
          fail(e);
        }
      };
    };
  });
}
export function markSyncBlocked(blocked) {
  const key = metaKey();
  return records("readwrite", (store, done) => {
    const q = store.get(key);
    q.onsuccess = () => {
      const m = q.result;
      m.blocked = blocked;
      store.put(m, key);
      done();
    };
  });
}
export function resolveSync(keepMine) {
  const key = currentKey(),
    metadataKey = metaKey();
  return records("readwrite", (store, done, fail) => {
    const q = store.get(metadataKey);
    q.onsuccess = () => {
      try {
        const meta = q.result;
        let next = clone(meta.remote),
          changes = [];
        if (keepMine) {
          for (const batch of meta.queue) {
            const rebased = batch.changes.map((c) => {
              const current =
                c.id === null
                  ? next[c.collection]
                  : next[c.collection].find((row) => row.id === c.id) || null;
              if (!current && c.before)
                throw new Error(
                  "El registro se eliminó. Usa los cambios compartidos; tu copia sigue en el respaldo de pendientes.",
                );
              let after = c.after === null ? null : clone(current || c.after);
              if (current && after)
                for (const field of new Set([
                  ...Object.keys(c.before || {}),
                  ...Object.keys(c.after),
                ])) {
                  if (
                    JSON.stringify(c.before?.[field]) !==
                    JSON.stringify(c.after[field])
                  ) {
                    if (Object.hasOwn(c.after, field))
                      after[field] = clone(c.after[field]);
                    else delete after[field];
                  }
                }
              return { ...c, before: current, after };
            });
            authorizeChanges(rebased, meta.member, next);
            next = applyChanges(next, rebased);
          }
          changes = diffState(meta.remote, next);
        }
        store.put(meta.queue, `${key}:pending-backup`);
        meta.queue = changes.length
          ? [{ mutationId: crypto.randomUUID(), changes }]
          : [];
        meta.conflicts = [];
        const cached = store.get(key);
        cached.onsuccess = () => {
          next.revision = (cached.result?.revision || 0) + 1;
          store.put(next, key);
          store.put(meta, metadataKey);
          done();
        };
      } catch (e) {
        fail(e);
      }
    };
  });
}
