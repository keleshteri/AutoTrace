import http from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.SYNC_TOKEN || "";
const packs = new Map();

function auth(req) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || "";
  return h === `Bearer ${TOKEN}` || h === TOKEN;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "autotrace-sync" }));
    return;
  }
  if (!auth(req)) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/sync") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    const id = createHash("sha256").update(body).digest("hex").slice(0, 16);
    packs.set(id, { body, at: new Date().toISOString() });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, id, stored: packs.size }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/sync/latest") {
    const latest = [...packs.entries()].at(-1);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(latest ? latest[1].body : JSON.stringify({ empty: true }));
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`autotrace-sync on :${PORT}`));
