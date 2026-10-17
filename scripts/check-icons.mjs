#!/usr/bin/env node
// Verifies the desktop icon set that Tauri bakes into installers, window, taskbar and tray:
//   - every PNG's pixel size matches its file name (32x32.png, Square142x142Logo.png, …)
//   - icon.ico / icon.icns contain the sizes Windows / macOS need
//   - every icon listed in tauri.conf.json bundle.icon exists
//   - no file is still one of Tauri's default placeholder icons (the v0.1.1 bug)
// Regenerate the set with: npx tauri icon src-tauri/icons/icon-1024.png  (then delete android/ ios/)
// Run: node scripts/check-icons.mjs
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const iconsDir = join(root, "src-tauri/icons");
const problems = [];

// sha256 of the placeholder icons that `tauri init` ships (from this repo's first commit).
const TAURI_DEFAULTS = new Set([
  "10be9840e58fb018eb9029601d42008e16c0c9cfa66b8f9467fee94f600160d4",
  "12aed0e7ee06cb631427dc9da72c0c7ecf03857fbc4884d0c31f78314feb6c7f",
  "19b4fec485db7df51a691fcce72a3dd6f983e754fc4262da7154e4a4c688f69e",
  "1c6782dc65c8111c12cbc1882a0fea5e71ab8e51b18da2ce9580f5c88860ed02",
  "2937fc83324cd9a1fddcfefd5927c791af31996a6840bfb3e2f1d578ad4129de",
  "392206b573a809997f3ff16fe68f456a52e931c372107eade9572b329bbe3321",
  "3dc10493b7de48a61de58f768f8a5708d3a44a068c148cedf0502b9b9b71ba5d",
  "54f7a0f58c96a4b023c1edc4b53fc443e27dace50e345f6936fa29bc20f785ca",
  "65fb570cb0e61ffce02ad67784cb200a0bf058400300980a46fa0d0c8f43a77a",
  "6c7660390d65217fe8de0892862254f47aee77e0af7096c75b8bfe168c5403f7",
  "91a54024dd47230991546088f2e75d3e3199b3ccc9fe40f3f6b7d3bf1cbf7776",
  "9733a89c539115de3c49bd06720bfc99639d9a918f5df48a810e267cf3554119",
  "cc72279c41b4ed343e8db7e7541ceef7b6b23edaa83d4e7338421dfcb8d63c33",
  "ea0b7c5d4b1d1ab9c91d2f7c9b069c8dfbf4557b0649a5777d47332cde610262",
  "fec1e2080ca73cd4c4a123b23b1cd364059a8a8efeba3076e21dfefed390693b",
]);

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function expectedSize(name) {
  if (name === "128x128@2x.png") return 256;
  if (name === "StoreLogo.png") return 50;
  if (name === "icon.png") return 512;
  const m = name.match(/^(?:Square)?(\d+)x\1(?:Logo)?\.png$/) ?? name.match(/^icon-(\d+)\.png$/);
  return m ? Number(m[1]) : null;
}

for (const name of readdirSync(iconsDir)) {
  const buf = readFileSync(join(iconsDir, name));
  const hash = createHash("sha256").update(buf).digest("hex");
  if (TAURI_DEFAULTS.has(hash)) problems.push(`${name} is still Tauri's default placeholder icon`);

  if (name.endsWith(".png")) {
    const size = pngSize(buf);
    const want = expectedSize(name);
    if (!size) problems.push(`${name} is not a PNG`);
    else if (want && (size[0] !== want || size[1] !== want))
      problems.push(`${name} is ${size[0]}x${size[1]}, expected ${want}x${want}`);
  }
}

// Windows .ico: needs 16/32/48/256 for title bar, taskbar, Explorer and installer.
const icoPath = join(iconsDir, "icon.ico");
if (existsSync(icoPath)) {
  const ico = readFileSync(icoPath);
  const count = ico.readUInt16LE(4);
  const sizes = new Set();
  for (let i = 0; i < count; i++) sizes.add(ico[6 + i * 16] || 256);
  for (const s of [16, 32, 48, 256]) if (!sizes.has(s)) problems.push(`icon.ico lacks a ${s}x${s} image (has ${[...sizes].join(", ")})`);
} else problems.push("icon.ico is missing");

// macOS .icns: needs 512 and 1024 (ic09 / ic10) for the Dock and Finder.
const icnsPath = join(iconsDir, "icon.icns");
if (existsSync(icnsPath)) {
  const icns = readFileSync(icnsPath);
  const types = new Set();
  for (let off = 8; off + 8 <= icns.length; ) {
    types.add(icns.toString("ascii", off, off + 4));
    const len = icns.readUInt32BE(off + 4);
    if (len < 8) break;
    off += len;
  }
  for (const t of ["ic09", "ic10"]) if (!types.has(t)) problems.push(`icon.icns lacks ${t} (has ${[...types].join(", ")})`);
} else problems.push("icon.icns is missing");

const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
for (const rel of conf.bundle?.icon ?? []) {
  if (!existsSync(join(root, "src-tauri", rel))) problems.push(`tauri.conf.json bundle.icon lists missing file ${rel}`);
}

if (problems.length) {
  console.error(`Icon check failed (${problems.length}):\n- ${problems.join("\n- ")}`);
  console.error("Regenerate with: npx tauri icon src-tauri/icons/icon-1024.png (then remove android/ and ios/)");
  process.exit(1);
}
console.log("Icon check ok: sizes match names, ico/icns complete, no Tauri placeholders.");
