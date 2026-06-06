// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Dan Fessler
// Part of the Derived Surface Shading (DSS) method library. See ./LICENSE.

import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import type { VoxelData } from "./VoxelData";
import { NormalFieldCache, type DssSettings } from "./dss";
import { OcclusionFieldCache, type AoSettings } from "./ao";
import { hexToRgb01, type Palette } from "./palette";

interface FaceDef {
  /** Geometric cube-face normal. */
  n: Vector3;
  /** Neighbor direction used for face culling. */
  d: [number, number, number];
  /** Four corner offsets in local cube space (unit cube centered at origin). */
  corners: [number, number, number][];
}

const FACES: FaceDef[] = [
  {
    n: new Vector3(1, 0, 0),
    d: [1, 0, 0],
    corners: [
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, 0.5, 0.5],
      [0.5, -0.5, 0.5],
    ],
  },
  {
    n: new Vector3(-1, 0, 0),
    d: [-1, 0, 0],
    corners: [
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, -0.5],
    ],
  },
  {
    n: new Vector3(0, 1, 0),
    d: [0, 1, 0],
    corners: [
      [-0.5, 0.5, -0.5],
      [-0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
      [0.5, 0.5, -0.5],
    ],
  },
  {
    n: new Vector3(0, -1, 0),
    d: [0, -1, 0],
    corners: [
      [-0.5, -0.5, 0.5],
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, -0.5, 0.5],
    ],
  },
  {
    n: new Vector3(0, 0, 1),
    d: [0, 0, 1],
    corners: [
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, -0.5, 0.5],
    ],
  },
  {
    n: new Vector3(0, 0, -1),
    d: [0, 0, -1],
    corners: [
      [-0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, -0.5, -0.5],
    ],
  },
];

export interface MeshBuildResult {
  geometry: BufferGeometry;
  faceCount: number;
}

/**
 * Build a culled, vertex-colored surface mesh for the voxel volume.
 *
 * Normals come from the chosen DSS mode:
 *  - "cube": geometric cube-face normals (classic voxel look).
 *  - "perVoxel": one derived normal per voxel (whitepaper 10.1).
 *  - "vertexInterpolated": continuous derived normals per vertex (10.2).
 *
 * Voxels are emitted centered on integer coordinates and offset by +0.5 so the
 * volume sits in the positive octant (the cell [0,0,0] spans world 0..1).
 */
export function buildVoxelMesh(
  data: VoxelData,
  palette: Palette,
  settings: DssSettings,
  ao: AoSettings,
): MeshBuildResult {
  const cache = new NormalFieldCache(data, settings);
  const aoCache =
    ao.mode === "off" ? null : new OcclusionFieldCache(data, ao);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vi = 0;
  let faceCount = 0;

  data.forEach((v) => {
    const baseNormal =
      settings.shading === "cube" ? null : cache.get(v.x, v.y, v.z);
    const baseAo = aoCache ? aoCache.get(v.x, v.y, v.z) : 1;
    const [r, g, b] = hexToRgb01(palette[v.color] ?? "#ffffff");

    for (const f of FACES) {
      if (data.isSolid(v.x + f.d[0], v.y + f.d[1], v.z + f.d[2])) continue;

      for (const c of f.corners) {
        let normal: Vector3;
        if (settings.shading === "cube") {
          normal = f.n;
        } else if (settings.shading === "vertexInterpolated") {
          normal = cache.vertexNormal(v.x, v.y, v.z, c, baseNormal!);
        } else {
          normal = baseNormal!;
        }

        let aoFactor = 1;
        if (aoCache) {
          aoFactor =
            ao.mode === "vertexInterpolated"
              ? aoCache.vertexAO(v.x, v.y, v.z, c, baseAo)
              : baseAo;
        }

        positions.push(
          v.x + 0.5 + c[0],
          v.y + 0.5 + c[1],
          v.z + 0.5 + c[2],
        );
        normals.push(normal.x, normal.y, normal.z);
        colors.push(r * aoFactor, g * aoFactor, b * aoFactor);
      }

      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
      faceCount++;
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return { geometry, faceCount };
}
