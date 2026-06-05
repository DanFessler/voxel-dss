import { useEffect, useRef } from "react";
import type { VoxelEngine } from "./engine/VoxelEngine";
import { EngineContext } from "./engine/EngineContext";
import { Viewport } from "./components/Viewport";
import { TopMenu } from "./components/TopMenu";
import { Toolbar } from "./components/Toolbar";
import { PalettePanel } from "./components/PalettePanel";
import { StarterShapesPanel } from "./components/StarterShapesPanel";
import { ShadingPanel } from "./components/ShadingPanel";
import { StatusBar } from "./components/StatusBar";
import { useEditorStore } from "./state/editorStore";

export function App() {
  const engineRef = useRef<VoxelEngine | null>(null);
  const editorMode = useEditorStore((s) => s.editorMode);

  // Global keyboard shortcuts (MagicaVoxel-inspired).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      const store = useEditorStore.getState();
      const k = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) {
        e.preventDefault();
        engineRef.current?.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        engineRef.current?.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      switch (k) {
        case "t":
          store.setAction("attach");
          break;
        case "r":
          store.setAction("erase");
          break;
        case "g":
          store.setAction("paint");
          break;
        case "v":
          store.setBrush("voxel");
          break;
        case "b":
          store.setBrush("box");
          break;
        case "l":
          store.setBrush("line");
          break;
        case "f":
          store.setBrush("face");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <EngineContext.Provider value={engineRef}>
      <div className="app">
        <TopMenu />
        <Toolbar />
        <Viewport engineRef={engineRef} />
        <aside className="panels">
          {editorMode === "sculpt" && <StarterShapesPanel />}
          <PalettePanel />
          <ShadingPanel />
        </aside>
        <StatusBar />
      </div>
    </EngineContext.Provider>
  );
}
