/**
 * MagicaVoxel `.vox` importer.
 *
 * Parses the binary chunk format (https://github.com/ephtracy/voxel-model)
 * into the editor's internal model. Supports the common single- and
 * multi-model files produced by MagicaVoxel: the `SIZE`/`XYZI` chunk pairs and
 * the optional `RGBA` palette. Scene-graph transform chunks (`nTRN`/`nGRP`/
 * `nSHP`) are ignored - every model is merged into one volume at the origin,
 * which matches how the editor presents a single editable volume.
 *
 * Coordinate convention: MagicaVoxel is Z-up, while this editor is Y-up, so we
 * remap (vx, vy, vz) -> (vx, vz, vy) to keep imported models standing upright.
 */
import { PALETTE_SIZE, type Palette } from "./palette";
import { VoxelData, type VoxelDims } from "./VoxelData";

const MAX_DIM = 256;

export interface VoxImport {
  data: VoxelData;
  palette: Palette;
  /** Number of occupied voxels written into the volume. */
  voxelCount: number;
  /** Number of models found in the file (all merged into one volume). */
  modelCount: number;
}

interface RawModel {
  size: { x: number; y: number; z: number };
  /** Flat (x, y, z, colorIndex) tuples straight from the XYZI chunk. */
  voxels: Uint8Array;
}

class Reader {
  private offset = 0;
  constructor(private readonly view: DataView) {}

  get pos(): number {
    return this.offset;
  }
  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  int32(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  tag(): string {
    const c = (n: number) => String.fromCharCode(this.view.getUint8(this.offset + n));
    const s = c(0) + c(1) + c(2) + c(3);
    this.offset += 4;
    return s;
  }

  skip(bytes: number): void {
    this.offset += bytes;
  }

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return out;
  }
}

/**
 * Parse a `.vox` file. Throws a descriptive `Error` if the buffer is not a
 * valid MagicaVoxel file so callers can surface a clean message.
 */
export function parseVox(buffer: ArrayBuffer): VoxImport {
  if (buffer.byteLength < 8) {
    throw new Error("File is too small to be a .vox file.");
  }
  const reader = new Reader(new DataView(buffer));

  const magic = reader.tag();
  if (magic !== "VOX ") {
    throw new Error(`Not a MagicaVoxel file (expected "VOX " header, got "${magic}").`);
  }
  reader.int32(); // version

  const models: RawModel[] = [];
  let rgba: Uint8Array | null = null;
  let pendingSize: RawModel["size"] | null = null;

  // The top-level MAIN chunk contains all others as children. We read every
  // chunk header and only act on the ones we understand, skipping the rest.
  while (reader.remaining >= 12) {
    const id = reader.tag();
    const contentBytes = reader.int32();
    reader.int32(); // children byte count (we traverse linearly instead)

    if (id === "SIZE") {
      pendingSize = { x: reader.int32(), y: reader.int32(), z: reader.int32() };
      reader.skip(contentBytes - 12);
    } else if (id === "XYZI") {
      const count = reader.int32();
      const voxels = reader.bytes(count * 4).slice();
      models.push({ size: pendingSize ?? { x: 0, y: 0, z: 0 }, voxels });
      pendingSize = null;
      reader.skip(contentBytes - 4 - count * 4);
    } else if (id === "RGBA") {
      rgba = reader.bytes(contentBytes).slice();
    } else {
      // MAIN (empty content) or any chunk we don't handle.
      reader.skip(contentBytes);
    }
  }

  if (models.length === 0) {
    throw new Error("No voxel models found in the file.");
  }

  const dims = mergedDims(models);
  const data = new VoxelData(dims);

  let voxelCount = 0;
  for (const model of models) {
    const v = model.voxels;
    for (let i = 0; i < v.length; i += 4) {
      const vx = v[i];
      const vy = v[i + 1];
      const vz = v[i + 2];
      const colorIndex = v[i + 3];
      if (colorIndex === 0) continue;
      // Z-up (MagicaVoxel) -> Y-up (editor).
      const before = data.get(vx, vz, vy);
      data.set(vx, vz, vy, colorIndex);
      if (before === 0) voxelCount++;
    }
  }

  return {
    data,
    palette: buildPalette(rgba),
    voxelCount,
    modelCount: models.length,
  };
}

/** Editor dimensions large enough to hold every model (clamped to MAX_DIM). */
function mergedDims(models: RawModel[]): VoxelDims {
  let mx = 1;
  let my = 1;
  let mz = 1;
  for (const m of models) {
    mx = Math.max(mx, m.size.x);
    my = Math.max(my, m.size.z); // editor Y <- vox Z
    mz = Math.max(mz, m.size.y); // editor Z <- vox Y
  }
  return {
    x: Math.min(MAX_DIM, mx),
    y: Math.min(MAX_DIM, my),
    z: Math.min(MAX_DIM, mz),
  };
}

/**
 * Build the editor palette from a `.vox` `RGBA` chunk. Per the format spec,
 * voxel color index `i` (1..255) maps to RGBA entry `i - 1`. When a file has no
 * palette chunk, MagicaVoxel's built-in default palette is used.
 */
function buildPalette(rgba: Uint8Array | null): Palette {
  const palette: Palette = new Array(PALETTE_SIZE).fill("#000000");
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const src = (i - 1) * 4;
    let r: number;
    let g: number;
    let b: number;
    if (rgba && src + 2 < rgba.length) {
      r = rgba[src];
      g = rgba[src + 1];
      b = rgba[src + 2];
    } else {
      const packed = DEFAULT_VOX_PALETTE[i] ?? 0;
      r = packed & 0xff;
      g = (packed >> 8) & 0xff;
      b = (packed >> 16) & 0xff;
    }
    palette[i] = rgbToHex(r, g, b);
  }
  return palette;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * MagicaVoxel's default 256-color palette, packed as 0x00BBGGRR. Index 0 is
 * unused (empty). Only consulted for files that omit the `RGBA` chunk.
 */
const DEFAULT_VOX_PALETTE: number[] = [
  0x00000000, 0x00ffffff, 0x00ffccff, 0x00ff99ff, 0x00ff66ff, 0x00ff33ff, 0x00ff00ff, 0x00ffffcc,
  0x00ffcccc, 0x00ff99cc, 0x00ff66cc, 0x00ff33cc, 0x00ff00cc, 0x00ffff99, 0x00ffcc99, 0x00ff9999,
  0x00ff6699, 0x00ff3399, 0x00ff0099, 0x00ffff66, 0x00ffcc66, 0x00ff9966, 0x00ff6666, 0x00ff3366,
  0x00ff0066, 0x00ffff33, 0x00ffcc33, 0x00ff9933, 0x00ff6633, 0x00ff3333, 0x00ff0033, 0x00ffff00,
  0x00ffcc00, 0x00ff9900, 0x00ff6600, 0x00ff3300, 0x00ff0000, 0x00ccffff, 0x00ccccff, 0x00cc99ff,
  0x00cc66ff, 0x00cc33ff, 0x00cc00ff, 0x00ccffcc, 0x00cccccc, 0x00cc99cc, 0x00cc66cc, 0x00cc33cc,
  0x00cc00cc, 0x00ccff99, 0x00cccc99, 0x00cc9999, 0x00cc6699, 0x00cc3399, 0x00cc0099, 0x00ccff66,
  0x00cccc66, 0x00cc9966, 0x00cc6666, 0x00cc3366, 0x00cc0066, 0x00ccff33, 0x00cccc33, 0x00cc9933,
  0x00cc6633, 0x00cc3333, 0x00cc0033, 0x00ccff00, 0x00cccc00, 0x00cc9900, 0x00cc6600, 0x00cc3300,
  0x00cc0000, 0x0099ffff, 0x0099ccff, 0x009999ff, 0x009966ff, 0x009933ff, 0x009900ff, 0x0099ffcc,
  0x0099cccc, 0x009999cc, 0x009966cc, 0x009933cc, 0x009900cc, 0x0099ff99, 0x0099cc99, 0x00999999,
  0x00996699, 0x00993399, 0x00990099, 0x0099ff66, 0x0099cc66, 0x00999966, 0x00996666, 0x00993366,
  0x00990066, 0x0099ff33, 0x0099cc33, 0x00999933, 0x00996633, 0x00993333, 0x00990033, 0x0099ff00,
  0x0099cc00, 0x00999900, 0x00996600, 0x00993300, 0x00990000, 0x0066ffff, 0x0066ccff, 0x006699ff,
  0x006666ff, 0x006633ff, 0x006600ff, 0x0066ffcc, 0x0066cccc, 0x006699cc, 0x006666cc, 0x006633cc,
  0x006600cc, 0x0066ff99, 0x0066cc99, 0x00669999, 0x00666699, 0x00663399, 0x00660099, 0x0066ff66,
  0x0066cc66, 0x00669966, 0x00666666, 0x00663366, 0x00660066, 0x0066ff33, 0x0066cc33, 0x00669933,
  0x00666633, 0x00663333, 0x00660033, 0x0066ff00, 0x0066cc00, 0x00669900, 0x00666600, 0x00663300,
  0x00660000, 0x0033ffff, 0x0033ccff, 0x003399ff, 0x003366ff, 0x003333ff, 0x003300ff, 0x0033ffcc,
  0x0033cccc, 0x003399cc, 0x003366cc, 0x003333cc, 0x003300cc, 0x0033ff99, 0x0033cc99, 0x00339999,
  0x00336699, 0x00333399, 0x00330099, 0x0033ff66, 0x0033cc66, 0x00339966, 0x00336666, 0x00333366,
  0x00330066, 0x0033ff33, 0x0033cc33, 0x00339933, 0x00336633, 0x00333333, 0x00330033, 0x0033ff00,
  0x0033cc00, 0x00339900, 0x00336600, 0x00333300, 0x00330000, 0x0000ffff, 0x0000ccff, 0x000099ff,
  0x000066ff, 0x000033ff, 0x000000ff, 0x0000ffcc, 0x0000cccc, 0x000099cc, 0x000066cc, 0x000033cc,
  0x000000cc, 0x0000ff99, 0x0000cc99, 0x00009999, 0x00006699, 0x00003399, 0x00000099, 0x0000ff66,
  0x0000cc66, 0x00009966, 0x00006666, 0x00003366, 0x00000066, 0x0000ff33, 0x0000cc33, 0x00009933,
  0x00006633, 0x00003333, 0x00000033, 0x0000ff00, 0x0000cc00, 0x00009900, 0x00006600, 0x00003300,
  0x00ee0000, 0x00dd0000, 0x00bb0000, 0x00aa0000, 0x00880000, 0x00770000, 0x00550000, 0x00440000,
  0x00220000, 0x00110000, 0x0000ee00, 0x0000dd00, 0x0000bb00, 0x0000aa00, 0x00008800, 0x00007700,
  0x00005500, 0x00004400, 0x00002200, 0x00001100, 0x000000ee, 0x000000dd, 0x000000bb, 0x000000aa,
  0x00000088, 0x00000077, 0x00000055, 0x00000044, 0x00000022, 0x00000011, 0x00eeeeee, 0x00dddddd,
  0x00bbbbbb, 0x00aaaaaa, 0x00888888, 0x00777777, 0x00555555, 0x00444444, 0x00222222, 0x00111111,
];
