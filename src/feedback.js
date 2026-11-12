let audio,
  lastTone = 0,
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
    performance.now() - lastTone < 100
  )
    return;
  lastTone = performance.now();
  try {
    const start = audio.currentTime;
    const notes =
      kind === "success" ? [520, 660] : kind === "error" ? [240] : [440];
    notes.forEach((frequency, i) => {
      const at = start + i * 0.055,
        osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.018, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.065);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.07);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  } catch {}
}
export const mayAnimate = () =>
  pointer &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches &&
  !document.hidden;
export function enter(element) {
  if (!element || !mayAnimate() || !element.animate) return;
  element.getAnimations().forEach((a) => a.cancel());
  element.animate(
    [
      { opacity: 0.5, transform: "translateY(7px)" },
      { opacity: 1, transform: "translateY(0px)" },
    ],
    { duration: 180, easing: "cubic-bezier(.23,1,.32,1)" },
  );
}
export function confirmVisual(element) {
  if (!element || !mayAnimate() || !element.animate) return;
  element.animate([{ opacity: 0.55 }, { opacity: 1 }], {
    duration: 160,
    easing: "cubic-bezier(.23,1,.32,1)",
  });
}
export function progressFeedback(before, root) {
  if (!mayAnimate()) return;
  for (const bar of root.querySelectorAll("[role=progressbar]")) {
    const previous = before.get(bar.getAttribute("aria-label")),
      next = Number(bar.getAttribute("aria-valuenow"));
    if (previous === undefined || previous === next || !next) continue;
    bar.firstElementChild?.animate(
      [{ transform: `scaleX(${previous / next})` }, { transform: "scaleX(1)" }],
      { duration: 180, easing: "cubic-bezier(.23,1,.32,1)" },
    );
  }
}
