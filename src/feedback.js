let audio,
  clickBuffer,
  lastTone = -Infinity,
  pointer = true;
let enabled = true;
try {
  enabled = localStorage.getItem("nupcial-soft-sounds") !== "off";
} catch {}
export const soundEnabled = () => enabled;
export function setSoundEnabled(value) {
  enabled = !!value;
  try {
    localStorage.setItem("nupcial-soft-sounds", enabled ? "on" : "off");
  } catch {}
  if (enabled) {
    unlock();
    tone("select");
  }
}
function unlock() {
  if (!enabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audio ??= new Audio();
    if (audio.state === "suspended") audio.resume().catch(() => {});
  } catch {}
}
document.addEventListener(
  "pointerdown",
  () => {
    pointer = true;
    unlock();
  },
  { capture: true },
);
document.addEventListener(
  "keydown",
  () => {
    pointer = false;
    unlock();
  },
  { capture: true },
);
export function tone(kind = "success") {
  if (
    !enabled ||
    !audio ||
    audio.state !== "running" ||
    document.hidden ||
    performance.now() - lastTone < 90
  )
    return;
  lastTone = performance.now();
  try {
    // A dry mechanical click: one short, filtered noise transient. No delay or reverb.
    if (!clickBuffer) {
      clickBuffer = audio.createBuffer(
        1,
        Math.ceil(audio.sampleRate * 0.028),
        audio.sampleRate,
      );
      const data = clickBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = audio.createBufferSource(),
      filter = audio.createBiquadFilter(),
      gain = audio.createGain();
    const at = audio.currentTime;
    source.buffer = clickBuffer;
    filter.type = "bandpass";
    filter.frequency.value =
      kind === "error" ? 850 : kind === "success" ? 1550 : 1300;
    filter.Q.value = 0.65;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.36, at + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.026);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    source.start(at);
    source.stop(at + 0.028);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  } catch {}
}
export const mayAnimate = () =>
  pointer &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches &&
  !document.hidden;
export function enter(element) {
  if (!element) return;
  element.getAnimations().forEach((a) => a.cancel());
  if (!mayAnimate() || !element.animate) return;
  element.animate(
    [
      { opacity: 0.2, transform: "translateY(22%)" },
      { opacity: 1, transform: "translateY(0%)" },
    ],
    { duration: 260, easing: "cubic-bezier(.32,.72,0,1)" },
  );
}
const closing = new WeakMap();
export async function leave(element) {
  if (!element?.open) return;
  if (closing.has(element)) return closing.get(element);
  const work = (async () => {
    element.getAnimations().forEach((a) => a.cancel());
    if (mayAnimate() && element.animate) {
      const animation = element.animate(
        [
          { opacity: 1, transform: "translateY(0%)" },
          { opacity: 0, transform: "translateY(22%)" },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(.23,1,.32,1)",
          fill: "forwards",
        },
      );
      try {
        await animation.finished;
      } catch {}
      element.close();
      animation.cancel();
    } else element.close();
  })();
  closing.set(element, work);
  try {
    await work;
  } finally {
    closing.delete(element);
  }
}
const confirmationTimers = new WeakMap();
export function confirmVisual(element) {
  if (!element) return;
  clearTimeout(confirmationTimers.get(element));
  element.classList.add("is-confirmed");
  confirmationTimers.set(
    element,
    setTimeout(() => element.classList.remove("is-confirmed"), 650),
  );
}
export function progressFeedback(before, root) {
  if (!mayAnimate()) return;
  for (const bar of root.querySelectorAll("[role=progressbar]")) {
    const previous = before.get(bar.getAttribute("aria-label")),
      next = Number(bar.getAttribute("aria-valuenow"));
    if (previous === undefined || previous === next) continue;
    confirmVisual(bar.closest(".section-summary, .card"));
    if (next)
      bar.firstElementChild?.animate(
        [
          { transform: `scaleX(${previous / next})` },
          { transform: "scaleX(1)" },
        ],
        { duration: 260, easing: "cubic-bezier(.23,1,.32,1)" },
      );
  }
}
// Capture before navigation or form handlers replace the clicked control.
document.addEventListener(
  "click",
  (event) => {
    const control = event.target.closest("button, a[href], .choice");
    if (
      !control ||
      control.matches(":disabled") ||
      control.querySelector("input:disabled")
    )
      return;
    tone("select");
    if (!mayAnimate() || !control.animate || control.closest("svg")) return;
    control
      .getAnimations()
      .filter((a) => a.id === "press-feedback")
      .forEach((a) => a.cancel());
    const animation = control.animate(
      [{ transform: "scale(.94)" }, { transform: "scale(1)" }],
      { duration: 160, easing: "cubic-bezier(.23,1,.32,1)" },
    );
    animation.id = "press-feedback";
  },
  { capture: true },
);
