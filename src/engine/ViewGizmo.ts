import {
  BoxGeometry,
  type Camera,
  CanvasTexture,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";

export type GizmoFace = "front" | "back" | "left" | "right" | "top" | "bottom";

// BoxGeometry material/group order: +X, -X, +Y, -Y, +Z, -Z.
const FACE_BY_INDEX: GizmoFace[] = [
  "right",
  "left",
  "top",
  "bottom",
  "front",
  "back",
];
const LABELS: Record<GizmoFace, string> = {
  right: "RIGHT",
  left: "LEFT",
  top: "TOP",
  bottom: "BOTTOM",
  front: "FRONT",
  back: "BACK",
};

const SIZE = 104; // gizmo viewport size, CSS px
const MARGIN = 14; // distance from the top-right corner, CSS px
const CUBE = 1.4;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeLabel(text: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#262b36";
  roundRect(ctx, 5, 5, 118, 118, 16);
  ctx.fill();
  ctx.strokeStyle = "#3c4555";
  ctx.lineWidth = 4;
  roundRect(ctx, 5, 5, 118, 118, 16);
  ctx.stroke();
  ctx.fillStyle = "#eef2f7";
  ctx.font = "bold 25px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 67);
  return new CanvasTexture(c);
}

/**
 * A small navigation cube rendered as an overlay in the top-right corner. It
 * mirrors the main camera's orientation, and clicking a labeled face reports
 * which side the user wants to look at.
 */
export class ViewGizmo {
  private scene = new Scene();
  private camera = new OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 100);
  private cube: Mesh;
  private materials: MeshBasicMaterial[];
  private raycaster = new Raycaster();
  private hovered: GizmoFace | null = null;
  private layout = { w: 0, h: 0 };

  constructor() {
    this.materials = FACE_BY_INDEX.map(
      (f) => new MeshBasicMaterial({ map: makeLabel(LABELS[f]) }),
    );
    this.cube = new Mesh(new BoxGeometry(CUBE, CUBE, CUBE), this.materials);
    this.scene.add(this.cube);

    const edges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(CUBE, CUBE, CUBE)),
      new LineBasicMaterial({ color: 0x0b0d12 }),
    );
    this.cube.add(edges);

    this.camera.position.set(0, 0, 4);
    this.camera.lookAt(0, 0, 0);
  }

  /** Point the gizmo camera the same way the main camera views the target. */
  update(mainCamera: Camera, target: Vector3): void {
    const dir = mainCamera.position.clone().sub(target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(4);
    this.camera.position.copy(dir);
    this.camera.up.copy(mainCamera.up);
    this.camera.lookAt(0, 0, 0);

    for (let i = 0; i < this.materials.length; i++) {
      const lit = FACE_BY_INDEX[i] === this.hovered;
      this.materials[i].color.setHex(lit ? 0xffffff : 0xb9c2cf);
    }
  }

  /** Draw the cube into a scissored corner viewport, on top of the scene. */
  render(renderer: WebGLRenderer): void {
    const size = renderer.getSize(new Vector2());
    this.layout.w = size.x;
    this.layout.h = size.y;

    const x = size.x - SIZE - MARGIN;
    const y = size.y - SIZE - MARGIN; // GL origin is bottom-left; top margin.

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setViewport(x, y, SIZE, SIZE);
    renderer.setScissor(x, y, SIZE, SIZE);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.setScissor(0, 0, size.x, size.y);
    renderer.autoClear = prevAutoClear;
  }

  /** Is the canvas-relative point (px, py) inside the gizmo's corner? */
  containsPoint(px: number, py: number): boolean {
    const l = this.layout.w - SIZE - MARGIN;
    const t = MARGIN;
    return px >= l && px <= l + SIZE && py >= t && py <= t + SIZE;
  }

  /** Which face is under the canvas-relative point, if any. */
  pick(px: number, py: number): GizmoFace | null {
    const l = this.layout.w - SIZE - MARGIN;
    const t = MARGIN;
    const ndcX = ((px - l) / SIZE) * 2 - 1;
    const ndcY = -(((py - t) / SIZE) * 2 - 1);
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.intersectObject(this.cube, false)[0];
    if (!hit || !hit.face) return null;
    return FACE_BY_INDEX[hit.face.materialIndex ?? 0] ?? null;
  }

  setHover(face: GizmoFace | null): void {
    this.hovered = face;
  }

  dispose(): void {
    this.cube.geometry.dispose();
    for (const m of this.materials) {
      m.map?.dispose();
      m.dispose();
    }
    this.cube.traverse((o) => {
      if (o instanceof LineSegments) {
        o.geometry.dispose();
        (o.material as LineBasicMaterial).dispose();
      }
    });
  }
}
