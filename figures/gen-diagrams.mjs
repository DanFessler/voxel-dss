/**
 * Generates the whitepaper's conceptual SVG diagrams (Figures 2, 5, 6).
 *
 * These are 2D cross-section illustrations of the occupancy field and the two
 * normal-derivation methods. They are computed (occupancy discs, finite
 * differences, Gaussian-weighted centroid) rather than hand-drawn so the
 * geometry is faithful to the algorithms in `src/voxel/`.
 *
 * Run:  node figures/gen-diagrams.mjs
 * Output: whitepaper/figures/figure-{2,5,6}.svg
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../whitepaper/figures");
mkdirSync(OUT, { recursive: true });

// ---- shared theme -----------------------------------------------------------
const C = {
  bg: "#1a1c22",
  panel: "#20232b",
  grid: "#33404d",
  empty: "#272b34",
  solid: "#c2c8d0",
  solidFaint: "#3a414d",
  fg: "#e7ecf2",
  muted: "#9aa6b2",
  normal: "#ffb454",
  accent: "#9ec1ff",
  centroid: "#7ee0a0",
};
const FONT =
  'font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"';

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function arrow(x1, y1, x2, y2, color, w = 3.5) {
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(
    1,
  )}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" marker-end="url(#arrow-${color.slice(
    1,
  )})"/>`;
}
function marker(color) {
  return `<marker id="arrow-${color.slice(
    1,
  )}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`;
}
function text(x, y, s, { fill = C.fg, size = 15, anchor = "start", weight = 400, italic = false } = {}) {
  return `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" ${
    italic ? 'font-style="italic"' : ""
  } fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}

/** Draw an N×M grid of cells given an occupancy(i,j)->bool predicate. */
function grid(ox, oy, cols, rows, s, occ, { solid = C.solid, faint = false } = {}) {
  let out = "";
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = ox + i * s;
      const y = oy + j * s;
      const filled = occ(i, j);
      const fill = filled ? (faint ? C.solidFaint : solid) : C.empty;
      out += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${fill}" stroke="${C.grid}" stroke-width="1"/>`;
    }
  return out;
}

/** Thick silhouette: every edge between an occupied cell and empty space. */
function silhouette(ox, oy, cols, rows, s, occ, color) {
  let out = "";
  const edge = (x1, y1, x2, y2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (!occ(i, j)) continue;
      const x = ox + i * s;
      const y = oy + j * s;
      if (!occ(i - 1, j)) out += edge(x, y, x, y + s);
      if (!occ(i + 1, j)) out += edge(x + s, y, x + s, y + s);
      if (!occ(i, j - 1)) out += edge(x, y, x + s, y);
      if (!occ(i, j + 1)) out += edge(x, y + s, x + s, y + s);
    }
  return out;
}

function svg(w, h, body) {
  const markers = [C.normal, C.accent, C.centroid].map(marker).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs>${markers}</defs>
<rect width="${w}" height="${h}" fill="${C.bg}"/>
${body}
</svg>`;
}

// ============================================================ Figure 2
// Explicit cube geometry vs the implicit surface, from one occupancy field.
function figure2() {
  const s = 18;
  const N = 16;
  const R = 6.6;
  const cx = N / 2;
  const cy = N / 2;
  const occ = (i, j) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return Math.hypot(i + 0.5 - cx, j + 0.5 - cy) <= R;
  };

  const gw = N * s;
  const pad = 28;
  const top = 64;
  const panelW = gw + pad * 2;
  const W = panelW * 3 + pad * 2;
  const H = top + gw + 70;

  const panel = (px, title, inner) =>
    `<g transform="translate(${px},0)">
      ${text(pad + gw / 2, 38, title, { anchor: "middle", size: 17, weight: 600 })}
      <g transform="translate(${pad},${top})">${inner}</g>
    </g>`;

  // a) raw occupancy
  const a = grid(0, 0, N, N, s, occ);

  // b) explicit cube geometry (faint cells + stair-step silhouette)
  const b =
    grid(0, 0, N, N, s, occ, { faint: true }) +
    silhouette(0, 0, N, N, s, occ, C.accent);

  // c) implicit / perceived surface (faint cells + smooth circle)
  const c =
    grid(0, 0, N, N, s, occ, { faint: true }) +
    `<circle cx="${cx * s}" cy="${cy * s}" r="${R * s}" fill="none" stroke="${
      C.normal
    }" stroke-width="3.5"/>`;

  const body =
    panel(0, "Occupancy field  V(x, y, z)", a) +
    panel(panelW, "Explicit cube geometry", b) +
    panel(panelW * 2, "Implied (perceived) surface", c) +
    text(W / 2, H - 26, "The same field yields a blocky boundary and a smooth implied surface.", {
      anchor: "middle",
      fill: C.muted,
      size: 14,
    });

  return svg(W, H, body);
}

// ============================================================ Figure 5
// Density-gradient normal: finite difference of smoothed occupancy density.
function figure5() {
  const s = 40;
  const cols = 9;
  const rows = 8;
  // Solid lower region with a curved top boundary (circle centered below grid).
  const ox0 = 4.2;
  const oy0 = 12.2;
  const R = 8.4;
  const occ = (i, j) =>
    i >= 0 && j >= 0 && i < cols && j < rows &&
    Math.hypot(i + 0.5 - ox0, j + 0.5 - oy0) <= R;

  const pad = 34;
  const top = 64;
  const gw = cols * s;
  const gh = rows * s;
  const W = gw + pad * 2 + 240;
  const H = top + gh + 40;

  // Pick a boundary cell p (topmost solid cell in the center column).
  const pi = 4;
  let pj = 0;
  for (let j = 0; j < rows; j++) if (occ(pi, j)) { pj = j; break; }
  const r = 2;
  const cxp = (i) => pad + (i + 0.5) * s;
  const cyp = (j) => top + (j + 0.5) * s;

  const g = grid(pad, top, cols, rows, s, occ);

  // Highlight the ±r sample windows on each axis.
  const win = (i, j) =>
    `<rect x="${pad + (i - r) * s}" y="${top + (j - r) * s}" width="${
      (2 * r + 1) * s
    }" height="${(2 * r + 1) * s}" fill="none" stroke="${C.accent}" stroke-width="2" stroke-dasharray="5 4" rx="6"/>`;

  // p marker.
  const pMark = `<rect x="${pad + pi * s}" y="${top + pj * s}" width="${s}" height="${s}" fill="none" stroke="${C.normal}" stroke-width="3"/>`;

  // Gradient normal at p points from solid toward empty (upward here).
  const nx = cxp(pi);
  const ny = cyp(pj);
  const nArrow = arrow(nx, ny, nx, ny - s * 2.0, C.normal, 4);

  // sample dots above (low density) and below (high density)
  const dotLow = `<circle cx="${cxp(pi)}" cy="${cyp(pj - r)}" r="6" fill="${C.accent}"/>`;
  const dotHigh = `<circle cx="${cxp(pi)}" cy="${cyp(pj + r)}" r="6" fill="${C.accent}"/>`;

  const labels =
    text(pad + gw + 24, top + 30, "Density gradient", { size: 17, weight: 600 }) +
    text(pad + gw + 24, top + 60, "ρ(p) = smoothed occupancy", { fill: C.muted, size: 14 }) +
    text(pad + gw + 24, top + 96, "N = ∇ρ", { size: 16, italic: true }) +
    text(pad + gw + 24, top + 126, "Nx = ρ(x−r) − ρ(x+r)", { fill: C.muted, size: 13.5 }) +
    text(pad + gw + 24, top + 148, "Ny = ρ(y−r) − ρ(y+r)", { fill: C.muted, size: 13.5 }) +
    text(pad + gw + 24, top + 184, "ρ low (mostly empty)", { fill: C.accent, size: 13.5 }) +
    text(pad + gw + 24, top + 206, "ρ high (mostly solid)", { fill: C.accent, size: 13.5 }) +
    `<rect x="${pad + gw + 24}" y="${top + 226}" width="16" height="16" fill="none" stroke="${C.normal}" stroke-width="3"/>` +
    text(pad + gw + 48, top + 239, "sample voxel p", { fill: C.fg, size: 13.5 }) +
    arrow(pad + gw + 32, top + 272, pad + gw + 32, top + 256, C.normal, 4) +
    text(pad + gw + 48, top + 270, "derived normal N", { fill: C.fg, size: 13.5 });

  const body =
    text(W / 2, 38, "Density-gradient normal estimation", { anchor: "middle", size: 18, weight: 600 }) +
    g + win(pi, pj) + dotLow + dotHigh + pMark + nArrow + labels;
  return svg(W, H, body);
}

// ============================================================ Figure 6
// Occupancy-centroid normal: N points away from nearby occupied mass.
function figure6() {
  const s = 40;
  const cols = 9;
  const rows = 9;
  // A rounded mass anchored to the lower-left, so the centroid sits clearly
  // down-left of p and the derived normal points diagonally up-right.
  const ox0 = 0.6;
  const oy0 = 9.4;
  const R = 7.6;
  const occ = (i, j) =>
    i >= 0 && j >= 0 && i < cols && j < rows &&
    Math.hypot(i + 0.5 - ox0, j + 0.5 - oy0) <= R;

  const pad = 34;
  const top = 64;
  const gw = cols * s;
  const gh = rows * s;
  const W = gw + pad * 2 + 240;
  const H = top + gh + 40;

  // p: a surface cell on the upper-right shoulder of the mass.
  const pi = 4;
  let pj = 0;
  for (let j = 0; j < rows; j++) if (occ(pi, j)) { pj = j; break; }
  const r = 3;

  const cxp = (i) => pad + (i + 0.5) * s;
  const cyp = (j) => top + (j + 0.5) * s;

  // Gaussian-weighted occupancy centroid of the kernel around p (matches dss.ts).
  const sigma = Math.max(0.75, r * 0.65);
  let cx = 0, cy = 0, tot = 0;
  for (let dj = -r; dj <= r; dj++)
    for (let di = -r; di <= r; di++) {
      if (di === 0 && dj === 0) continue;
      const i = pi + di, j = pj + dj;
      if (!occ(i, j)) continue;
      const w = Math.exp(-(di * di + dj * dj) / (2 * sigma * sigma));
      cx += (i + 0.5) * w;
      cy += (j + 0.5) * w;
      tot += w;
    }
  cx /= tot; cy /= tot;
  const Cx = pad + cx * s;
  const Cy = top + cy * s;

  // Kernel cells, occupied highlighted blue.
  const g = grid(pad, top, cols, rows, s, occ, { faint: true });
  let kernelOcc = "";
  for (let dj = -r; dj <= r; dj++)
    for (let di = -r; di <= r; di++) {
      const i = pi + di, j = pj + dj;
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      if (occ(i, j)) {
        kernelOcc += `<rect x="${pad + i * s}" y="${top + j * s}" width="${s}" height="${s}" fill="${C.accent}" opacity="0.5" stroke="${C.grid}" stroke-width="1"/>`;
      }
    }

  const kernelBox = `<rect x="${pad + (pi - r) * s}" y="${top + (pj - r) * s}" width="${
    (2 * r + 1) * s
  }" height="${(2 * r + 1) * s}" fill="none" stroke="${C.accent}" stroke-width="2" stroke-dasharray="5 4" rx="8"/>`;

  const pMark = `<rect x="${pad + pi * s}" y="${top + pj * s}" width="${s}" height="${s}" fill="none" stroke="${C.normal}" stroke-width="3"/>`;
  const cMark = `<circle cx="${Cx}" cy="${Cy}" r="7" fill="${C.centroid}"/>`;

  // N = normalize(p - C), drawn from p outward.
  const px = cxp(pi), py = cyp(pj);
  let dx = px - Cx, dy = py - Cy;
  const len = Math.hypot(dx, dy);
  dx /= len; dy /= len;
  const L = s * 2.1;
  const nArrow = arrow(px, py, px + dx * L, py + dy * L, C.normal, 4);
  const cLine = `<line x1="${Cx}" y1="${Cy}" x2="${px}" y2="${py}" stroke="${C.centroid}" stroke-width="2" stroke-dasharray="4 4"/>`;

  const labels =
    text(pad + gw + 24, top + 30, "Occupancy centroid", { size: 17, weight: 600 }) +
    text(pad + gw + 24, top + 62, "C = Σ V(q) w(q) q", { fill: C.muted, size: 14 }) +
    text(pad + gw + 24, top + 82, "      ───────────", { fill: C.muted, size: 14 }) +
    text(pad + gw + 24, top + 102, "        Σ V(q) w(q)", { fill: C.muted, size: 14 }) +
    text(pad + gw + 24, top + 140, "N = normalize(p − C)", { size: 16, italic: true }) +
    `<rect x="${pad + gw + 24}" y="${top + 168}" width="16" height="16" fill="${C.accent}" opacity="0.5"/>` +
    text(pad + gw + 48, top + 181, "occupied in kernel", { fill: C.fg, size: 13.5 }) +
    `<circle cx="${pad + gw + 32}" cy="${top + 206}" r="7" fill="${C.centroid}"/>` +
    text(pad + gw + 48, top + 211, "weighted centroid C", { fill: C.fg, size: 13.5 }) +
    `<rect x="${pad + gw + 24}" y="${top + 228}" width="16" height="16" fill="none" stroke="${C.normal}" stroke-width="3"/>` +
    text(pad + gw + 48, top + 241, "sample voxel p", { fill: C.fg, size: 13.5 }) +
    arrow(pad + gw + 32, top + 274, pad + gw + 32, top + 258, C.normal, 4) +
    text(pad + gw + 48, top + 272, "derived normal N", { fill: C.fg, size: 13.5 });

  const body =
    text(W / 2, 38, "Occupancy-centroid normal estimation", { anchor: "middle", size: 18, weight: 600 }) +
    g + kernelOcc + kernelBox + cLine + pMark + cMark + nArrow + labels;
  return svg(W, H, body);
}

// ============================================================ Figure 11
// Where derived normals are ill-defined: thin and isolated features.
function figure11() {
  const s = 34;
  const N = 7;
  const gw = N * s;
  const pad = 26;
  const top = 58;
  const panelW = gw + pad * 2;
  const W = panelW * 3;
  const H = top + gw + 64;

  const cc = (i) => (i + 0.5) * s;
  const pMark = (i, j) =>
    `<rect x="${i * s}" y="${j * s}" width="${s}" height="${s}" fill="none" stroke="${C.normal}" stroke-width="3"/>`;

  // a) Thick feature - gradient/centroid resolve a clear outward normal.
  const occA = (_i, j) => j >= 3;
  const aInner =
    grid(0, 0, N, N, s, occA) +
    pMark(3, 3) +
    arrow(cc(3), cc(3) - 2, cc(3), cc(3) - s * 1.7, C.normal, 4);

  // b) 1-voxel sheet / line - both faces want opposite normals; per-voxel
  //    derivation is symmetric and cannot choose.
  const occB = (_i, j) => j === 3;
  const bInner =
    grid(0, 0, N, N, s, occB) +
    pMark(3, 3) +
    arrow(cc(3), cc(3) - 3, cc(3), cc(3) - s * 1.5, C.normal, 4) +
    arrow(cc(3), cc(3) + 3, cc(3), cc(3) + s * 1.5, C.normal, 4) +
    text(cc(3) + s * 0.62, cc(3) + s * 0.16, "?", {
      fill: C.normal,
      size: 26,
      weight: 700,
    });

  // c) Isolated voxel - no neighborhood mass, so the normal is undefined.
  const occC = (i, j) => i === 3 && j === 3;
  const cInner =
    grid(0, 0, N, N, s, occC) +
    pMark(3, 3) +
    `<circle cx="${cc(3)}" cy="${cc(3)}" r="${s * 1.5}" fill="none" stroke="${
      C.muted
    }" stroke-width="2" stroke-dasharray="5 5"/>` +
    text(cc(3), cc(3) - s * 1.05, "?", {
      anchor: "middle",
      fill: C.muted,
      size: 26,
      weight: 700,
    });

  const panel = (idx, title, sub, inner) =>
    `<g transform="translate(${idx * panelW},0)">
      ${text(pad + gw / 2, 34, title, { anchor: "middle", size: 16, weight: 600 })}
      <g transform="translate(${pad},${top})">${inner}</g>
      ${text(pad + gw / 2, top + gw + 34, sub, { anchor: "middle", fill: C.muted, size: 13 })}
    </g>`;

  const body =
    panel(0, "Thick feature", "normal points clearly toward empty space", aInner) +
    panel(1, "1-voxel sheet or line", "two opposite faces, one ambiguous normal", bInner) +
    panel(2, "Isolated voxel", "no neighbors → undefined (fallback used)", cInner);

  return svg(W, H, body);
}

const files = {
  "figure-2.svg": figure2(),
  "figure-5.svg": figure5(),
  "figure-6.svg": figure6(),
  "figure-11.svg": figure11(),
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(resolve(OUT, name), content, "utf8");
  console.log("wrote", name);
}
