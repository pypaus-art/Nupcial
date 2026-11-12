import {
  id,
  normalize,
  mutate,
  validate,
  parseBackup,
  importNames,
  paid,
  remaining,
  amountCents,
  countdown,
} from "./domain.js";
import { openDatabase, load, commit, recovery } from "./storage.js";
import { icon } from "./icons.js";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n / 100);
let state,
  route = "home",
  editing = false,
  filter = "all",
  query = "",
  selectedGuest = null,
  dialogRevision = 0,
  installPrompt;
const dialog = $("#dialog"),
  main = $("#main");
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("nupcial-preview")
    : null;
const labels = {
  pending: "Pendiente",
  active: "En curso",
  done: "Listo",
  doing: "En curso",
  normal: "Normal",
  urgent: "Urgente",
  confirmed: "Confirmado",
  declined: "No asiste",
  adult: "Adulto",
  child: "Niño",
  undefined: "Sin definir",
  review: "En revisión",
};
const personName = (pid) =>
  state.people.find((p) => p.id === pid)?.name || "Sin responsable";
const personMeta = (pid) => {
  const p = state.people.find((p) => p.id === pid);
  return p ? [p.name, p.phone].filter(Boolean).join(" · ") : "Sin responsable";
};
const tableFor = (gid) =>
  state.tables.find((t) =>
    state.assignments.some((a) => a.guestId === gid && a.tableId === t.id),
  );
const initials = (name) => {
  const parts = name.trim().split(/\s+/);
  return (
    [...(parts[0] || "")][0] + (parts.length > 1 ? [...parts.at(-1)][0] : "")
  );
};
const byStart = (a, b) => a.start.localeCompare(b.start);
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function error(message) {
  const el = $("#form-error");
  if (dialog.open && el) {
    el.textContent = message;
    el.scrollIntoView({ block: "nearest" });
  } else toast(message);
}
async function change(
  action,
  { close = true, expected = state.revision } = {},
) {
  try {
    state = await commit(expected, (s) => mutate(s, action));
    channel?.postMessage("changed");
    if (close && dialog.open) dialog.close();
    render();
    if (close) toast("Cambios guardados en este dispositivo");
    return true;
  } catch (e) {
    error(e.message);
    if (e.message.includes("otra pestaña")) {
      state = await load();
      render();
    }
    return false;
  }
}
function button(action, label, ico = "plus", cls = "icon-button", attrs = "") {
  return `<button type="button" class="${cls}" data-action="${action}" aria-label="${esc(label)}" ${attrs}>${icon(ico)}${cls === "primary" ? esc(label) : ""}</button>`;
}
function heading(title, subtitle = "", actions = "") {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="page-actions">${actions}</div></div>`;
}
function empty(title, description, action, label, ico = "plus") {
  return `<div class="empty">${icon(ico)}<h3>${esc(title)}</h3><p>${esc(description)}</p>${action ? `<button class="primary" data-action="${action}">${icon("plus")}${esc(label)}</button>` : ""}</div>`;
}
function search(placeholder) {
  return `<label class="search">${icon("search")}<input id="page-search" type="search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" value="${esc(query)}" autocomplete="off"></label>`;
}
function filters(items) {
  return `<div class="filters" aria-label="Filtrar">${items.map(([value, label]) => `<button class="filter" data-filter="${value}" aria-pressed="${filter === value}">${esc(label)}</button>`).join("")}</div>`;
}
function notes(text) {
  return `<div class="note">${icon("info")}<p>${text}</p></div>`;
}
function nav() {
  const items = [
    ["home", "Inicio", "home"],
    ["agenda", "Agenda", "calendar"],
    ["map", "Mapa del jardín", "map"],
    ["tasks", "Tareas", "tasks"],
    ["more", "Más", "more"],
  ];
  $("#nav").innerHTML = items
    .map(
      ([key, label, ico]) =>
        `<a href="#${key}" ${key === "map" ? 'class="map-nav"' : 'class="nav-item"'} aria-label="${label}" ${route === key || (key === "more" && ["guests", "vendors", "people", "event", "plans", "backup"].includes(route)) ? 'aria-current="page"' : ""}>${icon(ico)}${key !== "map" ? `<span>${label}</span>` : ""}</a>`,
    )
    .join("");
}
function routeTo() {
  const next = location.hash.slice(1) || "home";
  route = [
    "home",
    "agenda",
    "map",
    "tasks",
    "more",
    "guests",
    "vendors",
    "people",
    "event",
    "plans",
    "backup",
  ].includes(next)
    ? next
    : "home";
  editing = false;
  query = "";
  filter = "all";
  if (dialog.open) dialog.close();
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (!state) return;
  nav();
  main.className = route === "map" ? "map-page" : "";
  main.innerHTML = {
    home: homePage,
    agenda: agendaPage,
    tasks: tasksPage,
    map: mapPage,
    more: morePage,
    guests: guestsPage,
    vendors: vendorsPage,
    people: peoplePage,
    event: eventPage,
    plans: plansPage,
    backup: backupPage,
  }[route]();
  tick();
}
function homePage() {
  const upcoming =
    [...state.agenda].sort(byStart).find((a) => a.status === "active") ||
    [...state.agenda].sort(byStart).find((a) => a.status !== "done");
  const tasks = state.tasks.filter((t) => t.status !== "done"),
    urgent = tasks.filter((t) => t.priority === "urgent");
  const guestCount = state.guests.filter(
    (g) => g.attendance === "confirmed",
  ).length;
  const vendors = state.vendors.filter((v) => !v.refundable),
    total = vendors.reduce((n, v) => n + v.total, 0),
    totalPaid = vendors.reduce((n, v) => n + paid(state, v.id), 0);
  return `<div class="greeting"><h1>Todo en su lugar.</h1><p>Tu boda, un paso a la vez.</p></div><div class="event-date"><span>${icon("calendar")}${esc(new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(new Date(state.event.date + "T12:00:00-06:00")))} · ${state.event.time}</span><span>${icon("pin")}${esc(state.event.venue)}</span></div><section class="countdown" aria-label="Cuenta regresiva"><div class="countdown-top"><span id="countdown-caption">Nos vemos en el jardín</span>${icon("leaf")}</div><div id="countdown" class="countdown-values"></div></section><div class="bento"><button class="card card-wide" data-go="agenda"><div class="card-top"><span class="card-label">${upcoming?.status === "active" ? "En curso" : "Próxima actividad"}</span>${icon("arrow", "chevron")}</div>${upcoming ? `<div class="next-row"><div class="time-block">${upcoming.start}<small>${upcoming.end ? "hasta " + upcoming.end : "fin por confirmar"}</small></div><div><h3>${esc(upcoming.title)}</h3><p class="row-meta">${esc(personName(upcoming.personId))}</p></div></div>` : "<h3>Itinerario completado</h3>"}<div class="mini-rule"></div><p class="small muted">${state.agenda.length} actividades · ${state.agenda.filter((a) => a.status === "done").length} listas</p></button><button class="card" data-go="tasks"><div class="card-top">${icon("tasks")}<span class="pill">${urgent.length} ${urgent.length === 1 ? "urgente" : "urgentes"}</span></div><div class="card-number">${tasks.length}</div><p class="card-title">Pendientes</p><div class="card-foot"><span>Ver tareas</span>${icon("arrow")}</div></button><button class="card tinted" data-go="guests"><div class="card-top">${icon("users")}<span class="small muted">${state.guests.length} en lista</span></div><div class="card-number">${guestCount}</div><p class="card-title">Confirmados</p><div class="card-foot"><span>${state.assignments.length} con mesa</span>${icon("arrow")}</div></button><button class="card card-wide" data-go="vendors"><div class="card-top"><span class="card-label">Proveedores y pagos</span>${icon("wallet")}</div><div class="card-number currency">${money(total - totalPaid)}</div><div class="card-foot"><span>Por pagar · MXN</span><span>${total ? Math.round((totalPaid / total) * 100) : 0}% pagado</span></div><div class="progress" role="progressbar" aria-label="Pagos realizados" aria-valuenow="${total ? Math.round((totalPaid / total) * 100) : 0}" aria-valuemin="0" aria-valuemax="100"><span style="width:${total ? (totalPaid / total) * 100 : 0}%"></span></div>${!total ? '<p class="row-meta">Registra los acuerdos y abonos confirmados.</p>' : ""}</button></div><div class="section-head"><h2>En el jardín</h2><button data-go="map">Abrir mapa ${icon("arrow")}</button></div><button class="menu-row" data-go="map">${icon("table")}<div class="row-content">Un lugar para cada invitado<small>${state.tables.length} mesas · ${Math.max(0, guestCount - state.assignments.filter((a) => state.guests.find((g) => g.id === a.guestId)?.attendance === "confirmed").length)} confirmados sin mesa</small></div>${icon("chevron", "chevron")}</button>${operationalAlerts()}`;
}
function operationalAlerts() {
  const unconfirmed = state.contingencies.filter(
    (p) => p.status !== "confirmed",
  ).length;
  return `<div class="section-head"><h2>Avisos operativos</h2></div><button class="menu-row" data-go="plans">${icon("shield")}<div class="row-content">${unconfirmed} planes por confirmar<small>Lluvia, energía, comida y accesibilidad.</small></div>${icon("chevron", "chevron")}</button>${notes("Se conserva el fin de la alabanza como 16:35 / 16:40, por confirmar. Los pagos históricos no se han cargado como vigentes.")}`;
}
function tick() {
  if (!state || !$("#countdown")) return;
  const c = countdown(state.event);
  $("#countdown-caption").textContent = c.started
    ? "La fecha del evento ha llegado"
    : "Nos vemos en el jardín";
  $("#countdown").innerHTML = [
    ["days", "días"],
    ["hours", "horas"],
    ["minutes", "minutos"],
    ["seconds", "segundos"],
  ]
    .map(
      ([key, label]) =>
        `<div class="countdown-unit"><strong>${String(c[key]).padStart(2, "0")}</strong><span>${label}</span></div>`,
    )
    .join("");
}
function agendaPage() {
  const entries = [...state.agenda]
    .sort(byStart)
    .filter((a) => filter === "all" || a.status === filter);
  return (
    heading(
      "Agenda",
      `${new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "America/Mexico_City" }).format(new Date(state.event.date + "T12:00:00-06:00"))} · Horario de Puebla`,
      button("agenda-export", "Exportar itinerario", "download") +
        button("new-agenda", "Agregar actividad"),
    ) +
    filters([
      ["all", "Todo"],
      ["pending", "Pendiente"],
      ["active", "En curso"],
      ["done", "Listo"],
    ]) +
    `<div class="list">${entries.map((a) => `<button class="list-row agenda-row" data-open="agenda" data-id="${esc(a.id)}"><div class="agenda-time">${a.start}<small>${a.end || "por definir"}</small></div><div class="row-content"><div class="row-title">${esc(a.title)}</div><div class="row-meta">${esc(personName(a.personId))}${a.location ? " · " + esc(a.location) : ""}</div>${a.endNote ? `<p class="row-meta">${esc(a.endNote)}</p>` : ""}${a.status !== "pending" ? `<span class="pill">${labels[a.status]}</span>` : ""}</div>${icon("chevron", "chevron")}</button>`).join("") || empty("Sin actividades", "No hay actividades con este estado.", "new-agenda", "Agregar actividad", "calendar")}</div>`
  );
}
function tasksPage() {
  const tasks = state.tasks.filter(
    (t) =>
      filter === "all" ||
      (filter === "urgent"
        ? t.priority === "urgent" && t.status !== "done"
        : t.status === filter),
  );
  const done = state.tasks.filter((t) => t.status === "done").length;
  return (
    heading(
      "Tareas",
      `${done} de ${state.tasks.length} terminadas`,
      button("new-tasks", "Agregar tarea"),
    ) +
    filters([
      ["all", "Todas"],
      ["urgent", "Urgentes"],
      ["pending", "Pendientes"],
      ["doing", "En curso"],
      ["done", "Listas"],
    ]) +
    `<div class="list">${tasks.map((t) => `<button class="list-row" data-open="tasks" data-id="${esc(t.id)}"><span class="status-icon ${t.priority}">${icon(t.status === "done" ? "check" : t.priority === "urgent" ? "urgent" : "circle")}</span><div class="row-content"><div class="row-title">${esc(t.title)}</div><div class="row-meta">${!t.personId ? `<span class="unassigned-marker">${icon("unassigned")}Sin responsable</span>` : esc(personName(t.personId))}${t.due ? " · " + esc(t.due) : ""}</div></div>${icon("chevron", "chevron")}</button>`).join("") || empty("Una cosa a la vez", "Anota lo que falta y asígnalo a la persona indicada.", "new-tasks", "Agregar tarea", "tasks")}</div>`
  );
}
function guestsPage() {
  return (
    heading(
      "Invitados",
      `${state.guests.length} en lista · ${state.guests.filter((g) => g.attendance === "confirmed").length} confirmados`,
      button("add-guests", "Agregar invitados"),
    ) +
    search("Buscar invitados") +
    filters([
      ["all", "Todos"],
      ["unassigned", "Sin mesa"],
      ["confirmed", "Confirmados"],
      ["child", "Niños"],
    ]) +
    `<div id="guest-list">${guestList()}</div>`
  );
}
function guestList() {
  const rows = state.guests.filter(
    (g) =>
      normalize(g.name).includes(normalize(query)) &&
      (filter === "all" ||
        (filter === "unassigned" && !tableFor(g.id)) ||
        (filter === "confirmed" && g.attendance === "confirmed") ||
        (filter === "child" && g.type === "child")),
  );
  return `<div class="list">${
    rows
      .slice(0, 250)
      .map(
        (g) =>
          `<button class="list-row" data-open="guests" data-id="${esc(g.id)}"><span class="avatar">${esc(initials(g.name))}</span><div class="row-content"><div class="row-title">${esc(g.name)}</div><div class="row-meta">${esc(tableFor(g.id)?.name || "Sin mesa")} · ${labels[g.type]}</div></div><div class="row-end"><span>${labels[g.attendance]}</span>${icon("chevron", "chevron")}</div></button>`,
      )
      .join("") ||
    empty(
      query ? "No encontramos ese nombre" : "Tu lista comienza aquí",
      query
        ? "Prueba con otro nombre."
        : "Agrega uno o varios invitados a la vez.",
      query ? null : "add-guests",
      "Agregar invitados",
      "users",
    )
  }</div>${rows.length > 250 ? notes("Se muestran 250 resultados. Usa la búsqueda para acotar la lista.") : ""}`;
}
function vendorsPage() {
  const vendors = state.vendors.filter(
    (v) =>
      filter === "all" ||
      (filter === "pending" && remaining(state, v) > 0) ||
      (filter === "done" && remaining(state, v) === 0) ||
      (filter === "deposit" && v.refundable),
  );
  const regular = state.vendors.filter((v) => !v.refundable);
  return (
    heading(
      "Proveedores",
      "Acuerdos, abonos y saldos",
      button("new-vendors", "Agregar proveedor"),
    ) +
    `<div class="summary-strip"><div><span>Acordado</span><strong>${money(regular.reduce((n, v) => n + v.total, 0))}</strong></div><div><span>Pagado</span><strong>${money(regular.reduce((n, v) => n + paid(state, v.id), 0))}</strong></div><div><span>Pendiente</span><strong>${money(regular.reduce((n, v) => n + remaining(state, v), 0))}</strong></div></div>` +
    filters([
      ["all", "Todos"],
      ["pending", "Por pagar"],
      ["done", "Pagados"],
      ["deposit", "Depósitos"],
    ]) +
    `<div class="list">${vendors.map((v) => `<button class="list-row" data-open="vendors" data-id="${esc(v.id)}">${icon("wallet")}<div class="row-content"><div class="row-title">${esc(v.name)}</div><div class="row-meta">${esc(v.service)}${v.refundable ? " · Reembolsable" : ""}</div></div><div class="row-end"><strong>${money(remaining(state, v))}</strong><span>${remaining(state, v) > 0 ? "pendiente" : "pagado"}</span></div></button>`).join("") || empty("Cuentas claras", "Registra el total acordado; después podrás agregar cada abono.", "new-vendors", "Agregar proveedor", "wallet")}</div>${notes("Los depósitos reembolsables se muestran por separado y no se suman al gasto. Los saldos históricos requieren confirmación.")}`
  );
}
function morePage() {
  const links = [
    ["event", "calendar", "Datos del evento", "Fecha, lugar y horario"],
    ["guests", "users", "Invitados", "Asistencia y mesas"],
    ["vendors", "wallet", "Proveedores y pagos", "Acuerdos y abonos"],
    [
      "people",
      "person",
      "Responsables y contactos",
      "Un solo directorio para toda la boda",
    ],
    ["plans", "shield", "Plan B", "Situaciones y respuestas por confirmar"],
    [
      "backup",
      "download",
      "Respaldo y recuperación",
      "Guardar, revisar y restaurar",
    ],
  ];
  return (
    heading("Más", "Todo lo demás, a mano") +
    links
      .map(
        ([key, ico, title, sub]) =>
          `<button class="menu-row" data-go="${key}">${icon(ico)}<div class="row-content">${title}<small>${sub}</small></div>${icon("chevron", "chevron")}</button>`,
      )
      .join("") +
    notes(
      "Esta versión guarda los datos únicamente en este navegador. Compartir su dirección no comparte tus registros.",
    )
  );
}
function peoplePage() {
  return (
    heading(
      "Responsables",
      "El mismo directorio en agenda, tareas y Plan B",
      button("new-people", "Agregar responsable"),
    ) +
    `<div class="list">${state.people.map((p) => `<button class="list-row" data-open="people" data-id="${esc(p.id)}"><span class="avatar">${esc(initials(p.name))}</span><div class="row-content"><div class="row-title">${esc(p.name)}</div><div class="row-meta">${esc([p.role, p.phone].filter(Boolean).join(" · "))}</div></div>${icon("chevron", "chevron")}</button>`).join("") || empty("¿Con quién contamos?", "Registra a quienes ayudarán a coordinar el evento.", "new-people", "Agregar responsable", "person")}</div>`
  );
}
function plansPage() {
  return (
    heading(
      "Plan B",
      "Borrador · pendiente de aprobación final",
      button("new-contingencies", "Agregar situación"),
    ) +
    `<div class="list">${state.contingencies.map((p) => `<button class="list-row" data-open="contingencies" data-id="${esc(p.id)}">${icon("shield")}<div class="row-content"><div class="row-title">${esc(p.name)}</div><div class="row-meta">${esc(personName(p.personId))}</div></div><span class="pill">${labels[p.status]}</span></button>`).join("")}</div>` +
    notes(
      "Una propuesta escrita no equivale a un plan confirmado. Define la condición de activación y acuerda la respuesta con su responsable.",
    )
  );
}
function eventPage() {
  return (
    heading(
      "El evento",
      "La información que compartimos",
      button("edit-event", "Editar datos del evento", "edit"),
    ) +
    `<div class="card"><h2>${esc(state.event.name)}</h2><div class="mini-rule"></div><p>${esc(state.event.venue)}</p><p class="muted small">${esc(state.event.region)}</p><div class="mini-rule"></div><p>${esc(state.event.date)} · ${esc(state.event.time)}</p><p class="muted small">America/Mexico_City</p></div>` +
    notes(
      "Montaje histórico: acceso desde las 09:00, 14 mesas y 140 sillas. Los horarios de proveedores y el recorrido accesible requieren verificación. Consulta la especificación antes de tratarlos como acuerdos vigentes.",
    )
  );
}
function mapPage() {
  return (
    heading(
      "Mapa del jardín",
      "",
      button("add-table", "Agregar mesa", "plus") +
        button(
          "toggle-edit",
          editing ? "Terminar edición" : "Editar posición de mesas",
          editing ? "check" : "edit",
          `icon-button ${editing ? "active" : ""}`,
        ),
    ) +
    `<div class="garden ${editing ? "editing" : ""}" role="region" aria-label="Distribución orientativa del jardín"><div class="garden-top"><span>${icon("person")}Baños</span><span class="hotel">Entrada del hotel ${icon("exit")}</span></div><div class="garden-tree" aria-hidden="true"></div><div class="map-canvas" id="map-canvas">${state.tables.map((t) => `<button class="table" style="left:${t.x * 8.7}%;top:${t.y * 12.4}%" data-table="${esc(t.id)}" aria-label="${esc(t.name)}, ${state.assignments.filter((a) => a.tableId === t.id).length} de ${t.capacity} lugares${editing ? ", mover con flechas" : ""}"><i class="chair-rail top" aria-hidden="true"><i></i><i></i><i></i><i></i></i><i class="chair-rail bottom" aria-hidden="true"><i></i><i></i><i></i><i></i></i><b>${esc(t.name)}</b><span>${state.assignments.filter((a) => a.tableId === t.id).length}/${t.capacity}</span></button>`).join("")}</div>${!state.tables.length ? `<div class="garden-empty">${icon("table")}<p>Organiza las mesas sin perder de vista a tus invitados.</p><button class="primary" data-action="setup-tables">Crear las 14 mesas</button></div>` : ""}<span class="garden-foot">Orientación del jardín · no está a escala</span></div><div class="map-toolbar"><span>${editing ? "Arrastra las mesas · flechas con teclado" : "Toca una mesa para ver sus invitados"}</span><button data-go="guests">${icon("users")}Invitados</button></div>`
  );
}
function backupPage() {
  return (
    heading("Respaldo", "Tus datos, también fuera del teléfono") +
    `<button class="menu-row" data-action="backup-export">${icon("download")}<div class="row-content">Guardar respaldo completo<small>Archivo JSON · versión de esquema 1</small></div>${icon("chevron", "chevron")}</button><div class="card"><h2>Restaurar un respaldo</h2><p class="row-meta">Revisaremos el archivo antes de reemplazar datos. Se conservará una copia preventiva en este dispositivo.</p><label class="field"><span class="sr-only">Seleccionar respaldo JSON</span><input class="backup-input" id="backup-file" type="file" accept=".json,application/json"></label><div id="import-preview"></div></div><button class="menu-row" style="margin-top:14px" data-action="recovery-export">${icon("refresh")}<div class="row-content">Copia anterior a la restauración<small>Descargar para revisar o recuperar</small></div>${icon("chevron", "chevron")}</button><div class="section-head"><h2>Exportaciones operativas</h2></div><button class="menu-row" data-action="agenda-export">${icon("calendar")}<div class="row-content">Compartir itinerario<small>Sin pagos ni datos privados de invitados</small></div>${icon("chevron", "chevron")}</button>${notes("No borres los datos del navegador sin guardar antes un respaldo. La PWA funciona offline tras su primera carga completa; la instalación requiere HTTPS fuera de este entorno local.")}`
  );
}
function modal(content) {
  dialogRevision = state.revision;
  $("#dialog-content").innerHTML =
    content + `<p class="form-error" id="form-error" role="alert"></p>`;
  if (!dialog.open) dialog.showModal();
}
const field = (
  label,
  name,
  value = "",
  type = "text",
  wide = false,
  extra = "",
) =>
  `<label class="field ${wide ? "wide" : ""}"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const textarea = (label, name, value = "", extra = "") =>
  `<label class="field wide"><span>${esc(label)}</span><textarea name="${name}" maxlength="2000" ${extra}>${esc(value)}</textarea></label>`;
function select(label, name, value, options, wide = false) {
  return `<label class="field ${wide ? "wide" : ""}"><span>${label}</span><select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(value ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
}
const personSelect = (value) =>
  select(
    "Responsable",
    "personId",
    value,
    [["", "Sin responsable"], ...state.people.map((p) => [p.id, p.name])],
    true,
  );
const actions = (collection, entityId) =>
  `<div class="form-actions">${entityId ? `<button type="button" class="danger" data-delete="${collection}" data-id="${esc(entityId)}" aria-label="Eliminar ${collection === "guests" ? "invitado" : collection === "tables" ? "mesa" : "registro"}">${icon("trash")}</button>` : ""}<button type="submit" class="primary">Guardar cambios</button></div>`;
const enumOptions = (list) => list.map((v) => [v, labels[v]]);
function addGuests() {
  modal(
    `<h2>Agregar invitados</h2><form id="guest-bulk"><label class="field"><textarea name="names" aria-label="Nombres de invitados, uno por línea" placeholder="Nombre del invitado" rows="7" maxlength="200000" required></textarea></label><div id="duplicate-report"></div><div class="form-actions"><button type="submit" class="primary">Agregar invitados</button></div></form>`,
  );
}
function openEntity(collection, entityId) {
  const existing = state[collection]?.find((x) => x.id === entityId);
  const v = existing || {};
  if (collection === "tables") {
    openTable(entityId);
    return;
  }
  if (collection === "vendors" && existing) {
    vendorDetail(v);
    return;
  }
  let title = "",
    body = "";
  if (collection === "guests") {
    title = "";
    body =
      `<input class="title-input wide" name="name" aria-label="Nombre del invitado" value="${esc(v.name)}" maxlength="160" required>` +
      select(
        "Asistencia",
        "attendance",
        v.attendance,
        enumOptions(["confirmed", "pending", "declined"]),
      ) +
      select("Tipo", "type", v.type, enumOptions(["adult", "child"])) +
      select(
        "Mesa",
        "tableId",
        tableFor(v.id)?.id,
        [["", "Sin mesa"], ...state.tables.map((t) => [t.id, t.name])],
        true,
      ) +
      textarea("Observaciones", "notes", v.notes);
  } else if (collection === "people") {
    title = existing ? "Editar responsable" : "Agregar responsable";
    body =
      field(
        "Nombre",
        "name",
        v.name,
        "text",
        true,
        'required maxlength="160"',
      ) +
      field("Función", "role", v.role, "text", true, 'maxlength="160"') +
      field("Teléfono", "phone", v.phone, "tel", true, 'maxlength="80"');
  } else if (collection === "tasks") {
    title = existing ? "Editar tarea" : "Agregar tarea";
    body =
      field(
        "Tarea",
        "title",
        v.title,
        "text",
        true,
        'required maxlength="160"',
      ) +
      personSelect(v.personId) +
      select(
        "Prioridad",
        "priority",
        v.priority || "normal",
        enumOptions(["normal", "urgent"]),
      ) +
      select(
        "Estado",
        "status",
        v.status || "pending",
        enumOptions(["pending", "doing", "done"]),
      ) +
      field("Fecha límite", "due", v.due, "date", true) +
      textarea("Descripción", "description", v.description);
  } else if (collection === "agenda") {
    title = existing ? "Editar actividad" : "Agregar actividad";
    body =
      field(
        "Actividad",
        "title",
        v.title,
        "text",
        true,
        'required maxlength="160"',
      ) +
      field("Inicio", "start", v.start || "14:30", "time", false, "required") +
      field("Fin", "end", v.end || "", "time") +
      field(
        "Aclaración del horario",
        "endNote",
        v.endNote,
        "text",
        true,
        'maxlength="160"',
      ) +
      personSelect(v.personId) +
      field("Lugar", "location", v.location, "text", true, 'maxlength="160"') +
      select(
        "Estado",
        "status",
        v.status || "pending",
        enumOptions(["pending", "active", "done"]),
        true,
      ) +
      textarea("Descripción", "description", v.description) +
      textarea("Notas", "notes", v.notes);
  } else if (collection === "vendors") {
    vendorEdit(existing);
    return;
  } else if (collection === "contingencies") {
    title = existing ? "Plan B · " + v.name : "Agregar situación";
    body =
      field(
        "Nombre",
        "name",
        v.name,
        "text",
        true,
        'required maxlength="160"',
      ) +
      textarea("Situación", "situation", v.situation) +
      select(
        "Estado",
        "status",
        v.status || "undefined",
        enumOptions(["undefined", "review", "confirmed"]),
        true,
      ) +
      textarea("Condición para activar el plan", "trigger", v.trigger) +
      textarea("Respuesta acordada", "response", v.response) +
      personSelect(v.personId);
  }
  modal(
    `${title ? `<h2>${esc(title)}</h2>` : ""}<form id="entity-form" data-collection="${collection}" data-id="${esc(existing?.id || "")}"><div class="form-grid">${body}</div>${actions(collection, existing?.id)}</form>`,
  );
}
function vendorEdit(v) {
  modal(
    `<h2>${v ? "Editar proveedor" : "Agregar proveedor"}</h2><form id="vendor-form" data-id="${esc(v?.id || "")}"><div class="form-grid">${field("Nombre del proveedor", "name", v?.name, "text", true, 'required maxlength="160"')}${field("Servicio", "service", v?.service, "text", true, 'maxlength="160"')}${field("Contacto", "contact", v?.contact, "text", true, 'maxlength="160"')}${field("Teléfono", "phone", v?.phone, "tel", false, 'maxlength="80"')}${field("Hora de llegada", "arrival", v?.arrival, "time")}${field("Total acordado · MXN", "total", v ? String(v.total / 100) : "", "text", true, 'required inputmode="decimal"')}${textarea("Notas", "notes", v?.notes)}<label class="check-field wide"><input name="refundable" type="checkbox" ${v?.refundable ? "checked" : ""}>Depósito reembolsable (separado del gasto)</label></div>${actions("vendors", v?.id)}</form>`,
  );
}
function vendorDetail(v) {
  const payments = state.payments.filter((p) => p.vendorId === v.id);
  modal(
    `<h2>${esc(v.name)}</h2><p class="muted">${esc(v.service)}${v.refundable ? " · Depósito reembolsable" : ""}</p><div class="summary-strip" style="margin-top:20px"><div><span>Acordado</span><strong>${money(v.total)}</strong></div><div><span>Abonado</span><strong>${money(paid(state, v.id))}</strong></div><div><span>Saldo</span><strong>${money(remaining(state, v))}</strong></div></div>${v.contact || v.phone ? `<p class="row-meta">${esc(v.contact)} ${v.phone ? `<a href="tel:${esc(v.phone.replace(/[^+\d]/g, ""))}">${esc(v.phone)}</a>` : ""}</p>` : ""}${v.arrival ? `<p class="row-meta">Llegada: ${v.arrival}</p>` : ""}${v.notes ? `<p class="notice-box">${esc(v.notes)}</p>` : ""}<div class="inline-actions"><button class="secondary" data-action="edit-vendor" data-id="${esc(v.id)}">Editar proveedor</button><button class="secondary" data-action="add-payment" data-id="${esc(v.id)}">${icon("plus")} Registrar abono</button></div><div class="section-head"><h3>Abonos registrados</h3></div>${payments.map((p) => `<div class="payment-row"><div class="row-content"><p>${esc(p.concept)}</p><p class="row-meta">${esc(p.date)}</p></div><strong>${money(p.amount)}</strong><button class="icon-button" data-delete="payments" data-id="${esc(p.id)}" aria-label="Eliminar abono ${esc(p.concept)}">${icon("trash")}</button></div>`).join("") || '<p class="muted small">Aún no hay abonos registrados.</p>'}`,
  );
}
function paymentForm(vendorId) {
  modal(
    `<h2>Registrar abono</h2><form id="payment-form" data-id="${esc(vendorId)}"><div class="form-grid">${field("Importe · MXN", "amount", "", "text", true, 'required inputmode="decimal"')}${field("Concepto", "concept", "", "text", true, 'required maxlength="160"')}${field("Fecha", "date", new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), "date", true, "required")}</div><div class="form-actions"><button class="primary">Guardar abono</button></div></form>`,
  );
}
function openTable(tableId) {
  const t = state.tables.find((t) => t.id === tableId);
  if (!t) return;
  selectedGuest = null;
  const assigned = state.assignments.filter((a) => a.tableId === tableId);
  modal(
    `<form id="table-name-form" data-id="${esc(t.id)}"><div class="table-title"><input name="name" class="title-input" aria-label="Nombre de la mesa" value="${esc(t.name)}" maxlength="160" required>${button("capacity-down", "Disminuir lugares", "minus", "icon-button", `data-id="${esc(t.id)}" ${t.capacity <= Math.max(1, assigned.length) ? "disabled" : ""}`)}<span class="seat-count" aria-label="Lugares">${t.capacity}</span>${button("capacity-up", "Aumentar lugares", "plus", "icon-button", `data-id="${esc(t.id)}" ${t.capacity >= 10 ? "disabled" : ""}`)}</div><div class="seat-icons" aria-label="${assigned.length} ocupados de ${t.capacity} lugares">${Array.from({ length: t.capacity }, (_, i) => icon("person", i < assigned.length ? "occupied" : "")).join("")}</div><button class="quiet-link" type="submit">Guardar nombre</button></form><div class="search-inline"><label class="search">${icon("search")}<input id="table-search" aria-label="Buscar invitado para asignar" placeholder="Buscar invitado" autocomplete="off"></label>${button("unassigned-list", "Ver invitados sin mesa", "list", "icon-button", `data-id="${esc(t.id)}"`)}${button("assign-guest", "Asignar invitado seleccionado", "plus", "icon-button", `id="assign-button" data-id="${esc(t.id)}" disabled`)}</div><div id="table-results" class="results"></div><div id="table-assigned">${
      assigned
        .map((a) => {
          const g = state.guests.find((g) => g.id === a.guestId);
          return `<div class="assignment-row"><span>${esc(g.name)}</span>${button("release-guest", `Liberar a ${g.name}`, "minus", "icon-button", `data-id="${esc(g.id)}" data-table-id="${esc(t.id)}"`)}</div>`;
        })
        .join("") || '<p class="row-meta">Los lugares están disponibles.</p>'
    }</div><div class="form-actions"><button class="danger" data-delete="tables" data-id="${esc(t.id)}">${icon("trash")}Eliminar mesa</button></div>`,
  );
  dialog.dataset.tableId = t.id;
}
function tableSearch(all = false) {
  const q = normalize($("#table-search")?.value || "");
  const t = dialog.dataset.tableId;
  const results = state.guests
    .filter(
      (g) => (all || q) && normalize(g.name).includes(q) && !tableFor(g.id),
    )
    .slice(0, 100);
  $("#table-results").innerHTML =
    results
      .map(
        (g) =>
          `<button type="button" class="result" data-select-guest="${esc(g.id)}" aria-pressed="${selectedGuest === g.id}">${esc(g.name)}${g.attendance === "declined" ? " · No asiste" : ""}</button>`,
      )
      .join("") ||
    (q || all
      ? '<p class="row-meta">No hay invitados sin mesa que coincidan.</p>'
      : "");
}
function eventEdit() {
  modal(
    `<h2>Datos del evento</h2><form id="event-form"><div class="form-grid">${field("Nombre del evento", "name", state.event.name, "text", true, 'required maxlength="160"')}${field("Lugar", "venue", state.event.venue, "text", true, 'maxlength="160"')}${field("Región", "region", state.event.region, "text", true, 'maxlength="160"')}${field("Fecha", "date", state.event.date, "date", false, "required")}${field("Hora", "time", state.event.time, "time", false, "required")}</div><p class="row-meta">Zona horaria: America/Mexico_City</p><div class="form-actions"><button class="primary">Guardar cambios</button></div></form>`,
  );
}
function confirmDelete(collection, entityId) {
  const messages = {
    guests: "¿Eliminar este invitado? También se liberará su lugar en la mesa.",
    tables:
      "¿Eliminar esta mesa? Sus invitados quedarán sin mesa y seguirán en el directorio.",
    people:
      "¿Eliminar este responsable? Sus actividades, tareas y planes quedarán sin responsable.",
    vendors: "¿Eliminar este proveedor y todos sus abonos?",
    payments: "¿Eliminar este abono? Se actualizará el saldo.",
    agenda: "¿Eliminar esta actividad del itinerario?",
    tasks: "¿Eliminar esta tarea?",
    contingencies: "¿Eliminar este plan?",
  };
  if (confirm(messages[collection] || "¿Eliminar este registro?"))
    change(
      { type: "delete", collection, id: entityId },
      { expected: dialogRevision },
    );
}
function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function exportBackup(s = state, suffix = "respaldo") {
  download(
    `nupcial-${suffix}-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(validate(s), null, 2),
  );
  toast("Respaldo preparado para descargar");
}
function exportAgenda() {
  const date = state.event.date;
  const body = [
    `${state.event.name} — Itinerario`,
    `${date} · ${state.event.venue} · America/Mexico_City`,
    "",
    ...[...state.agenda]
      .sort(byStart)
      .map(
        (a) =>
          `${a.start}–${a.end || a.endNote || "por definir"} | ${a.title}\n${[a.location, personMeta(a.personId), a.description].filter(Boolean).join(" · ")}`,
      ),
  ].join("\n\n");
  modal(
    `<h2>Exportar itinerario</h2><p class="muted small">Incluye actividades, horarios, responsables, teléfonos, lugares y descripción operativa. No incluye notas internas, invitados ni pagos.</p><div class="inline-actions"><button class="primary" id="download-agenda">${icon("download")}Guardar texto</button><button class="secondary" id="print-agenda">Imprimir / guardar PDF</button>${navigator.share ? '<button class="secondary" id="share-agenda">Compartir</button>' : ""}</div><div class="notice-box"><p>${state.agenda.length} actividades · ${esc(date)}</p><p>Formato de exportación pendiente de aprobación final.</p></div>`,
  );
  $("#download-agenda").onclick = () =>
    download("nupcial-itinerario.txt", body, "text/plain;charset=utf-8");
  $("#print-agenda").onclick = () => printAgenda();
  if ($("#share-agenda"))
    $("#share-agenda").onclick = async () => {
      try {
        await navigator.share({ title: "Itinerario Nupcial", text: body });
      } catch (e) {
        if (e.name !== "AbortError")
          error("No se pudo compartir. Guarda el archivo de texto.");
      }
    };
}
function printAgenda() {
  const win = window.open("", "_blank");
  if (!win) {
    error("Permite abrir la vista de impresión e intenta de nuevo.");
    return;
  }
  win.document.write(
    `<!doctype html><html lang="es"><head><title>Itinerario Nupcial</title><style>body{font:14px system-ui;margin:30px;color:#111}h1{font-size:24px}article{break-inside:avoid;padding:12px 0;border-bottom:1px solid #bbb}h2{font-size:16px;margin:0}p{margin:6px 0}</style></head><body><h1>${esc(state.event.name)} · Itinerario</h1><p>${esc(state.event.date)} · ${esc(state.event.venue)} · America/Mexico_City</p>${[
      ...state.agenda,
    ]
      .sort(byStart)
      .map(
        (a) =>
          `<article><h2>${a.start}–${esc(a.end || a.endNote || "por definir")} · ${esc(a.title)}</h2><p>${esc([a.location, personMeta(a.personId)].filter(Boolean).join(" · "))}</p><p>${esc(a.description)}</p></article>`,
      )
      .join("")}</body></html>`,
  );
  win.document.close();
  win.onload = () => win.print();
}
let importCandidate, importRevision;
async function inspectBackup(file) {
  const box = $("#import-preview");
  importCandidate = null;
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024)
      throw new Error("El archivo supera el límite de 10 MB.");
    importCandidate = parseBackup(await file.text());
    importRevision = state.revision;
    box.innerHTML = `<div class="notice-box"><p><strong>Respaldo válido · ${esc(importCandidate.event.name)}</strong></p><p>${importCandidate.guests.length} invitados · ${importCandidate.tables.length} mesas · ${importCandidate.agenda.length} actividades · ${importCandidate.tasks.length} tareas</p><p>${importCandidate.vendors.length} proveedores · ${importCandidate.people.length} responsables</p><p>Guardado: ${esc(importCandidate.updatedAt)}</p></div><button class="primary" data-action="restore-backup">Reemplazar con este respaldo</button>`;
  } catch (e) {
    box.innerHTML = `<p class="form-error" role="alert">${esc(e.message)}</p>`;
  }
}
async function restoreBackup() {
  if (!importCandidate) return;
  if (
    !confirm(
      "¿Reemplazar los datos actuales por el respaldo revisado? Se guardará una copia preventiva.",
    )
  )
    return;
  try {
    state = await commit(
      importRevision,
      () => structuredClone(importCandidate),
      true,
    );
    channel?.postMessage("changed");
    importCandidate = null;
    render();
    toast("Respaldo restaurado. Copia anterior conservada.");
  } catch (e) {
    error(e.message);
  }
}
// Forms share one persistence boundary: UI only updates after the IDB transaction commits.
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form.matches("form")) return;
  e.preventDefault();
  const fd = new FormData(form),
    raw = Object.fromEntries(fd),
    entityId = form.dataset.id;
  try {
    if (form.id === "guest-bulk") {
      const { added, duplicates } = importNames(state, raw.names, false);
      if (duplicates.length) {
        $("#duplicate-report").innerHTML =
          `<div class="notice-box">${duplicates.length} nombres coinciden y no se agregarán automáticamente.<p>${duplicates.map(esc).join(", ")}</p><label class="check-field"><input type="checkbox" name="homonyms">Confirmo que los nombres coincidentes son personas distintas (homónimos).</label></div>`;
        if (!fd.has("homonyms")) {
          if (added.length) {
            const ok = await change(
              { type: "guests", guests: added },
              { close: false, expected: dialogRevision },
            );
            if (ok) {
              dialogRevision = state.revision;
              form.elements.names.value = duplicates.join("\n");
              toast(
                `${added.length} invitados agregados; revisa las coincidencias.`,
              );
            }
          }
          return;
        }
      }
      const result = fd.has("homonyms")
        ? importNames(state, raw.names, true)
        : { added };
      if (!result.added.length)
        throw new Error("No hay nombres nuevos para agregar.");
      await change(
        { type: "guests", guests: result.added },
        { expected: dialogRevision },
      );
    } else if (form.id === "entity-form") {
      const collection = form.dataset.collection;
      let value = { id: entityId || id(), ...raw };
      if (["tasks", "agenda", "contingencies"].includes(collection))
        value.personId = raw.personId || null;
      if (collection === "agenda") value.end = raw.end || null;
      if (collection === "guests") {
        const tableId = raw.tableId || null;
        delete value.tableId;
        await change(
          { type: "guestUpdate", value, tableId },
          { expected: dialogRevision },
        );
      } else
        await change(
          { type: "save", collection, value },
          { expected: dialogRevision },
        );
    } else if (form.id === "vendor-form") {
      const value = {
        id: entityId || id(),
        ...raw,
        total: amountCents(raw.total),
        refundable: fd.has("refundable"),
      };
      await change(
        { type: "save", collection: "vendors", value },
        { expected: dialogRevision },
      );
    } else if (form.id === "payment-form") {
      const value = {
        id: id(),
        vendorId: entityId,
        amount: amountCents(raw.amount),
        concept: raw.concept,
        date: raw.date,
      };
      await change(
        { type: "save", collection: "payments", value },
        { expected: dialogRevision },
      );
    } else if (form.id === "table-name-form") {
      const t = state.tables.find((t) => t.id === entityId);
      if (
        await change(
          {
            type: "save",
            collection: "tables",
            value: { ...t, name: raw.name },
          },
          { close: false, expected: dialogRevision },
        )
      ) {
        dialogRevision = state.revision;
        toast("Nombre de mesa guardado");
      }
    } else if (form.id === "event-form")
      await change({ type: "event", value: raw }, { expected: dialogRevision });
  } catch (err) {
    error(err.message);
  }
});
document.addEventListener("click", async (e) => {
  const go = e.target.closest("[data-go]");
  if (go) {
    location.hash = go.dataset.go;
    return;
  }
  const f = e.target.closest("[data-filter]");
  if (f) {
    filter = f.dataset.filter;
    render();
    return;
  }
  const open = e.target.closest("[data-open]");
  if (open) {
    openEntity(open.dataset.open, open.dataset.id);
    return;
  }
  const del = e.target.closest("[data-delete]");
  if (del) {
    confirmDelete(del.dataset.delete, del.dataset.id);
    return;
  }
  const chosen = e.target.closest("[data-select-guest]");
  if (chosen) {
    selectedGuest = chosen.dataset.selectGuest;
    $("#table-search").value = state.guests.find(
      (g) => g.id === selectedGuest,
    ).name;
    $("#table-results").innerHTML =
      `<button class="result" aria-pressed="true" data-select-guest="${esc(selectedGuest)}">${esc($("#table-search").value)}</button>`;
    $("#assign-button").disabled = false;
    return;
  }
  const table = e.target.closest("[data-table]");
  if (table) {
    if (!editing) openTable(table.dataset.table);
    return;
  }
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const action = b.dataset.action,
    entityId = b.dataset.id;
  if (action.startsWith("new-")) openEntity(action.slice(4));
  else if (action === "add-guests") addGuests();
  else if (action === "edit-event") eventEdit();
  else if (action === "install-app") {
    if (installPrompt) {
      await installPrompt.prompt();
      installPrompt = null;
    } else
      modal(
        '<h2>Nupcial en tu teléfono</h2><p>En Safari, abre Compartir y elige Añadir a pantalla de inicio. En Chrome, abre el menú y elige Instalar aplicación o Añadir a pantalla de inicio.</p><div class="notice-box">Fuera del entorno local, la instalación necesita una dirección HTTPS. Conserva un respaldo antes de cambiar de navegador o dispositivo.</div>',
      );
  } else if (action === "edit-vendor")
    vendorEdit(state.vendors.find((v) => v.id === entityId));
  else if (action === "add-payment") paymentForm(entityId);
  else if (action === "toggle-edit") {
    editing = !editing;
    render();
  } else if (action === "setup-tables") {
    if (
      confirm(
        "¿Crear las 14 mesas de referencia, con diez lugares cada una? Puedes cambiarlas después.",
      )
    )
      change({ type: "createTables" });
  } else if (action === "add-table") {
    let spot;
    for (let y = 0; y <= 7 && !spot; y++)
      for (let x of [2, 5, 8, 0])
        if (!state.tables.some((t) => t.y === y && Math.abs(t.x - x) < 3)) {
          spot = { x, y };
          break;
        }
    if (!spot) {
      toast("No hay espacio disponible en el mapa. Reorganiza las mesas.");
      return;
    }
    let num = 1;
    while (state.tables.some((t) => normalize(t.name) === `mesa ${num}`)) num++;
    await change({
      type: "save",
      collection: "tables",
      value: { id: id(), name: `Mesa ${num}`, capacity: 10, ...spot },
    });
  } else if (action.startsWith("capacity-")) {
    const t = state.tables.find((t) => t.id === entityId);
    if (
      await change(
        {
          type: "save",
          collection: "tables",
          value: {
            ...t,
            capacity: t.capacity + (action === "capacity-up" ? 1 : -1),
          },
        },
        { close: false, expected: dialogRevision },
      )
    )
      openTable(entityId);
  } else if (action === "unassigned-list") tableSearch(true);
  else if (action === "assign-guest") {
    if (!selectedGuest) {
      error("Selecciona un invitado primero.");
      return;
    }
    if (
      await change(
        { type: "assign", guestId: selectedGuest, tableId: entityId },
        { close: false, expected: dialogRevision },
      )
    )
      openTable(entityId);
  } else if (action === "release-guest") {
    if (
      await change(
        { type: "assign", guestId: entityId, tableId: null },
        { close: false, expected: dialogRevision },
      )
    )
      openTable(b.dataset.tableId);
  } else if (action === "backup-export") exportBackup();
  else if (action === "recovery-export") {
    const s = await recovery();
    if (s) exportBackup(s, "antes-de-restaurar");
    else toast("Todavía no hay una copia preventiva de restauración.");
  } else if (action === "restore-backup") restoreBackup();
  else if (action === "agenda-export") exportAgenda();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "page-search") {
    query = e.target.value;
    if (route === "guests") $("#guest-list").innerHTML = guestList();
  }
  if (e.target.id === "table-search") {
    selectedGuest = null;
    $("#assign-button").disabled = true;
    tableSearch();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "backup-file") inspectBackup(e.target.files[0]);
});
$(".close-dialog").innerHTML = icon("close");
$(".close-dialog").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
});
// Grid movement uses one coordinate space, direct pointer tracking and atomic persistence.
let drag;
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("[data-table]");
  if (!el || !editing || e.button !== 0 || drag) return;
  const t = state.tables.find((t) => t.id === el.dataset.table),
    canvas = $("#map-canvas").getBoundingClientRect();
  drag = {
    el,
    id: t.id,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    x: t.x,
    y: t.y,
    newX: t.x,
    newY: t.y,
    canvas,
    revision: state.revision,
  };
  el.setPointerCapture(e.pointerId);
  el.classList.add("dragging");
});
document.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  d.newX = Math.max(
    0,
    Math.min(
      8,
      Math.round(d.x + (e.clientX - d.startX) / (d.canvas.width * 0.087)),
    ),
  );
  d.newY = Math.max(
    0,
    Math.min(
      7,
      Math.round(d.y + (e.clientY - d.startY) / (d.canvas.height * 0.124)),
    ),
  );
  d.el.style.left = `${d.newX * 8.7}%`;
  d.el.style.top = `${d.newY * 12.4}%`;
});
async function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  d.el.classList.remove("dragging");
  if (d.el.hasPointerCapture(e.pointerId))
    d.el.releasePointerCapture(e.pointerId);
  if (d.x === d.newX && d.y === d.newY) return;
  if (
    !(await change(
      { type: "move", id: d.id, x: d.newX, y: d.newY },
      { close: false, expected: d.revision },
    ))
  )
    render();
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
document.addEventListener("keydown", async (e) => {
  const el = e.target.closest("[data-table]");
  if (
    !el ||
    !editing ||
    !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
  )
    return;
  e.preventDefault();
  const t = state.tables.find((t) => t.id === el.dataset.table);
  const x = Math.max(
      0,
      Math.min(
        8,
        t.x + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0),
      ),
    ),
    y = Math.max(
      0,
      Math.min(
        7,
        t.y + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0),
      ),
    );
  await change({ type: "move", id: t.id, x, y }, { close: false });
  $(`[data-table="${CSS.escape(t.id)}"]`)?.focus();
});
let theme = "system";
try {
  theme = localStorage.getItem("nupcial-preview-theme") || "system";
} catch {}
function applyTheme() {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme:dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#theme").innerHTML = icon(dark ? "sun" : "moon");
  $("#theme").setAttribute(
    "aria-label",
    `Cambiar a modo ${dark ? "claro" : "oscuro"}`,
  );
  $("meta[name=theme-color]").content = dark ? "#1c1d1b" : "#f4f3ef";
}
$("#theme").onclick = () => {
  theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("nupcial-preview-theme", theme);
  } catch {}
  applyTheme();
};
applyTheme();
matchMedia("(prefers-color-scheme:dark)").addEventListener("change", () => {
  if (theme === "system") applyTheme();
});
function connection() {
  $("#connection").textContent = navigator.onLine
    ? "En este dispositivo"
    : "Sin conexión";
}
window.addEventListener("online", connection);
window.addEventListener("offline", connection);
connection();
window.addEventListener("hashchange", routeTo);
channel?.addEventListener("message", async () => {
  state = await load();
  render();
  if (dialog.open)
    toast("Hubo cambios en otra pestaña. Reabre la ficha antes de guardar.");
});
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
async function boot() {
  try {
    await openDatabase();
    state = await load();
    routeTo();
    if ("serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url));
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              toast(
                "Hay una actualización. Cierra y vuelve a abrir Nupcial cuando termines.",
              );
          });
        });
      } catch {
        toast(
          "Guardado local activo. No se pudo preparar el modo offline; vuelve a abrir con conexión.",
        );
      }
    }
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    main.innerHTML = `<div class="empty">${icon("info")}<h2>No pudimos abrir tus datos</h2><p>${esc(e.message)}</p><p>Activa el almacenamiento de este navegador. No se ha borrado ningún registro.</p><button class="primary" onclick="location.reload()">Volver a intentar</button></div>`;
  }
}
setInterval(tick, 1000);
boot();
