import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  type Raycaster,
} from "three";
import type { VoxelDims } from "@/voxel/VoxelData";
import type { TriViewMasks } from "@/voxel/TriViewMasks";
import type { Palette } from "@/voxel/palette";

export type PlaneId = "top" | "front" | "side";

/** A cell hit on one of the planes, in that plane's logical (a, b) coordinates. */
export interface PlaneHit {
  id: PlaneId;
  a: number;
  b: number;
}

export interface PreviewSpec {
  id: PlaneId;
  cells: Array<[number, number]>;
  /** Palette index being painted (0 = erase) - drives the preview tint. */
  value: number;
}

interface PlaneEntry {
  id: PlaneId;
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  cols: number;
  rows: number;
}

const CELL_PX = 14;

/**
 * The three silhouette planes shown inside the volume during tri-view modeling.
 *
 * They are arranged as an open corner (floor + back wall + left wall) so the
 * default camera looks into all three inner faces at once, like drawing
 * reference shadows on the walls of a box:
 *
 *   top   (X/Z) -> floor at y = 0
 *   front (X/Y) -> back wall at z = 0
 *   side  (Z/Y) -> left wall at x = 0
 *
 * Painting maps a world-space ray hit directly to integer cell coordinates,
 * and the painted silhouette is displayed via a per-plane CanvasTexture.
 */
export class TriViewPlanes {
  readonly group = new Group();
  private planes: PlaneEntry[] = [];

  constructor(
    dims: VoxelDims,
    private readonly masks: TriViewMasks,
  ) {
    const { x: dx, y: dy, z: dz } = dims;

    this.planes.push(this.build("top", dx, dz));
    this.planes.push(this.build("front", dx, dy));
    this.planes.push(this.build("side", dz, dy));

    // top: floor at y=0, facing up.
    const top = this.planes[0].mesh;
    top.rotation.x = -Math.PI / 2;
    top.position.set(dx / 2, 0, dz / 2);

    // front: back wall at z=0, facing +Z.
    this.planes[1].mesh.position.set(dx / 2, dy / 2, 0);

    // side: left wall at x=0, facing +X.
    const side = this.planes[2].mesh;
    side.rotation.y = Math.PI / 2;
    side.position.set(0, dy / 2, dz / 2);

    for (const p of this.planes) this.group.add(p.mesh);
    this.group.visible = false;
  }

  private build(id: PlaneId, cols: number, rows: number): PlaneEntry {
    const canvas = document.createElement("canvas");
    canvas.width = cols * CELL_PX;
    canvas.height = rows * CELL_PX;
    const ctx = canvas.getContext("2d")!;

    const texture = new CanvasTexture(canvas);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;

    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(new PlaneGeometry(cols, rows), material);
    mesh.renderOrder = 2;

    return { id, mesh, canvas, ctx, texture, cols, rows };
  }

  private entry(id: PlaneId): PlaneEntry {
    return this.planes.find((p) => p.id === id)!;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  cols(id: PlaneId): number {
    return this.entry(id).cols;
  }
  rows(id: PlaneId): number {
    return this.entry(id).rows;
  }

  get(id: PlaneId, a: number, b: number): number {
    if (id === "top") return this.masks.getTop(a, b);
    if (id === "front") return this.masks.getFront(a, b);
    return this.masks.getSide(a, b);
  }
  set(id: PlaneId, a: number, b: number, v: number): void {
    if (id === "top") this.masks.setTop(a, b, v);
    else if (id === "front") this.masks.setFront(a, b, v);
    else this.masks.setSide(a, b, v);
  }

  /** Raycast the planes; returns the cell hit, or null. */
  pick(raycaster: Raycaster): PlaneHit | null {
    const hits = raycaster.intersectObjects(
      this.planes.map((p) => p.mesh),
      false,
    );
    if (hits.length === 0) return null;
    const mesh = hits[0].object as Mesh;
    const entry = this.planes.find((p) => p.mesh === mesh);
    if (!entry) return null;

    const p = hits[0].point;
    let a: number;
    let b: number;
    if (entry.id === "top") {
      a = Math.floor(p.x);
      b = Math.floor(p.z);
    } else if (entry.id === "front") {
      a = Math.floor(p.x);
      b = Math.floor(p.y);
    } else {
      a = Math.floor(p.z);
      b = Math.floor(p.y);
    }
    a = Math.max(0, Math.min(entry.cols - 1, a));
    b = Math.max(0, Math.min(entry.rows - 1, b));
    return { id: entry.id, a, b };
  }

  /** Convert a logical (a, b) cell to its canvas pixel origin for this plane. */
  private cellToPixel(entry: PlaneEntry, a: number, b: number): [number, number] {
    if (entry.id === "top") return [a * CELL_PX, b * CELL_PX];
    if (entry.id === "front")
      return [a * CELL_PX, (entry.rows - 1 - b) * CELL_PX];
    // side
    return [(entry.cols - 1 - a) * CELL_PX, (entry.rows - 1 - b) * CELL_PX];
  }

  redraw(palette: Palette, preview?: PreviewSpec, hover?: PlaneHit): void {
    for (const entry of this.planes) {
      this.redrawEntry(entry, palette, preview, hover);
    }
  }

  private redrawEntry(
    entry: PlaneEntry,
    palette: Palette,
    preview: PreviewSpec | undefined,
    hover: PlaneHit | undefined,
  ): void {
    const { ctx, cols, rows } = entry;
    const w = cols * CELL_PX;
    const h = rows * CELL_PX;

    ctx.clearRect(0, 0, w, h);
    // Faint backing so empty planes are visible but see-through to the model.
    ctx.fillStyle = "rgba(18,20,26,0.42)";
    ctx.fillRect(0, 0, w, h);

    // Filled silhouette cells, each in its own painted color.
    ctx.globalAlpha = 0.95;
    for (let b = 0; b < rows; b++)
      for (let a = 0; a < cols; a++) {
        const idx = this.get(entry.id, a, b);
        if (idx) {
          ctx.fillStyle = palette[idx] ?? "#ffffff";
          const [px, py] = this.cellToPixel(entry, a, b);
          ctx.fillRect(px, py, CELL_PX, CELL_PX);
        }
      }
    ctx.globalAlpha = 1;

    // Pending box/line preview on the active plane.
    if (preview && preview.id === entry.id) {
      ctx.fillStyle = preview.value ? palette[preview.value] ?? "#ffffff" : "#ff6b6b";
      ctx.globalAlpha = 0.5;
      for (const [a, b] of preview.cells) {
        const [px, py] = this.cellToPixel(entry, a, b);
        ctx.fillRect(px, py, CELL_PX, CELL_PX);
      }
      ctx.globalAlpha = 1;
    }

    // Grid.
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      ctx.moveTo(c * CELL_PX + 0.5, 0);
      ctx.lineTo(c * CELL_PX + 0.5, h);
    }
    for (let r = 0; r <= rows; r++) {
      ctx.moveTo(0, r * CELL_PX + 0.5);
      ctx.lineTo(w, r * CELL_PX + 0.5);
    }
    ctx.stroke();

    // Hover cell outline.
    if (hover && hover.id === entry.id) {
      const [px, py] = this.cellToPixel(entry, hover.a, hover.b);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);
    }

    entry.texture.needsUpdate = true;
  }

  dispose(): void {
    for (const p of this.planes) {
      p.mesh.geometry.dispose();
      (p.mesh.material as MeshBasicMaterial).dispose();
      p.texture.dispose();
    }
  }
}
