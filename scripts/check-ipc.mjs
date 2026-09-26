#!/usr/bin/env node
// Verifies the Tauri IPC surface stays in sync:
//   1. every `#[tauri::command]` in src-tauri/src is registered in lib.rs `generate_handler!`
//   2. every command the frontend invokes (src/lib/api.ts) is registered
//   3. every command the e2e mock handles is registered (catches stale mocks)
// Exits 1 with a list of problems. Run: node scripts/check-ipc.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");

function rustFiles(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) return rustFiles(rel);
    return rel.endsWith(".rs") ? [rel] : [];
  });
}

const lib = read("src-tauri/src/lib.rs");
const handlerStart = lib.indexOf("generate_handler![");
const handlerBlock = lib.slice(handlerStart, lib.indexOf("]", handlerStart));
const registered = new Set([...handlerBlock.matchAll(/(\w+)::(\w+)/g)].map((m) => m[2]));

const defined = new Map();
for (const file of rustFiles("src-tauri/src")) {
  for (const m of read(file).matchAll(/#\[tauri::command(?:\([^)]*\))?\]\s*pub(?:\(crate\))?\s+(?:async\s+)?fn\s+(\w+)/g)) {
    defined.set(m[1], file);
  }
}

const invoked = new Set(
  [...read("src/lib/api.ts").matchAll(/invoke(?:<[\s\S]*?>)?\(\s*"(\w+)"/g)].map((m) => m[1]),
);
const mocked = new Set([...read("e2e/mockTauri.ts").matchAll(/case "(\w+)":/g)].map((m) => m[1]));

const problems = [];
for (const [name, file] of defined) {
  if (!registered.has(name)) problems.push(`${name} (${file}) is a #[tauri::command] but not in generate_handler! in lib.rs`);
}
for (const name of registered) {
  if (!defined.has(name)) problems.push(`${name} is in generate_handler! but no #[tauri::command] fn defines it`);
}
for (const name of invoked) {
  if (!registered.has(name)) problems.push(`src/lib/api.ts invokes "${name}", which is not registered`);
}
for (const name of mocked) {
  if (!registered.has(name)) problems.push(`e2e/mockTauri.ts mocks "${name}", which is not registered`);
}

if (problems.length) {
  console.error(`IPC check failed (${problems.length}):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`IPC check ok: ${registered.size} commands registered, ${invoked.size} used by api.ts.`);
