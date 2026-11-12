// Ordered 2px ink dots. These masks never invert or flash the whole screen.
const order = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function mask(threshold) {
  const dots = order
    .map((n, i) =>
      n < threshold
        ? `<rect x="${(i % 4) * 2}" y="${Math.floor(i / 4) * 2}" width="2" height="2"/>`
        : "",
    )
    .join("");
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges">${dots}</svg>`)}")`;
}
const dense = mask(12),
  sparse = mask(5);
document.documentElement.style.setProperty("--ink-dense", dense);
document.documentElement.style.setProperty("--ink-sparse", sparse);
export const eraseFrames = [
  { opacity: 1, maskImage: "none", filter: "blur(0px)", offset: 0 },
  { opacity: 0.7, maskImage: dense, filter: "blur(.15px)", offset: 0.4 },
  { opacity: 0, maskImage: sparse, filter: "blur(.35px)", offset: 1 },
];
export const printFrames = [
  { opacity: 0, maskImage: sparse, filter: "blur(.35px)", offset: 0 },
  { opacity: 0.7, maskImage: dense, filter: "blur(.15px)", offset: 0.65 },
  { opacity: 1, maskImage: "none", filter: "blur(0px)", offset: 1 },
];
