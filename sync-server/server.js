import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
// Loopback by default; set HOST=0.0.0.0 when deploying behind an HTTPS proxy.
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN = process.env.SYNC_TOKEN || "";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 5 * 1024 * 1024);
const MAX_PACKS = 20;

if (TOKEN.length < 16) {
  console.error("SYNC_TOKEN must be set to a random string of at least 16 characters.");
  process.exit(1);
}

/** In-memory ring of recent packs (newest last). Restarting the server clears it. */
const packs = new Map();

function auth(req) {
  const header = req.headers.authorization || "";
  const presented = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : header);
  const expected = Buffer.from(TOKEN);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, service: "autotrace-sync" });
    return;
  }
  if (!auth(req)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }
  try {
    if (req.method === "POST" && url.pathname === "/v1/sync") {
      const body = await readBody(req);
      try {
        JSON.parse(body);
      } catch {
        json(res, 400, { error: "body must be JSON" });
        return;
      }
      const id = createHash("sha256").update(body).digest("hex").slice(0, 16);
      packs.delete(id);
      packs.set(id, { body, at: new Date().toISOString() });
      while (packs.size > MAX_PACKS) packs.delete(packs.keys().next().value);
      json(res, 200, { ok: true, id, stored: packs.size });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/sync/latest") {
      const latest = [...packs.values()].at(-1);
      json(res, 200, latest ? latest.body : { empty: true });
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, err.status || 500, { error: err.status ? err.message : "internal error" });
  }
});

server.listen(PORT, HOST, () => console.log(`autotrace-sync on ${HOST}:${PORT}`));
