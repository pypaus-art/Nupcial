import { cloud, sync } from "./cloud.js";
import { icon } from "./icons.js";
import { normalize } from "./domain.js";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const field = (label, name, type = "text", extra = "") =>
  `<label class="field"><span>${label}</span><input name="${name}" type="${type}" required ${extra}></label>`;
const action = (key, label, style = "secondary", extra = "") =>
  `<button type="button" class="${style}" data-team-action="${key}" ${extra}>${label}</button>`;
const panel = (html) => `<section class="team-panel">${html}</section>`;
let inviteCode = sessionStorage.getItem("nupcial-invitation") || "";
const url = new URL(location.href);
if (url.searchParams.has("invite")) {
  inviteCode = url.searchParams.get("invite");
  sessionStorage.setItem("nupcial-invitation", inviteCode);
  url.searchParams.delete("invite");
  url.hash = "team";
  history.replaceState(null, "", url);
}
let adminOpen = false,
  profileFilter = "";
function profileButtons() {
  const rows = (cloud.state.directory?.people || []).filter((person) =>
    normalize(person.name).includes(normalize(profileFilter)),
  );
  return (
    rows
      .map(
        (person) =>
          `<button class="profile-choice" data-team-action="select-person" data-person="${esc(person.id)}"><span class="avatar" aria-hidden="true">${esc([...person.name.trim()][0])}</span><span><strong>${esc(person.name)}</strong>${person.role ? `<small>${esc(person.role)}</small>` : ""}</span>${icon("chevron", "chevron")}</button>`,
      )
      .join("") ||
    `<p class="muted">${profileFilter ? "No encontramos ese nombre." : "La organización aún no agregó responsables."}</p>`
  );
}
function adminForm() {
  return panel(
    `<h2>Administración</h2><form data-team-form="login">${field("Usuario", "username", "text", 'autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32"')}${field("Contraseña", "password", "password", 'autocomplete="current-password" minlength="8"')}<div class="inline-actions"><button type="submit" class="primary">Entrar</button><button type="submit" class="secondary" name="signup" value="yes">Crear administración</button></div></form><details><summary>Ya tenía una cuenta con correo</summary><p class="small muted">Entra una vez para conservar tu evento y elegir tu nuevo usuario.</p><form data-team-form="legacy-login">${field("Cuenta anterior", "email", "email", 'autocomplete="username"')}${field("Contraseña anterior", "password", "password", 'autocomplete="current-password" minlength="8"')}<button type="submit" class="secondary">Conservar mi cuenta anterior</button></form></details>`,
  );
}
function usernameForm() {
  return panel(
    `<h2>Tu usuario de administración</h2><form data-team-form="admin-name">${field("Nombre de usuario", "username", "text", `autocomplete="username" autocapitalize="none" maxlength="32" value="${esc(cloud.adminName)}"`)}<p class="small muted">Conservas tu contraseña y todos tus datos.</p><button class="primary" type="submit">Guardar usuario</button></form>`,
  );
}
export function teamPage(state) {
  const data = cloud.state,
    meta = data.metadata;
  const picking = cloud.choosingPerson && !adminOpen;
  let html = `<div class="page-head"><h1>${picking ? "¿Quién eres?" : "Equipo"}</h1></div><p id="team-message" class="team-message" role="status"></p>`;
  if (!cloud.configured)
    return (
      html +
      panel(
        `<h2>Conectar el evento</h2><p>El servicio compartido todavía no está configurado.</p><details><summary>Configurar conexión</summary><form data-team-form="configure">${field("URL del proyecto", "url", "url")}${field("Clave pública", "publicKey")}<button class="primary" type="submit">Conectar</button></form></details>`,
      )
    );
  if (cloud.needsPasswordChange && cloud.signedIn && !cloud.anonymous)
    return (
      html +
      panel(
        `<h2>Tu nueva contraseña</h2><form data-team-form="password">${field("Nueva contraseña", "password", "password", 'minlength="8" autocomplete="new-password"')}<button class="primary" type="submit">Guardar contraseña</button></form>`,
      )
    );
  if (picking) {
    html += panel(
      `<div class="section-head"><h2>${esc(data.directory?.name || "Elige tu nombre")}</h2>${action("refresh-directory", "Actualizar lista")}</div>${data.directoryError ? `<p class="team-message">${esc(data.directoryError)}</p>` : ""}${(data.directory?.people.length || 0) > 8 ? `<label class="search">${icon("search")}<input id="profile-search" type="search" placeholder="Buscar mi nombre" aria-label="Buscar mi nombre" value="${esc(profileFilter)}"></label>` : ""}<div class="profile-grid" id="profile-list">${data.directory ? profileButtons() : `<p class="muted">${data.directoryError ? "Pide el enlace del equipo a la organización." : "Cargando responsables…"}</p>`}</div>`,
    );
    if (meta?.queue.length)
      html += panel(
        `<p>Tus cambios pendientes del usuario anterior siguen guardados en este teléfono.</p>${action("pending-backup", "Guardar copia de mis cambios")}`,
      );
    return html + action("show-admin", "Administración", "text-button");
  }
  if (!cloud.signedIn || (adminOpen && cloud.limited))
    return (
      html +
      adminForm() +
      (cloud.hasAccessLink
        ? action("show-picker", "Elegir responsable", "text-button")
        : panel(
            `<p class="muted">¿Eres responsable? Abre el enlace que te envió la organización para elegir tu nombre.</p>`,
          ))
    );
  if (!cloud.connected) {
    if (cloud.canSetAdminName && !cloud.adminName) html += usernameForm();
    html += panel(
      `<h2>Mis eventos</h2>${data.events.map((event) => action("open", esc(event.name), "menu-row", `data-event="${esc(event.eventId)}"`)).join("")}${action("refresh-events", "Buscar mis eventos")}`,
    );
    if (!cloud.anonymous && cloud.canShareLocal && !data.events.length)
      html += panel(
        `<h2>Compartir este evento</h2><p>${esc(state.event.name)} · ${state.guests.length} invitados · ${state.tasks.length} tareas</p><p class="small muted">La copia local se conserva.</p>${action("create", "Crear evento compartido", "primary")}`,
      );
    return html + action("logout", "Salir de administración");
  }
  html += panel(
    `<div class="team-status-line">${icon("users")}<div><strong>${esc(state.event.name)}</strong><p class="row-meta" data-sync-status>${esc(data.status)}</p></div>${action("sync", "Sincronizar")}</div><p class="small muted">${esc(data.displayName)} · ${cloud.limited ? "Responsable" : "Administración"}</p>`,
  );
  if (meta?.conflicts?.length)
    html += panel(
      `<h2>Revisar cambios</h2><p>También editaron estos datos desde otro teléfono. Tu edición sigue guardada.</p><ul>${meta.conflicts.map((item) => `<li>${esc(item.title)}</li>`).join("")}</ul><details><summary>Ver mis cambios pendientes</summary>${pendingDetails(meta)}</details><div class="inline-actions">${action("keep-mine", "Conservar mis cambios", "primary")}${action("use-shared", "Usar cambios compartidos")}${action("pending-backup", "Guardar copia de mis cambios")}</div><p class="small muted">Guardamos una copia anterior a la revisión en este teléfono.</p>`,
    );
  if (cloud.limited) return html + action("change-person", "Cambiar usuario");
  if (!cloud.adminName) html += usernameForm();
  html += panel(
    `<h2>Acceso del equipo</h2><p class="small muted">Tus responsables eligen su nombre, sin correo ni contraseña. El directorio define quién puede entrar.</p>${data.invitationLink ? `<label class="field"><span>Enlace del equipo</span><input readonly aria-label="Enlace del equipo" value="${esc(data.invitationLink)}"></label>${action("copy-invite", "Copiar enlace", "primary")}` : action("share-link", "Crear enlace del equipo", "primary")}`,
  );
  html += panel(
    `<div class="section-head"><h2>${state.people.length} responsables</h2></div>${state.people.map((person) => `<div class="team-member"><div><strong>${esc(person.name)}</strong><p class="row-meta">${esc(person.role)}</p></div></div>`).join("") || `<p class="muted">Agrega a tus responsables para que aparezcan en el acceso.</p>`}<a class="secondary" href="#people">Responsables y contactos</a>`,
  );
  if (cloud.adminName)
    html += `<details class="team-account"><summary>Cambiar mi usuario de administración</summary>${usernameForm()}</details>`;
  return html + action("logout", "Salir de administración");
}
function pendingDetails(meta) {
  const names = {
    status: "Estado",
    notes: "Notas",
    title: "Título",
    name: "Nombre",
    description: "Descripción",
    capacity: "Lugares",
    personId: "Responsable",
    normal: "Normal",
    pending: "Pendiente",
    doing: "En curso",
    active: "En curso",
    done: "Terminado",
  };
  return meta.queue
    .flatMap((batch) => batch.changes)
    .map(
      (c) =>
        `<div class="team-pending"><strong>${esc(c.after?.title || c.after?.name || c.before?.title || c.before?.name || "Cambio")}</strong>${
          c.after
            ? Object.keys(c.after)
                .filter(
                  (k) =>
                    !["id"].includes(k) &&
                    JSON.stringify(c.before?.[k]) !==
                      JSON.stringify(c.after[k]),
                )
                .map(
                  (k) =>
                    `<p>${esc(names[k] || k)}: ${esc(typeof c.after[k] === "object" ? "Diseño actualizado" : names[c.after[k]] || c.after[k])}</p>`,
                )
                .join("")
            : "<p>Eliminar registro</p>"
        }</div>`,
    )
    .join("");
}
export async function teamSubmit(form, submitter, state) {
  const values = Object.fromEntries(new FormData(form));
  if (form.dataset.teamForm === "password")
    return await cloud.updatePassword(values.password);
  if (form.dataset.teamForm === "configure")
    cloud.configure(values.url, values.publicKey);
  else if (
    form.dataset.teamForm === "login" ||
    form.dataset.teamForm === "legacy-login"
  ) {
    const legacy = form.dataset.teamForm === "legacy-login";
    const result = await cloud.login(
      legacy ? values.email : values.username,
      values.password,
      submitter?.name === "signup",
      legacy,
    );
    adminOpen = false;
    if (result.confirmation)
      return "La organización debe habilitar la entrada con contraseña sin confirmación por correo.";
    if (cloud.connected && cloud.adminName) return { route: "home" };
  } else if (form.dataset.teamForm === "admin-name") {
    await cloud.setAdminName(values.username);
    return "Usuario guardado. Tu contraseña se conserva.";
  }
}
export async function teamAction(button, state) {
  const key = button.dataset.teamAction;
  if (key === "show-admin") {
    adminOpen = true;
    return;
  }
  if (key === "show-picker") {
    adminOpen = false;
    await cloud.loadDirectory();
    return;
  }
  if (key === "select-person") {
    await cloud.choosePerson(button.dataset.person);
    adminOpen = false;
    return { route: "home" };
  }
  if (key === "change-person") {
    adminOpen = false;
    await cloud.changePerson();
    return;
  }
  if (key === "refresh-directory") {
    await cloud.loadDirectory();
    return;
  }
  if (key === "share-link") await cloud.share();
  else if (key === "view-mine") cloud.setView("mine");
  else if (key === "view-all") cloud.setView("all");
  else if (key === "create") await cloud.create(state);
  else if (key === "open") {
    await cloud.open(button.dataset.event);
    return { route: cloud.adminName || cloud.limited ? "home" : "team" };
  } else if (key === "refresh-events") await cloud.loadEvents();
  else if (key === "sync") await sync();
  else if (key === "logout") {
    adminOpen = false;
    await cloud.logout();
  } else if (key === "keep-mine") await cloud.resolve(true);
  else if (key === "use-shared") await cloud.resolve(false);
  else if (key === "copy-invite") {
    await navigator.clipboard.writeText(cloud.state.invitationLink);
    return "Enlace copiado. Compártelo con tu equipo.";
  } else if (key === "pending-backup") {
    const url = URL.createObjectURL(
      new Blob([await cloud.pendingBackup()], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "nupcial-cambios-pendientes.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
document.addEventListener("input", (event) => {
  if (event.target.id !== "profile-search") return;
  profileFilter = event.target.value;
  const list = document.querySelector("#profile-list");
  if (list) list.innerHTML = profileButtons();
});
