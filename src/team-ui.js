import { cloud, sync } from "./cloud.js";
import { icon } from "./icons.js";
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
export function teamPage(state) {
  const data = cloud.state,
    meta = data.metadata;
  let html = `<div class="page-head"><h1>Equipo</h1></div><p id="team-message" class="team-message" role="status"></p>`;
  if (!cloud.configured)
    return (
      html +
      panel(
        `<h2>Conectar el evento</h2><p>El servicio compartido todavía no está configurado.</p><details><summary>Configurar conexión</summary><form data-team-form="configure">${field("URL del proyecto", "url", "url", 'autocomplete="url"')}${field("Clave pública · publishable o anon", "publicKey", "text", 'autocomplete="off" spellcheck="false"')}<button class="primary" type="submit">Conectar</button></form></details>`,
      )
    );
  if (cloud.needsPasswordChange)
    return (
      html +
      panel(
        `<h2>Tu nueva contraseña</h2><form data-team-form="password">${field("Nueva contraseña", "password", "password", 'minlength="8" autocomplete="new-password"')}<button type="submit" class="primary">Guardar contraseña</button></form>`,
      )
    );
  if (!cloud.signedIn)
    return (
      html +
      panel(
        `<h2>Entra a tu evento</h2><form data-team-form="login">${field("Correo", "email", "email", `autocomplete="username" value="${esc(data.email)}"`)}${field("Contraseña", "password", "password", 'autocomplete="current-password" minlength="8"')}<div class="inline-actions"><button type="submit" class="primary">Entrar</button><button type="submit" class="secondary" name="signup" value="yes">Crear cuenta</button></div>${cloud.recoveryAvailable ? `<button type="submit" class="text-button" name="recover" formnovalidate>Olvidé mi contraseña</button>` : ""}</form><p class="small muted">Cada responsable entra con su cuenta y la invitación de la organización.</p>`,
      )
    );
  if (!cloud.connected) {
    html += panel(
      `<h2>${inviteCode ? "Tu invitación" : "Tu evento compartido"}</h2><form data-team-form="join">${field("Código de invitación", "code", "text", `autocomplete="off" value="${esc(inviteCode)}"`)}<button class="primary" type="submit">Unirme al evento</button></form>`,
    );
    html += panel(
      `<h2>Mis eventos</h2>${data.events.map((event) => action("open", esc(event.name), "menu-row", `data-event="${esc(event.eventId)}"`)).join("")}${action("refresh-events", "Buscar mis eventos")}`,
    );
    if (cloud.canShareLocal && !inviteCode)
      html += panel(
        `<h2>Compartir este evento</h2><p>${esc(state.event.name)} · ${state.guests.length} invitados · ${state.tasks.length} tareas</p><p class="small muted">Publica tus datos actuales en un espacio privado para tu equipo. La copia local se conserva.</p>${action("create", "Crear evento compartido", "primary")}`,
      );
    return html + action("logout", "Salir de mi cuenta");
  }
  html += panel(
    `<div class="team-status-line">${icon("users")}<div><strong>${esc(state.event.name)}</strong><p class="row-meta" data-sync-status>${esc(data.status)}</p></div>${action("sync", "Sincronizar")}</div><p class="small muted">${esc(data.email)} · ${cloud.limited ? "Responsable" : "Organización"}</p>`,
  );
  if (meta?.conflicts?.length) {
    html += panel(
      `<h2>Revisar cambios</h2><p>También editaron estos datos desde otro teléfono. Tu edición sigue guardada.</p><ul>${meta.conflicts.map((item) => `<li>${esc(item.title)}</li>`).join("")}</ul><details><summary>Ver mis cambios pendientes</summary>${pendingDetails(meta)}</details><div class="inline-actions">${action("keep-mine", "Conservar mis cambios", "primary")}${action("use-shared", "Usar cambios compartidos")}${action("pending-backup", "Guardar copia de mis cambios")}</div><p class="small muted">La elección afecta a tus cambios pendientes. Guardamos una copia anterior a la revisión en este teléfono.</p>`,
    );
  }
  if (!cloud.limited) {
    html += panel(
      `<h2>Invitar al equipo</h2>${state.people.length ? `<form data-team-form="invite"><label class="field"><span>Responsable</span><select name="personId">${state.people.map((person) => `<option value="${esc(person.id)}">${esc(person.name)}</option>`).join("")}</select></label><p class="small muted">Puede colaborar en tareas e itinerario y consultar el evento. Sin acceso a dinero ni eliminación de registros.</p><button type="submit" class="primary">Crear invitación</button></form>` : `<p>Agrega primero a tus responsables al directorio.</p><a href="#people" class="secondary">Agregar responsables</a>`}${data.invitationLink ? `<div class="team-invitation"><label class="field"><span>Invitación personal · un uso · 7 días</span><input readonly aria-label="Enlace de invitación" value="${esc(data.invitationLink)}"></label>${action("copy-invite", "Copiar invitación", "primary")}</div>` : ""}`,
    );
    html += panel(
      `<div class="section-head"><h2>Personas con acceso</h2>${action("refresh-members", "Actualizar")}</div>${data.members.length ? data.members.map((member) => `<div class="team-member"><div><strong>${esc(state.people.find((p) => p.id === member.personId)?.name || member.displayName)}</strong><p class="row-meta">${esc(member.displayName)} · ${member.active ? (member.role === "member" ? "Responsable" : "Organización") : "Acceso retirado"}</p></div>${member.active && member.role !== "owner" && member.userId !== cloud.member.userId ? action("revoke", "Retirar acceso", "secondary", `data-user="${esc(member.userId)}"`) : ""}</div>`).join("") : "<p class='muted'>Pulsa Actualizar para consultar el equipo.</p>"}${data.invitations
        .filter(
          (i) =>
            !i.used_by && !i.cancelled && Date.parse(i.expires_at) > Date.now(),
        )
        .map(
          (i) =>
            `<div class="team-member"><span>Invitación pendiente · ${esc(state.people.find((p) => p.id === i.person_id)?.name || "Organización")}</span>${action("cancel-invite", "Cancelar", "secondary", `data-invitation="${esc(i.id)}"`)}</div>`,
        )
        .join("")}`,
    );
  }
  return html + action("logout", "Salir de mi cuenta");
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
  if (submitter?.name === "recover")
    return await cloud.recoverPassword(values.email);
  if (form.dataset.teamForm === "password")
    return await cloud.updatePassword(values.password);
  if (form.dataset.teamForm === "configure")
    cloud.configure(values.url, values.publicKey);
  else if (form.dataset.teamForm === "login") {
    const result = await cloud.login(
      values.email,
      values.password,
      submitter?.name === "signup",
    );
    if (result.confirmation)
      return "Revisa tu correo para confirmar la cuenta y después entra con tu contraseña.";
  } else if (form.dataset.teamForm === "join") {
    await cloud.join(values.code);
    sessionStorage.removeItem("nupcial-invitation");
    inviteCode = "";
  } else if (form.dataset.teamForm === "invite")
    await cloud.invite(values.personId, "member");
}
export async function teamAction(button, state) {
  const action = button.dataset.teamAction;
  if (action === "view-mine") cloud.setView("mine");
  else if (action === "view-all") cloud.setView("all");
  else if (action === "create") await cloud.create(state);
  else if (action === "open") await cloud.open(button.dataset.event);
  else if (action === "refresh-events") await cloud.loadEvents();
  else if (action === "sync") await sync();
  else if (action === "logout") await cloud.logout();
  else if (action === "refresh-members") await cloud.management();
  else if (action === "revoke") await cloud.revoke(button.dataset.user);
  else if (action === "cancel-invite")
    await cloud.cancelInvitation(button.dataset.invitation);
  else if (action === "keep-mine") await cloud.resolve(true);
  else if (action === "use-shared") await cloud.resolve(false);
  else if (action === "copy-invite") {
    await navigator.clipboard.writeText(cloud.state.invitationLink);
    return "Invitación copiada. Compártela solo con esa persona.";
  } else if (action === "pending-backup") {
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
