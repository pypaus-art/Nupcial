import { validate } from "./domain.js";

export const COLLECTIONS = [
  "people",
  "guests",
  "vendors",
  "payments",
  "tasks",
  "assignments",
  "tables",
  "agenda",
  "contingencies",
];
const SINGLE = ["event", "garden"];
export function equal(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}
export class SyncError extends Error {
  constructor(message, status = 400, conflicts = []) {
    super(message);
    this.status = status;
    this.conflicts = conflicts;
  }
}
export function diffState(before, after) {
  const changes = [];
  for (const collection of SINGLE) {
    if (!equal(before[collection], after[collection]))
      changes.push({
        collection,
        id: null,
        before: before[collection],
        after: after[collection],
      });
  }
  for (const collection of COLLECTIONS) {
    const old = new Map(before[collection].map((row) => [row.id, row]));
    const next = new Map(after[collection].map((row) => [row.id, row]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(id) || null,
        b = next.get(id) || null;
      if (!equal(a, b)) changes.push({ collection, id, before: a, after: b });
    }
  }
  return changes;
}
export function authorizeChanges(changes, member, current) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 10000)
    throw new SyncError("Los cambios no son válidos.");
  if (["owner", "coordinator"].includes(member.role)) return;
  for (const change of changes) {
    if (!["tasks", "agenda"].includes(change.collection) || !change.after)
      throw new SyncError(
        "Puedes agregar y editar tareas o actividades. El resto de la información es de consulta y no puedes eliminar registros.",
        403,
      );
  }
}
function mergeRecord(before, after, current) {
  if (equal(current, after)) return current;
  if (before === null) {
    if (current !== null) throw new Error();
    return after;
  }
  if (after === null) {
    if (!equal(current, before)) throw new Error();
    return null;
  }
  if (current === null) throw new Error();
  const result = structuredClone(current);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new SyncError("Campo no permitido.");
    if (equal(before[key], after[key])) continue;
    if (!equal(current[key], before[key]) && !equal(current[key], after[key]))
      throw new Error();
    if (Object.hasOwn(after, key)) result[key] = structuredClone(after[key]);
    else delete result[key];
  }
  return result;
}
export function applyChanges(state, changes) {
  const next = structuredClone(state),
    conflicts = [],
    seen = new Set();
  for (const c of changes) {
    if (
      !c ||
      ![...COLLECTIONS, ...SINGLE].includes(c.collection) ||
      !Object.hasOwn(c, "before") ||
      !Object.hasOwn(c, "after") ||
      ![c.before, c.after].every(
        (v) => v === null || (typeof v === "object" && !Array.isArray(v)),
      )
    )
      throw new SyncError("Cambio no reconocido.");
    const single = SINGLE.includes(c.collection),
      key = `${c.collection}:${c.id}`;
    if (
      seen.has(key) ||
      (single
        ? c.id !== null || !c.before || !c.after
        : typeof c.id !== "string" ||
          !c.id ||
          [c.before, c.after].some((v) => v && v.id !== c.id))
    )
      throw new SyncError("Cambio no válido.");
    seen.add(key);
    const index = single
      ? -1
      : next[c.collection].findIndex((row) => row.id === c.id);
    const current = single
      ? next[c.collection]
      : next[c.collection][index] || null;
    try {
      const result = mergeRecord(c.before, c.after, current);
      if (single) next[c.collection] = result;
      else if (result === null) {
        if (index >= 0) next[c.collection].splice(index, 1);
      } else if (index < 0) next[c.collection].push(result);
      else next[c.collection][index] = result;
    } catch {
      conflicts.push({
        collection: c.collection,
        id: c.id,
        title:
          c.after?.title ||
          c.before?.title ||
          c.after?.name ||
          c.before?.name ||
          c.collection,
      });
    }
  }
  if (conflicts.length)
    throw new SyncError(
      "Este dato también cambió en otro teléfono. Tu edición está guardada y necesita revisión.",
      409,
      conflicts,
    );
  try {
    return validate(next);
  } catch (e) {
    throw new SyncError(e.message, 422);
  }
}
export function projectState(state, member) {
  const result = structuredClone(state);
  if (["owner", "coordinator"].includes(member.role)) return result;
  result.vendors = result.vendors.map(
    ({ id, name, service, contact, phone, arrival }) => ({
      id,
      name,
      service,
      contact,
      phone,
      arrival,
      total: 0,
      refundable: false,
      notes: "",
    }),
  );
  result.payments = [];
  return validate(result);
}
