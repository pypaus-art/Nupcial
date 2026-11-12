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
  SCHEMA,
} from "./domain.js";
import { openDatabase, load, commit, recovery } from "./storage.js";
import { icon } from "./icons.js";
import { board, boardContents } from "./garden-view.js";
import {
  WORLD,
  WORLD_AREA,
  fitArea,
  TABLE_GRID,
  snapTable,
  KINDS,
  tableSpaceFree,
  clampPosition,
  findElementSpace,
} from "./map-model.js";
import {
  tone,
  soundEnabled,
  setSoundEnabled,
  enter,
  leave,
  confirmVisual,
  progressFeedback,
} from "./feedback.js";
import { eraseFrames, printFrames } from "./ink.js";
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
  dialogRevision = 0,
  installPrompt,
  nextRouteFilter = null;
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
  tone("error");
  if (route === "garden" && $("#garden-error")) {
    $("#garden-error").textContent = message;
    return;
  }
  const el = $("#form-error");
  if (dialog.open && el) {
    el.textContent = message;
    if (formChanged(dialog.querySelector("form")))
      el.insertAdjacentHTML(
        "beforeend",
        '<div class="inline-actions"><button type="button" class="secondary" data-action="form-discard">Descartar borrador</button></div>',
      );
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
    if (close && dialog.open) await leave(dialog);
    render();
    tone(action.type === "move" ? "select" : "success");
    if (action.type === "save" || action.type === "guestUpdate") {
      const collection = action.collection || "guests";
      const target =
        collection === "tables" ? "data-table" : `data-open="${collection}"`;
      const element =
        collection === "tables"
          ? $(`[data-table="${CSS.escape(action.value.id)}"]`)
          : $(`[${target}][data-id="${CSS.escape(action.value.id)}"]`);
      confirmVisual(element);
    }
    if (close) toast("Cambios guardados en este dispositivo");
    return true;
  } catch (e) {
    error(e.message);
    if (e.message.includes("otra pestaña")) {
      if (route === "garden") gardenStale = true;
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
        `<a href="#${key}" ${key === "map" ? 'class="map-nav"' : 'class="nav-item"'} aria-label="${label}" ${route === key || (key === "more" && ["guests", "vendors", "people", "event", "plans", "backup", "garden"].includes(route)) ? 'aria-current="page"' : ""}>${icon(ico)}${key !== "map" ? `<span>${label}</span>` : ""}</a>`,
    )
    .join("");
}
let pointerNavigation = false;
let inkSequence = 0;
let inkViewTransition;
let inkAnimation;
document.addEventListener(
  "pointerdown",
  () => {
    pointerNavigation = true;
  },
  { capture: true },
);
document.addEventListener(
  "keydown",
  () => {
    pointerNavigation = false;
  },
  { capture: true },
);
function inkTransition(paint) {
  const sequence = ++inkSequence;
  inkViewTransition?.skipTransition();
  inkAnimation?.cancel();
  const animate =
    pointerNavigation &&
    main.dataset.route &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !document.hidden;
  pointerNavigation = false;
  if (!animate) {
    delete document.documentElement.dataset.ink;
    paint();
    return;
  }
  document.documentElement.dataset.ink = "refreshing";
  const finish = () => {
    if (sequence === inkSequence) delete document.documentElement.dataset.ink;
  };
  if (document.startViewTransition) {
    inkViewTransition = document.startViewTransition(() => {
      if (sequence === inkSequence) paint();
    });
    inkViewTransition.ready.catch(() => {});
    inkViewTransition.finished.catch(() => {}).finally(finish);
  } else if (main.animate) {
    inkAnimation = main.animate(eraseFrames, {
      duration: 95,
      easing: "cubic-bezier(.23,1,.32,1)",
      fill: "none",
    });
    inkAnimation.finished
      .then(() => {
        if (sequence !== inkSequence) return;
        paint();
        inkAnimation = main.animate(printFrames, {
          duration: 180,
          easing: "cubic-bezier(.23,1,.32,1)",
          fill: "none",
        });
        return inkAnimation.finished;
      })
      .catch(() => {})
      .finally(finish);
  } else {
    paint();
    finish();
  }
}
let navigationSequence = 0;
async function routeTo() {
  const sequence = ++navigationSequence;
  const next = location.hash.slice(1) || "home";
  if (dialog.open) {
    if (!(await requestDialogClose())) {
      if (sequence === navigationSequence)
        history.replaceState(null, "", `#${route}`);
      return;
    }
    if (sequence !== navigationSequence) return;
  }
  if (route === "garden" && next !== "garden") {
    if (!(await saveGarden()) || sequence !== navigationSequence) {
      if (sequence === navigationSequence)
        history.replaceState(null, "", "#garden");
      return;
    }
    gardenDraft = null;
    gardenDirty = false;
  }
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
    "garden",
  ].includes(next)
    ? next
    : "home";
  editing = false;
  selectedTable = null;
  tablePreview = null;
  query = "";
  filter = nextRouteFilter || "all";
  nextRouteFilter = null;
  inkTransition(() => {
    render();
    window.scrollTo(0, 0);
  });
}
function render() {
  if (!state) return;
  const previousProgress =
    main.dataset.route === route
      ? new Map(
          [...main.querySelectorAll("[role=progressbar]")].map((el) => [
            el.getAttribute("aria-label"),
            Number(el.getAttribute("aria-valuenow")),
          ]),
        )
      : new Map();
  nav();
  $("#header-date").textContent = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Mexico_City",
  })
    .format(new Date(state.event.date + "T12:00:00-06:00"))
    .replaceAll(".", "")
    .toUpperCase();
  main.className =
    route === "map"
      ? "map-page"
      : route === "home"
        ? "home-page"
        : route === "garden"
          ? "garden-editor-page"
          : "";
  document.body.classList.toggle(
    "canvas-open",
    ["map", "garden"].includes(route),
  );
  document.body.classList.toggle("home-open", route === "home");
  main.dataset.route = route;
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
    garden: gardenPage,
  }[route]();
  mountMapViewport();
  progressFeedback(previousProgress, main);
  tick();
}
function percentage(value, total) {
  return total > 0
    ? Math.min(100, Math.max(0, Math.round((value / total) * 100)))
    : 0;
}
function progressBar(label, value, total) {
  const percent = percentage(value, total);
  return `<div class="progress" role="progressbar" aria-label="${esc(label)}" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${total ? `${percent}%` : "Sin registros"}"><span style="width:${percent}%"></span></div>`;
}
function countSummary(key, title, actions, value, total, label) {
  const percent = percentage(value, total);
  return `<section class="section-summary" data-summary="${key}">${heading(title, "", actions)}<div class="summary-metric"><div class="summary-count"><strong>${value}</strong><span>/ ${total}</span></div><span class="summary-percent">${percent}%</span></div><div class="summary-bottom"><span>${label}</span>${progressBar(label, value, total)}</div></section>`;
}
function homePage() {
  const upcoming =
    [...state.agenda].sort(byStart).find((a) => a.status === "active") ||
    [...state.agenda].sort(byStart).find((a) => a.status !== "done");
  const tasks = state.tasks.filter((t) => t.status !== "done");
  const done = state.tasks.length - tasks.length;
  const urgent = tasks.filter((t) => t.priority === "urgent").length;
  const assigned = state.assignments.length;
  const settled = state.vendors.filter((v) => remaining(state, v) === 0).length;
  const pendingVendors = state.vendors.length - settled;
  return `<h1 class="sr-only">Inicio</h1><section class="countdown home-countdown" aria-label="Cuenta regresiva al evento"><div id="countdown" class="countdown-values"></div></section>
  <div class="bento home-bento">
    <button class="card home-next" data-go="agenda"><span class="tile-icon">${icon("calendar")}</span><div class="next-content"><span class="card-label">${upcoming?.status === "active" ? "En curso" : "Próxima actividad"}</span>${upcoming ? `<div class="home-time">${upcoming.start}</div><h2 class="next-title">${esc(upcoming.title)}</h2>${upcoming.personId ? `<p class="tile-detail">${esc(personName(upcoming.personId))}</p>` : ""}` : '<h2 class="next-title">Agenda completada</h2>'}</div></button>
    <button class="card home-tasks" data-go="tasks"><span class="tile-icon">${icon("tasks")}</span><div class="tile-main"><strong class="tile-number">${String(tasks.length).padStart(2, "0")}</strong><span class="tile-label">Pendientes</span></div><div class="tile-bottom">${progressBar("Tareas completadas", done, state.tasks.length)}<span class="tile-detail">${percentage(done, state.tasks.length)}%</span></div></button>
    <button class="card home-vendors" data-go="vendors"><span class="tile-icon">${icon("truck")}</span><div class="tile-main"><strong class="tile-ratio">${String(settled).padStart(2, "0")}<span> / ${String(state.vendors.length).padStart(2, "0")}</span></strong><span class="tile-label">Proveedores</span><span class="tile-detail">${pendingVendors} por liquidar</span></div></button>
    <button class="card home-guests" data-go="guests"><div class="tile-top"><span class="tile-icon">${icon("users")}</span><span class="pill">${percentage(assigned, state.guests.length)}%</span></div><div class="tile-main"><strong class="tile-ratio">${assigned}<span> / ${state.guests.length}</span></strong><span class="tile-label">Invitados</span><span class="tile-detail">${state.tables.length} ${state.tables.length === 1 ? "mesa" : "mesas"}</span></div></button>
  </div>
  <button class="urgent-row" data-go="tasks"><span class="urgent-badge">${icon(urgent ? "urgent" : "check")}</span><strong>${urgent ? `${urgent} ${urgent === 1 ? "asunto urgente" : "asuntos urgentes"}` : "Sin pendientes urgentes"}</strong>${icon("chevron", "chevron")}</button>`;
}
function tick() {
  const counter = $("#countdown");
  if (!state || !counter) return;
  const c = countdown(state.event);
  counter.setAttribute(
    "aria-label",
    c.started
      ? "La fecha del evento ha llegado"
      : `${c.days} días, ${c.hours} horas, ${c.minutes} minutos y ${c.seconds} segundos`,
  );
  counter.innerHTML = ["days", "hours", "minutes", "seconds"]
    .map(
      (key, i) =>
        `${i ? '<span class="countdown-colon" aria-hidden="true">:</span>' : ""}<strong class="${key === "seconds" ? "countdown-seconds" : ""}" aria-hidden="true">${String(c[key]).padStart(2, "0")}</strong>`,
    )
    .join("");
}
function agendaPage() {
  const entries = [...state.agenda]
    .sort(byStart)
    .filter((a) => filter === "all" || a.status === filter);
  return (
    countSummary(
      "agenda",
      "Itinerario",
      button("agenda-export", "Exportar itinerario", "download") +
        button("new-agenda", "Agregar actividad"),
      state.agenda.filter((a) => a.status === "done").length,
      state.agenda.length,
      "Completadas",
    ) +
    filters([
      ["all", "Todo"],
      ["pending", "Pendiente"],
      ["active", "En curso"],
      ["done", "Finalizado"],
    ]) +
    `<div class="list">${entries.map((a) => `<button class="list-row agenda-row" data-open="agenda" data-id="${esc(a.id)}"><div class="agenda-time">${a.start}<small><span>${a.end || "por definir"}</span>${a.status === "done" ? `<span class="agenda-finished" aria-label="Finalizado">${icon("circle-check")}</span>` : ""}</small></div><div class="row-content"><div class="row-title">${esc(a.title)}</div>${a.personId || a.location ? `<div class="row-meta">${esc([a.personId ? personName(a.personId) : null, a.location].filter(Boolean).join(" · "))}</div>` : ""}${a.endNote ? `<p class="row-meta">${esc(a.endNote)}</p>` : ""}${a.status === "active" ? `<span class="pill">${labels[a.status]}</span>` : ""}</div>${icon("chevron", "chevron")}</button>`).join("") || empty("Sin actividades", "No hay actividades con este estado.", "new-agenda", "Agregar actividad", "calendar")}</div>`
  );
}
function tasksPage() {
  const tasks = state.tasks.filter(
    (t) => filter === "all" || t.status === filter,
  );
  const done = state.tasks.filter((t) => t.status === "done").length;
  return (
    countSummary(
      "tasks",
      "Tareas",
      button("new-tasks", "Agregar tarea"),
      done,
      state.tasks.length,
      "Terminadas",
    ) +
    filters([
      ["all", "Todas"],
      ["pending", "Pendientes"],
      ["doing", "En curso"],
      ["done", "Terminadas"],
    ]) +
    `<div class="list">${tasks.map((t) => `<button class="list-row" data-open="tasks" data-id="${esc(t.id)}"><span class="task-status" aria-label="${t.status === "done" ? "Terminada" : labels[t.status]}"><span class="status-icon ${t.priority}" aria-label="${t.status === "done" ? "Terminada" : `Prioridad ${t.priority === "urgent" ? "urgente" : "normal"}`}">${icon(t.status === "done" ? "circle-check" : t.priority === "urgent" ? "urgent" : "circle")}</span><span class="task-steps" aria-hidden="true">${[1, 2, 3].map((step) => `<i class="${step <= (t.status === "done" ? 3 : t.status === "doing" ? 2 : 1) ? "filled" : ""}"></i>`).join("")}</span></span><div class="row-content"><div class="row-title">${esc(t.title)}</div><div class="row-meta">${!t.personId ? `<span class="unassigned-marker">${icon("unassigned")}Sin responsable</span>` : esc(personName(t.personId))}${t.due ? " · " + esc(t.due) : ""}</div></div>${icon("chevron", "chevron")}</button>`).join("") || empty("Una cosa a la vez", "Anota lo que falta y asígnalo a la persona indicada.", "new-tasks", "Agregar tarea", "tasks")}</div>`
  );
}
function guestsPage() {
  return (
    countSummary(
      "guests",
      "Invitados",
      button("add-guests", "Agregar invitados"),
      state.assignments.length,
      state.guests.length,
      "Con mesa",
    ) +
    search("Buscar invitados") +
    filters([
      ["all", "Todos"],
      ["unassigned", "Sin mesa"],
    ]) +
    `<div id="guest-list">${guestList()}</div>`
  );
}
function guestList() {
  const rows = state.guests.filter(
    (g) =>
      normalize(g.name).includes(normalize(query)) &&
      (filter === "all" || (filter === "unassigned" && !tableFor(g.id))),
  );
  return `<div class="list">${
    rows
      .slice(0, 250)
      .map(
        (g) =>
          `<button class="list-row" data-open="guests" data-id="${esc(g.id)}"><span class="avatar">${esc(initials(g.name))}</span><div class="row-content"><div class="row-title">${esc(g.name)}</div><div class="row-meta">${esc(tableFor(g.id)?.name || "Sin mesa")} · ${labels[g.type]}</div></div>${icon("chevron", "chevron")}</button>`,
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
    `<section class="section-summary" data-summary="vendors">${heading("Proveedores", "", button("new-vendors", "Agregar proveedor"))}<div class="balance-label">Por pagar · MXN</div><strong class="balance-value">${money(regular.reduce((n, v) => n + remaining(state, v), 0))}</strong>${progressBar(
      "Pagos realizados",
      regular.reduce((n, v) => n + paid(state, v.id), 0),
      regular.reduce((n, v) => n + v.total, 0),
    )}<div class="summary-footer"><span>${money(regular.reduce((n, v) => n + paid(state, v.id), 0))} pagados</span><span>${percentage(
      regular.reduce((n, v) => n + paid(state, v.id), 0),
      regular.reduce((n, v) => n + v.total, 0),
    )}%</span></div></section>` +
    filters([
      ["all", "Todos"],
      ["pending", "Por pagar"],
      ["done", "Pagados"],
      ["deposit", "Depósitos"],
    ]) +
    `<div class="list">${vendors.map((v) => `<button class="list-row" data-open="vendors" data-id="${esc(v.id)}">${icon("wallet")}<div class="row-content"><div class="row-title">${esc(v.name)}</div><div class="row-meta">${esc(v.service)}${v.refundable ? " · Reembolsable" : ""}</div></div><div class="row-end"><strong>${money(remaining(state, v))}</strong><span>${remaining(state, v) > 0 ? "pendiente" : "pagado"}</span></div></button>`).join("") || empty("Cuentas claras", "Registra el total acordado; después podrás agregar cada abono.", "new-vendors", "Agregar proveedor", "wallet")}</div>${state.vendors.some((v) => v.refundable) ? '<p class="finance-note">Depósitos reembolsables separados del gasto.</p>' : ""}`
  );
}
function morePage() {
  const links = [
    ["event", "calendar", "Datos del evento", "Fecha, lugar y horario"],
    ["garden", "leaf", "Diseñar jardín", "Tu fondo para el mapa"],
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
    heading("Más") +
    `<div class="more-bento">${links.map(([key, ico, title, sub]) => `<button class="menu-tile" data-go="${key}">${icon(ico)}<span>${title}</span><small>${sub}</small></button>`).join("")}<button class="menu-tile" data-action="toggle-sounds" aria-pressed="${soundEnabled()}">${icon(soundEnabled() ? "sound" : "muted")}<span>Sonidos suaves</span><small>${soundEnabled() ? "Activados" : "Silenciados"}</small><span class="switch-track" aria-hidden="true"><i></i></span></button></div>` +
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
  return `<div class="canvas-head" id="table-edit-panel">${editing ? tableControls() : heading("Mapa del jardín", "", button("add-table", "Agregar mesa") + button("toggle-edit", "Editar mesas", "edit"))}</div><div class="garden ${editing ? "editing" : ""}" role="region" aria-label="Distribución orientativa del jardín">${board(state, { editing, selected: selectedTable, tablePreview })}${!state.tables.length ? `<div class="garden-empty">${icon("table")}<p>Organiza las mesas.</p><button class="primary" data-action="setup-tables">Crear las 14 mesas</button></div>` : ""}</div>`;
}
let selectedTable = null,
  tablePreview = null,
  tableWork = Promise.resolve();
let gardenDraft = null,
  gardenBaseline = "",
  gardenSaved = "",
  gardenSelection = null,
  gardenDirty = false,
  gardenStale = false,
  gardenPaletteOpen = false,
  gardenSaveWork = Promise.resolve(true),
  gardenSaveTimer;
const gardenCamera = { zoom: 1, x: WORLD.width / 2, y: WORLD.height / 2 };
function selectedObject() {
  return gardenDraft?.elements.find((e) => e.id === gardenSelection);
}
function updateDirty() {
  gardenDirty =
    !!gardenDraft && JSON.stringify(gardenDraft.elements) !== gardenBaseline;
  const status = $("#garden-status");
  if (status)
    status.textContent = gardenStale
      ? "No se pudo guardar"
      : gardenDirty
        ? "Guardando"
        : "Guardado automáticamente";
}
function editorControls() {
  if (gardenPaletteOpen)
    return `<div class="editor-palette" aria-label="Agregar al jardín">${Object.entries(
      KINDS,
    )
      .map(
        ([kind, spec]) =>
          `<button data-action="garden-add" data-kind="${kind}" class="palette-item" aria-label="Agregar ${esc(spec.label.toLowerCase())}">${icon(kind)}<span>${spec.label}</span></button>`,
      )
      .join(
        "",
      )}${button("garden-deselect", "Cerrar elementos", "close")}</div>`;
  const e = selectedObject();
  if (!e)
    return heading(
      "Diseñar jardín",
      "",
      button("garden-palette", "Agregar al jardín") +
        button("garden-exit", "Salir del editor", "close"),
    );
  const name = ["toilet", "entrance"].includes(e.kind)
    ? `<input id="garden-label" value="${esc(e.label)}" maxlength="60" aria-label="Etiqueta del elemento">`
    : `<strong>${esc(KINDS[e.kind].label)}</strong>`;
  return `<div class="editor-control-row"><div class="editor-selection">${name}<small id="garden-dimensions">${e.width} × ${e.height} px</small></div>${button("garden-rotate", "Girar elemento 90 grados", "rotate")}${button("garden-shrink", "Reducir elemento 5 píxeles", "minus")}${button("garden-grow", "Aumentar elemento 5 píxeles", "plus")}${button("garden-delete", "Quitar elemento", "trash")}${button("garden-deselect", "Terminar edición del elemento", "check")}</div>`;
}
let mapArea = WORLD_AREA,
  mapAreaKey = "",
  mapResizeObserver;
function fitMapViewport() {
  const svg = $("#map-canvas");
  if (!svg || !["map", "garden"].includes(route)) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const garden = route === "garden" ? gardenDraft : state.garden;
  const next = fitArea(
    [...state.tables, ...(garden?.elements || [])],
    rect.width,
    rect.height,
  );
  const key = `${route}:${rect.width}:${rect.height}`;
  if (key !== mapAreaKey || next.width > mapArea.width + 0.001) mapArea = next;
  mapAreaKey = key;
  if (route === "garden") applyGardenCamera();
  else
    svg.setAttribute(
      "viewBox",
      `${mapArea.left} ${mapArea.top} ${mapArea.width} ${mapArea.height}`,
    );
  const grid = svg.querySelector(".table-grid");
  if (grid)
    for (const [key, value] of Object.entries({
      x: mapArea.left,
      y: mapArea.top,
      width: mapArea.width,
      height: mapArea.height,
    }))
      grid.setAttribute(key, value);
}
function mountMapViewport() {
  mapResizeObserver?.disconnect();
  const svg = $("#map-canvas");
  if (!svg) {
    mapAreaKey = "";
    return;
  }
  fitMapViewport();
  mapResizeObserver = new ResizeObserver(() => {
    if (!drag) fitMapViewport();
  });
  mapResizeObserver.observe(svg);
}
function applyGardenCamera() {
  const svg = $("#map-canvas");
  if (!svg || route !== "garden") return;
  const w = mapArea.width / gardenCamera.zoom,
    h = mapArea.height / gardenCamera.zoom;
  gardenCamera.x = Math.max(
    mapArea.left + w / 2,
    Math.min(mapArea.left + mapArea.width - w / 2, gardenCamera.x),
  );
  gardenCamera.y = Math.max(
    mapArea.top + h / 2,
    Math.min(mapArea.top + mapArea.height - h / 2, gardenCamera.y),
  );
  svg.setAttribute(
    "viewBox",
    `${gardenCamera.x - w / 2} ${gardenCamera.y - h / 2} ${w} ${h}`,
  );
  $("#garden-zoom-value").textContent =
    `${Math.round(gardenCamera.zoom * 100)}%`;
  $("[data-action=garden-zoom-out]").disabled = gardenCamera.zoom <= 1;
  $("[data-action=garden-zoom-in]").disabled = gardenCamera.zoom >= 3;
}
function refreshGarden({ controls = true } = {}) {
  if (route !== "garden" || !$("#map-canvas")) return;
  $("#map-canvas").innerHTML = boardContents(state, {
    editor: true,
    draft: gardenDraft,
    selected: gardenSelection,
    showTables: false,
  });
  if (controls) $("#garden-controls").innerHTML = editorControls();
  fitMapViewport();
  updateDirty();
}
function gardenPage() {
  if (!gardenDraft) {
    gardenDraft = structuredClone(state.garden);
    gardenDraft.custom = true;
    gardenBaseline = JSON.stringify(state.garden.elements);
    gardenSaved = JSON.stringify(state.garden);
    gardenSelection = null;
    gardenDirty = false;
    gardenStale = false;
    gardenPaletteOpen = false;
    Object.assign(gardenCamera, {
      zoom: 1,
      x: WORLD.width / 2,
      y: WORLD.height / 2,
    });
  }
  // The header always reserves the same height; tools replace it instead of shrinking the canvas.
  queueMicrotask(applyGardenCamera);
  return `<div class="canvas-head" id="garden-controls">${editorControls()}</div><div class="garden garden-workspace">${board(state, { editor: true, draft: gardenDraft, selected: gardenSelection, showTables: false })}<div class="garden-save-error" id="garden-error" role="alert"></div></div><div class="canvas-zoom" aria-label="Zoom del jardín">${button("garden-zoom-out", "Alejar jardín", "minus", "icon-button", "disabled")}<button data-action="garden-zoom-fit" id="garden-zoom-value" aria-label="Ver jardín completo">100%</button>${button("garden-zoom-in", "Acercar jardín", "plus")}<span class="sr-only" id="garden-status" role="status">Guardado automáticamente</span></div>`;
}
function tableControls() {
  const t = state.tables.find((t) => t.id === selectedTable);
  return `<div class="editor-control-row"><div class="editor-selection"><strong>${t ? esc(t.name) : "Elige una mesa"}</strong><small id="table-dimensions">${t ? `${t.width} × ${t.height} px · ${t.rotation}°` : "Arrastra para mover"}</small></div>${button("table-rotate", "Girar mesa 90 grados", "rotate", "icon-button", `${t ? "" : "disabled"} id="table-rotate"`)}${button("table-shrink", "Reducir mesa un píxel", "minus", "icon-button", `${!t || t.width <= 44 ? "disabled" : ""} id="table-shrink"`)}${button("table-grow", "Aumentar mesa un píxel", "plus", "icon-button", `${!t || t.width >= 140 ? "disabled" : ""} id="table-grow"`)}${button("toggle-edit", "Terminar edición", "check", "icon-button active")}</div>`;
}
function selectTable(tableId) {
  const different = selectedTable !== tableId;
  selectedTable = tableId;
  tablePreview = null;
  if (editing && $("#table-edit-panel"))
    $("#table-edit-panel").innerHTML = tableControls();
  if ($("#map-canvas"))
    $("#map-canvas").innerHTML = boardContents(state, {
      editing,
      selected: selectedTable,
    });
  fitMapViewport();
  if (different) tone("select");
}
function transformTable({ rotationDelta = 0, delta = 0 }) {
  const target = selectedTable,
    focused = document.activeElement?.id;
  tableWork = tableWork
    .then(async () => {
      const t = state.tables.find((t) => t.id === target);
      if (!t) return;
      const width = Math.max(44, Math.min(140, t.width + delta));
      const value = {
        ...t,
        width,
        height: Math.round((width * 9) / 16),
        rotation: (t.rotation + rotationDelta) % 360,
      };
      Object.assign(value, clampPosition(value, value.x, value.y, mapArea));
      await change(
        { type: "save", collection: "tables", value },
        { close: false },
      );
      if (focused)
        document.getElementById(focused)?.focus({ preventScroll: true });
    })
    .catch((e) => error(e.message));
}
function resizeObject(width) {
  const e = selectedObject();
  if (!e) return;
  const max = Math.min(
    240,
    Math.floor((240 * KINDS[e.kind].width) / KINDS[e.kind].height),
  );
  e.width = Math.max(16, Math.min(max, width));
  e.height = Math.max(
    12,
    Math.round((e.width * KINDS[e.kind].height) / KINDS[e.kind].width),
  );
  Object.assign(e, clampPosition(e, e.x, e.y, mapArea));
  refreshGarden();
  saveGarden();
}
function scheduleGardenSave() {
  updateDirty();
  clearTimeout(gardenSaveTimer);
  gardenSaveTimer = setTimeout(saveGarden, 220);
}
function showGardenSaveError(message) {
  gardenStale = true;
  const el = $("#garden-error");
  if (el)
    el.innerHTML = `${esc(message)} <button data-action="garden-retry" class="quiet-link">Reintentar</button>`;
  updateDirty();
  tone("error");
}
function saveGarden() {
  clearTimeout(gardenSaveTimer);
  gardenSaveWork = gardenSaveWork.then(async () => {
    if (!gardenDraft) return true;
    updateDirty();
    if (!gardenDirty) return true;
    const value = structuredClone(gardenDraft);
    try {
      if (JSON.stringify(state.garden) !== gardenSaved)
        throw new Error(
          "El jardín cambió en otra pestaña. Tu diseño sigue aquí.",
        );
      let next;
      try {
        next = await commit(state.revision, (s) =>
          mutate(s, { type: "garden", value }),
        );
      } catch (e) {
        if (!e.message.includes("otra pestaña")) throw e;
        const latest = await load();
        state = latest;
        if (JSON.stringify(latest.garden) !== gardenSaved)
          throw new Error(
            "El jardín cambió en otra pestaña. Tu diseño sigue aquí.",
          );
        next = await commit(latest.revision, (s) =>
          mutate(s, { type: "garden", value }),
        );
      }
      state = next;
      gardenSaved = JSON.stringify(next.garden);
      gardenBaseline = JSON.stringify(value.elements);
      gardenStale = false;
      if ($("#garden-error")) $("#garden-error").textContent = "";
      updateDirty();
      channel?.postMessage("changed");
      return true;
    } catch (e) {
      showGardenSaveError(e.message);
      return false;
    }
  });
  return gardenSaveWork;
}
async function gardenAction(action, el) {
  if (action === "garden-retry") {
    const latest = await load();
    if (
      JSON.stringify(latest.garden) !== gardenSaved &&
      !confirm(
        "¿Guardar tu diseño sobre el jardín de la otra pestaña? Los demás registros se conservarán.",
      )
    )
      return;
    state = latest;
    gardenSaved = JSON.stringify(latest.garden);
    await saveGarden();
    return;
  }
  if (action === "garden-exit") {
    location.hash = "more";
    return;
  }
  if (action === "garden-palette" || action === "garden-deselect") {
    gardenSelection = null;
    gardenPaletteOpen = action === "garden-palette";
    refreshGarden();
    return;
  }
  if (action.startsWith("garden-zoom-")) {
    if (action === "garden-zoom-fit")
      Object.assign(gardenCamera, {
        zoom: 1,
        x: WORLD.width / 2,
        y: WORLD.height / 2,
      });
    else {
      const selected = selectedObject();
      if (selected && gardenCamera.zoom === 1)
        Object.assign(gardenCamera, { x: selected.x, y: selected.y });
      gardenCamera.zoom = Math.max(
        1,
        Math.min(
          3,
          gardenCamera.zoom + (action === "garden-zoom-in" ? 0.25 : -0.25),
        ),
      );
    }
    applyGardenCamera();
    return;
  }
  if (action === "garden-add") {
    const kind = el.dataset.kind,
      spec = KINDS[kind];
    if (!spec) return;
    const item = findElementSpace(
      {
        id: id(),
        kind,
        width: spec.width,
        height: spec.height,
        rotation: 0,
        label: ["toilet", "entrance"].includes(kind) ? spec.label : "",
      },
      gardenDraft.elements,
      [],
    );
    if (!item) {
      error("Reduce el tamaño de este elemento para colocarlo.");
      return;
    }
    gardenDraft.elements.push(item);
    gardenSelection = item.id;
    gardenPaletteOpen = false;
    if (gardenCamera.zoom > 1)
      Object.assign(gardenCamera, { x: item.x, y: item.y });
    refreshGarden();
    confirmVisual($(`[data-garden-object="${CSS.escape(item.id)}"]`));
    saveGarden();
    return;
  }
  const selected = selectedObject();
  if (!selected) return;
  if (action === "garden-rotate") {
    selected.rotation = (selected.rotation + 90) % 360;
    Object.assign(
      selected,
      clampPosition(selected, selected.x, selected.y, mapArea),
    );
  } else if (action === "garden-delete") {
    gardenDraft.elements = gardenDraft.elements.filter(
      (e) => e.id !== selected.id,
    );
    gardenSelection = null;
  } else if (action === "garden-grow" || action === "garden-shrink") {
    resizeObject(selected.width + (action === "garden-grow" ? 5 : -5));
    return;
  } else return;
  refreshGarden();
  confirmVisual($(`[data-garden-object="${CSS.escape(selected.id)}"]`));
  saveGarden();
}
function backupPage() {
  return (
    heading("Respaldo", "Tus datos, también fuera del teléfono") +
    `<button class="menu-row" data-action="backup-export">${icon("download")}<div class="row-content">Guardar respaldo completo<small>Archivo JSON · versión de esquema ${SCHEMA}</small></div>${icon("chevron", "chevron")}</button><div class="card"><h2>Restaurar un respaldo</h2><p class="row-meta">Revisaremos el archivo antes de reemplazar datos. Se conservará una copia preventiva en este dispositivo.</p><label class="field"><span class="sr-only">Seleccionar respaldo JSON</span><input class="backup-input" id="backup-file" type="file" accept=".json,application/json"></label><div id="import-preview"></div></div><button class="menu-row" style="margin-top:14px" data-action="recovery-export">${icon("refresh")}<div class="row-content">Copia anterior a la restauración<small>Descargar para revisar o recuperar</small></div>${icon("chevron", "chevron")}</button><button class="menu-row" data-action="migration-export">${icon("shield")}<div class="row-content">Copia previa a la actualización<small>Respaldo conservado al incorporar el editor</small></div>${icon("chevron", "chevron")}</button><div class="section-head"><h2>Exportaciones operativas</h2></div><button class="menu-row" data-action="agenda-export">${icon("calendar")}<div class="row-content">Compartir itinerario<small>Sin pagos ni datos privados de invitados</small></div>${icon("chevron", "chevron")}</button>${notes("No borres los datos del navegador sin guardar antes un respaldo. La PWA funciona offline tras su primera carga completa; la instalación requiere HTTPS fuera de este entorno local.")}`
  );
}
function modal(content) {
  const opening = !dialog.open;
  clearTimeout(tableNameTimer);
  dialogRevision = state.revision;
  $("#dialog-content").innerHTML =
    content + `<p class="form-error" id="form-error" role="alert"></p>`;
  for (const form of dialog.querySelectorAll("form")) {
    form.dataset.initial = formSignature(form);
    formBaselines.set(form, structuredClone(formRecord(form, state)));
  }
  if (!dialog.open) dialog.showModal();
  if (opening) enter(dialog);
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
function choices(label, name, value, options, columns = options.length) {
  return `<fieldset class="choice-field wide"><legend>${esc(label)}</legend><div class="choice-grid" style="--columns:${columns}">${options.map(([v, title, disabled = false]) => `<label class="choice"><input type="radio" name="${name}" value="${esc(v)}" ${String(value ?? "") === String(v) ? "checked" : ""} ${disabled ? "disabled" : ""}><span>${esc(title)}</span></label>`).join("")}</div></fieldset>`;
}
function tableChoices(guestId) {
  const current = tableFor(guestId)?.id || "";
  return choices(
    "Mesa",
    "tableId",
    current,
    [
      ["", "Sin mesa"],
      ...state.tables.map((t) => [
        t.id,
        t.name,
        t.id !== current &&
          state.assignments.filter((a) => a.tableId === t.id).length >=
            t.capacity,
      ]),
    ],
    3,
  );
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
const enumOptions = (list, doneLabel = labels.done) =>
  list.map((v) => [v, v === "done" ? doneLabel : labels[v]]);
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
      choices(
        "Tipo",
        "type",
        v.type || "adult",
        enumOptions(["adult", "child"]),
      ) +
      tableChoices(v.id) +
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
      choices(
        "Prioridad",
        "priority",
        v.priority || "normal",
        enumOptions(["normal", "urgent"]),
      ) +
      choices(
        "Estado",
        "status",
        v.status || "pending",
        enumOptions(["pending", "doing", "done"], "Terminada"),
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
      choices(
        "Estado",
        "status",
        v.status || "pending",
        enumOptions(["pending", "active", "done"], "Finalizado"),
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
  const assigned = state.assignments.filter((a) => a.tableId === tableId);
  modal(
    `<form id="table-name-form" data-id="${esc(t.id)}"><div class="table-title"><input name="name" class="title-input" aria-label="Nombre de la mesa" value="${esc(t.name)}" maxlength="160" required>${button("capacity-down", "Disminuir lugares", "minus", "icon-button", `data-id="${esc(t.id)}" ${t.capacity <= Math.max(1, assigned.length) ? "disabled" : ""}`)}<span class="seat-count" aria-label="Lugares">${t.capacity}</span>${button("capacity-up", "Aumentar lugares", "plus", "icon-button", `data-id="${esc(t.id)}" ${t.capacity >= 10 ? "disabled" : ""}`)}</div><div class="seat-icons" aria-label="${assigned.length} ocupados de ${t.capacity} lugares">${Array.from({ length: t.capacity }, (_, i) => icon("person", i < assigned.length ? "occupied" : "")).join("")}</div></form><div class="search-inline"><label class="search">${icon("search")}<input id="table-search" aria-label="Buscar invitado para asignar" placeholder="Buscar invitado" autocomplete="off"></label>${button("unassigned-list", "Ver invitados sin mesa", "list", "icon-button", `data-id="${esc(t.id)}"`)}</div><div id="table-results" class="results"></div><div id="table-assigned" role="region" aria-label="Invitados de esta mesa">${
      assigned
        .map((a) => {
          const g = state.guests.find((g) => g.id === a.guestId);
          return `<div class="assignment-row"><span>${esc(g.name)}</span>${button("release-guest", `Liberar a ${g.name}`, "minus", "icon-button", `data-id="${esc(g.id)}" data-table-id="${esc(t.id)}"`)}</div>`;
        })
        .join("") || '<p class="row-meta">Lugares disponibles</p>'
    }</div><div class="form-actions"><button class="danger" data-delete="tables" data-id="${esc(t.id)}">${icon("trash")}Eliminar mesa</button></div>`,
  );
  dialog.dataset.tableId = t.id;
}
function tableSearch(all = false) {
  const q = normalize($("#table-search")?.value || "");
  const t = dialog.dataset.tableId;
  const table = state.tables.find((x) => x.id === t);
  if (
    table &&
    state.assignments.filter((a) => a.tableId === t).length >= table.capacity
  ) {
    $("#table-results").innerHTML = '<p class="row-meta">Mesa completa.</p>';
    return;
  }
  const results = state.guests
    .filter(
      (g) => (all || q) && normalize(g.name).includes(q) && !tableFor(g.id),
    )
    .slice(0, 100);
  $("#table-results").innerHTML =
    results
      .map(
        (g) =>
          `<button type="button" class="result" data-select-guest="${esc(g.id)}">${esc(g.name)}</button>`,
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
    box.innerHTML = `<div class="notice-box"><p><strong>Respaldo válido · ${esc(importCandidate.event.name)}</strong></p><p>${importCandidate.guests.length} invitados · ${importCandidate.tables.length} mesas · ${importCandidate.agenda.length} actividades · ${importCandidate.tasks.length} tareas</p><p>${importCandidate.vendors.length} proveedores · ${importCandidate.people.length} responsables</p><p>${importCandidate.garden.elements.length} elementos del jardín</p><p>Guardado: ${esc(importCandidate.updatedAt)}</p></div><button class="primary" data-action="restore-backup">Reemplazar con este respaldo</button>`;
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
const formBaselines = new WeakMap();
function formRecord(form, s) {
  const key = form.dataset.id;
  if (form.id === "entity-form")
    return {
      record: s[form.dataset.collection].find((x) => x.id === key) || null,
      ...(form.dataset.collection === "guests"
        ? {
            tableId:
              s.assignments.find((a) => a.guestId === key)?.tableId || null,
          }
        : {}),
    };
  if (form.id === "vendor-form")
    return s.vendors.find((x) => x.id === key) || null;
  if (form.id === "table-name-form") {
    const t = s.tables.find((x) => x.id === key);
    return t ? { id: t.id, name: t.name } : null;
  }
  if (form.id === "event-form") return s.event;
  return null;
}
function showFormConflict(form, removed = false) {
  const el = $("#form-error");
  if (el)
    el.innerHTML = `${removed ? "Este registro se eliminó en otra pestaña." : "Este registro cambió en otra pestaña."} Tu edición sigue aquí.<div class="inline-actions">${removed ? "" : '<button type="button" class="secondary" data-action="form-overwrite">Guardar mi versión</button>'}<button type="button" class="secondary" data-action="form-discard">Descartar mi edición</button></div>`;
}
async function refreshFormContext(form, force = false) {
  const latest = await load();
  const original = formBaselines.get(form),
    current = formRecord(form, latest);
  const deleted =
    !!form.dataset.id &&
    !!original &&
    (form.id === "entity-form" ? !current.record : !current);
  state = latest;
  if (
    deleted ||
    (!force &&
      formChanged(form) &&
      JSON.stringify(original) !== JSON.stringify(current))
  ) {
    showFormConflict(form, deleted);
    return false;
  }
  dialogRevision = latest.revision;
  formBaselines.set(form, structuredClone(current));
  return true;
}
async function changeForm(form, action, options = {}) {
  const ok = await change(action, { expected: dialogRevision, ...options });
  if (!ok && state.revision !== dialogRevision) {
    if (await refreshFormContext(form))
      error("Tu edición sigue aquí. Vuelve a guardar para reintentar.");
  }
  return ok;
}
// One transaction per submitted form. Closing a sheet uses this same boundary.
const formSaves = new WeakMap();
const formSignature = (form) => JSON.stringify([...new FormData(form)]);
const formChanged = (form) =>
  !!form && formSignature(form) !== form.dataset.initial;
let dialogCloseWork = null,
  tableNameTimer,
  tableDialogWork = Promise.resolve(true);
function tableNameValid(form) {
  if (form.checkValidity() && form.elements.name.value.trim()) return true;
  error("Escribe un nombre para guardar la mesa.");
  form.reportValidity();
  form.elements.name.focus();
  return false;
}
async function persistTableName(form) {
  if (!form.isConnected || !formChanged(form)) return true;
  if (!(await refreshFormContext(form))) return false;
  const name = form.elements.name.value;
  const t = state.tables.find((t) => t.id === form.dataset.id);
  if (!t) {
    error("La mesa ya no existe. Tu texto sigue aquí.");
    return false;
  }
  if (name === t.name) {
    form.dataset.initial = formSignature(form);
    return true;
  }
  if (!tableNameValid(form)) return false;
  const ok = await changeForm(
    form,
    { type: "save", collection: "tables", value: { ...t, name } },
    { close: false },
  );
  if (ok) {
    dialogRevision = state.revision;
    form.dataset.initial = JSON.stringify([["name", name]]);
    formBaselines.set(form, { id: t.id, name });
  }
  return ok;
}
function saveTableName(form) {
  clearTimeout(tableNameTimer);
  tableDialogWork = tableDialogWork
    .then(() => persistTableName(form))
    .catch((e) => {
      error(e.message);
      return false;
    });
  return tableDialogWork;
}
function tableAction(action) {
  if (dialogCloseWork) return Promise.resolve(false);
  const form = $("#table-name-form"),
    tableId = form?.dataset.id;
  if (!form) return Promise.resolve(false);
  clearTimeout(tableNameTimer);
  tableDialogWork = tableDialogWork
    .then(async () => {
      if (
        !form.isConnected ||
        !(await refreshFormContext(form)) ||
        !(await persistTableName(form))
      )
        return false;
      const t = state.tables.find((t) => t.id === tableId);
      if (!t) return false;
      const ok = await changeForm(form, action(t), { close: false });
      if (ok) openTable(tableId);
      return ok;
    })
    .catch((e) => {
      error(e.message);
      return false;
    });
  return tableDialogWork;
}
async function saveForm(form) {
  if (form.id === "table-name-form") return saveTableName(form);
  if (formSaves.has(form)) return formSaves.get(form);
  if (!formChanged(form)) {
    state = await load();
    await leave(dialog);
    render();
    return true;
  }
  if (!form.checkValidity()) {
    error("Completa los campos marcados para guardar.");
    form.reportValidity();
    return false;
  }
  const work = persistForm(form);
  formSaves.set(form, work);
  try {
    return await work;
  } finally {
    formSaves.delete(form);
  }
}
async function persistForm(form) {
  form.inert = true;
  form.setAttribute("aria-busy", "true");
  try {
    if (!(await refreshFormContext(form))) return false;
    const fd = new FormData(form),
      raw = Object.fromEntries(fd),
      entityId = form.dataset.id;
    if (form.id === "guest-bulk") {
      const { added, duplicates } = importNames(state, raw.names, false);
      if (duplicates.length) {
        $("#duplicate-report").innerHTML =
          `<div class="notice-box">${duplicates.length} nombres coinciden y no se agregarán automáticamente.<p>${duplicates.map(esc).join(", ")}</p><label class="check-field"><input type="checkbox" name="homonyms">Confirmo que los nombres coincidentes son personas distintas (homónimos).</label></div>`;
        if (!fd.has("homonyms")) {
          if (added.length) {
            const ok = await changeForm(
              form,
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
          return false;
        }
      }
      const result = fd.has("homonyms")
        ? importNames(state, raw.names, true)
        : { added };
      if (!result.added.length)
        throw new Error("No hay nombres nuevos para agregar.");
      return await changeForm(
        form,
        { type: "guests", guests: result.added },
        { expected: dialogRevision },
      );
    }
    if (form.id === "entity-form") {
      const collection = form.dataset.collection;
      let value = {
        ...state[collection].find((x) => x.id === entityId),
        id: entityId || (form.dataset.recordId ||= id()),
        ...raw,
      };
      if (["tasks", "agenda", "contingencies"].includes(collection))
        value.personId = raw.personId || null;
      if (collection === "agenda") value.end = raw.end || null;
      if (collection === "guests") {
        const tableId = raw.tableId || null;
        delete value.tableId;
        return await changeForm(
          form,
          { type: "guestUpdate", value, tableId },
          { expected: dialogRevision },
        );
      }
      return await changeForm(
        form,
        { type: "save", collection, value },
        { expected: dialogRevision },
      );
    }
    if (form.id === "vendor-form") {
      const value = {
        id: entityId || (form.dataset.recordId ||= id()),
        ...raw,
        total: amountCents(raw.total),
        refundable: fd.has("refundable"),
      };
      return await changeForm(
        form,
        { type: "save", collection: "vendors", value },
        { expected: dialogRevision },
      );
    }
    if (form.id === "payment-form") {
      const value = {
        id: (form.dataset.recordId ||= id()),
        vendorId: entityId,
        amount: amountCents(raw.amount),
        concept: raw.concept,
        date: raw.date,
      };
      return await changeForm(
        form,
        { type: "save", collection: "payments", value },
        { expected: dialogRevision },
      );
    }
    if (form.id === "event-form")
      return await changeForm(
        form,
        { type: "event", value: raw },
        { expected: dialogRevision },
      );
    return true;
  } catch (e) {
    error(e.message);
    return false;
  } finally {
    form.inert = false;
    form.removeAttribute("aria-busy");
  }
}
async function requestDialogClose() {
  if (!dialog.open) return true;
  if (dialogCloseWork) return dialogCloseWork;
  const work = (async () => {
    await tableDialogWork;
    const form = dialog.querySelector("form");
    if (form?.id === "table-name-form") {
      if (!(await saveTableName(form))) return false;
    } else if (form && (formChanged(form) || formSaves.has(form))) {
      if (!(await saveForm(form))) return false;
    }
    if (dialog.open) await leave(dialog);
    return true;
  })();
  dialogCloseWork = work;
  try {
    return await work;
  } catch (e) {
    error(e.message);
    return false;
  } finally {
    dialogCloseWork = null;
  }
}
document.addEventListener("submit", (e) => {
  if (!e.target.matches("form")) return;
  e.preventDefault();
  saveForm(e.target);
});
document.addEventListener("click", async (e) => {
  if (
    e.target.closest("#map-canvas") &&
    performance.now() < suppressMapClickUntil
  )
    return;
  const resolution = e.target.closest(
    '[data-action="form-overwrite"],[data-action="form-discard"]',
  );
  if (resolution) {
    const form = dialog.querySelector("form");
    if (resolution.dataset.action === "form-discard") {
      clearTimeout(tableNameTimer);
      form.dataset.initial = formSignature(form);
      await leave(dialog);
      render();
    } else if (await refreshFormContext(form, true)) {
      $("#form-error").textContent = "";
      if (form.id === "table-name-form") await saveTableName(form);
      else await saveForm(form);
    }
    return;
  }
  const go = e.target.closest("[data-go]");
  if (go) {
    nextRouteFilter = go.dataset.filterRoute || null;
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
    if (
      await tableAction(() => ({
        type: "assign",
        guestId: chosen.dataset.selectGuest,
        tableId: dialog.dataset.tableId,
      }))
    )
      $("#table-search")?.focus({ preventScroll: true });
    return;
  }
  const object = e.target.closest("[data-garden-object]");
  if (object && route === "garden") {
    if (gardenSelection !== object.dataset.gardenObject) {
      gardenSelection = object.dataset.gardenObject;
      refreshGarden();
      tone("select");
    }
    return;
  }
  const table = e.target.closest("[data-table]");
  if (table) {
    if (!editing) openTable(table.dataset.table);
    else selectTable(table.dataset.table);
    return;
  }
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const action = b.dataset.action,
    entityId = b.dataset.id;
  if (action.startsWith("garden-")) {
    await gardenAction(action, b);
    return;
  }
  if (action === "toggle-sounds") {
    setSoundEnabled(!soundEnabled());
    render();
    return;
  }
  if (action === "table-rotate") {
    transformTable({ rotationDelta: 90 });
    return;
  }
  if (action === "table-grow" || action === "table-shrink") {
    transformTable({ delta: action === "table-grow" ? 1 : -1 });
    return;
  }
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
    selectedTable = null;
    tablePreview = null;
    render();
    tone("select");
  } else if (action === "setup-tables") {
    if (
      confirm(
        "¿Crear las 14 mesas de referencia, con diez lugares cada una? Puedes cambiarlas después.",
      )
    )
      change({ type: "createTables" });
  } else if (action === "add-table") {
    await change({ type: "createTable" });
  } else if (action.startsWith("capacity-")) {
    await tableAction((t) => {
      const value = {
        ...t,
        capacity: t.capacity + (action === "capacity-up" ? 1 : -1),
      };
      Object.assign(value, clampPosition(value, value.x, value.y, mapArea));
      return { type: "save", collection: "tables", value };
    });
  } else if (action === "unassigned-list") tableSearch(true);
  else if (action === "release-guest") {
    await tableAction(() => ({
      type: "assign",
      guestId: entityId,
      tableId: null,
    }));
  } else if (action === "backup-export") exportBackup();
  else if (action === "migration-export") {
    const previous = await recovery("before-migration-v2");
    if (previous) exportBackup(previous, "antes-del-editor");
    else toast("No hay una migración anterior en este dispositivo.");
  } else if (action === "recovery-export") {
    const s = await recovery();
    if (s) exportBackup(s, "antes-de-restaurar");
    else toast("Todavía no hay una copia preventiva de restauración.");
  } else if (action === "restore-backup") restoreBackup();
  else if (action === "agenda-export") exportAgenda();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "garden-label") {
    const item = selectedObject();
    if (!item) return;
    item.label = e.target.value;
    $("#map-canvas").innerHTML = boardContents(state, {
      editor: true,
      draft: gardenDraft,
      selected: gardenSelection,
      showTables: false,
    });
    scheduleGardenSave();
    return;
  }
  if (e.target.id === "page-search") {
    query = e.target.value;
    if (route === "guests") $("#guest-list").innerHTML = guestList();
  }
  if (e.target.form?.id === "table-name-form" && e.target.name === "name") {
    clearTimeout(tableNameTimer);
    const form = e.target.form;
    if (e.target.value.trim())
      tableNameTimer = setTimeout(() => saveTableName(form), 250);
  }
  if (e.target.id === "table-search") tableSearch();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "garden-label") {
    saveGarden();
    return;
  }
  if (e.target.id === "backup-file") inspectBackup(e.target.files[0]);
});
$(".close-dialog").innerHTML = icon("close");
$(".close-dialog").onclick = () => requestDialogClose();
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  requestDialogClose();
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      requestDialogClose();
  }
});
// Capture on the stable SVG root, never a child replaced by selection controls.
let drag,
  suppressMapClickUntil = 0,
  externalUpdatePending = false;
function worldPoint(
  event,
  inverse = $("#map-canvas").getScreenCTM().inverse(),
) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
}
document.addEventListener("pointerdown", (e) => {
  const svg = e.target.closest("#map-canvas");
  if (!svg || e.button !== 0 || drag || !(route === "garden" || editing))
    return;
  const el = e.target.closest("[data-table],[data-garden-object]");
  const isObject = !!el?.hasAttribute("data-garden-object");
  const pan = !el && route === "garden" && gardenCamera.zoom > 1;
  if (!el && !pan) return;
  if (el && (isObject ? route !== "garden" : !editing)) return;
  const item = pan
    ? null
    : isObject
      ? gardenDraft.elements.find((x) => x.id === el.dataset.gardenObject)
      : state.tables.find((x) => x.id === el.dataset.table);
  if (!pan && !item) return;
  if (item) {
    if (isObject) {
      gardenSelection = item.id;
      gardenPaletteOpen = false;
      $("#garden-controls").innerHTML = editorControls();
    } else {
      selectedTable = item.id;
      $("#table-edit-panel").innerHTML = tableControls();
    }
    svg
      .querySelectorAll('[aria-pressed="true"]')
      .forEach((x) => x.setAttribute("aria-pressed", "false"));
    el.setAttribute("aria-pressed", "true");
    el.classList.add("dragging");
  }
  const inverse = svg.getScreenCTM().inverse();
  drag = {
    svg,
    el,
    pan,
    isObject,
    item: item && structuredClone(item),
    inverse,
    pointerId: e.pointerId,
    start: worldPoint(e, inverse),
    screenX: e.clientX,
    screenY: e.clientY,
    next: item && { x: item.x, y: item.y },
    active: false,
    revision: state.revision,
    camera: { ...gardenCamera },
    area: { ...mapArea },
  };
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
});
document.addEventListener("pointermove", (e) => {
  if (!drag || drag.pointerId !== e.pointerId) return;
  if (
    !drag.active &&
    Math.hypot(e.clientX - drag.screenX, e.clientY - drag.screenY) < 3
  )
    return;
  drag.active = true;
  const point = worldPoint(e, drag.inverse);
  if (drag.pan) {
    gardenCamera.x = drag.camera.x - point.x + drag.start.x;
    gardenCamera.y = drag.camera.y - point.y + drag.start.y;
    applyGardenCamera();
    return;
  }
  const position = (drag.isObject ? clampPosition : snapTable)(
    drag.item,
    drag.item.x + point.x - drag.start.x,
    drag.item.y + point.y - drag.start.y,
    drag.area,
  );
  const free =
    drag.isObject ||
    tableSpaceFree(
      { ...drag.item, ...position },
      state.tables,
      null,
      drag.area,
    );
  drag.el.classList.toggle("drag-blocked", !free);
  if (!free) return;
  drag.next = position;
  drag.el.setAttribute("transform", `translate(${position.x} ${position.y})`);
});
async function endDrag(e) {
  if (!drag || drag.pointerId !== e.pointerId) return;
  const d = drag;
  drag = null;
  d.el?.classList.remove("dragging", "drag-blocked");
  if (d.svg.hasPointerCapture(e.pointerId))
    d.svg.releasePointerCapture(e.pointerId);
  suppressMapClickUntil = performance.now() + 350;
  if (!d.pan) {
    if (e.type === "pointercancel" || !d.active) {
      if (d.isObject) refreshGarden();
      else selectTable(d.item.id);
    } else if (d.isObject) {
      Object.assign(
        gardenDraft.elements.find((x) => x.id === d.item.id),
        d.next,
      );
      refreshGarden();
      confirmVisual($(`[data-garden-object="${CSS.escape(d.item.id)}"]`));
      tone("select");
      await saveGarden();
    } else if (d.next.x !== d.item.x || d.next.y !== d.item.y) {
      await change(
        { type: "move", id: d.item.id, ...d.next },
        { close: false, expected: d.revision },
      );
      confirmVisual($(`[data-table="${CSS.escape(d.item.id)}"]`));
    } else selectTable(d.item.id);
  }
  if (externalUpdatePending) {
    externalUpdatePending = false;
    await syncExternal();
  }
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
document.addEventListener("lostpointercapture", (e) => {
  if (drag?.pointerId === e.pointerId)
    endDrag({ pointerId: e.pointerId, type: "pointercancel" });
});
document.addEventListener("keydown", async (e) => {
  const el = e.target.closest("[data-table],[data-garden-object]");
  if (!el) return;
  const isObject = el.hasAttribute("data-garden-object");
  if (["Enter", " "].includes(e.key)) {
    e.preventDefault();
    if (isObject) {
      gardenSelection = el.dataset.gardenObject;
      refreshGarden();
    } else if (editing) selectTable(el.dataset.table);
    else openTable(el.dataset.table);
    return;
  }
  if (
    !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) ||
    (isObject ? route !== "garden" : !editing)
  )
    return;
  e.preventDefault();
  const item = isObject
    ? gardenDraft.elements.find((x) => x.id === el.dataset.gardenObject)
    : state.tables.find((x) => x.id === el.dataset.table);
  const step = isObject ? (e.shiftKey ? 1 : 2) : TABLE_GRID;
  const position = (isObject ? clampPosition : snapTable)(
    item,
    item.x +
      (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
    item.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
    mapArea,
  );
  if (isObject) {
    Object.assign(item, position);
    gardenSelection = item.id;
    refreshGarden();
    saveGarden();
    $(`[data-garden-object="${CSS.escape(item.id)}"]`)?.focus();
  } else {
    selectedTable = item.id;
    await change({ type: "move", id: item.id, ...position }, { close: false });
    $(`[data-table="${CSS.escape(item.id)}"]`)?.focus();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (
    gardenDirty ||
    (dialog.open && formChanged(dialog.querySelector("form")))
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
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
async function syncExternal() {
  if (drag) {
    externalUpdatePending = true;
    return;
  }
  const latest = await load();
  if (latest.revision <= state.revision) return;
  state = latest;
  if (route === "garden" && gardenDraft) {
    if (gardenDirty) {
      if (JSON.stringify(latest.garden) !== gardenSaved)
        showGardenSaveError(
          "El jardín cambió en otra pestaña. Tu diseño sigue aquí.",
        );
    } else {
      gardenDraft = structuredClone(latest.garden);
      gardenDraft.custom = true;
      gardenBaseline = JSON.stringify(latest.garden.elements);
      gardenSaved = JSON.stringify(latest.garden);
      refreshGarden();
    }
    return;
  }
  render();
  if (dialog.open)
    toast("Hubo cambios en otra pestaña. Reabre la ficha antes de guardar.");
}
channel?.addEventListener("message", syncExternal);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && gardenDirty) saveGarden();
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
        const reg = await navigator.serviceWorker.register(
          new URL("../sw.js", import.meta.url),
        );
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
