import { CLOUD_CONFIG } from "./cloud-config.js";
import { adminAlias, adminUsername } from "./access-model.js";
import { equal } from "./sync-model.js";
import {
  openCloud,
  selectCloud,
  selectLocal,
  readSync,
  acceptCloud,
  resolveSync,
  markSyncBlocked,
} from "./storage.js";

const SESSION = "nupcial-cloud-session",
  CONTEXT = "nupcial-cloud-context",
  SETTINGS = "nupcial-cloud-settings";
const ACCESS = "nupcial-team-access";
let accessCode = localStorage.getItem(ACCESS) || "",
  selectingIdentity = false,
  directory = null,
  directoryWork = null,
  directoryError = "";
const incoming = new URL(location.href);
if (incoming.searchParams.has("access")) {
  accessCode = incoming.searchParams.get("access");
  localStorage.setItem(ACCESS, accessCode);
  incoming.searchParams.delete("access");
  incoming.hash = "team";
  history.replaceState(null, "", incoming);
}
const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
let config = CLOUD_CONFIG.url ? CLOUD_CONFIG : read(SETTINGS) || CLOUD_CONFIG;
let session = read(SESSION),
  active = null,
  timer,
  work = null,
  refreshing = null,
  managementLoading = false;
let status = "Solo en este teléfono",
  metadata = null,
  loginNeeded = false;
let members = [],
  invitations = [],
  events = [],
  invitationLink = "";
const notify = () => window.dispatchEvent(new Event("nupcial:sync-status"));
const changed = () => window.dispatchEvent(new Event("nupcial:remote-change"));
function setStatus(value) {
  status = value;
  notify();
}
const persistSession = (value) => {
  session = value;
  if (value) localStorage.setItem(SESSION, JSON.stringify(value));
  else localStorage.removeItem(SESSION);
  loginNeeded = false;
};
const clockSession = (value) => ({
  ...value,
  expires_at:
    value.expires_at ||
    Math.floor(Date.now() / 1000) + (value.expires_in || 3600),
});
async function request(url, options = {}) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new Error(
      "No hay conexión con el evento. Tus cambios siguen en este teléfono.",
    );
  }
}
async function auth(path, body) {
  const response = await request(`${config.url}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: config.publicKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      path.includes("refresh_token")
        ? "Tu sesión necesita renovarse. Vuelve a entrar."
        : body?.email
          ? "No pudimos entrar. Revisa tu usuario y contraseña."
          : "No se pudo abrir el acceso sin registro. Pide a la organización que revise la conexión del equipo.",
    );
  return data;
}
async function accessToken() {
  if (!session?.access_token) {
    loginNeeded = true;
    throw new Error("Inicia sesión para sincronizar.");
  }
  if (session.expires_at * 1000 > Date.now() + 60000)
    return session.access_token;
  if (!refreshing)
    refreshing = (async () => {
      const refresh = async () => {
        const latest = read(SESSION);
        if (latest?.expires_at * 1000 > Date.now() + 60000) {
          session = latest;
          return;
        }
        try {
          persistSession(
            clockSession(
              await auth("token?grant_type=refresh_token", {
                refresh_token: latest?.refresh_token || session.refresh_token,
              }),
            ),
          );
        } catch (e) {
          loginNeeded = true;
          notify();
          throw e;
        }
      };
      if (navigator.locks)
        await navigator.locks.request("nupcial-cloud-auth", refresh);
      else await refresh();
    })().finally(() => {
      refreshing = null;
    });
  await refreshing;
  return session.access_token;
}
async function invoke(body, suppliedToken = null) {
  const token = suppliedToken || (await accessToken());
  const response = await request(`${config.url}/functions/v1/nupcial`, {
    method: "POST",
    headers: {
      apikey: config.publicKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const e = new Error(data.error || "No se pudo conectar con el evento.");
    e.status = response.status;
    e.conflicts = data.conflicts;
    if (e.status === 401 && !suppliedToken) loginNeeded = true;
    throw e;
  }
  return data;
}
async function activate(snapshot) {
  if (
    active &&
    (active.eventId !== snapshot.eventId ||
      active.userId !== session.user.id) &&
    (await readSync())?.queue.length &&
    !metadata?.blocked
  )
    throw new Error(
      "Sincroniza los cambios pendientes antes de cambiar de evento.",
    );
  await openCloud(snapshot, session.user.id);
  active = { eventId: snapshot.eventId, userId: session.user.id };
  localStorage.setItem(CONTEXT, JSON.stringify(active));
  localStorage.setItem("nupcial-shared-enabled", "true");
  metadata = await readSync();
  members = [];
  invitations = [];
  invitationLink =
    localStorage.getItem(`nupcial-share:${active.eventId}`) || "";
  selectingIdentity = false;
  setStatus("Sincronizado");
  changed();
  start();
}
function start() {
  clearInterval(timer);
  if (active || accessCode)
    timer = setInterval(() => {
      if (!document.hidden) {
        if (active && !selectingIdentity && !metadata?.blocked) sync();
        else if (accessCode) cloud.loadDirectory().catch(() => {});
      }
    }, 3000);
}
export async function sync() {
  if (work) return work;
  if (!active) return;
  if (!session || session.user.id !== active.userId) {
    loginNeeded = true;
    setStatus("El usuario cambió en otra ventana. Elige quién eres de nuevo.");
    window.dispatchEvent(new Event("nupcial:access-change"));
    return;
  }
  work = (async () => {
    if (!navigator.onLine) {
      metadata = await readSync();
      setStatus(
        metadata.queue.length
          ? `${metadata.queue.length} cambios pendientes · sin conexión`
          : "Sin conexión · copia guardada",
      );
      return;
    }
    try {
      metadata = await readSync();
      if (metadata.conflicts?.length) {
        await acceptCloud(
          await invoke({ action: "pull", eventId: active.eventId }),
        );
        metadata = await readSync();
        if (metadata.conflicts?.length) {
          setStatus("Hay cambios por revisar");
          return;
        }
      }
      if (metadata.queue.length) setStatus("Sincronizando…");
      for (let count = 0; count < 20; count++) {
        metadata = await readSync();
        const batch = metadata.queue[0];
        if (!batch) break;
        const result = await invoke({
          action: "patch",
          eventId: active.eventId,
          actingPerson: metadata.member.personId,
          ...batch,
        });
        const accepted = await acceptCloud(result, result.acknowledged);
        metadata = await readSync();
        if (accepted.changed) changed();
        if (accepted.conflict) break;
      }
      metadata = await readSync();
      const token = await accessToken();
      const response = await request(
        `${config.url}/rest/v1/nupcial_signals?event_id=eq.${active.eventId}&select=revision`,
        {
          headers: {
            apikey: config.publicKey,
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        const e = new Error(
          "Vuelve a iniciar sesión para sincronizar. Tus cambios siguen guardados.",
        );
        e.status = response.status;
        throw e;
      }
      const signals = await response.json();
      if (
        !signals.length ||
        signals[0].revision !== metadata.revision ||
        metadata.blocked
      ) {
        const accepted = await acceptCloud(
          await invoke({ action: "pull", eventId: active.eventId }),
        );
        metadata = await readSync();
        if (accepted.changed) changed();
      }
      metadata = await readSync();
      setStatus(
        metadata.conflicts?.length
          ? "Hay cambios por revisar"
          : metadata.queue.length
            ? `${metadata.queue.length} cambios pendientes`
            : "Sincronizado",
      );
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        try {
          await acceptCloud(
            await invoke({ action: "pull", eventId: active.eventId }),
          );
          metadata = await readSync();
          changed();
        } catch {}
        setStatus("Hay cambios por revisar");
      } else if (e.status === 403) {
        await markSyncBlocked(true);
        metadata = await readSync();
        setStatus("Acceso retirado · contacta a la organización");
        window.dispatchEvent(new Event("nupcial:access-change"));
        if (accessCode) cloud.loadDirectory().catch(() => {});
      } else {
        if (e.status === 401) loginNeeded = true;
        setStatus(e.message);
      }
    }
  })().finally(() => {
    work = null;
  });
  return work;
}
export const cloud = {
  get configured() {
    return !!(config.url && config.publicKey);
  },
  get signedIn() {
    return !!session?.access_token && !loginNeeded;
  },
  get recoveryAvailable() {
    return config.emailRecoveryEnabled === true;
  },
  get needsPasswordChange() {
    return sessionStorage.getItem("nupcial-password-recovery") === "true";
  },
  get connected() {
    return !!active;
  },
  get member() {
    return metadata?.member;
  },
  get limited() {
    return !!active && metadata?.member?.role === "member";
  },
  get needsEvent() {
    return (
      this.configured &&
      (!active || !this.signedIn || selectingIdentity || !!metadata?.blocked)
    );
  },
  get hasAccessLink() {
    return !!accessCode;
  },
  get choosingPerson() {
    return (
      !!accessCode &&
      this.needsEvent &&
      (!session || session.user.is_anonymous || this.limited)
    );
  },
  get anonymous() {
    return !!session?.user?.is_anonymous;
  },
  get adminName() {
    return session?.user?.user_metadata?.username || "";
  },
  get canSetAdminName() {
    return !!session && !session.user.is_anonymous && !this.limited;
  },
  get canShareLocal() {
    const owner = localStorage.getItem("nupcial-local-owner");
    return !owner || owner === session?.user?.id;
  },
  async refreshMetadata() {
    if (active) metadata = await readSync();
  },
  get mine() {
    return (
      this.limited &&
      localStorage.getItem(
        `nupcial-view:${active.eventId}:${active.userId}`,
      ) !== "all"
    );
  },
  setView(value) {
    if (active)
      localStorage.setItem(
        `nupcial-view:${active.eventId}:${active.userId}`,
        value,
      );
    notify();
  },
  attribution(collection, recordId) {
    let result = metadata?.attributions?.find(
      (row) => row.collection === collection && row.recordId === recordId,
    );
    for (const batch of metadata?.queue || [])
      for (const c of batch.changes)
        if (c.collection === collection && c.id === recordId)
          result = {
            collection,
            recordId,
            actorRole: metadata.member.role,
            actorName:
              metadata.remote?.people.find(
                (p) => p.id === metadata.member.personId,
              )?.name || metadata.member.displayName,
            action: c.before ? "edited" : "created",
          };
    return result;
  },
  get state() {
    return {
      status,
      metadata,
      members,
      invitations,
      events,
      invitationLink,
      email: session?.user?.email || "",
      displayName: this.limited
        ? metadata.member.displayName
        : this.adminName || "Administración",
      directory,
      directoryError,
      loginNeeded,
    };
  },
  async restore() {
    const callback = new URLSearchParams(location.hash.slice(1));
    if (callback.has("access_token")) {
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}#team`,
      );
      try {
        const response = await request(`${config.url}/auth/v1/user`, {
          headers: {
            apikey: config.publicKey,
            Authorization: `Bearer ${callback.get("access_token")}`,
          },
        });
        if (response.ok) {
          persistSession(
            clockSession({
              access_token: callback.get("access_token"),
              refresh_token: callback.get("refresh_token"),
              expires_in: Number(callback.get("expires_in")) || 3600,
              user: await response.json(),
            }),
          );
          if (callback.get("type") === "recovery")
            sessionStorage.setItem("nupcial-password-recovery", "true");
        }
      } catch {
        setStatus(
          "No se pudo comprobar el enlace. Entra con tu correo y contraseña.",
        );
      }
    }
    const context = read(CONTEXT);
    if (
      context &&
      session?.user?.id === context.userId &&
      (await selectCloud(context))
    ) {
      active = context;
      metadata = await readSync();
      setStatus(
        navigator.onLine ? "Conectando…" : "Sin conexión · copia guardada",
      );
      start();
      queueMicrotask(sync);
    } else if (session?.access_token && navigator.onLine)
      queueMicrotask(() =>
        invoke({ action: "events" })
          .then((data) => {
            events = data.events;
            notify();
          })
          .catch(() => {}),
      );
    if (accessCode) {
      start();
      if (this.choosingPerson)
        queueMicrotask(() => this.loadDirectory().catch(() => {}));
    }
  },
  configure(url, publicKey) {
    url = url.trim().replace(/\/$/, "");
    publicKey = publicKey.trim();
    const target = new URL(url);
    if (
      target.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(target.hostname)
    )
      throw new Error("Usa la dirección HTTPS del proyecto.");
    let secret = publicKey.startsWith("sb_secret_");
    if (publicKey.startsWith("eyJ")) {
      try {
        secret ||=
          JSON.parse(
            atob(publicKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
          ).role !== "anon";
      } catch {
        secret = true;
      }
    }
    if (
      secret ||
      !(publicKey.startsWith("sb_publishable_") || publicKey.startsWith("eyJ"))
    )
      throw new Error(
        "Usa únicamente la clave pública publishable o anon. Nunca la clave secret o service_role.",
      );
    if (active) throw new Error("Sal del evento antes de cambiar la conexión.");
    config = { url, publicKey };
    localStorage.setItem(SETTINGS, JSON.stringify(config));
    notify();
  },
  async login(username, password, signup = false, legacy = false) {
    if (password.length < 8)
      throw new Error("Usa una contraseña de al menos 8 caracteres.");
    const data = await auth(signup ? "signup" : "token?grant_type=password", {
      email: legacy ? username.trim() : adminAlias(username),
      password,
      ...(signup ? { data: { username: adminUsername(username) } } : {}),
    });
    if (!data.access_token) return { confirmation: true };
    if (
      active &&
      data.user.id !== active.userId &&
      (await readSync())?.queue.length
    )
      throw new Error(
        "Hay cambios pendientes de la cuenta anterior. Sincronízalos antes de cambiar de cuenta.",
      );
    persistSession(clockSession(data));
    if (active && active.userId === data.user.id) {
      await sync();
      return {};
    }
    if (active) {
      selectLocal();
      active = null;
      localStorage.removeItem(CONTEXT);
    }
    events = (await invoke({ action: "events" })).events;
    if (events.length === 1 && !accessCode) await this.open(events[0].eventId);
    notify();
    return {};
  },
  async setAdminName(username) {
    const data = await invoke({
      action: "admin-username",
      username: adminUsername(username),
    });
    persistSession({ ...session, user: data.user });
    notify();
  },
  async loadDirectory() {
    if (directoryWork) return directoryWork;
    directoryWork = (async () => {
      try {
        const response = await request(`${config.url}/functions/v1/nupcial`, {
          method: "POST",
          headers: {
            apikey: config.publicKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "directory", code: accessCode }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error || "No se pudo abrir el enlace del equipo.",
          );
        const updated = !equal(directory, data) || !!directoryError;
        directory = data;
        directoryError = "";
        if (updated) window.dispatchEvent(new Event("nupcial:access-change"));
      } catch (e) {
        directoryError = e.message;
        window.dispatchEvent(new Event("nupcial:access-change"));
        throw e;
      }
    })().finally(() => {
      directoryWork = null;
    });
    return directoryWork;
  },
  async choosePerson(personId) {
    if (!navigator.onLine)
      throw new Error("Conéctate para elegir tu usuario por primera vez.");
    if (work) await work;
    if (active && !metadata?.blocked) {
      await sync();
      if ((await readSync()).queue.length)
        throw new Error(
          "Primero sincroniza tus cambios pendientes antes de cambiar de usuario.",
        );
    }
    if (
      active &&
      !metadata?.blocked &&
      this.signedIn &&
      metadata.member.personId === personId
    ) {
      await activate(
        await invoke({ action: "select-person", code: accessCode, personId }),
      );
      this.setView("mine");
      return;
    }
    const fresh = await auth("signup", { data: {} });
    if (!fresh.access_token || !fresh.user?.is_anonymous)
      throw new Error(
        "La organización debe activar el acceso sin registro del equipo.",
      );
    const snapshot = await invoke(
      { action: "select-person", code: accessCode, personId },
      fresh.access_token,
    );
    if (active && !metadata?.blocked && (await readSync()).queue.length)
      throw new Error(
        "Se guardaron cambios en otra ventana. Sincronízalos antes de cambiar de usuario.",
      );
    persistSession(clockSession(fresh));
    await activate(snapshot);
    this.setView("mine");
  },
  async changePerson() {
    if (work) await work;
    if (active && !metadata?.blocked) {
      await sync();
      if ((await readSync()).queue.length)
        throw new Error(
          "Hay cambios pendientes. Sincronízalos antes de elegir otro usuario.",
        );
    }
    selectingIdentity = true;
    window.dispatchEvent(new Event("nupcial:access-change"));
    await this.loadDirectory();
  },
  async share() {
    await sync();
    if ((await readSync()).queue.length)
      throw new Error(
        "Espera a que se guarden tus responsables antes de compartir el enlace.",
      );
    const data = await invoke({
      action: "share-link",
      eventId: active.eventId,
    });
    const link = new URL(location.pathname, location.origin);
    link.searchParams.set("access", data.code);
    link.hash = "team";
    invitationLink = link.href;
    localStorage.setItem(`nupcial-share:${active.eventId}`, invitationLink);
    accessCode = data.code;
    localStorage.setItem(ACCESS, accessCode);
    notify();
  },
  async recoverPassword(email) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Escribe tu correo para recuperar el acceso.");
    const redirect = new URL(location.pathname, location.origin);
    redirect.hash = "team";
    await auth(`recover?redirect_to=${encodeURIComponent(redirect.href)}`, {
      email: email.trim(),
    });
    return "Si el correo está registrado, recibirás un enlace para cambiar tu contraseña.";
  },
  async updatePassword(password) {
    if (password.length < 8)
      throw new Error("Usa una contraseña de al menos 8 caracteres.");
    const token = await accessToken();
    const response = await request(`${config.url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: config.publicKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    if (!response.ok)
      throw new Error(
        "No se pudo cambiar la contraseña. Solicita un nuevo enlace e inténtalo otra vez.",
      );
    sessionStorage.removeItem("nupcial-password-recovery");
    return "Contraseña actualizada.";
  },
  async create(state) {
    if (!this.canShareLocal)
      throw new Error(
        "Entra con la cuenta que conserva la copia local para compartirla.",
      );
    const snapshot = await invoke({ action: "create", state });
    localStorage.setItem("nupcial-local-owner", session.user.id);
    await activate(snapshot);
  },
  async join(code) {
    await activate(await invoke({ action: "join", code: code.trim() }));
  },
  async open(eventId) {
    await activate(await invoke({ action: "pull", eventId }));
  },
  async loadEvents() {
    events = (await invoke({ action: "events" })).events;
  },
  async management() {
    if (!active || this.limited || managementLoading) return;
    managementLoading = true;
    try {
      const data = await invoke({ action: "members", eventId: active.eventId });
      members = data.members;
      invitations = data.invitations;
      notify();
    } finally {
      managementLoading = false;
    }
  },
  async invite(personId, role) {
    await sync();
    if ((await readSync()).queue.length)
      throw new Error(
        "Espera a que terminen de sincronizarse los cambios antes de invitar.",
      );
    const data = await invoke({
      action: "invite",
      eventId: active.eventId,
      personId,
      role,
    });
    const link = new URL(location.pathname, location.origin);
    link.searchParams.set("invite", data.code);
    link.hash = "team";
    invitationLink = link.href;
    await this.management();
  },
  async revoke(userId) {
    await invoke({ action: "revoke", eventId: active.eventId, userId });
    await this.management();
  },
  async cancelInvitation(invitationId) {
    await invoke({
      action: "cancel-invite",
      eventId: active.eventId,
      invitationId,
    });
    await this.management();
  },
  async resolve(keepMine) {
    // Always compare against a fresh server snapshot before an explicit conflict resolution.
    await acceptCloud(
      await invoke({ action: "pull", eventId: active.eventId }),
    );
    await resolveSync(keepMine);
    metadata = await readSync();
    changed();
    await sync();
  },
  async logout() {
    if (work) await work;
    if (active && (await readSync())?.queue.length)
      throw new Error(
        "Hay cambios pendientes. Sincronízalos o revisa el conflicto antes de salir.",
      );
    // Local logout only: other phones retain their own sessions.
    persistSession(null);
    active = null;
    metadata = null;
    events = [];
    members = [];
    invitations = [];
    invitationLink = "";
    sessionStorage.removeItem("nupcial-password-recovery");
    clearInterval(timer);
    localStorage.removeItem(CONTEXT);
    selectLocal();
    setStatus("Solo en este teléfono");
    selectingIdentity = false;
    changed();
    if (accessCode) {
      start();
      this.loadDirectory().catch(() => {});
    }
  },
  async pendingBackup() {
    return JSON.stringify(
      { eventId: active?.eventId, pending: (await readSync())?.queue || [] },
      null,
      2,
    );
  },
};
window.addEventListener("nupcial:local-change", () => {
  if (active)
    readSync().then((value) => {
      metadata = value;
      changed();
      sync();
    });
});
window.addEventListener("online", sync);
window.addEventListener("offline", sync);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) sync();
});
window.addEventListener("storage", (event) => {
  if (event.key === SESSION) {
    session = read(SESSION);
    if (!session && active) {
      loginNeeded = true;
      setStatus("Inicia sesión para sincronizar.");
    }
    if (active && session?.user?.id !== active.userId) {
      loginNeeded = true;
      clearInterval(timer);
      window.dispatchEvent(new Event("nupcial:access-change"));
    }
  }
});
