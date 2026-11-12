import {
  WORLD,
  KINDS,
  tableDefaults,
  legacyTable,
  bounds,
  inside,
  overlaps,
  tableSpaceFree,
  findTableSpace,
  snapTable,
} from "./map-model.js";
export const SCHEMA = 2;
export const EVENT_START = "2026-11-21T14:30:00-06:00";
export const id = () => crypto.randomUUID();
export const normalize = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-MX");
const fail = (message) => {
  throw new Error(message);
};
const check = (ok, message) => {
  if (!ok) fail(message);
};
const text = (x, max = 2000) => typeof x === "string" && x.length <= max;
const nonempty = (x) => text(x, 160) && x.trim().length > 0;
const time = (x) =>
  typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
const nullableId = (value, collection) =>
  value === null || collection.some((x) => x.id === value);
const date = (x) =>
  x === "" ||
  (typeof x === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(x) &&
    Number.isFinite(Date.parse(x + "T12:00:00Z")) &&
    new Date(x + "T12:00:00Z").toISOString().slice(0, 10) === x);
export function seed() {
  const rows = [
    ["14:30", "14:45", "Recepción y barra de snacks"],
    ["14:30", "14:50", "First Look con damas"],
    ["14:50", "14:55", "Fotos con damas"],
    ["14:55", "15:00", "Preparación para entrada"],
    ["15:00", "15:10", "Entrada del cortejo, novio y novia"],
    ["15:10", "15:30", "Alabanzas"],
    ["15:30", "16:25", "Ceremonia cristiana"],
    ["16:25", null, "Alabanza final y oración"],
    ["16:35", "16:45", "Presentación y salida de novios"],
    ["16:45", "17:00", "Fotografías familiares"],
    ["17:00", "17:10", "Inicio de comida"],
    ["17:10", "17:55", "Sesión de novios"],
    ["17:55", "18:15", "Convivencia"],
    ["18:15", "18:25", "Agradecimiento, oración/brindis"],
    ["18:25", "18:35", "Vals"],
    ["18:35", "18:50", "Corte de pastel"],
    ["18:50", "20:00", "Cabina y estaciones: libro, Biblia, árbol de huellas"],
    ["19:30", "20:00", "Segunda barra de snacks y esquites"],
    ["20:00", "20:40", "Dinámicas"],
    ["20:40", "20:50", "Últimos minutos de cabina"],
    ["20:50", "21:15", "Estaciones y convivencia"],
    ["21:15", "21:30", "Cierre"],
    ["21:30", "22:00", "Despedida"],
  ];
  return {
    schemaVersion: SCHEMA,
    revision: 0,
    updatedAt: new Date().toISOString(),
    event: {
      id: "event-nupcial",
      name: "Nupcial",
      venue: "Jardín Amate",
      region: "Puebla–Atlixco, México",
      date: "2026-11-21",
      time: "14:30",
      timezone: "America/Mexico_City",
    },
    garden: { version: 1, custom: false, elements: [] },
    people: [],
    guests: [],
    vendors: [],
    payments: [],
    tasks: [],
    assignments: [],
    tables: [],
    agenda: rows.map(([start, end, title], i) => ({
      id: `agenda-${i + 1}`,
      title,
      start,
      end,
      endNote: i === 7 ? "16:35 / 16:40 · por confirmar" : "",
      description: "",
      personId: null,
      location: "",
      status: "pending",
      notes: "",
    })),
    contingencies: [
      "Lluvia",
      "Falla eléctrica",
      "Retraso de comida",
      "Accesibilidad",
    ].map((name, i) => ({
      id: `plan-${i}`,
      name,
      situation: "",
      status: "undefined",
      trigger: "",
      response: "",
      personId: null,
    })),
  };
}
export function validate(s) {
  check(
    s && typeof s === "object" && [1, SCHEMA].includes(s.schemaVersion),
    "Versión de respaldo no compatible. No se modificaron tus datos.",
  );
  check(
    Number.isSafeInteger(s.revision) &&
      s.revision >= 0 &&
      text(s.updatedAt, 40) &&
      Number.isFinite(Date.parse(s.updatedAt)),
    "Metadatos inválidos.",
  );
  const keys = [
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
  const ids = new Set();
  for (const key of keys) {
    check(
      Array.isArray(s[key]) && s[key].length <= 10000,
      `La colección ${key} no es válida.`,
    );
    for (const x of s[key]) {
      check(
        x && nonempty(x.id) && !ids.has(x.id),
        "Hay IDs vacíos o duplicados.",
      );
      ids.add(x.id);
    }
  }
  check(
    s.event &&
      nonempty(s.event.id) &&
      !ids.has(s.event.id) &&
      nonempty(s.event.name) &&
      text(s.event.venue, 160) &&
      text(s.event.region, 160) &&
      date(s.event.date) &&
      s.event.date !== "" &&
      time(s.event.time) &&
      s.event.timezone === "America/Mexico_City",
    "Datos de evento inválidos.",
  );
  ids.add(s.event.id);
  for (const p of s.people)
    check(
      nonempty(p.name) && text(p.role, 160) && text(p.phone, 80),
      "Contacto inválido.",
    );
  for (const g of s.guests)
    check(
      nonempty(g.name) &&
        ["adult", "child"].includes(g.type) &&
        ["confirmed", "pending", "declined"].includes(g.attendance) &&
        text(g.notes),
      "Invitado inválido.",
    );
  for (const t of s.tables) {
    check(
      nonempty(t.name) &&
        Number.isInteger(t.capacity) &&
        t.capacity >= 1 &&
        t.capacity <= 10 &&
        Number.isInteger(t.x) &&
        Number.isInteger(t.y),
      "Mesa inválida: máximo diez lugares y posición dentro del jardín.",
    );
    if (s.schemaVersion === 1)
      check(
        t.x >= 0 && t.x <= 8 && t.y >= 0 && t.y <= 7,
        "Mesa inválida: posición fuera del jardín.",
      );
    else
      check(
        Number.isInteger(t.width) &&
          t.width >= 44 &&
          t.width <= 140 &&
          Number.isInteger(t.height) &&
          t.height >= 24 &&
          t.height <= 80 &&
          [0, 90, 180, 270].includes(t.rotation) &&
          inside(t),
        "Mesa inválida: revisa tamaño, giro y límites del jardín.",
      );
  }
  if (s.schemaVersion === 1) {
    for (let i = 0; i < s.tables.length; i++)
      for (let j = i + 1; j < s.tables.length; j++)
        check(
          s.tables[i].y !== s.tables[j].y ||
            Math.abs(s.tables[i].x - s.tables[j].x) >= 3,
          "Las mesas no pueden superponerse. Elige otro espacio.",
        );
  } else {
    check(
      s.garden &&
        s.garden.version === 1 &&
        typeof s.garden.custom === "boolean" &&
        Array.isArray(s.garden.elements) &&
        s.garden.elements.length <= 10000,
      "El mapa de jardín no es válido.",
    );
    for (const e of s.garden.elements) {
      check(
        e && nonempty(e.id) && !ids.has(e.id),
        "Hay IDs de jardín vacíos o duplicados.",
      );
      ids.add(e.id);
      check(
        Object.hasOwn(KINDS, e.kind) &&
          Number.isInteger(e.x) &&
          Number.isInteger(e.y) &&
          Number.isInteger(e.width) &&
          e.width >= 12 &&
          e.width <= 240 &&
          Number.isInteger(e.height) &&
          e.height >= 12 &&
          e.height <= 240 &&
          [0, 90, 180, 270].includes(e.rotation) &&
          text(e.label, 60) &&
          inside(e),
        "Elemento de jardín inválido: revisa sus límites, tamaño y tipo.",
      );
    }
    for (const t of s.tables)
      check(
        tableSpaceFree(t, s.tables, s.garden),
        "No hay espacio: las mesas no pueden superponerse entre sí.",
      );
  }
  const assigned = new Set();
  for (const a of s.assignments) {
    check(
      nullableId(a.guestId, s.guests) &&
        a.guestId !== null &&
        nullableId(a.tableId, s.tables) &&
        a.tableId !== null &&
        !assigned.has(a.guestId),
      "Asignación duplicada o con referencias inexistentes.",
    );
    assigned.add(a.guestId);
  }
  for (const t of s.tables)
    check(
      s.assignments.filter((a) => a.tableId === t.id).length <= t.capacity,
      "No hay lugares disponibles o la capacidad es menor que los ocupantes.",
    );
  for (const a of s.agenda)
    check(
      nonempty(a.title) &&
        time(a.start) &&
        (a.end === null || (time(a.end) && a.end >= a.start)) &&
        text(a.endNote, 160) &&
        text(a.description) &&
        text(a.location, 160) &&
        text(a.notes) &&
        nullableId(a.personId, s.people) &&
        ["pending", "active", "done"].includes(a.status),
      "Actividad inválida: revisa horas y responsable.",
    );
  for (const t of s.tasks)
    check(
      nonempty(t.title) &&
        text(t.description) &&
        nullableId(t.personId, s.people) &&
        ["normal", "urgent"].includes(t.priority) &&
        ["pending", "doing", "done"].includes(t.status) &&
        date(t.due),
      "Tarea inválida.",
    );
  for (const v of s.vendors)
    check(
      nonempty(v.name) &&
        text(v.service, 160) &&
        text(v.contact, 160) &&
        text(v.phone, 80) &&
        (v.arrival === "" || time(v.arrival)) &&
        Number.isSafeInteger(v.total) &&
        v.total >= 0 &&
        v.total <= 1e11 &&
        typeof v.refundable === "boolean" &&
        text(v.notes),
      "Proveedor inválido.",
    );
  for (const p of s.payments)
    check(
      nullableId(p.vendorId, s.vendors) &&
        p.vendorId !== null &&
        Number.isSafeInteger(p.amount) &&
        p.amount > 0 &&
        nonempty(p.concept) &&
        date(p.date) &&
        p.date !== "",
      "Abono inválido.",
    );
  for (const v of s.vendors)
    check(
      s.payments
        .filter((p) => p.vendorId === v.id)
        .reduce((n, p) => n + p.amount, 0) <= v.total,
      "Los abonos exceden el total acordado.",
    );
  for (const p of s.contingencies)
    check(
      nonempty(p.name) &&
        text(p.situation) &&
        text(p.trigger) &&
        text(p.response) &&
        ["undefined", "review", "confirmed"].includes(p.status) &&
        nullableId(p.personId, s.people),
      "Plan de contingencia inválido.",
    );
  return s;
}
export function migrate(value) {
  validate(value);
  if (value.schemaVersion === SCHEMA) return value;
  const next = structuredClone(value);
  next.schemaVersion = SCHEMA;
  next.tables = next.tables.map(legacyTable);
  next.garden = { version: 1, custom: false, elements: [] };
  return validate(next);
}
export function amountCents(value) {
  check(
    typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim()),
    "Usa un importe positivo con máximo dos decimales.",
  );
  const [a, b = ""] = value.trim().split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  check(Number.isSafeInteger(n) && n <= 1e11, "Importe fuera de rango.");
  return n;
}
export function parseBackup(raw) {
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    fail("El archivo no contiene JSON válido.");
  }
  return migrate(s);
}
export function importNames(s, raw, allowHomonyms = false) {
  check(text(raw, 200000), "La lista es demasiado larga.");
  const names = raw
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  check(
    names.length > 0 && names.length <= 1000,
    "Agrega entre uno y mil nombres.",
  );
  const seen = new Set(s.guests.map((g) => normalize(g.name))),
    added = [],
    duplicates = [];
  for (const name of names) {
    check(nonempty(name), "Cada nombre debe tener entre 1 y 160 caracteres.");
    const key = normalize(name);
    if (seen.has(key) && !allowHomonyms) duplicates.push(name);
    else {
      seen.add(key);
      added.push({
        id: id(),
        name,
        type: "adult",
        attendance: "confirmed",
        notes: "",
      });
    }
  }
  return { added, duplicates };
}
export function mutate(s, action) {
  const n = structuredClone(migrate(s));
  const { type } = action;
  if (type === "save") {
    check(
      [
        "people",
        "guests",
        "vendors",
        "tasks",
        "tables",
        "agenda",
        "contingencies",
        "payments",
      ].includes(action.collection),
      "Colección desconocida.",
    );
    if (action.collection === "tables")
      action = { ...action, value: tableDefaults(action.value) };
    const list = n[action.collection],
      i = list.findIndex((x) => x.id === action.value.id);
    if (i < 0) list.push(action.value);
    else list[i] = action.value;
  } else if (type === "guests") n.guests.push(...action.guests);
  else if (type === "assign") {
    n.assignments = n.assignments.filter((a) => a.guestId !== action.guestId);
    if (action.tableId)
      n.assignments.push({
        id: id(),
        guestId: action.guestId,
        tableId: action.tableId,
      });
  } else if (type === "delete") {
    check(
      [
        "guests",
        "tables",
        "people",
        "vendors",
        "payments",
        "tasks",
        "agenda",
        "contingencies",
      ].includes(action.collection),
      "No se puede eliminar esa colección.",
    );
    n[action.collection] = n[action.collection].filter(
      (x) => x.id !== action.id,
    );
    if (action.collection === "guests")
      n.assignments = n.assignments.filter((a) => a.guestId !== action.id);
    if (action.collection === "tables")
      n.assignments = n.assignments.filter((a) => a.tableId !== action.id);
    if (action.collection === "vendors")
      n.payments = n.payments.filter((p) => p.vendorId !== action.id);
    if (action.collection === "people")
      for (const list of [n.agenda, n.tasks, n.contingencies])
        for (const x of list) if (x.personId === action.id) x.personId = null;
  } else if (type === "guestUpdate") {
    const i = n.guests.findIndex((g) => g.id === action.value.id);
    check(i >= 0, "El invitado ya no existe.");
    n.guests[i] = action.value;
    n.assignments = n.assignments.filter((a) => a.guestId !== action.value.id);
    if (action.tableId)
      n.assignments.push({
        id: id(),
        guestId: action.value.id,
        tableId: action.tableId,
      });
  } else if (type === "move") {
    const t = n.tables.find((t) => t.id === action.id);
    check(t, "La mesa ya no existe.");
    t.x = action.x;
    t.y = action.y;
  } else if (type === "createTables") {
    check(n.tables.length === 0, "Ya hay mesas registradas.");
    n.tables = [];
    for (let i = 0; i < 14; i++) {
      const t = legacyTable({
        id: id(),
        name: `Mesa ${i + 1}`,
        capacity: 10,
        x: i % 2 ? 5 : 2,
        y: Math.floor(i / 2),
      });
      Object.assign(t, snapTable(t, t.x, t.y));
      if (!tableSpaceFree(t, n.tables, n.garden)) {
        const spot = findTableSpace(n.tables, n.garden);
        check(
          spot,
          "No hay espacio para las 14 mesas. Agrega mesas individuales o reorganiza el jardín.",
        );
        t.x = spot.x;
        t.y = spot.y;
      }
      n.tables.push(t);
    }
  } else if (type === "createTable") {
    const spot = findTableSpace(n.tables, n.garden);
    check(
      spot,
      "No hay espacio disponible. Reduce una mesa o reorganiza el mapa.",
    );
    let num = 1;
    while (n.tables.some((t) => normalize(t.name) === `mesa ${num}`)) num++;
    n.tables.push({ ...spot, id: id(), name: `Mesa ${num}`, capacity: 10 });
  } else if (type === "garden") {
    n.garden = structuredClone(action.value);
  } else if (type === "event") n.event = { ...n.event, ...action.value };
  else fail("Operación desconocida.");
  n.revision = s.revision + 1;
  n.updatedAt = new Date().toISOString();
  return validate(n);
}
export const paid = (s, vendorId) =>
  s.payments
    .filter((p) => p.vendorId === vendorId)
    .reduce((sum, p) => sum + p.amount, 0);
export const remaining = (s, v) => v.total - paid(s, v.id);
export function countdown(event, now = Date.now()) {
  const target = Date.parse(`${event.date}T${event.time}:00-06:00`),
    diff = Math.max(0, Math.floor((target - now) / 1000));
  return {
    days: Math.floor(diff / 86400),
    hours: Math.floor(diff / 3600) % 24,
    minutes: Math.floor(diff / 60) % 60,
    seconds: diff % 60,
    started: now >= target,
  };
}
