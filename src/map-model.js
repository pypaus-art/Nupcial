export const WORLD = Object.freeze({ width: 360, height: 640 });
export const KINDS = Object.freeze({
  tree: { label: "Árbol", width: 52, height: 60 },
  grass: { label: "Pasto", width: 120, height: 80 },
  bush: { label: "Arbusto", width: 64, height: 38 },
  toilet: { label: "Baños", width: 92, height: 36 },
  entrance: { label: "Entrada", width: 108, height: 34 },
});
export const tableDefaults = (t) => ({
  width: 64,
  height: 36,
  rotation: 0,
  ...t,
});
export function legacyTable(t) {
  return {
    ...t,
    x: Math.round(35 + (t.x * 0.087 + 0.105) * 307),
    y: Math.round(78 + (t.y * 0.124 + 0.047) * 530),
    width: 64,
    height: 36,
    rotation: 0,
  };
}
export function bounds(item) {
  const vertical = item.rotation === 90 || item.rotation === 270;
  return {
    x: item.x,
    y: item.y,
    w: vertical ? item.height : item.width,
    h: vertical ? item.width : item.height,
  };
}
export const overlaps = (a, b, gap = 0) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap &&
  Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;
export function inside(item, margin = 6) {
  const b = bounds(item);
  return (
    b.x - b.w / 2 >= margin &&
    b.x + b.w / 2 <= WORLD.width - margin &&
    b.y - b.h / 2 >= margin &&
    b.y + b.h / 2 <= WORLD.height - margin
  );
}
export function clampPosition(item, x, y) {
  const b = bounds(item);
  return {
    x: Math.round(
      Math.max(
        Math.ceil(b.w / 2 + 6),
        Math.min(Math.floor(WORLD.width - b.w / 2 - 6), x),
      ),
    ),
    y: Math.round(
      Math.max(
        Math.ceil(b.h / 2 + 6),
        Math.min(Math.floor(WORLD.height - b.h / 2 - 6), y),
      ),
    ),
  };
}
export function tableSpaceFree(candidate, tables, garden) {
  if (!inside(candidate)) return false;
  if (
    tables.some(
      (t) =>
        t.id !== candidate.id && overlaps(bounds(candidate), bounds(t), 12),
    )
  )
    return false;
  return true;
}
export function findTableSpace(tables, garden) {
  for (let y = 104; y < 610; y += 28)
    for (let x = 44; x < 340; x += 20) {
      const t = tableDefaults({ id: "candidate", x, y });
      if (tableSpaceFree(t, tables, garden)) return t;
    }
  return null;
}
export function findElementSpace(item, elements, tables) {
  let fallback;
  for (let y = 42; y < 620; y += 24)
    for (let x = 32; x < 345; x += 24) {
      const c = { ...item, x, y };
      if (!inside(c)) continue;
      fallback ??= c;
      if (!elements.some((e) => overlaps(bounds(c), bounds(e), 4))) return c;
    }
  return fallback || null;
}
