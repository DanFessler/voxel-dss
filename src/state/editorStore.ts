import { create } from "zustand";
import { DEFAULT_DSS, type NormalField, type ShadingMode } from "@/voxel/dss";
import { DEFAULT_AO, type AoMode } from "@/voxel/ao";
import { createDefaultPalette, type Palette } from "@/voxel/palette";

/** Editing action: what happens when the user paints in the viewport. */
export type ToolAction = "attach" | "erase" | "paint" | "pick";

/** Brush shape: how the action is applied across the volume. */
export type BrushShape = "voxel" | "box" | "line" | "face";

export type MirrorAxis = "x" | "y" | "z";

/** Top-level authoring mode. */
export type EditorMode = "sculpt" | "triview";

export interface EditorState {
  // Mode
  editorMode: EditorMode;

  // Tools
  action: ToolAction;
  brush: BrushShape;
  /** Voxel-brush diameter in cells (1 = single voxel). */
  brushSize: number;
  currentColor: number;
  palette: Palette;

  // Mirror planes (symmetry about the volume center on each axis).
  mirror: Record<MirrorAxis, boolean>;

  // Derived Surface Shading settings.
  field: NormalField;
  shading: ShadingMode;
  kernelRadius: number;

  // Derived Surface AO settings.
  aoMode: AoMode;
  aoRadius: number;
  aoIntensity: number;

  // Scene options.
  showGrid: boolean;
  showEdges: boolean;
  lightAutoRotate: boolean;

  // Read-only stats pushed from the engine.
  voxelCount: number;
  faceCount: number;
  canUndo: boolean;
  canRedo: boolean;

  // Actions
  setEditorMode: (mode: EditorMode) => void;
  setAction: (action: ToolAction) => void;
  setBrush: (brush: BrushShape) => void;
  setBrushSize: (size: number) => void;
  setCurrentColor: (index: number) => void;
  setPaletteColor: (index: number, hex: string) => void;
  setPalette: (palette: Palette) => void;
  toggleMirror: (axis: MirrorAxis) => void;
  setField: (field: NormalField) => void;
  setShading: (shading: ShadingMode) => void;
  setKernelRadius: (r: number) => void;
  setAoMode: (mode: AoMode) => void;
  setAoRadius: (r: number) => void;
  setAoIntensity: (v: number) => void;
  toggleGrid: () => void;
  toggleEdges: () => void;
  toggleLightAutoRotate: () => void;
  setStats: (stats: {
    voxelCount: number;
    faceCount: number;
    canUndo: boolean;
    canRedo: boolean;
  }) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  editorMode: "sculpt",
  action: "attach",
  brush: "voxel",
  brushSize: 1,
  currentColor: 1,
  palette: createDefaultPalette(),

  mirror: { x: false, y: false, z: false },

  field: DEFAULT_DSS.field,
  shading: DEFAULT_DSS.shading,
  kernelRadius: DEFAULT_DSS.kernelRadius,

  aoMode: DEFAULT_AO.mode,
  aoRadius: DEFAULT_AO.radius,
  aoIntensity: DEFAULT_AO.intensity,

  showGrid: true,
  showEdges: false,
  lightAutoRotate: false,

  voxelCount: 0,
  faceCount: 0,
  canUndo: false,
  canRedo: false,

  setEditorMode: (editorMode) => set({ editorMode }),
  setAction: (action) => set({ action }),
  setBrush: (brush) => set({ brush }),
  setBrushSize: (brushSize) =>
    set({ brushSize: Math.max(1, Math.min(16, Math.round(brushSize))) }),
  setCurrentColor: (currentColor) => set({ currentColor }),
  setPaletteColor: (index, hex) =>
    set((s) => {
      const palette = s.palette.slice();
      palette[index] = hex;
      return { palette };
    }),
  setPalette: (palette) => set({ palette: palette.slice() }),
  toggleMirror: (axis) =>
    set((s) => ({ mirror: { ...s.mirror, [axis]: !s.mirror[axis] } })),
  setField: (field) => set({ field }),
  setShading: (shading) => set({ shading }),
  setKernelRadius: (kernelRadius) =>
    set({ kernelRadius: Math.max(1, Math.min(4, kernelRadius)) }),
  setAoMode: (aoMode) => set({ aoMode }),
  setAoRadius: (aoRadius) =>
    set({ aoRadius: Math.max(1, Math.min(4, aoRadius)) }),
  setAoIntensity: (aoIntensity) =>
    set({ aoIntensity: Math.max(0, Math.min(1, aoIntensity)) }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleEdges: () => set((s) => ({ showEdges: !s.showEdges })),
  toggleLightAutoRotate: () =>
    set((s) => ({ lightAutoRotate: !s.lightAutoRotate })),
  setStats: (stats) => set(stats),
}));
