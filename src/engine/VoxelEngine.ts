import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  GridHelper,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ViewGizmo, type GizmoFace } from "./ViewGizmo";
import { VoxelData, type VoxelDims } from "@/voxel/VoxelData";
import type { Palette } from "@/voxel/palette";
import { TriViewMasks, type MaskSnapshot } from "@/voxel/TriViewMasks";
import {
  TriViewPlanes,
  type PlaneHit,
  type PlaneId,
  type PreviewSpec,
} from "./TriViewPlanes";
import { buildVoxelMesh } from "@/voxel/meshBuilder";
import type { DssSettings } from "@/voxel/dss";
import type { AoSettings } from "@/voxel/ao";
import { useEditorStore } from "@/state/editorStore";
import type { BrushShape, MirrorAxis, ToolAction } from "@/state/editorStore";
import {
  fillStarterShape,
  type StarterShapeId,
} from "@/voxel/starterShapes";

const MAX_HISTORY = 64;

/** One undo/redo step: the volume plus the tri-view masks at that point. */
interface HistoryEntry {
  volume: VoxelData;
  masks: MaskSnapshot;
}

// Camera view modes. The transition is run on the perspective camera by
// narrowing the FOV (and dollying out to hold perceived size), then we swap to
// a true orthographic camera at the end so parallel lines are actually parallel.
const FOV_PERSP = 45;
const FOV_ORTHO = 6; // near-parallel; the seam into the real ortho camera.
const CAM_ANIM_DURATION = 0.26; // seconds - snappy.

/** In-flight camera transition between view modes / orientations. */
interface CamAnim {
  elapsed: number;
  startTheta: number;
  startPhi: number;
  startFov: number;
  dTheta: number;
  goalPhi: number;
  goalFov: number;
  /** radius * tan(fov/2) - constant for the whole transition (perceived size). */
  k: number;
  target: Vector3;
  onDone?: () => void;
}

// Line strokes span at most one volume dimension (<= 256 cells); this cap leaves
// generous headroom for the instanced preview buffer.
const MAX_PREVIEW_CELLS = 1024;

// Preview tint by action, so the drag clearly reads as add / erase / paint.
const PREVIEW_COLORS: Record<string, number> = {
  attach: 0x9ec1ff,
  erase: 0xff6b6b,
  paint: 0x8fe39a,
};

interface Cell {
  x: number;
  y: number;
  z: number;
}

/**
 * Owns the Three.js scene and all imperative editing. React mounts it to a DOM
 * container and the editor store drives its settings; the engine pushes stats
 * back to the store.
 */
export class VoxelEngine {
  private container: HTMLElement;
  private scene = new Scene();
  private perspCamera: PerspectiveCamera;
  private orthoCamera: OrthographicCamera;
  private camera: PerspectiveCamera | OrthographicCamera;
  private renderer: WebGLRenderer;
  private controls: OrbitControls;

  private data: VoxelData;
  private meshGroup = new Group();
  private mesh: Mesh | null = null;
  private edges: LineSegments | null = null;
  private material: MeshStandardMaterial;

  private grid: GridHelper;
  private groundPlane: Mesh;
  private hover: Mesh;

  // Live preview shown while dragging a box or line stroke.
  private previewGroup = new Group();
  private previewBox!: Mesh;
  private previewBoxEdges!: LineSegments;
  private previewCells!: InstancedMesh;
  private previewMatrix = new Matrix4();

  // Tri-view modeling: silhouette masks + the in-volume planes you draw on.
  private triMasks: TriViewMasks;
  private triPlanes: TriViewPlanes;
  private triPainting = false;
  private triValue = 1;
  private triDragStart: PlaneHit | null = null;

  // Orientation gizmo + camera view-mode state.
  private gizmo = new ViewGizmo();
  private camAnim: CamAnim | null = null;
  private projection: "persp" | "ortho" = "persp";
  private lastT = performance.now();

  private dirLight: DirectionalLight;
  private raycaster = new Raycaster();
  private pointer = new Vector2();

  private unsubscribe: () => void;
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private lightAngle = 0;
  private disposed = false;

  // Drag state for shape brushes.
  private isPainting = false;
  private dragStart: Cell | null = null;
  private paintedThisStroke = new Set<number>();

  // While Space is held, left-drag pans instead of drawing (MagicaVoxel).
  private spacePan = false;

  // Undo/redo snapshots. Each entry captures both the volume and the tri-view
  // masks so undo is correct in either editing mode.
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    const { clientWidth: w, clientHeight: h } = container;

    this.data = new VoxelData({ x: 32, y: 32, z: 32 });

    this.scene.background = new Color(0x1a1c22);

    this.perspCamera = new PerspectiveCamera(FOV_PERSP, w / h, 0.1, 4000);
    this.orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
    this.camera = this.perspCamera;
    const c = this.center();
    this.camera.position.set(c.x + 40, c.y + 38, c.z + 52);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.copy(c);
    // MagicaVoxel conventions: left = draw (reserved for editing, so it is
    // omitted here), right = orbit, middle = pan, wheel = zoom.
    this.controls.mouseButtons = { MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
    // Touch: one finger orbits, two fingers pan/zoom (editing uses the pen/tap
    // path via pointer events).
    this.controls.update();

    // Lighting.
    this.scene.add(new AmbientLight(0xffffff, 0.45));
    this.dirLight = new DirectionalLight(0xffffff, 2.0);
    this.dirLight.position.set(c.x + 30, c.y + 50, c.z + 20);
    this.scene.add(this.dirLight);

    // Grid + ground (ground is an invisible raycast target at y = 0).
    this.grid = new GridHelper(
      Math.max(this.data.dims.x, this.data.dims.z),
      Math.max(this.data.dims.x, this.data.dims.z),
      0x556070,
      0x33404d,
    );
    this.grid.position.set(this.data.dims.x / 2, 0, this.data.dims.z / 2);
    this.scene.add(this.grid);

    const planeSize = Math.max(this.data.dims.x, this.data.dims.z);
    this.groundPlane = new Mesh(
      new PlaneGeometry(planeSize, planeSize),
      new MeshBasicMaterial({ visible: false }),
    );
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.set(this.data.dims.x / 2, 0, this.data.dims.z / 2);
    this.scene.add(this.groundPlane);

    this.scene.add(this.meshGroup);

    // Hover highlight.
    this.hover = new Mesh(
      new BoxGeometry(1.02, 1.02, 1.02),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    this.hover.visible = false;
    this.scene.add(this.hover);

    // Drag preview: a translucent box for box-mode (the filled region) and an
    // instanced set of cells for line-mode (the actual voxels along the line).
    const previewFill = new MeshBasicMaterial({
      color: PREVIEW_COLORS.attach,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.previewBox = new Mesh(new BoxGeometry(1, 1, 1), previewFill);
    this.previewBoxEdges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1, 1, 1)),
      new LineBasicMaterial({ color: PREVIEW_COLORS.attach }),
    );
    this.previewCells = new InstancedMesh(
      new BoxGeometry(1.02, 1.02, 1.02),
      previewFill.clone(),
      MAX_PREVIEW_CELLS,
    );
    this.previewCells.count = 0;
    this.previewCells.frustumCulled = false;
    this.previewGroup.add(this.previewBox, this.previewBoxEdges, this.previewCells);
    this.previewGroup.visible = false;
    this.scene.add(this.previewGroup);

    this.material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.0,
    });

    // Tri-view planes (hidden until the user switches to tri-view mode).
    this.triMasks = new TriViewMasks(this.data.dims);
    this.triPlanes = new TriViewPlanes(this.data.dims, this.triMasks);
    this.scene.add(this.triPlanes.group);

    this.seedDemoModel();
    this.rebuildMesh();
    this.syncStats();

    // Subscribe to store changes that require engine reaction.
    this.unsubscribe = useEditorStore.subscribe((state, prev) =>
      this.onStoreChange(state, prev),
    );

    // DOM events.
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.renderLoop();
  }

  private center(): Vector3 {
    return new Vector3(
      this.data.dims.x / 2,
      this.data.dims.y / 2,
      this.data.dims.z / 2,
    );
  }

  private dssSettings(): DssSettings {
    const s = useEditorStore.getState();
    return { field: s.field, shading: s.shading, kernelRadius: s.kernelRadius };
  }

  private aoSettings(): AoSettings {
    const s = useEditorStore.getState();
    return { mode: s.aoMode, radius: s.aoRadius, intensity: s.aoIntensity };
  }

  /** Initial white sphere so the viewport isn't empty on first load. */
  private seedDemoModel(): void {
    fillStarterShape(this.data, "sphere");
  }

  // ---------------------------------------------------------------- rendering

  private rebuildMesh(): void {
    if (this.mesh) {
      this.meshGroup.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.edges) {
      this.meshGroup.remove(this.edges);
      this.edges.geometry.dispose();
      (this.edges.material as LineBasicMaterial).dispose();
      this.edges = null;
    }

    const { geometry, faceCount } = buildVoxelMesh(
      this.data,
      useEditorStore.getState().palette,
      this.dssSettings(),
      this.aoSettings(),
    );

    this.mesh = new Mesh(geometry, this.material);
    this.meshGroup.add(this.mesh);

    if (useEditorStore.getState().showEdges && faceCount < 6000) {
      const eg = new EdgesGeometry(geometry, 1);
      this.edges = new LineSegments(
        eg,
        new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
      );
      this.meshGroup.add(this.edges);
    }

    this.lastFaceCount = faceCount;
  }

  private lastFaceCount = 0;
  private rebuildPending = false;

  private renderLoop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.renderLoop);

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    this.flushRebuild();

    if (useEditorStore.getState().lightAutoRotate) {
      this.lightAngle += 0.01;
      const c = this.center();
      const radius = Math.max(this.data.dims.x, this.data.dims.z);
      this.dirLight.position.set(
        c.x + Math.cos(this.lightAngle) * radius,
        c.y + radius,
        c.z + Math.sin(this.lightAngle) * radius,
      );
    }

    // OrbitControls always runs (orbit is never blocked); an active transition
    // then overrides the camera on top of it.
    this.controls.update();
    if (this.camAnim) this.updateCamAnim(dt);

    this.renderer.render(this.scene, this.camera);
    this.gizmo.update(this.camera, this.controls.target);
    this.gizmo.render(this.renderer);
  };

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    const aspect = w / h;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();
    const top = this.orthoCamera.top;
    this.orthoCamera.left = -top * aspect;
    this.orthoCamera.right = top * aspect;
    this.orthoCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // --------------------------------------------------------- camera view modes

  private fovHalfTan(fovDeg: number): number {
    return Math.tan(((fovDeg * Math.PI) / 180) / 2);
  }

  private aspect(): number {
    const { clientWidth: w, clientHeight: h } = this.container;
    return h > 0 ? w / h : 1;
  }

  /** Make `cam` the active camera, rebinding OrbitControls to it. */
  private setActiveCamera(cam: PerspectiveCamera | OrthographicCamera): void {
    if (this.camera === cam) return;
    cam.position.copy(this.camera.position);
    cam.up.copy(this.camera.up);
    cam.quaternion.copy(this.camera.quaternion);
    this.camera = cam;
    this.controls.object = cam;
    this.controls.update();
  }

  /** Half-height of the view at the target plane (the perceived-size metric). */
  private currentK(): number {
    const r = this.camera.position.distanceTo(this.controls.target);
    if (this.camera === this.perspCamera) {
      return r * this.fovHalfTan(this.perspCamera.fov);
    }
    return this.orthoCamera.top / this.orthoCamera.zoom;
  }

  /**
   * Ensure the perspective camera is active and configured to match the current
   * view, so a FOV transition can start seamlessly from an orthographic lock.
   */
  private prepPerspForAnim(): void {
    if (this.camera === this.perspCamera) return;
    const k = this.currentK();
    const target = this.controls.target;
    const dir = this.camera.position.clone().sub(target).normalize();
    const r = k / this.fovHalfTan(FOV_ORTHO);
    this.perspCamera.fov = FOV_ORTHO;
    this.perspCamera.position.copy(target).addScaledVector(dir, r);
    this.perspCamera.up.copy(this.camera.up);
    this.perspCamera.updateProjectionMatrix();
    this.perspCamera.lookAt(target);
    this.setActiveCamera(this.perspCamera);
  }

  /** Swap to a true orthographic camera matching the current perspective view. */
  private swapToOrtho(): void {
    const k = this.currentK();
    const aspect = this.aspect();
    this.orthoCamera.top = k;
    this.orthoCamera.bottom = -k;
    this.orthoCamera.left = -k * aspect;
    this.orthoCamera.right = k * aspect;
    this.orthoCamera.zoom = 1;
    this.orthoCamera.updateProjectionMatrix();
    this.setActiveCamera(this.orthoCamera);
  }

  /** Camera spherical orientation (theta, phi) for a head-on view of a face. */
  private faceOrientation(face: GizmoFace): { theta: number; phi: number } {
    const H = Math.PI / 2;
    switch (face) {
      case "front":
        return { theta: 0, phi: H };
      case "back":
        return { theta: Math.PI, phi: H };
      case "right":
        return { theta: H, phi: H };
      case "left":
        return { theta: -H, phi: H };
      // Top/bottom look down the Y axis; snap the azimuth to 0 so the view is
      // consistently aligned (+Z toward the bottom of the screen) rather than
      // keeping whatever rotation the camera happened to have.
      case "top":
        return { theta: 0, phi: 1e-3 };
      case "bottom":
        return { theta: 0, phi: Math.PI - 1e-3 };
    }
  }

  private faceDir(face: GizmoFace): Vector3 {
    switch (face) {
      case "front":
        return new Vector3(0, 0, 1);
      case "back":
        return new Vector3(0, 0, -1);
      case "right":
        return new Vector3(1, 0, 0);
      case "left":
        return new Vector3(-1, 0, 0);
      case "top":
        return new Vector3(0, 1, 0);
      case "bottom":
        return new Vector3(0, -1, 0);
    }
  }

  /**
   * Start a camera transition on the perspective camera. `goalTheta`/`goalPhi`
   * may be null to keep the current orientation. The distance is derived from
   * the FOV each frame to hold the perceived size constant. Orbit is never
   * blocked - starting a drag cancels the animation (see onPointerDown).
   */
  private animateCamera(
    goalTheta: number | null,
    goalPhi: number | null,
    goalFov: number,
    onDone?: () => void,
  ): void {
    const target = this.controls.target.clone();
    const sph = new Spherical().setFromVector3(
      this.perspCamera.position.clone().sub(target),
    );
    const startFov = this.perspCamera.fov;
    let dTheta = (goalTheta ?? sph.theta) - sph.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta)); // shortest path

    this.camAnim = {
      elapsed: 0,
      startTheta: sph.theta,
      startPhi: sph.phi,
      startFov,
      dTheta,
      goalPhi: goalPhi ?? sph.phi,
      goalFov,
      k: sph.radius * this.fovHalfTan(startFov),
      target,
      onDone,
    };
  }

  private updateCamAnim(dt: number): void {
    const a = this.camAnim;
    if (!a) return;
    a.elapsed += dt;
    let t = a.elapsed / CAM_ANIM_DURATION;
    if (t > 1) t = 1;
    const e = 1 - Math.pow(1 - t, 3); // easeOutCubic - snappy

    const theta = a.startTheta + a.dTheta * e;
    let phi = a.startPhi + (a.goalPhi - a.startPhi) * e;
    phi = Math.max(1e-3, Math.min(Math.PI - 1e-3, phi));
    const fov = a.startFov + (a.goalFov - a.startFov) * e;
    const radius = a.k / this.fovHalfTan(fov);

    const sinP = Math.sin(phi);
    this.perspCamera.position.set(
      a.target.x + radius * sinP * Math.sin(theta),
      a.target.y + radius * Math.cos(phi),
      a.target.z + radius * sinP * Math.cos(theta),
    );
    this.perspCamera.fov = fov;
    this.perspCamera.updateProjectionMatrix();
    this.perspCamera.lookAt(a.target);

    if (t >= 1) {
      const done = a.onDone;
      this.camAnim = null;
      done?.();
    }
  }

  /** Handle a click on a gizmo face: orient + lock to ortho, or toggle back. */
  private onGizmoFace(face: GizmoFace): void {
    const dir = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const facingThis =
      this.projection === "ortho" && dir.dot(this.faceDir(face)) > 0.999;

    this.prepPerspForAnim();

    if (facingThis) {
      this.animateCamera(null, null, FOV_PERSP, () => {
        this.projection = "persp";
      });
      return;
    }

    const o = this.faceOrientation(face);
    this.animateCamera(o.theta, o.phi, FOV_ORTHO, () => this.swapToOrtho());
    this.projection = "ortho";
  }

  /** Cancel an in-flight transition and settle into free perspective orbit. */
  private cancelCamAnim(): void {
    if (!this.camAnim) return;
    this.camAnim = null;
    const k = this.currentK();
    const target = this.controls.target;
    const dir = this.perspCamera.position.clone().sub(target).normalize();
    this.perspCamera.fov = FOV_PERSP;
    this.perspCamera.position
      .copy(target)
      .addScaledVector(dir, k / this.fovHalfTan(FOV_PERSP));
    this.perspCamera.updateProjectionMatrix();
    this.perspCamera.lookAt(target);
    this.projection = "persp";
  }

  // ------------------------------------------------------------------ picking

  private updatePointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /**
   * Resolve the cell under the cursor.
   * Returns the solid cell hit and the empty cell adjacent to the hit face.
   */
  private pickCell(): { solid: Cell | null; place: Cell | null } {
    // Prefer the voxel mesh.
    if (this.mesh) {
      const hits = this.raycaster.intersectObject(this.mesh, false);
      if (hits.length > 0 && hits[0].face) {
        const p = hits[0].point;
        const n = hits[0].face.normal;
        const solid: Cell = {
          x: Math.floor(p.x - n.x * 0.5),
          y: Math.floor(p.y - n.y * 0.5),
          z: Math.floor(p.z - n.z * 0.5),
        };
        const place: Cell = {
          x: Math.floor(p.x + n.x * 0.5),
          y: Math.floor(p.y + n.y * 0.5),
          z: Math.floor(p.z + n.z * 0.5),
        };
        return { solid, place };
      }
    }

    // Fall back to the ground plane (y = 0 layer).
    const hits = this.raycaster.intersectObject(this.groundPlane, false);
    if (hits.length > 0) {
      const p = hits[0].point;
      const cell: Cell = { x: Math.floor(p.x), y: 0, z: Math.floor(p.z) };
      if (this.data.inBounds(cell.x, cell.y, cell.z)) {
        return { solid: cell, place: cell };
      }
    }
    return { solid: null, place: null };
  }

  /** Cell targeted by the current action (place for attach, solid otherwise). */
  private targetCell(action: ToolAction): Cell | null {
    const { solid, place } = this.pickCell();
    return action === "attach" ? place : solid;
  }

  // ------------------------------------------------------------------- events

  private onPointerDown = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const gx = e.clientX - rect.left;
    const gy = e.clientY - rect.top;

    // Clicking the orientation gizmo orients/locks the camera (left button).
    if (e.button === 0 && this.gizmo.containsPoint(gx, gy)) {
      const face = this.gizmo.pick(gx, gy);
      if (face) this.onGizmoFace(face);
      return;
    }
    // Orbiting (right-drag) must never be blocked: cancel any in-flight camera
    // transition so the drag takes over immediately in free perspective.
    if (e.button === 2 && this.camAnim) {
      this.cancelCamAnim();
    }

    if (e.button !== 0) return;
    // While Space is held, left-drag is a camera pan handled by OrbitControls.
    if (this.spacePan) return;
    this.updatePointer(e);

    const store = useEditorStore.getState();
    if (store.editorMode === "triview") {
      this.triPointerDown(store);
      return;
    }

    const action: ToolAction = e.altKey ? "pick" : store.action;

    if (action === "pick") {
      const { solid } = this.pickCell();
      if (solid && this.data.isSolid(solid.x, solid.y, solid.z)) {
        store.setCurrentColor(this.data.get(solid.x, solid.y, solid.z));
      }
      return;
    }

    const target = this.targetCell(action);
    if (!target) return;

    this.isPainting = true;
    this.paintedThisStroke.clear();
    this.snapshot();

    if (store.brush === "voxel" || store.brush === "face") {
      this.applyAction(target, action);
      this.commitEdit();
    } else {
      // box / line: remember the start and show a live preview; commit on up.
      this.dragStart = target;
      this.setPreviewColor(action);
      this.updateDragPreview(target, target, store.brush);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const store = useEditorStore.getState();

    // Hovering the orientation gizmo: highlight the face and skip voxel hover.
    if (!this.isPainting && !this.triPainting) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const gx = e.clientX - rect.left;
      const gy = e.clientY - rect.top;
      if (this.gizmo.containsPoint(gx, gy)) {
        this.gizmo.setHover(this.gizmo.pick(gx, gy));
        this.hover.visible = false;
        if (!this.spacePan) this.renderer.domElement.style.cursor = "pointer";
        return;
      }
      this.gizmo.setHover(null);
      if (!this.spacePan && this.renderer.domElement.style.cursor === "pointer") {
        this.renderer.domElement.style.cursor = "";
      }
    }

    this.updatePointer(e);
    if (store.editorMode === "triview") {
      this.hover.visible = false;
      this.triPointerMove(store);
      return;
    }
    const action: ToolAction = e.altKey ? "pick" : store.action;
    const target = this.targetCell(action === "pick" ? "erase" : action);

    // While dragging a box/line stroke, show the shape preview instead of the
    // single-cell hover. The actual edit is still applied atomically on up.
    if (
      this.isPainting &&
      (store.brush === "box" || store.brush === "line") &&
      this.dragStart &&
      target
    ) {
      this.updateDragPreview(this.dragStart, target, store.brush);
      return;
    }

    // Hover highlight.
    if (target) {
      const previewSize =
        store.brush === "voxel" && action !== "pick" ? store.brushSize : 1;
      this.hover.visible = true;
      this.hover.scale.set(previewSize, previewSize, previewSize);
      this.hover.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    } else {
      this.hover.visible = false;
    }

    if (!this.isPainting) return;

    if (store.brush === "voxel" && target) {
      // Continuous freehand painting.
      this.applyAction(target, action);
      this.commitEdit();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const store = useEditorStore.getState();
    if (store.editorMode === "triview") {
      this.updatePointer(e);
      this.triPointerUp(store);
      return;
    }
    if (!this.isPainting) {
      this.discardSnapshotIfNoop();
      return;
    }
    this.updatePointer(e);
    const action: ToolAction = store.action;

    if ((store.brush === "box" || store.brush === "line") && this.dragStart) {
      const end = this.targetCell(action);
      if (end) {
        const cells =
          store.brush === "box"
            ? this.boxCells(this.dragStart, end)
            : this.lineCells(this.dragStart, end);
        for (const cell of cells) this.applyAction(cell, action);
        this.commitEdit();
      }
    }

    this.hideDragPreview();
    this.isPainting = false;
    this.dragStart = null;
    this.discardSnapshotIfNoop();
  };

  private onPointerLeave = (): void => {
    this.hover.visible = false;
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.code === "Space" && !this.spacePan) {
      e.preventDefault();
      this.spacePan = true;
      // Temporarily let left-drag pan the camera.
      this.controls.mouseButtons.LEFT = MOUSE.PAN;
      this.renderer.domElement.style.cursor = "grab";
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space" && this.spacePan) {
      this.spacePan = false;
      delete this.controls.mouseButtons.LEFT;
      this.renderer.domElement.style.cursor = "";
    }
  };

  // -------------------------------------------------------------- editing ops

  private applyAction(cell: Cell, action: ToolAction): void {
    const store = useEditorStore.getState();
    const cells =
      store.brush === "voxel" && store.brushSize > 1
        ? this.brushFootprint(cell, store.brushSize)
        : [cell];

    for (const c of cells) {
      for (const m of this.mirrored(c, store.mirror)) {
        const k = (m.x << 16) | (m.y << 8) | m.z;
        if (this.paintedThisStroke.has(k)) continue;
        this.paintedThisStroke.add(k);

        if (action === "attach") {
          this.data.set(m.x, m.y, m.z, store.currentColor);
        } else if (action === "erase") {
          this.data.remove(m.x, m.y, m.z);
        } else if (action === "paint") {
          if (this.data.isSolid(m.x, m.y, m.z)) {
            this.data.set(m.x, m.y, m.z, store.currentColor);
          }
        }
      }
    }
  }

  /** Spherical brush footprint centered on `center` (MagicaVoxel voxel-mode style). */
  private brushFootprint(center: Cell, size: number): Cell[] {
    const radius = size / 2;
    const r = Math.ceil(radius - 1e-6);
    const cells: Cell[] = [];

    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const x = center.x + dx;
          const y = center.y + dy;
          const z = center.z + dz;
          if (this.data.inBounds(x, y, z)) cells.push({ x, y, z });
        }

    return cells;
  }

  private mirrored(cell: Cell, mirror: Record<MirrorAxis, boolean>): Cell[] {
    const cells: Cell[] = [cell];
    const expand = (axis: MirrorAxis, dim: number) => {
      if (!mirror[axis]) return;
      const copy: Cell[] = [];
      for (const c of cells) {
        const m = { ...c };
        m[axis] = dim - 1 - c[axis];
        copy.push(m);
      }
      cells.push(...copy);
    };
    expand("x", this.data.dims.x);
    expand("y", this.data.dims.y);
    expand("z", this.data.dims.z);
    return cells;
  }

  private boxCells(a: Cell, b: Cell): Cell[] {
    const cells: Cell[] = [];
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const [z0, z1] = [Math.min(a.z, b.z), Math.max(a.z, b.z)];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) cells.push({ x, y, z });
    return cells;
  }

  /** 3D DDA line between two cells. */
  private lineCells(a: Cell, b: Cell): Cell[] {
    const cells: Cell[] = [];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      cells.push({
        x: Math.round(a.x + dx * t),
        y: Math.round(a.y + dy * t),
        z: Math.round(a.z + dz * t),
      });
    }
    return cells;
  }

  // --------------------------------------------------------------- drag preview

  private setPreviewColor(action: ToolAction): void {
    const color = PREVIEW_COLORS[action] ?? PREVIEW_COLORS.attach;
    (this.previewBox.material as MeshBasicMaterial).color.setHex(color);
    (this.previewBoxEdges.material as LineBasicMaterial).color.setHex(color);
    (this.previewCells.material as MeshBasicMaterial).color.setHex(color);
  }

  /** Show the box/line stroke that would be committed between `start` and `end`. */
  private updateDragPreview(start: Cell, end: Cell, brush: BrushShape): void {
    this.hover.visible = false;
    this.previewGroup.visible = true;

    if (brush === "box") {
      const x0 = Math.min(start.x, end.x);
      const y0 = Math.min(start.y, end.y);
      const z0 = Math.min(start.z, end.z);
      const sx = Math.abs(end.x - start.x) + 1;
      const sy = Math.abs(end.y - start.y) + 1;
      const sz = Math.abs(end.z - start.z) + 1;

      this.previewBox.visible = true;
      this.previewBoxEdges.visible = true;
      this.previewCells.visible = false;

      this.previewBox.scale.set(sx, sy, sz);
      this.previewBox.position.set(x0 + sx / 2, y0 + sy / 2, z0 + sz / 2);
      this.previewBoxEdges.scale.copy(this.previewBox.scale);
      this.previewBoxEdges.position.copy(this.previewBox.position);
      return;
    }

    // Line: stamp an instanced cube at each cell along the stroke.
    this.previewBox.visible = false;
    this.previewBoxEdges.visible = false;
    this.previewCells.visible = true;

    const cells = this.lineCells(start, end);
    const count = Math.min(cells.length, MAX_PREVIEW_CELLS);
    for (let i = 0; i < count; i++) {
      const c = cells[i];
      this.previewMatrix.makeTranslation(c.x + 0.5, c.y + 0.5, c.z + 0.5);
      this.previewCells.setMatrixAt(i, this.previewMatrix);
    }
    this.previewCells.count = count;
    this.previewCells.instanceMatrix.needsUpdate = true;
  }

  private hideDragPreview(): void {
    this.previewGroup.visible = false;
    this.previewCells.count = 0;
  }

  /**
   * Mark the mesh dirty. The actual rebuild (which recomputes the normal and
   * AO fields and regenerates geometry) is coalesced to at most once per
   * animation frame in the render loop, so a fast brush drag that fires many
   * pointer-move events only triggers one recompute per displayed frame.
   */
  private commitEdit(): void {
    this.rebuildPending = true;
  }

  /** Run a pending rebuild, if any. Called once per frame from the render loop. */
  private flushRebuild(): void {
    if (!this.rebuildPending) return;
    this.rebuildPending = false;
    this.rebuildMesh();
    this.syncStats();
  }

  // -------------------------------------------------------------- undo / redo

  private snapshot(): void {
    this.pendingSnapshot = this.data.clone();
  }

  private pendingSnapshot: VoxelData | null = null;

  /** Capture the current volume + masks as one history entry. */
  private currentEntry(): HistoryEntry {
    return { volume: this.data.clone(), masks: this.triMasks.snapshot() };
  }

  private pushHistory(volume: VoxelData): void {
    this.undoStack.push({ volume, masks: this.triMasks.snapshot() });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  private discardSnapshotIfNoop(): void {
    if (!this.pendingSnapshot) return;
    if (this.paintedThisStroke.size > 0) {
      this.pushHistory(this.pendingSnapshot);
    }
    this.pendingSnapshot = null;
    this.syncStats();
  }

  private restoreEntry(entry: HistoryEntry): void {
    this.data = entry.volume;
    this.triMasks.restore(entry.masks);
    if (useEditorStore.getState().editorMode === "triview") this.redrawPlanes();
    this.commitEdit();
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(this.currentEntry());
    this.restoreEntry(entry);
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(this.currentEntry());
    this.restoreEntry(entry);
  }

  // -------------------------------------------------------- volume operations

  clearVolume(): void {
    this.pushHistory(this.data.clone());
    this.data.clear();
    this.commitEdit();
  }

  fillVolume(): void {
    this.pushHistory(this.data.clone());
    const color = useEditorStore.getState().currentColor;
    const { x: dx, y: dy, z: dz } = this.data.dims;
    for (let x = 0; x < dx; x++)
      for (let y = 0; y < dy; y++)
        for (let z = 0; z < dz; z++) this.data.set(x, y, z, color);
    this.commitEdit();
  }

  loadStarterShape(shape: StarterShapeId): void {
    this.pushHistory(this.data.clone());
    fillStarterShape(this.data, shape);
    this.commitEdit();
  }

  /**
   * Replace the whole document with an imported model (e.g. a parsed `.vox`).
   * The volume may have different dimensions, so the grid, ground plane and
   * tri-view planes are rebuilt to match and the camera reframes onto it.
   *
   * Importing is treated as opening a new file: existing undo/redo history is
   * cleared because past snapshots are sized to the previous volume.
   */
  loadVoxModel(data: VoxelData, palette: Palette): void {
    this.undoStack = [];
    this.redoStack = [];

    const dimsChanged =
      data.dims.x !== this.data.dims.x ||
      data.dims.y !== this.data.dims.y ||
      data.dims.z !== this.data.dims.z;

    this.data = data;
    if (dimsChanged) this.rebuildForDims(data.dims);

    // Adopt the file's palette (a new array reference triggers a mesh rebuild
    // and plane-fill refresh via the store subscription).
    useEditorStore.getState().setPalette(palette);

    if (useEditorStore.getState().editorMode === "triview") {
      this.triMasks.projectFromVolume(this.data);
      this.regenerateFromMasks();
      this.redrawPlanes();
    }

    this.frameVolume();
    this.commitEdit();
  }

  /** Recreate dimension-dependent scene helpers for a new volume size. */
  private rebuildForDims(dims: VoxelDims): void {
    const span = Math.max(dims.x, dims.z);

    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as LineBasicMaterial).dispose();
    this.grid = new GridHelper(span, span, 0x556070, 0x33404d);
    this.grid.position.set(dims.x / 2, 0, dims.z / 2);
    this.grid.visible = useEditorStore.getState().showGrid;
    this.scene.add(this.grid);

    this.scene.remove(this.groundPlane);
    this.groundPlane.geometry.dispose();
    (this.groundPlane.material as MeshBasicMaterial).dispose();
    this.groundPlane = new Mesh(
      new PlaneGeometry(span, span),
      new MeshBasicMaterial({ visible: false }),
    );
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.set(dims.x / 2, 0, dims.z / 2);
    this.scene.add(this.groundPlane);

    this.scene.remove(this.triPlanes.group);
    this.triPlanes.dispose();
    this.triMasks = new TriViewMasks(dims);
    this.triPlanes = new TriViewPlanes(dims, this.triMasks);
    this.triPlanes.setVisible(useEditorStore.getState().editorMode === "triview");
    this.scene.add(this.triPlanes.group);
  }

  /** Point the camera, controls target and key light at the current volume. */
  private frameVolume(): void {
    const c = this.center();
    const span = Math.max(this.data.dims.x, this.data.dims.y, this.data.dims.z);
    this.controls.target.copy(c);
    this.camera.position.set(c.x + span * 1.25, c.y + span * 1.2, c.z + span * 1.6);
    this.dirLight.position.set(c.x + span, c.y + span * 1.6, c.z + span * 0.6);
    this.controls.update();
  }

  // ---------------------------------------------------------- tri-view modeling

  /** Push the current volume + masks onto the undo stack (groups one stroke). */
  private pushUndoSnapshot(): void {
    this.pushHistory(this.data.clone());
    this.syncStats();
  }

  /** Rebuild the volume as the intersection of the three silhouette masks. */
  private regenerateFromMasks(): void {
    this.triMasks.applyToVolume(this.data);
    this.commitEdit();
  }

  private redrawPlanes(preview?: PreviewSpec, hover?: PlaneHit | null): void {
    this.triPlanes.redraw(useEditorStore.getState().palette, preview, hover ?? undefined);
  }

  private enterTriView(): void {
    // Project the volume onto the three planes, then rebuild it as their
    // intersection. The directional color projection is stable, so a no-edit
    // tri-view <-> sculpt round-trip reproduces the same volume.
    this.triMasks.projectFromVolume(this.data);
    this.pushUndoSnapshot();
    this.regenerateFromMasks();
    this.triPlanes.setVisible(true);
    this.redrawPlanes();
    this.hover.visible = false;
  }

  private exitTriView(): void {
    this.triPlanes.setVisible(false);
    this.triPainting = false;
    this.triDragStart = null;
  }

  clearMasks(): void {
    this.pushUndoSnapshot();
    this.triMasks.clearAll();
    this.regenerateFromMasks();
    this.redrawPlanes();
  }

  reseedMasks(): void {
    this.pushUndoSnapshot();
    this.triMasks.projectFromVolume(this.data);
    this.regenerateFromMasks();
    this.redrawPlanes();
  }

  private triPlaneCols(id: PlaneId): number {
    return this.triPlanes.cols(id);
  }
  private triPlaneRows(id: PlaneId): number {
    return this.triPlanes.rows(id);
  }

  private applyPlaneCells(
    id: PlaneId,
    cells: Array<[number, number]>,
    value: number,
  ): void {
    const cols = this.triPlaneCols(id);
    const rows = this.triPlaneRows(id);
    for (const [a, b] of cells) {
      if (a >= 0 && b >= 0 && a < cols && b < rows) {
        this.triPlanes.set(id, a, b, value);
      }
    }
  }

  /** Filled disc footprint in plane (a, b) space (diameter = brush size). */
  private disc2D(a: number, b: number, size: number): Array<[number, number]> {
    if (size <= 1) return [[a, b]];
    const radius = size / 2;
    const r = Math.ceil(radius - 1e-6);
    const cells: Array<[number, number]> = [];
    for (let da = -r; da <= r; da++)
      for (let db = -r; db <= r; db++) {
        if (da * da + db * db <= radius * radius) cells.push([a + da, b + db]);
      }
    return cells;
  }

  private box2D(s: PlaneHit, e: PlaneHit): Array<[number, number]> {
    const cells: Array<[number, number]> = [];
    const [a0, a1] = [Math.min(s.a, e.a), Math.max(s.a, e.a)];
    const [b0, b1] = [Math.min(s.b, e.b), Math.max(s.b, e.b)];
    for (let a = a0; a <= a1; a++)
      for (let b = b0; b <= b1; b++) cells.push([a, b]);
    return cells;
  }

  private line2D(s: PlaneHit, e: PlaneHit): Array<[number, number]> {
    const cells: Array<[number, number]> = [];
    const da = e.a - s.a;
    const db = e.b - s.b;
    const steps = Math.max(Math.abs(da), Math.abs(db), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      cells.push([Math.round(s.a + da * t), Math.round(s.b + db * t)]);
    }
    return cells;
  }

  private triStamp(store: ReturnType<typeof useEditorStore.getState>, hit: PlaneHit): void {
    const cells =
      store.brush === "voxel" ? this.disc2D(hit.a, hit.b, store.brushSize) : [
        [hit.a, hit.b] as [number, number],
      ];
    this.applyPlaneCells(hit.id, cells, this.triValue);
    this.regenerateFromMasks();
    this.redrawPlanes(undefined, hit);
  }

  private triPointerDown(store: ReturnType<typeof useEditorStore.getState>): void {
    const hit = this.triPlanes.pick(this.raycaster);
    if (!hit) return;
    // Reuse the left-side tools: Attach/Paint add silhouette, Erase removes it,
    // Pick is a no-op on the planes.
    if (store.action === "pick") return;
    this.triValue = store.action === "erase" ? 0 : store.currentColor;
    this.triPainting = true;
    this.pushUndoSnapshot();

    if (store.brush === "box" || store.brush === "line") {
      this.triDragStart = hit;
      this.redrawPlanes({ id: hit.id, cells: [[hit.a, hit.b]], value: this.triValue }, hit);
    } else {
      this.triStamp(store, hit);
    }
  }

  private triPointerMove(store: ReturnType<typeof useEditorStore.getState>): void {
    const hit = this.triPlanes.pick(this.raycaster);

    if (
      this.triPainting &&
      this.triDragStart &&
      (store.brush === "box" || store.brush === "line")
    ) {
      if (hit && hit.id === this.triDragStart.id) {
        const cells =
          store.brush === "box"
            ? this.box2D(this.triDragStart, hit)
            : this.line2D(this.triDragStart, hit);
        this.redrawPlanes({ id: hit.id, cells, value: this.triValue }, hit);
      }
      return;
    }

    if (this.triPainting && hit) {
      this.triStamp(store, hit);
      return;
    }

    // Not painting: hover outline.
    this.redrawPlanes(undefined, hit);
  }

  private triPointerUp(store: ReturnType<typeof useEditorStore.getState>): void {
    if (
      this.triPainting &&
      this.triDragStart &&
      (store.brush === "box" || store.brush === "line")
    ) {
      const hit = this.triPlanes.pick(this.raycaster);
      const end = hit && hit.id === this.triDragStart.id ? hit : this.triDragStart;
      const cells =
        store.brush === "box"
          ? this.box2D(this.triDragStart, end)
          : this.line2D(this.triDragStart, end);
      this.applyPlaneCells(this.triDragStart.id, cells, this.triValue);
      this.regenerateFromMasks();
    }
    this.triPainting = false;
    this.triDragStart = null;
    this.redrawPlanes();
  }

  // -------------------------------------------------------------------- store

  private onStoreChange(state: ReturnType<typeof useEditorStore.getState>, prev: typeof state): void {
    const needsRebuild =
      state.field !== prev.field ||
      state.shading !== prev.shading ||
      state.kernelRadius !== prev.kernelRadius ||
      state.aoMode !== prev.aoMode ||
      state.aoRadius !== prev.aoRadius ||
      state.aoIntensity !== prev.aoIntensity ||
      state.palette !== prev.palette ||
      state.showEdges !== prev.showEdges;
    // Coalesce through the same per-frame flush so dragging a slider (e.g. AO
    // intensity) doesn't trigger a full recompute on every input event.
    if (needsRebuild) this.commitEdit();

    if (state.showGrid !== prev.showGrid) {
      this.grid.visible = state.showGrid;
    }

    if (state.editorMode !== prev.editorMode) {
      if (state.editorMode === "triview") this.enterTriView();
      else this.exitTriView();
    }

    // The selected color is the brush color (applied per stroke), so it should
    // not recolor existing geometry. Only redraw plane fills if the palette's
    // hex values themselves changed (the mesh rebuild is already queued above).
    if (state.editorMode === "triview" && state.palette !== prev.palette) {
      this.redrawPlanes();
    }
  }

  private syncStats(): void {
    useEditorStore.getState().setStats({
      voxelCount: this.data.count,
      faceCount: this.lastFaceCount,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  // ------------------------------------------------------------------ cleanup

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.resizeObserver.disconnect();

    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    el.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);

    this.controls.dispose();
    this.mesh?.geometry.dispose();
    this.material.dispose();
    this.previewBox.geometry.dispose();
    (this.previewBox.material as MeshBasicMaterial).dispose();
    this.previewBoxEdges.geometry.dispose();
    (this.previewBoxEdges.material as LineBasicMaterial).dispose();
    this.previewCells.geometry.dispose();
    (this.previewCells.material as MeshBasicMaterial).dispose();
    this.triPlanes.dispose();
    this.gizmo.dispose();
    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}
