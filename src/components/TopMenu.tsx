import { useRef } from "react";
import { useEngineRef } from "../engine/EngineContext";
import { useEditorStore } from "../state/editorStore";
import { parseVox } from "../voxel/voxParser";

export function TopMenu() {
  const engineRef = useEngineRef();
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onImportFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const { data, palette, voxelCount, modelCount } = parseVox(buffer);
      if (voxelCount === 0) {
        alert(`"${file.name}" parsed but contains no voxels.`);
        return;
      }
      engineRef.current?.loadVoxModel(data, palette);
      if (modelCount > 1) {
        console.info(
          `Imported ${file.name}: merged ${modelCount} models (${voxelCount} voxels).`,
        );
      }
    } catch (err) {
      alert(
        `Could not import "${file.name}".\n\n${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  return (
    <header className="topmenu">
      <div className="topmenu__brand">
        <span className="topmenu__logo">◧</span>
        <span>Voxel DSS Editor</span>
      </div>

      <div className="topmenu__actions">
        <input
          ref={fileInputRef}
          type="file"
          accept=".vox"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
            // Reset so re-importing the same file fires onChange again.
            e.target.value = "";
          }}
        />
        <button
          className="menu-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Import a MagicaVoxel .vox file"
        >
          Import
        </button>
        <span className="topmenu__sep" />
        <button
          className="menu-btn"
          disabled={!canUndo}
          onClick={() => engineRef.current?.undo()}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          className="menu-btn"
          disabled={!canRedo}
          onClick={() => engineRef.current?.redo()}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
        <span className="topmenu__sep" />
        <button
          className="menu-btn"
          onClick={() => engineRef.current?.fillVolume()}
          title="Fill volume with current color (I)"
        >
          Fill
        </button>
        <button
          className="menu-btn menu-btn--danger"
          onClick={() => {
            if (confirm("Clear the entire model?")) {
              engineRef.current?.clearVolume();
            }
          }}
          title="Clear all voxels"
        >
          Clear
        </button>
      </div>
    </header>
  );
}
