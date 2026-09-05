//! Localhost export API — token-gated, 127.0.0.1 only. Off by default.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::store::Store;

pub struct LocalApiHandle {
    store: Arc<Store>,
    running: Arc<AtomicBool>,
    join: Mutex<Option<JoinHandle<()>>>,
}

impl LocalApiHandle {
    pub fn new(store: Arc<Store>) -> Self {
        let handle = Self {
            store,
            running: Arc::new(AtomicBool::new(false)),
            join: Mutex::new(None),
        };
        handle.reconcile();
        handle
    }

    /// Start or stop the server to match the local_api integration row.
    pub fn reconcile(&self) {
        let enabled = self
            .store
            .get_integration_by_kind("local_api")
            .ok()
            .flatten()
            .map(|r| r.enabled)
            .unwrap_or(false);

        if enabled {
            self.start();
        } else {
            self.stop();
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn status_message(&self) -> String {
        let row = self.store.get_integration_by_kind("local_api").ok().flatten();
        let Some(row) = row else {
            return "local_api not configured".into();
        };
        let port = port_from_config(&row.config_json);
        if !row.enabled {
            return format!("disabled (would bind 127.0.0.1:{port})");
        }
        if self.is_running() {
            format!("listening on http://127.0.0.1:{port}")
        } else {
            format!("enabled but not listening (check port {port})")
        }
    }

    fn start(&self) {
        if self.running.load(Ordering::SeqCst) {
            return;
        }
        let row = match self.store.get_integration_by_kind("local_api") {
            Ok(Some(r)) if r.enabled => r,
            _ => return,
        };
        let port = port_from_config(&row.config_json);
        let token = token_from_config(&row.config_json);
        let addr = format!("127.0.0.1:{port}");
        let server = match Server::http(&addr) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("AutoTrace local API failed to bind {addr}: {e}");
                return;
            }
        };

        self.running.store(true, Ordering::SeqCst);
        let running = Arc::clone(&self.running);
        let store = Arc::clone(&self.store);

        let handle = thread::spawn(move || {
            while running.load(Ordering::SeqCst) {
                let mut request = match server.recv_timeout(std::time::Duration::from_millis(400)) {
                    Ok(Some(r)) => r,
                    Ok(None) => continue,
                    Err(_) => break,
                };

                if !authorize(&request, &token) {
                    let _ = request.respond(Response::from_string("unauthorized").with_status_code(401));
                    continue;
                }

                let url = request.url().to_string();
                let method = request.method().clone();

                let response = match (method, url.as_str()) {
                    (Method::Get, "/health") | (Method::Get, "/v1/health") => {
                        json_response(200, serde_json::json!({"ok": true, "service": "autotrace"}))
                    }
                    (Method::Get, path) if path.starts_with("/v1/sessions") => {
                        handle_sessions(&store, path)
                    }
                    (Method::Get, path) if path.starts_with("/v1/export/") => {
                        handle_export_day(&store, path)
                    }
                    (Method::Get, "/v1/mcp/tools") => json_response(
                        200,
                        serde_json::json!({
                            "tools": [
                                {"name": "list_sessions", "description": "List approved exportable sessions for a day", "input": {"day": "YYYY-MM-DD"}},
                                {"name": "day_report", "description": "Aggregated day report", "input": {"day": "YYYY-MM-DD"}},
                                {"name": "profitability", "description": "Utilization and revenue for a range", "input": {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}},
                                {"name": "export_sync_pack", "description": "Export hierarchy sync pack JSON"},
                                {"name": "distraction_report", "description": "Context-switch score for a day", "input": {"day": "YYYY-MM-DD"}}
                            ],
                            "protocol": "MCP JSON-RPC 2.0 via POST /v1/mcp"
                        }),
                    ),
                    (Method::Post, "/v1/mcp") | (Method::Post, "/v1/mcp/call") => {
                        handle_mcp(&store, &mut request)
                    }
                    _ => json_response(
                        404,
                        serde_json::json!({
                            "error": "not_found",
                            "endpoints": ["/health", "/v1/sessions?day=", "/v1/export/YYYY-MM-DD", "/v1/mcp/tools", "POST /v1/mcp"]
                        }),
                    ),
                };
                let _ = request.respond(response);
            }
            running.store(false, Ordering::SeqCst);
        });

        if let Ok(mut g) = self.join.lock() {
            *g = Some(handle);
        }
    }

    fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        // Join briefly; server loop exits on next timeout.
        if let Ok(mut g) = self.join.lock() {
            if let Some(h) = g.take() {
                let _ = h.join();
            }
        }
    }
}

impl Drop for LocalApiHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

fn port_from_config(config_json: &str) -> u16 {
    serde_json::from_str::<serde_json::Value>(config_json)
        .ok()
        .and_then(|v| v.get("port").and_then(|p| p.as_u64()))
        .unwrap_or(17890) as u16
}

fn token_from_config(config_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(config_json)
        .ok()
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(|s| s.to_string()))
        .unwrap_or_default()
}

fn authorize(request: &tiny_http::Request, token: &str) -> bool {
    if token.is_empty() {
        // Require a token when enabled — refuse all if misconfigured empty.
        return false;
    }
    let auth = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| h.value.as_str().to_string());
    match auth {
        Some(a) if a == format!("Bearer {token}") => true,
        Some(a) if a == token => true,
        _ => request
            .url()
            .contains(&format!("access_token={token}")),
    }
}

fn handle_sessions(store: &Store, path: &str) -> Response<Cursor<Vec<u8>>> {
    let day = path
        .split('?')
        .nth(1)
        .unwrap_or("")
        .split('&')
        .find_map(|p| p.strip_prefix("day="))
        .map(|s| s.to_string());

    let entries = match store.eligible_export_entries(None) {
        Ok(e) => e,
        Err(e) => {
            return json_response(500, serde_json::json!({"error": e.to_string()}));
        }
    };
    let filtered: Vec<_> = entries
        .into_iter()
        .filter(|e| day.as_ref().map(|d| e.started_at.starts_with(d.as_str())).unwrap_or(true))
        .map(|e| crate::integrations::entry_json(&e))
        .collect();
    json_response(200, serde_json::json!({ "entries": filtered }))
}

fn handle_export_day(store: &Store, path: &str) -> Response<Cursor<Vec<u8>>> {
    let day = path.trim_start_matches("/v1/export/").split('?').next().unwrap_or("");
    if day.len() != 10 {
        return json_response(400, serde_json::json!({"error": "use /v1/export/YYYY-MM-DD"}));
    }
    match store.export_csv_for_day(day) {
        Ok(csv) => {
            // Still privacy-filter: only include rows that correspond to eligible summaries.
            // CSV export historically includes all sessions; for API we return eligible JSON instead if preferred.
            // Provide CSV of eligible entries only.
            let entries = store.eligible_export_entries(None).unwrap_or_default();
            let mut out = String::from(
                "session_id,started_at,ended_at,duration_mins,client,project,task,description\n",
            );
            for e in entries.into_iter().filter(|e| e.started_at.starts_with(day)) {
                out.push_str(&format!(
                    "{},{},{},{},{},{},{},{}\n",
                    e.session_id,
                    e.started_at,
                    e.ended_at.unwrap_or_default(),
                    e.duration_mins,
                    csv_escape(e.client_name.as_deref().unwrap_or("")),
                    csv_escape(e.project_name.as_deref().unwrap_or("")),
                    csv_escape(e.task_name.as_deref().unwrap_or("")),
                    csv_escape(&e.description),
                ));
            }
            let _ = csv; // unused full export — intentional privacy filter
            let data = out.into_bytes();
            let mut resp = Response::from_data(data);
            if let Ok(h) = Header::from_bytes("Content-Type", "text/csv; charset=utf-8") {
                resp.add_header(h);
            }
            resp
        }
        Err(e) => json_response(500, serde_json::json!({"error": e.to_string()})),
    }
}

fn handle_mcp(store: &Store, request: &mut tiny_http::Request) -> Response<Cursor<Vec<u8>>> {
    let mut body = String::new();
    request.as_reader().read_to_string(&mut body).ok();
    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({}));

    if parsed.get("jsonrpc").and_then(|j| j.as_str()) == Some("2.0") {
        return handle_mcp_jsonrpc(store, &parsed);
    }

    let tool = parsed
        .get("tool")
        .or_else(|| parsed.get("name"))
        .and_then(|t| t.as_str())
        .unwrap_or("");
    let args = parsed.get("arguments").cloned().unwrap_or(serde_json::json!({}));
    match call_mcp_tool(store, tool, &args) {
        Ok(result) => json_response(200, serde_json::json!({"ok": true, "result": result})),
        Err(e) => json_response(400, serde_json::json!({"error": e})),
    }
}

fn handle_mcp_jsonrpc(store: &Store, parsed: &serde_json::Value) -> Response<Cursor<Vec<u8>>> {
    let id = parsed.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let method = parsed.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = parsed.get("params").cloned().unwrap_or(serde_json::json!({}));

    let result = match method {
        "initialize" => Ok(serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "autotrace", "version": "0.1.0" }
        })),
        "notifications/initialized" | "ping" => Ok(serde_json::json!({})),
        "tools/list" => Ok(serde_json::json!({
            "tools": [
                {
                    "name": "list_sessions",
                    "description": "List approved exportable sessions for a day",
                    "inputSchema": {
                        "type": "object",
                        "properties": { "day": { "type": "string" } }
                    }
                },
                {
                    "name": "day_report",
                    "description": "Aggregated day report",
                    "inputSchema": {
                        "type": "object",
                        "properties": { "day": { "type": "string" } },
                        "required": ["day"]
                    }
                },
                {
                    "name": "profitability",
                    "description": "Utilization and revenue for a range",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "from": { "type": "string" },
                            "to": { "type": "string" }
                        },
                        "required": ["from"]
                    }
                },
                {
                    "name": "export_sync_pack",
                    "description": "Export hierarchy sync pack JSON",
                    "inputSchema": { "type": "object", "properties": {} }
                },
                {
                    "name": "distraction_report",
                    "description": "Context-switch / distraction score for a day",
                    "inputSchema": {
                        "type": "object",
                        "properties": { "day": { "type": "string" } },
                        "required": ["day"]
                    }
                }
            ]
        })),
        "tools/call" => {
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(serde_json::json!({}));
            match call_mcp_tool(store, name, &args) {
                Ok(result) => Ok(serde_json::json!({
                    "content": [{ "type": "text", "text": result.to_string() }],
                    "isError": false
                })),
                Err(e) => Ok(serde_json::json!({
                    "content": [{ "type": "text", "text": e }],
                    "isError": true
                })),
            }
        }
        _ => Err(format!("method not found: {method}")),
    };

    match result {
        Ok(value) => json_response(
            200,
            serde_json::json!({"jsonrpc": "2.0", "id": id, "result": value}),
        ),
        Err(msg) => json_response(
            200,
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": msg }
            }),
        ),
    }
}

fn call_mcp_tool(
    store: &Store,
    tool: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    match tool {
        "list_sessions" => {
            let day = args.get("day").and_then(|d| d.as_str());
            let entries = store.eligible_export_entries(None).unwrap_or_default();
            let filtered: Vec<_> = entries
                .into_iter()
                .filter(|e| day.map(|d| e.started_at.starts_with(d)).unwrap_or(true))
                .map(|e| crate::integrations::entry_json(&e))
                .collect();
            Ok(serde_json::json!(filtered))
        }
        "day_report" => {
            let day = args.get("day").and_then(|d| d.as_str()).unwrap_or("");
            store
                .day_report(day)
                .map(|r| serde_json::to_value(r).unwrap_or_default())
                .map_err(|e| e.to_string())
        }
        "profitability" => {
            let from = args.get("from").and_then(|d| d.as_str()).unwrap_or("");
            let to = args.get("to").and_then(|d| d.as_str()).unwrap_or(from);
            store
                .profitability_report(from, to)
                .map(|r| serde_json::to_value(r).unwrap_or_default())
                .map_err(|e| e.to_string())
        }
        "export_sync_pack" => store
            .export_sync_pack()
            .map(|s| serde_json::from_str(&s).unwrap_or(serde_json::json!({})))
            .map_err(|e| e.to_string()),
        "distraction_report" => {
            let day = args.get("day").and_then(|d| d.as_str()).unwrap_or("");
            store
                .distraction_report(day)
                .map(|r| serde_json::to_value(r).unwrap_or_default())
                .map_err(|e| e.to_string())
        }
        "" => Err("unknown_tool — use tools/list or GET /v1/mcp/tools".into()),
        other => Err(format!("unknown_tool: {other}")),
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn json_response(code: u16, value: serde_json::Value) -> Response<Cursor<Vec<u8>>> {
    let body = value.to_string().into_bytes();
    let mut resp = Response::from_data(body).with_status_code(StatusCode(code));
    if let Ok(h) = Header::from_bytes("Content-Type", "application/json; charset=utf-8") {
        resp.add_header(h);
    }
    resp
}
