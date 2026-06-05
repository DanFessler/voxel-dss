import {
  useEditorStore,
  type BrushShape,
  type MirrorAxis,
  type ToolAction,
} from "../state/editorStore";
import { useEngineRef } from "../engine/EngineContext";

const ACTIONS: { id: ToolAction; label: string; key: string; hint: string }[] = [
  { id: "attach", label: "Attach", key: "T", hint: "Add voxels" },
  { id: "erase", label: "Erase", key: "R", hint: "Remove voxels" },
  { id: "paint", label: "Paint", key: "G", hint: "Recolor voxels" },
  { id: "pick", label: "Pick", key: "Alt", hint: "Pick color (Alt+click)" },
];

const BRUSHES: { id: BrushShape; label: string; key: string }[] = [
  { id: "voxel", label: "Voxel", key: "V" },
  { id: "box", label: "Box", key: "B" },
  { id: "line", label: "Line", key: "L" },
  { id: "face", label: "Face", key: "F" },
];

const MIRROR_AXES: MirrorAxis[] = ["x", "y", "z"];

export function Toolbar() {
  const engineRef = useEngineRef();
  const editorMode = useEditorStore((s) => s.editorMode);
  const action = useEditorStore((s) => s.action);
  const brush = useEditorStore((s) => s.brush);
  const brushSize = useEditorStore((s) => s.brushSize);
  const mirror = useEditorStore((s) => s.mirror);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const setAction = useEditorStore((s) => s.setAction);
  const setBrush = useEditorStore((s) => s.setBrush);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const toggleMirror = useEditorStore((s) => s.toggleMirror);

  const sculpt = editorMode === "sculpt";

  return (
    <nav className="toolbar">
      <div className="tool-group">
        <span className="tool-group__title">Mode</span>
        <button
          className={`tool-btn ${sculpt ? "is-active" : ""}`}
          onClick={() => setEditorMode("sculpt")}
          title="Sculpt voxels directly in 3D"
        >
          <span>Sculpt</span>
        </button>
        <button
          className={`tool-btn ${!sculpt ? "is-active" : ""}`}
          onClick={() => setEditorMode("triview")}
          title="Draw top/front/side silhouettes on planes in the volume"
        >
          <span>Tri-view</span>
        </button>
      </div>

      <div className="tool-group">
        <span className="tool-group__title">Tool</span>
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            className={`tool-btn ${action === a.id ? "is-active" : ""}`}
            onClick={() => setAction(a.id)}
            title={`${a.hint} (${a.key})`}
          >
            <span>{a.label}</span>
            <kbd>{a.key}</kbd>
          </button>
        ))}
      </div>

      <div className="tool-group">
        <span className="tool-group__title">Brush</span>
        {BRUSHES.map((b) => (
          <button
            key={b.id}
            className={`tool-btn ${brush === b.id ? "is-active" : ""}`}
            onClick={() => setBrush(b.id)}
            title={`${b.label} brush (${b.key})`}
          >
            <span>{b.label}</span>
            <kbd>{b.key}</kbd>
          </button>
        ))}
      </div>

      {brush === "voxel" && (
        <div className="tool-group">
          <span className="tool-group__title">
            {sculpt ? "Voxel size" : "Brush size"}
          </span>
          <label className="brush-size">
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              title="Brush diameter"
            />
            <span className="brush-size__label">{brushSize} vx</span>
          </label>
        </div>
      )}

      {sculpt && (
        <div className="tool-group">
          <span className="tool-group__title">Mirror</span>
          <div className="mirror-row">
            {MIRROR_AXES.map((axis) => (
              <button
                key={axis}
                className={`mirror-btn ${mirror[axis] ? "is-active" : ""}`}
                onClick={() => toggleMirror(axis)}
                title={`Mirror across ${axis.toUpperCase()} axis`}
              >
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {!sculpt && (
        <div className="tool-group">
          <span className="tool-group__title">Tri-view</span>
          <p className="toolbar__note">
            Draw on the floor / back / left planes in the volume. The model is
            their intersection.
          </p>
          <button
            className="menu-btn"
            onClick={() => engineRef.current?.reseedMasks()}
            title="Reset the planes from the current 3D model"
          >
            Reseed planes
          </button>
          <button
            className="menu-btn menu-btn--danger"
            onClick={() => engineRef.current?.clearMasks()}
            title="Clear all three silhouettes"
          >
            Clear planes
          </button>
        </div>
      )}
    </nav>
  );
}
