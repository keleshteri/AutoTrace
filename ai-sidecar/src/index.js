/**
 * AutoTrace LangGraph sidecar — local HTTP on 127.0.0.1:17991
 */
import http from "node:http";
import { runChat } from "./graphs/chat.js";
import { runAnalyst } from "./graphs/analyst.js";
import { runTemplate } from "./graphs/template.js";

const PORT = Number(process.env.AUTOTRACE_AI_PORT || 17991);

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true, service: "autotrace-ai-sidecar", langgraph: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/run") {
    try {
      const body = await readJson(req);
      const agent = body.agent || "chat";
      let result;
      if (agent === "tracking_analyst") {
        result = await runAnalyst(body);
      } else if (agent === "template") {
        result = await runTemplate(body);
      } else {
        result = await runChat(body);
      }
      send(res, 200, result);
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  send(res, 404, { error: "not_found", endpoints: ["/health", "POST /v1/run"] });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`autotrace-ai-sidecar (LangGraph) on http://127.0.0.1:${PORT}`);
});
