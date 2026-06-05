/**
 * Whitepaper figure renderer.
 *
 * Renders the paper's 3D comparison figures using the *exact* Derived Surface
 * Shading code from `src/` (buildVoxelMesh + the gradient/centroid normal
 * fields), with the same material and lighting as the editor, so the figures
 * faithfully depict the real technique rather than an artistic impression.
 *
 * Open `/figures/?fig=N` and screenshot the `#figure` element.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { VoxelData } from "@/voxel/VoxelData";
import { fillStarterShape, type StarterShapeId } from "@/voxel/starterShapes";
import { buildVoxelMesh } from "@/voxel/meshBuilder";
import { createDefaultPalette } from "@/voxel/palette";
import { parseVox } from "@/voxel/voxParser";
import type { NormalField, ShadingMode } from "@/voxel/dss";
import type { AoMode } from "@/voxel/ao";

const BG = 0x1a1c22;
/** Neutral mid-tone so lighting (not albedo) carries the comparison. */
const FIG_COLOR = "#c2c8d0";

/** Starter shapes plus figure-only primitives. */
type FigShape = StarterShapeId | "cube" | "sprout" | "thin";

/**
 * A centered cube, optionally with a smaller cube stub on each face. The stubs
 * give the kernel-radius sweep something to absorb: larger kernels round the
 * cube's corners and dissolve the stubs into the surface.
 */
function fillCube(data: VoxelData, sprouts: boolean): void {
  data.clear();
  const d = data.dims.x;
  const lo = Math.round(d * 0.27);
  const hi = d - 1 - lo;
  const box = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ) => {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) data.set(x, y, z, 1);
  };

  box(lo, lo, lo, hi, hi, hi);
  if (!sprouts) return;

  const mid = Math.round((lo + hi) / 2);
  const h = 3; // stub half-width (7 cells across)
  const out = Math.max(4, Math.round(d * 0.12)); // protrusion depth
  const a = mid - h;
  const b = mid + h;
  box(hi + 1, a, a, hi + out, b, b); // +x
  box(lo - out, a, a, lo - 1, b, b); // -x
  box(a, hi + 1, a, b, hi + out, b); // +y
  box(a, lo - out, a, b, lo - 1, b); // -y
  box(a, a, hi + 1, b, b, hi + out); // +z
  box(a, a, lo - out, b, b, lo - 1); // -z
}

/**
 * A scene of one-voxel-thick / isolated features where the derived normal is
 * ill-defined: a 1-voxel-thick square plate, a 1-wide line, and a few isolated
 * single voxels. Used to make the known artifact (Section 14) concrete.
 */
function fillThinFeatures(data: VoxelData): void {
  data.clear();
  const set = (x: number, y: number, z: number) => data.set(x, y, z, 1);

  // 1-voxel-thick square plate (horizontal).
  for (let x = 6; x <= 21; x++)
    for (let z = 7; z <= 22; z++) set(x, 8, z);

  // 1-wide line (single-voxel cross-section).
  for (let x = 6; x <= 23; x++) set(x, 18, 13);

  // Isolated single voxels.
  set(11, 24, 9);
  set(20, 22, 19);
  set(14, 26, 16);
  set(9, 21, 21);
}

function fillShape(data: VoxelData, shape: FigShape): void {
  if (shape === "cube") fillCube(data, false);
  else if (shape === "sprout") fillCube(data, true);
  else if (shape === "thin") fillThinFeatures(data);
  else fillStarterShape(data, shape);
}

interface PanelSpec {
  shape: FigShape;
  /** URL of a `.vox` asset to load instead of a generated shape. */
  asset?: string;
  dim?: number;
  field: NormalField;
  shading: ShadingMode;
  kernelRadius: number;
  ao?: AoMode;
  aoRadius?: number;
  aoIntensity?: number;
  caption: string;
  sub?: string;
  size?: number;
}

interface FigureSpec {
  layout: "row" | "grid";
  cols?: number;
  panels: PanelSpec[];
}

function buildPalette(): string[] {
  const p = createDefaultPalette();
  p[1] = FIG_COLOR; // STARTER_COLOR slot
  return p;
}

function renderPanel(spec: PanelSpec): HTMLElement {
  const size = spec.size ?? 420;
  const dim = spec.dim ?? 40;

  const data = new VoxelData({ x: dim, y: dim, z: dim });
  fillShape(data, spec.shape);

  const { geometry } = buildVoxelMesh(
    data,
    buildPalette(),
    {
      field: spec.field,
      shading: spec.shading,
      kernelRadius: spec.kernelRadius,
    },
    {
      mode: spec.ao ?? "off",
      radius: spec.aoRadius ?? 2,
      intensity: spec.aoIntensity ?? 0.85,
    },
  );

  const scene = new Scene();
  scene.background = new Color(BG);
  scene.add(new AmbientLight(0xffffff, 0.4));

  const c = new Vector3(dim / 2, dim / 2, dim / 2);
  const span = dim;

  // Key light rakes from the upper-left, roughly perpendicular to the camera,
  // so the terminator falls across the visible surface rather than hiding near
  // the rim (which happens when the light is aligned with the view direction).
  const dir = new DirectionalLight(0xffffff, 2.2);
  dir.position.set(c.x - span * 1.1, c.y + span * 0.95, c.z + span * 0.25);
  scene.add(dir);

  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
  });
  scene.add(new Mesh(geometry, mat));

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(size, size);

  const cam = new PerspectiveCamera(40, 1, 0.1, 4000);
  cam.position.set(c.x + span * 1.2, c.y + span * 1.0, c.z + span * 1.62);
  cam.lookAt(c);
  renderer.render(scene, cam);

  return captioned(renderer.domElement, spec);
}

function captioned(canvas: HTMLCanvasElement, spec: PanelSpec): HTMLElement {
  const fig = document.createElement("figure");
  fig.className = "panel";
  fig.appendChild(canvas);

  const cap = document.createElement("figcaption");
  cap.textContent = spec.caption;
  if (spec.sub) {
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = spec.sub;
    cap.appendChild(sub);
  }
  fig.appendChild(cap);
  return fig;
}

/**
 * Render a real `.vox` asset with its own palette. Unlike the generated shapes,
 * the camera and key light are framed from the geometry's bounding sphere so
 * arbitrarily sized/positioned imported models fit the panel.
 */
async function renderAssetPanel(spec: PanelSpec): Promise<HTMLElement> {
  const size = spec.size ?? 440;

  const res = await fetch(spec.asset!);
  if (!res.ok) throw new Error(`Failed to load ${spec.asset}: ${res.status}`);
  const { data, palette } = parseVox(await res.arrayBuffer());

  const { geometry } = buildVoxelMesh(
    data,
    palette,
    {
      field: spec.field,
      shading: spec.shading,
      kernelRadius: spec.kernelRadius,
    },
    {
      mode: spec.ao ?? "off",
      radius: spec.aoRadius ?? 2,
      intensity: spec.aoIntensity ?? 0.85,
    },
  );

  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere!;
  const c = sphere.center.clone();
  const radius = Math.max(1, sphere.radius);

  const scene = new Scene();
  scene.background = new Color(BG);
  scene.add(new AmbientLight(0xffffff, 0.4));

  const dir = new DirectionalLight(0xffffff, 2.2);
  dir.position
    .copy(c)
    .addScaledVector(new Vector3(-1.1, 0.95, 0.25).normalize(), radius * 4);
  scene.add(dir);

  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
  });
  scene.add(new Mesh(geometry, mat));

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(size, size);

  const cam = new PerspectiveCamera(40, 1, 0.1, 8000);
  cam.position
    .copy(c)
    .addScaledVector(new Vector3(1.2, 1.0, 1.62).normalize(), radius * 3.6);
  cam.lookAt(c);
  renderer.render(scene, cam);

  return captioned(renderer.domElement, spec);
}

const SPHERE_DIM = 44;
const CUBE_DIM = 40;

function radii(
  shape: FigShape,
  dim: number,
  field: NormalField,
  shading: ShadingMode,
  size: number,
): PanelSpec[] {
  return [1, 2, 3, 4].map((r) => ({
    shape,
    dim,
    field,
    shading,
    kernelRadius: r,
    size,
    caption: `r = ${r}`,
    sub: `${2 * r + 1}³ kernel`,
  }));
}

const FIGURES: Record<string, FigureSpec> = {
  // Figure 1 - traditional cube-face shading vs derived surface shading.
  "1": {
    layout: "row",
    panels: [
      {
        shape: "sphere",
        dim: SPHERE_DIM,
        field: "gradient",
        shading: "cube",
        kernelRadius: 2,
        size: 440,
        caption: "Traditional cube-face shading",
        sub: "Lighting follows voxel faces - stair-steps emphasized",
      },
      {
        shape: "sphere",
        dim: SPHERE_DIM,
        field: "gradient",
        shading: "perVoxel",
        kernelRadius: 2,
        size: 440,
        caption: "Derived Surface Shading",
        sub: "Lighting follows the implied sphere - geometry unchanged",
      },
    ],
  },

  // Figure 7 - kernel radius sweep for both fields (rows × columns). A cube with
  // a stub on each face makes the radius effect obvious: corners round off and
  // the stubs dissolve into the surface as the kernel grows.
  "7": {
    layout: "grid",
    cols: 4,
    panels: [
      ...radii("sprout", CUBE_DIM, "gradient", "perVoxel", 250).map((p) => ({
        ...p,
        caption: `Gradient · r = ${p.kernelRadius}`,
      })),
      ...radii("sprout", CUBE_DIM, "centroid", "perVoxel", 250).map((p) => ({
        ...p,
        caption: `Centroid · r = ${p.kernelRadius}`,
      })),
    ],
  },

  // Figure 8 - observed convergence: Centroid(r) ≈ Gradient(r−1). The methods
  // are only meaningfully distinguishable at small radii, so the equivalent
  // low-radius pair (gradient r1 ≈ centroid r2) is the informative comparison.
  "8": {
    layout: "row",
    panels: [
      {
        shape: "cube",
        dim: CUBE_DIM,
        field: "gradient",
        shading: "perVoxel",
        kernelRadius: 1,
        size: 440,
        caption: "Density gradient",
        sub: "radius 1 (3³)",
      },
      {
        shape: "cube",
        dim: CUBE_DIM,
        field: "centroid",
        shading: "perVoxel",
        kernelRadius: 2,
        size: 440,
        caption: "Occupancy centroid",
        sub: "radius 2 (5³)",
      },
    ],
  },

  // Figure 9 - same normal field, two application strategies.
  "9": {
    layout: "row",
    panels: [
      {
        shape: "sphere",
        dim: SPHERE_DIM,
        field: "gradient",
        shading: "perVoxel",
        kernelRadius: 2,
        size: 440,
        caption: "Uniform per-voxel",
        sub: "one derived normal per voxel",
      },
      {
        shape: "sphere",
        dim: SPHERE_DIM,
        field: "gradient",
        shading: "vertexInterpolated",
        kernelRadius: 2,
        size: 440,
        caption: "Vertex-interpolated",
        sub: "normals blended at cube corners",
      },
    ],
  },

  // Figure 12 - thin / isolated features where the derived normal degenerates.
  // Cube faces handle them correctly; per-voxel DSS cannot orient them.
  "12": {
    layout: "row",
    panels: [
      {
        shape: "thin",
        dim: 30,
        field: "gradient",
        shading: "cube",
        kernelRadius: 2,
        size: 440,
        caption: "Cube faces",
        sub: "each face correctly oriented",
      },
      {
        shape: "thin",
        dim: 30,
        field: "gradient",
        shading: "perVoxel",
        kernelRadius: 2,
        size: 440,
        caption: "Per-voxel DSS",
        sub: "thin/isolated normals ill-defined",
      },
    ],
  },

  // Hero - example asset across the three shading approaches the paper covers.
  hero: {
    layout: "row",
    panels: [
      {
        shape: "sphere", // ignored when `asset` is set
        asset: "/src/examples/DanF_Assets.vox",
        field: "centroid",
        shading: "cube",
        kernelRadius: 1,
        size: 430,
        caption: "Cube faces",
        sub: "control",
      },
      {
        shape: "sphere",
        asset: "/src/examples/DanF_Assets.vox",
        field: "centroid",
        shading: "perVoxel",
        kernelRadius: 1,
        size: 430,
        caption: "Per-voxel DSS",
        sub: "centroid r1",
      },
      {
        shape: "sphere",
        asset: "/src/examples/DanF_Assets.vox",
        field: "centroid",
        shading: "vertexInterpolated",
        kernelRadius: 1,
        size: 430,
        caption: "Vertex-interpolated DSS",
        sub: "centroid r1",
      },
    ],
  },

  // Figure 13 - real-world .vox assets: traditional cube-face control (left)
  // vs per-voxel DSS (right), one asset per row.
  "13": {
    layout: "grid",
    cols: 2,
    panels: [
      {
        shape: "sphere", // ignored when `asset` is set
        asset: "/src/examples/DanF_Assets.vox",
        field: "centroid",
        shading: "cube",
        kernelRadius: 1,
        size: 420,
        caption: "DanF_Assets.vox",
        sub: "control - cube faces",
      },
      {
        shape: "sphere",
        asset: "/src/examples/DanF_Assets.vox",
        field: "centroid",
        shading: "perVoxel",
        kernelRadius: 1,
        size: 420,
        caption: "DanF_Assets.vox",
        sub: "per-voxel DSS · centroid r1",
      },
      {
        shape: "sphere",
        asset: "/src/examples/DanF_Assets_2.vox",
        field: "centroid",
        shading: "cube",
        kernelRadius: 1,
        size: 420,
        caption: "DanF_Assets_2.vox",
        sub: "control - cube faces",
      },
      {
        shape: "sphere",
        asset: "/src/examples/DanF_Assets_2.vox",
        field: "centroid",
        shading: "perVoxel",
        kernelRadius: 1,
        size: 420,
        caption: "DanF_Assets_2.vox",
        sub: "per-voxel DSS · single-voxel foliage reads as noise",
      },
    ],
  },
};

async function main(): Promise<void> {
  const root = document.getElementById("figure")!;
  const id = new URLSearchParams(location.search).get("fig") ?? "1";
  const spec = FIGURES[id];

  if (!spec) {
    root.innerHTML = `<div id="missing">No figure "${id}". Try ?fig=${Object.keys(
      FIGURES,
    ).join(", ?fig=")}</div>`;
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = spec.layout;
  if (spec.layout === "grid" && spec.cols) {
    (wrap as HTMLElement).style.gridTemplateColumns = `repeat(${spec.cols}, auto)`;
  }
  for (const panel of spec.panels) {
    wrap.appendChild(
      panel.asset ? await renderAssetPanel(panel) : renderPanel(panel),
    );
  }
  root.appendChild(wrap);

  document.body.setAttribute("data-ready", "true");
}

void main();
