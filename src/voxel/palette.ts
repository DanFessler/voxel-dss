// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Dan Fessler
// Part of the Derived Surface Shading (DSS) method library. See ./LICENSE.

/**
 * Color palette model.
 *
 * Voxels store a 1-based palette index (0 is reserved for "empty"), mirroring
 * the MagicaVoxel/.vox convention. The palette holds up to 255 usable colors.
 */

export const PALETTE_SIZE = 256;
export const EMPTY_INDEX = 0;

/** A palette is a flat array of CSS hex color strings, index 0 unused. */
export type Palette = string[];

/**
 * Build the default MagicaVoxel-style palette: a perceptually spread set of
 * hues at a few saturations/values, plus a grayscale ramp at the end.
 */
export function createDefaultPalette(): Palette {
  const palette: Palette = new Array(PALETTE_SIZE).fill("#000000");

  let i = 1;
  palette[i++] = "#ffffff";
  const hueSteps = 24;
  const valueSteps = [1.0, 0.78, 0.56];
  const satSteps = [1.0, 0.6];

  for (const sat of satSteps) {
    for (const val of valueSteps) {
      for (let h = 0; h < hueSteps && i < PALETTE_SIZE - 16; h++) {
        palette[i++] = hslToHex((h / hueSteps) * 360, sat, val);
      }
    }
  }

  // Grayscale ramp to fill the remainder.
  const remaining = PALETTE_SIZE - i;
  for (let g = 0; g < remaining; g++) {
    const t = g / Math.max(1, remaining - 1);
    const v = Math.round(t * 255);
    palette[i++] = rgbToHex(v, v, v);
  }

  return palette;
}

function hslToHex(h: number, s: number, l: number): string {
  // Note: treats `l` as HSV "value" for a punchier artist palette.
  const c = l * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  );
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Parse a CSS hex color into normalized [r, g, b] in 0..1. */
export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}
