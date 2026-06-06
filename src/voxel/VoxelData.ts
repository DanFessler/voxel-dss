// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Dan Fessler
// Part of the Derived Surface Shading (DSS) method library. See ./LICENSE.

import { EMPTY_INDEX } from "./palette";

/** Integer voxel coordinate. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface VoxelDims {
  x: number;
  y: number;
  z: number;
}

/** A single occupied voxel: integer position plus palette color index. */
export interface Voxel {
  x: number;
  y: number;
  z: number;
  color: number;
}

const MAX_DIM = 256;

/**
 * Sparse voxel volume.
 *
 * Storage is a Map from a packed integer key to a 1-based palette index.
 * Empty space is simply absent from the map. Coordinates are bounded to
 * `[0, dims)` on each axis (MagicaVoxel-style bounded model space).
 */
export class VoxelData {
  dims: VoxelDims;
  private cells = new Map<number, number>();

  constructor(dims: VoxelDims = { x: 32, y: 32, z: 32 }) {
    this.dims = {
      x: Math.min(MAX_DIM, Math.max(1, dims.x)),
      y: Math.min(MAX_DIM, Math.max(1, dims.y)),
      z: Math.min(MAX_DIM, Math.max(1, dims.z)),
    };
  }

  private key(x: number, y: number, z: number): number {
    // Pack into a single integer. MAX_DIM (256) needs 8 bits per axis -> 24 bits.
    return (x << 16) | (y << 8) | z;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return (
      x >= 0 &&
      y >= 0 &&
      z >= 0 &&
      x < this.dims.x &&
      y < this.dims.y &&
      z < this.dims.z
    );
  }

  /** True if the cell holds a voxel. Out-of-bounds always reads as empty. */
  isSolid(x: number, y: number, z: number): boolean {
    if (!this.inBounds(x, y, z)) return false;
    return this.cells.has(this.key(x, y, z));
  }

  /** Palette index at a cell, or EMPTY_INDEX if empty / out of bounds. */
  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return EMPTY_INDEX;
    return this.cells.get(this.key(x, y, z)) ?? EMPTY_INDEX;
  }

  /** Set a voxel color, or remove it when color is EMPTY_INDEX. */
  set(x: number, y: number, z: number, color: number): void {
    if (!this.inBounds(x, y, z)) return;
    const k = this.key(x, y, z);
    if (color === EMPTY_INDEX) this.cells.delete(k);
    else this.cells.set(k, color);
  }

  remove(x: number, y: number, z: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.cells.delete(this.key(x, y, z));
  }

  clear(): void {
    this.cells.clear();
  }

  get count(): number {
    return this.cells.size;
  }

  /** Iterate occupied voxels. */
  forEach(fn: (v: Voxel) => void): void {
    for (const [k, color] of this.cells) {
      fn({
        x: (k >> 16) & 0xff,
        y: (k >> 8) & 0xff,
        z: k & 0xff,
        color,
      });
    }
  }

  toArray(): Voxel[] {
    const out: Voxel[] = [];
    this.forEach((v) => out.push(v));
    return out;
  }

  /** Deep copy (used for undo/redo snapshots). */
  clone(): VoxelData {
    const copy = new VoxelData(this.dims);
    copy.cells = new Map(this.cells);
    return copy;
  }

  /** A face is exposed when the neighbor in that direction is empty. */
  isFaceVisible(x: number, y: number, z: number, dx: number, dy: number, dz: number): boolean {
    return !this.isSolid(x + dx, y + dy, z + dz);
  }

  /** True if the voxel has at least one exposed face (i.e. it is on the surface). */
  isVisible(x: number, y: number, z: number): boolean {
    return (
      this.isFaceVisible(x, y, z, 1, 0, 0) ||
      this.isFaceVisible(x, y, z, -1, 0, 0) ||
      this.isFaceVisible(x, y, z, 0, 1, 0) ||
      this.isFaceVisible(x, y, z, 0, -1, 0) ||
      this.isFaceVisible(x, y, z, 0, 0, 1) ||
      this.isFaceVisible(x, y, z, 0, 0, -1)
    );
  }
}
