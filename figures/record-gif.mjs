/**
 * Tiny capture server for the dynamic-lighting demo GIF.
 *
 * Serves `recorder.html`, receives raw RGBA frames streamed back from the page
 * (POST /frame?i=N), and on POST /done encodes them into an animated GIF with
 * the pure-JS `gifenc` encoder - no ffmpeg/ImageMagick required.
 *
 *   node figures/record-gif.mjs
 *   # then open http://localhost:7788/ in a browser; it records and exits.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, "recorder.html"));
const OUT = path.resolve(__dirname, "../whitepaper/figures/lighting-phasing.gif");
const PORT = 7788;

/** @type {Map<number, Buffer>} */
const frames = new Map();

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function encode(w, h, n, delay) {
  // Global palette sampled from a few frames so colors don't flicker per frame.
  const sampleIdx = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4)];
  const parts = sampleIdx.map((i) => frames.get(i)).filter(Boolean);
  const sample = Buffer.concat(parts);
  const palette = quantize(new Uint8Array(sample.buffer, sample.byteOffset, sample.length), 256);

  const gif = GIFEncoder();
  for (let i = 0; i < n; i++) {
    const buf = frames.get(i);
    if (!buf) {
      console.error("missing frame", i);
      continue;
    }
    const rgba = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, w, h, { palette, delay });
  }
  gif.finish();
  fs.writeFileSync(OUT, Buffer.from(gif.bytes()));
  console.log("WROTE", OUT, fs.statSync(OUT).size, "bytes");
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/recorder.html")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(HTML);
    return;
  }
  if (req.method === "POST" && u.pathname === "/frame") {
    const i = Number(u.searchParams.get("i"));
    frames.set(i, await readBody(req));
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "POST" && u.pathname === "/done") {
    await readBody(req);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("OK");
    try {
      encode(
        Number(u.searchParams.get("w")),
        Number(u.searchParams.get("h")),
        Number(u.searchParams.get("n")),
        Number(u.searchParams.get("delay")) || 40,
      );
    } catch (err) {
      console.error("ENCODE_ERROR", err);
    }
    setTimeout(() => server.close(() => process.exit(0)), 250);
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log("RECORD_SERVER_READY", PORT));
