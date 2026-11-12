import { WORLD, KINDS, bounds, TABLE_GRID } from "./map-model.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const short = (s, max) =>
  Array.from(s).length > max
    ? Array.from(s)
        .slice(0, Math.max(1, max - 1))
        .join("") + "…"
    : s;
const symbols = `<defs>
<symbol id="garden-tree" viewBox="0 0 100 100"><path d="M48 93V65m0 12-14-12m14 9 17-13" fill="none"/><path d="M20 57C-3 43 13 13 34 18 40-2 74 5 73 23c29 1 31 31 13 42-1 26-40 27-44 10-20 12-40-4-22-18Z"/></symbol>
<symbol id="garden-bush" viewBox="0 0 100 100"><path d="M12 78C-5 65 4 41 23 43 13 20 43 6 56 24c23-15 39 6 30 25 22 10 15 37-6 36H29Z"/><path d="m26 61 9 9m32-19-7 12m-11-21v12" fill="none"/></symbol>
<symbol id="garden-grass" viewBox="0 0 100 100"><path d="m17 30 6 13 7-16m32 3 6 13 7-16M41 64l6 13 7-16" fill="none"/></symbol>
</defs>`;
export const defaultGarden = () => [
  {
    id: "default-toilet",
    kind: "toilet",
    x: 180,
    y: 28,
    width: 84,
    height: 32,
    rotation: 0,
    label: "Baños",
  },
  {
    id: "default-entrance",
    kind: "entrance",
    x: 292,
    y: 63,
    width: 112,
    height: 30,
    rotation: 0,
    label: "Entrada hotel",
  },
  {
    id: "default-tree",
    kind: "tree",
    x: 32,
    y: 278,
    width: 45,
    height: 64,
    rotation: 0,
    label: "",
  },
];
function element(e, editor, selected) {
  const b = bounds(e),
    landmark = ["toilet", "entrance"].includes(e.kind);
  const glyph = landmark
    ? `<rect class="landmark-frame" x="${-e.width / 2}" y="${-e.height / 2}" width="${e.width}" height="${e.height}" rx="7"/><svg x="${-e.width / 2 + 6}" y="-9" width="18" height="18" viewBox="0 0 24 24" class="landmark-icon">${e.kind === "toilet" ? '<circle cx="12" cy="5" r="2"/><path d="M7 12c0-5 10-5 10 0v4h-3v6h-4v-6H7Z"/>' : '<path d="M3 3h7v18H3m11-15 6 6-6 6m-3-6h9"/>'}</svg><text x="${-e.width / 2 + 29}" y="4" class="landmark-label">${esc(short(e.label || KINDS[e.kind].label, Math.max(2, Math.floor((e.width - 34) / 5.7))))}</text>`
    : `<use href="#garden-${e.kind}" x="${-e.width / 2}" y="${-e.height / 2}" width="${e.width}" height="${e.height}"/>`;
  return `<g class="garden-object kind-${e.kind}" ${editor ? `data-garden-object="${esc(e.id)}" role="button" tabindex="0" aria-pressed="${selected === e.id}"` : 'role="img"'} aria-label="${esc(e.label || KINDS[e.kind].label)}" transform="translate(${e.x} ${e.y})"><title>${esc(e.label || KINDS[e.kind].label)}</title><g transform="rotate(${e.rotation})">${glyph}</g>${editor ? `<rect class="object-hit" x="${-b.w / 2 - 3}" y="${-b.h / 2 - 3}" width="${b.w + 6}" height="${b.h + 6}"/><rect class="object-selection" x="${-b.w / 2 - 5}" y="${-b.h / 2 - 5}" width="${b.w + 10}" height="${b.h + 10}" rx="6"/>` : ""}</g>`;
}
function table(t, assignments, { editing, selected, ghost }) {
  const b = bounds(t),
    count = assignments.filter((a) => a.tableId === t.id).length;
  const seats = [];
  const top = Math.ceil(Math.min(t.capacity, 8) / 2);
  const bottom = Math.floor(Math.min(t.capacity, 8) / 2);
  for (const [amount, y] of [
    [top, -t.height / 2 - 6],
    [bottom, t.height / 2 + 2],
  ]) {
    for (let i = 0; i < amount; i++) {
      const x =
        amount === 1
          ? 0
          : -t.width / 2 + 8 + (i * (t.width - 16)) / (amount - 1);
      seats.push(
        `<rect class="map-seat ${seats.length < count ? "occupied" : ""}" x="${x - 4}" y="${y}" width="8" height="4" rx="1"/>`,
      );
    }
  }
  if (t.capacity >= 9)
    seats.push(
      `<rect class="map-seat ${seats.length < count ? "occupied" : ""}" x="${-t.width / 2 - 6}" y="-4" width="4" height="8" rx="1"/>`,
    );
  if (t.capacity >= 10)
    seats.push(
      `<rect class="map-seat ${seats.length < count ? "occupied" : ""}" x="${t.width / 2 + 2}" y="-4" width="4" height="8" rx="1"/>`,
    );
  let label = t.name;
  if ((t.rotation === 90 || t.rotation === 270) && /^Mesa \d+$/.test(label))
    label = label.replace("Mesa ", "M");
  label = short(label, Math.max(3, Math.floor((b.w - 6) / 5.5)));
  return `<g class="map-table ${ghost ? "table-ghost" : ""}" ${ghost ? 'aria-hidden="true"' : `data-table="${esc(t.id)}" role="button" tabindex="0" aria-pressed="${editing && selected === t.id}" aria-label="${esc(t.name)}, ${count} de ${t.capacity} lugares${editing ? ", mover con flechas" : ""}"`} transform="translate(${t.x} ${t.y})"><title>${esc(t.name)}</title><g transform="rotate(${t.rotation})"><rect class="table-body" x="${-t.width / 2}" y="${-t.height / 2}" width="${t.width}" height="${t.height}" rx="5"/><g class="table-seats">${seats.join("")}</g><path class="table-direction" d="M${-t.width / 2 + 4} ${-t.height / 2 + 8}v-4h4"/></g><text class="map-table-label" text-anchor="middle" y="-2">${esc(label)}</text><text class="map-table-count" text-anchor="middle" y="10">${count}/${t.capacity}</text>${ghost ? "" : `<rect class="table-hit" x="${-b.w / 2 - 6}" y="${-b.h / 2 - 6}" width="${b.w + 12}" height="${b.h + 12}"/><rect class="table-selection" x="${-b.w / 2 - 9}" y="${-b.h / 2 - 9}" width="${b.w + 18}" height="${b.h + 18}" rx="7"/>`}</g>`;
}
export function boardContents(
  state,
  {
    editor = false,
    draft = null,
    selected = null,
    editing = false,
    showTables = true,
    tablePreview = null,
  } = {},
) {
  const garden = draft || state.garden;
  const elements = editor
    ? garden.elements
    : garden.custom
      ? garden.elements
      : defaultGarden();
  return (
    symbols +
    (editing && !editor
      ? `<defs><pattern id="table-grid" width="${TABLE_GRID}" height="${TABLE_GRID}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".55"/></pattern></defs><rect class="table-grid" width="100%" height="100%" fill="url(#table-grid)"/>`
      : "") +
    `<g class="garden-background">${[...elements]
      .sort(
        (a, b) => (a.kind === "grass" ? 0 : 1) - (b.kind === "grass" ? 0 : 1),
      )
      .map((e) => element(e, editor, selected))
      .join(
        "",
      )}</g><g class="map-tables">${showTables ? state.tables.map((t) => table(tablePreview?.id === t.id ? tablePreview : t, state.assignments, { editing, selected, ghost: editor })).join("") : ""}</g>`
  );
}
export function board(state, options = {}) {
  return `<svg id="map-canvas" class="map-surface ${options.editor ? "garden-design-surface" : ""}" viewBox="0 0 ${WORLD.width} ${WORLD.height}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${options.editor ? "Lienzo de diseño del jardín" : "Mesas y orientación del jardín"}">${boardContents(state, options)}</svg>`;
}
