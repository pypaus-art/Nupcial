export const WORLD = Object.freeze({ width: 360, height: 640 });
export const TABLE_GRID = 8;
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
// The boundary follows the actual chairs. A two-seat table has no lateral chairs.
export function edgeInsets(item) {
  if (item.kind) return { left: 0, right: 0, top: 0, bottom: 0 };
  const capacity = item.capacity ?? 10;
  let edges = {
    left: capacity >= 9 ? 6 : 0,
    right: capacity >= 10 ? 6 : 0,
    top: 6,
    bottom: capacity >= 2 ? 6 : 0,
  };
  for (let turn = 0; turn < (item.rotation || 0) / 90; turn++)
    edges = {
      left: edges.bottom,
      top: edges.left,
      right: edges.top,
      bottom: edges.right,
    };
  return edges;
}
export const WORLD_AREA = Object.freeze({ left: 0, top: 0, ...WORLD });
// Rendering can expose space beyond the original frame without changing saved coordinates.
export const STORAGE_AREA = Object.freeze({
  left: -100000,
  top: -100000,
  width: 200360,
  height: 200640,
});
const ART_BOUNDS = Object.freeze({
  tree: { x: 7.974, y: 5.152, w: 90.354, h: 88.598 },
  bush: { x: 2.247, y: 15.046, w: 97.991, h: 70.731 },
  grass: { x: 16, y: 26, w: 60, h: 52 },
});
export function footprint(item) {
  const art = ART_BOUNDS[item.kind];
  if (!art) {
    const b = bounds(item),
      e = edgeInsets(item);
    return {
      x: b.x + (e.right - e.left) / 2,
      y: b.y + (e.bottom - e.top) / 2,
      w: b.w + e.left + e.right,
      h: b.h + e.top + e.bottom,
    };
  }
  const scale = Math.min(item.width, item.height) / 100;
  let dx = (art.x + art.w / 2 - 50) * scale,
    dy = (art.y + art.h / 2 - 50) * scale;
  let w = art.w * scale,
    h = art.h * scale;
  for (let turn = 0; turn < (item.rotation || 0) / 90; turn++) {
    [dx, dy] = [-dy, dx];
    [w, h] = [h, w];
  }
  return { x: item.x + dx, y: item.y + dy, w, h };
}
export function inside(item, area = WORLD_AREA) {
  const b = footprint(item);
  return (
    b.x - b.w / 2 >= area.left &&
    b.x + b.w / 2 <= area.left + area.width &&
    b.y - b.h / 2 >= area.top &&
    b.y + b.h / 2 <= area.top + area.height
  );
}
export function clampPosition(item, x, y, area = WORLD_AREA) {
  const b = footprint(item),
    dx = b.x - item.x,
    dy = b.y - item.y;
  return {
    x: Math.round(
      Math.max(
        Math.ceil(area.left + b.w / 2 - dx),
        Math.min(Math.floor(area.left + area.width - b.w / 2 - dx), x),
      ),
    ),
    y: Math.round(
      Math.max(
        Math.ceil(area.top + b.h / 2 - dy),
        Math.min(Math.floor(area.top + area.height - b.h / 2 - dy), y),
      ),
    ),
  };
}
export function fitArea(items, pixelWidth, pixelHeight) {
  const cx = WORLD.width / 2,
    cy = WORLD.height / 2;
  let width = WORLD.width,
    height = WORLD.height;
  for (const item of items) {
    const b = footprint(item);
    width = Math.max(width, 2 * (Math.abs(b.x - cx) + b.w / 2));
    height = Math.max(height, 2 * (Math.abs(b.y - cy) + b.h / 2));
  }
  const aspect = pixelWidth / pixelHeight;
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}
export function snapTable(item, x, y, area = WORLD_AREA) {
  return clampPosition(
    item,
    Math.round(x / TABLE_GRID) * TABLE_GRID,
    Math.round(y / TABLE_GRID) * TABLE_GRID,
    area,
  );
}
export function tableSpaceFree(candidate, tables, garden, area = STORAGE_AREA) {
  if (!inside(candidate, area)) return false;
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
  for (let y = 104; y < 610; y += TABLE_GRID)
    for (let x = 40; x < 340; x += TABLE_GRID) {
      const t = tableDefaults({ id: "candidate", x, y });
      if (tableSpaceFree(t, tables, garden, WORLD_AREA)) return t;
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
