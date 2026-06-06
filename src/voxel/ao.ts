// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Dan Fessler
// Part of the Derived Surface Shading (DSS) method library. See ./LICENSE.

import type { VoxelData } from "./VoxelData";

/**
 * Derived Surface Ambient Occlusion (AO).
 *
 * Mirrors the Derived Surface Shading principle from the whitepaper: instead of
 * computing occlusion from axis-aligned cube faces/corners (which produces the
 * same lattice-aligned discontinuities the paper set out to avoid), AO is
 * derived from the occupancy field itself.
 *
 * Crucially, this is hemispherical occlusion, not a curvature/neighbor-count
 * measure. Counting occupied voxels in all directions is ~half-solid on any
 * flat surface and drops on convex edges, which reads as curvature (convex
 * edges get highlighted). Instead we orient a hemisphere by the derived
 * outward normal and ask how much of the *open* side is blocked:
 *
 *  - Flat surface  -> open hemisphere is empty            -> unoccluded (lit).
 *  - Convex edge   -> open hemisphere is even emptier      -> unoccluded (lit).
 *  - Concavity     -> nearby walls fill the open hemisphere -> occluded (dark).
 *
 * Samples are cosine-weighted (Lambertian) and Gaussian-falloff by distance.
 * Because the measure varies smoothly along the implicit surface, occlusion
 * reads as the shape the field describes rather than the voxel grid.
 *
 * Like normals, AO is split into generation (this occlusion field) and
 * application: a uniform per-voxel value, or values interpolated between
 * neighboring voxels at the shared cube vertices.
 */

export type AoMode = "off" | "perVoxel" | "vertexInterpolated";

export interface AoSettings {
  mode: AoMode;
  /** Neighborhood radius r: 1 => 3x3x3, 2 => 5x5x5, etc. */
  radius: number;
  /** Strength of the darkening in concavities, 0..1. */
  intensity: number;
}

export const DEFAULT_AO: AoSettings = {
  mode: "off",
  radius: 2,
  intensity: 0.85,
};

/** Never let AO drive a surface fully black. */
const MIN_AO = 0.1;

function gaussianWeight(dx: number, dy: number, dz: number, r: number): number {
  const d2 = dx * dx + dy * dy + dz * dz;
  const sigma = Math.max(0.75, r * 0.65);
  return Math.exp(-d2 / (2 * sigma * sigma));
}

/**
 * Computes and caches occupancy-derived AO factors (1 = unoccluded, 0 = dark).
 *
 * A fresh cache should be created whenever the volume or AO settings change.
 */
export class OcclusionFieldCache {
  private cache = new Map<number, number>();

  constructor(
    private readonly data: VoxelData,
    private readonly settings: AoSettings,
  ) {}

  private key(x: number, y: number, z: number): number {
    return (x << 16) | (y << 8) | z;
  }

  get(x: number, y: number, z: number): number {
    const k = this.key(x, y, z);
    let ao = this.cache.get(k);
    if (ao === undefined) {
      ao = this.computeAO(x, y, z);
      this.cache.set(k, ao);
    }
    return ao;
  }

  private computeAO(x: number, y: number, z: number): number {
    const r = this.settings.radius;

    const normal = this.outwardNormal(x, y, z);
    if (!normal) return 1; // isolated voxel: nothing to occlude it.
    const [nx, ny, nz] = normal;

    // Integrate occupancy over the hemisphere facing the open (air) side,
    // cosine-weighted by alignment with the outward normal and Gaussian by
    // distance. Directions into the solid (ndotd <= 0) are ignored.
    let occluded = 0;
    let total = 0;

    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const ndotd = (dx * nx + dy * ny + dz * nz) / len;
          if (ndotd <= 0) continue;

          const w = gaussianWeight(dx, dy, dz, r) * ndotd;
          total += w;
          if (this.data.isSolid(x + dx, y + dy, z + dz)) occluded += w;
        }

    if (total <= 1e-6) return 1;

    const occlusion = occluded / total;
    return Math.max(MIN_AO, 1 - this.settings.intensity * occlusion);
  }

  /**
   * Outward surface direction = away from the local occupied mass (occupancy
   * centroid). Returns null when there is no nearby mass to orient against.
   */
  private outwardNormal(
    x: number,
    y: number,
    z: number,
  ): [number, number, number] | null {
    const r = this.settings.radius;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let mass = 0;

    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (!this.data.isSolid(x + dx, y + dy, z + dz)) continue;
          const w = gaussianWeight(dx, dy, dz, r);
          cx += dx * w;
          cy += dy * w;
          cz += dz * w;
          mass += w;
        }

    if (mass <= 1e-6) return null;

    // Outward = center minus centroid (center offset is the origin here).
    let nx = -cx / mass;
    let ny = -cy / mass;
    let nz = -cz / mass;
    let len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (len < 1e-4) {
      // Symmetric surroundings: fall back to direction from the volume center.
      nx = x + 0.5 - this.data.dims.x / 2;
      ny = y + 0.5 - this.data.dims.y / 2;
      nz = z + 0.5 - this.data.dims.z / 2;
      len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-4) return [0, 1, 0];
    }

    return [nx / len, ny / len, nz / len];
  }

  /**
   * Vertex-interpolated AO: blend the per-voxel AO of occupied voxels touching
   * a cube corner. `corner` is the local corner offset in {-0.5,+0.5}^3.
   * Mirrors the vertex-normal gather so AO and shading share continuity.
   */
  vertexAO(
    vx: number,
    vy: number,
    vz: number,
    corner: [number, number, number],
    fallback: number,
  ): number {
    const sx = corner[0] > 0 ? 1 : -1;
    const sy = corner[1] > 0 ? 1 : -1;
    const sz = corner[2] > 0 ? 1 : -1;

    let acc = 0;
    let total = 0;

    for (const ox of [0, sx])
      for (const oy of [0, sy])
        for (const oz of [0, sz]) {
          const nx = vx + ox;
          const ny = vy + oy;
          const nz = vz + oz;
          if (!this.data.isSolid(nx, ny, nz)) continue;
          const w = ox === 0 && oy === 0 && oz === 0 ? 1.5 : 1.0;
          acc += this.get(nx, ny, nz) * w;
          total += w;
        }

    if (total <= 1e-6) return fallback;
    return acc / total;
  }
}
