import type { VoxelData, VoxelDims } from "./VoxelData";

/** A deep copy of the three mask arrays, used for undo/redo history. */
export interface MaskSnapshot {
  top: Uint8Array;
  front: Uint8Array;
  side: Uint8Array;
}

/**
 * Three orthographic silhouette masks used for "tri-view" modeling.
 *
 * Each cell stores a palette color index (0 = empty) rather than a plain bit,
 * so strokes carry the color they were painted with. The volume is the
 * intersection of the three extruded silhouettes (the visual hull):
 *
 *   solid(x,y,z)  <=>  top(x,z) AND front(x,y) AND side(z,y)
 *
 * Color is an orthographic projection onto the three planes, which sit at the
 * minimum-coordinate walls (top->y=0 floor, front->z=0 back, side->x=0 left):
 *  - capture: each cell takes the color of the voxel nearest that plane (the
 *    surface facing the wall), so the plane shows the model projected onto it.
 *  - reconstruct: each solid voxel takes the color of the plane it is closest
 *    to (min of x, y, z). Painting a color on a plane therefore tints the
 *    voxels nearest that plane, and a uniformly colored model round-trips
 *    exactly.
 *
 * This is lossy by nature (three projections cannot encode a full volume), but
 * it is stable: re-projecting a reconstruction of a single color is identity.
 *
 * Plane conventions (logical coordinates, before any canvas row flipping):
 *  - top:   looking down  -Y, indexed by (x, z)   [x across, z deep]
 *  - front: looking along -Z, indexed by (x, y)   [x across, y up]
 *  - side:  looking along -X, indexed by (z, y)   [z across, y up]
 */
export class TriViewMasks {
  readonly dims: VoxelDims;
  readonly top: Uint8Array; // size x*z, palette index (0 = empty)
  readonly front: Uint8Array; // size x*y
  readonly side: Uint8Array; // size z*y

  constructor(dims: VoxelDims) {
    this.dims = { ...dims };
    this.top = new Uint8Array(dims.x * dims.z);
    this.front = new Uint8Array(dims.x * dims.y);
    this.side = new Uint8Array(dims.z * dims.y);
  }

  getTop(x: number, z: number): number {
    return this.top[x + z * this.dims.x];
  }
  setTop(x: number, z: number, v: number): void {
    this.top[x + z * this.dims.x] = v & 0xff;
  }

  getFront(x: number, y: number): number {
    return this.front[x + y * this.dims.x];
  }
  setFront(x: number, y: number, v: number): void {
    this.front[x + y * this.dims.x] = v & 0xff;
  }

  getSide(z: number, y: number): number {
    return this.side[z + y * this.dims.z];
  }
  setSide(z: number, y: number, v: number): void {
    this.side[z + y * this.dims.z] = v & 0xff;
  }

  clearAll(): void {
    this.top.fill(0);
    this.front.fill(0);
    this.side.fill(0);
  }

  snapshot(): MaskSnapshot {
    return {
      top: this.top.slice(),
      front: this.front.slice(),
      side: this.side.slice(),
    };
  }

  /** Restore arrays in place (keeps the object identity for plane references). */
  restore(snap: MaskSnapshot): void {
    this.top.set(snap.top);
    this.front.set(snap.front);
    this.side.set(snap.side);
  }

  /**
   * Seed the three masks from a volume. Occupancy is the full silhouette (any
   * voxel marks the cell), while color is the orthographic projection: each
   * cell takes the color of the voxel nearest its plane.
   */
  projectFromVolume(data: VoxelData): void {
    this.clearAll();
    const { x: dx, z: dz } = this.dims;
    const FAR = 0x7fffffff;
    const bestTop = new Int32Array(this.top.length).fill(FAR); // nearest min-y
    const bestFront = new Int32Array(this.front.length).fill(FAR); // nearest min-z
    const bestSide = new Int32Array(this.side.length).fill(FAR); // nearest min-x

    data.forEach((v) => {
      const c = v.color;
      const ti = v.x + v.z * dx;
      if (v.y < bestTop[ti]) {
        bestTop[ti] = v.y;
        this.top[ti] = c;
      }
      const fi = v.x + v.y * dx;
      if (v.z < bestFront[fi]) {
        bestFront[fi] = v.z;
        this.front[fi] = c;
      }
      const si = v.z + v.y * dz;
      if (v.x < bestSide[si]) {
        bestSide[si] = v.x;
        this.side[si] = c;
      }
    });
  }

  /**
   * Reconstruct a volume as the intersection of the three masks. Clears `data`
   * first and, for each cell present in all three silhouettes, writes the color
   * of the plane the voxel is closest to (the smallest of x, y, z).
   */
  applyToVolume(data: VoxelData): void {
    const { x: dx, y: dy, z: dz } = this.dims;
    data.clear();
    for (let y = 0; y < dy; y++)
      for (let z = 0; z < dz; z++)
        for (let x = 0; x < dx; x++) {
          const t = this.getTop(x, z);
          if (!t) continue;
          const f = this.getFront(x, y);
          if (!f) continue;
          const s = this.getSide(z, y);
          if (!s) continue;
          // Nearest plane wins: side at x=0, top at y=0, front at z=0.
          const color = x <= y && x <= z ? s : y <= z ? t : f;
          data.set(x, y, z, color);
        }
  }
}
