//! AI completion gateway with budget gates and optional LangGraph sidecar.

use crate::ai::secrets::{decrypt_secret, encrypt_secret};
use crate::store::{AiProvider, AiRunResult, Store};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentRequest {
    pub agent: String,
    pub model: Option<String>,
    pub prompt: String,
    pub system: Option<String>,
    pub chat_id: Option<i64>,
    pub template_slug: Option<String>,
    pub variables: Option<serde_json::Value>,
    pub day: Option<String>,
}

pub fn resolve_base_url(kind: &str, base_url: Option<&str>) -> String {
    if let Some(u) = base_url.filter(|s| !s.is_empty()) {
        return u.trim_end_matches('/').to_string();
    }
    match kind {
        "openai" => "https://api.openai.com/v1".into(),
        "anthropic" => "https://api.anthropic.com/v1".into(),
        "openrouter" => "https://openrouter.ai/api/v1".into(),
        "ollama" => "http://127.0.0.1:11434/v1".into(),
        "lmstudio" => "http://127.0.0.1:1234/v1".into(),
        _ => "http://127.0.0.1:11434/v1".into(),
    }
}

pub fn ensure_model_allowed(provider: &AiProvider, model: &str) -> Result<(), String> {
    if provider.allowed_models.is_empty() {
        return Ok(());
    }
    if provider.allowed_models.iter().any(|m| m == model) {
        Ok(())
    } else {
        Err(format!(
            "model '{model}' is not in the allowlist for provider {}",
            provider.label
        ))
    }
}

fn default_model(kind: &str, allowed: &[String]) -> String {
    if let Some(m) = allowed.first() {
        return m.clone();
    }
    match kind {
        "anthropic" => "claude-3-5-haiku-latest".into(),
        "ollama" => "llama3.2".into(),
        "lmstudio" => "local-model".into(),
        "openrouter" => "openai/gpt-4o-mini".into(),
        _ => "gpt-4o-mini".into(),
    }
}

fn estimate_tokens(text: &str) -> i64 {
    ((text.len() as i64) / 4).max(32)
}

pub fn encrypt_provider_key(store: &Store, plaintext: &str) -> Result<String, String> {
    encrypt_secret(store.path(), plaintext)
}

fn provider_api_key(store: &Store, enc: Option<&str>) -> Result<String, String> {
    match enc {
        Some(e) if !e.is_empty() => decrypt_secret(store.path(), e),
        _ => Ok(String::new()),
    }
}

/// Tiny completion used by Settings → Test.
pub fn test_provider(store: &Store, provider_id: i64) -> Result<AiRunResult, String> {
    if !store.ai_enabled() {
        return Err("Enable AI in settings first (opt-in)".into());
    }
    let warn = store.ai_budget_gate(64).map_err(|e| e.to_string())?;
    let (provider, enc) = store
        .get_ai_provider_secret(provider_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "provider not found".to_string())?;
    if !provider.enabled {
        return Err("provider is disabled".into());
    }
    let model = default_model(&provider.kind, &provider.allowed_models);
    ensure_model_allowed(&provider, &model)?;
    let key = provider_api_key(store, enc.as_deref())?;
    let result = chat_completion(
        &provider,
        &key,
        &model,
        "You are a connectivity probe. Reply with exactly: ok",
        "ping",
        32,
    )?;
    let _ = store.record_ai_usage(
        Some(provider.id),
        &result.model,
        "test",
        result.prompt_tokens,
        result.completion_tokens,
        None,
        None,
        "ok",
        None,
    );
    let _ = store.log_privacy_event(
        "ai_request",
        Some(&format!("test provider={} model={}", provider.label, result.model)),
    );
    Ok(AiRunResult {
        warning: warn,
        ..result
    })
}

pub fn run_agent(store: &Store, req: AgentRequest) -> Result<AiRunResult, String> {
    if !store.ai_enabled() {
        return Err("Enable AI in settings first (opt-in)".into());
    }
    let projected = estimate_tokens(&req.prompt)
        + req.system.as_ref().map(|s| estimate_tokens(s)).unwrap_or(0)
        + 512;
    let warn = store.ai_budget_gate(projected).map_err(|e| e.to_string())?;

    let (provider, enc) = store
        .default_ai_provider()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No AI provider configured — add one under AI → Providers".to_string())?;
    if !provider.enabled {
        return Err("Default AI provider is disabled".into());
    }
    let model = req
        .model
        .clone()
        .unwrap_or_else(|| default_model(&provider.kind, &provider.allowed_models));
    ensure_model_allowed(&provider, &model)?;
    let key = provider_api_key(store, enc.as_deref())?;

    // Prefer LangGraph sidecar when healthy; otherwise run in-process completion.
    let sidecar = store
        .get_setting("ai_sidecar_url")
        .ok()
        .flatten()
        .unwrap_or_else(|| "http://127.0.0.1:17991".into());

    let result = if sidecar_healthy(&sidecar) {
        run_via_sidecar(store, &sidecar, &provider, &key, &model, &req)?
    } else {
        run_local_fallback(store, &provider, &key, &model, &req)?
    };

    let _ = store.record_ai_usage(
        Some(provider.id),
        &result.model,
        &req.agent,
        result.prompt_tokens,
        result.completion_tokens,
        None,
        None,
        "ok",
        None,
    );
    let _ = store.log_privacy_event(
        "ai_request",
        Some(&format!(
            "agent={} model={} tokens={}",
            req.agent, result.model, result.total_tokens
        )),
    );

    if let Some(chat_id) = req.chat_id {
        let _ = store.add_ai_message(chat_id, "user", &req.prompt);
        let _ = store.add_ai_message(chat_id, "assistant", &result.text);
    }

    Ok(AiRunResult {
        warning: warn.or(result.warning),
        ..result
    })
}

fn sidecar_healthy(base: &str) -> bool {
    let url = format!("{}/health", base.trim_end_matches('/'));
    reqwest::blocking::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_millis(400))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn run_via_sidecar(
    store: &Store,
    sidecar: &str,
    provider: &AiProvider,
    api_key: &str,
    model: &str,
    req: &AgentRequest,
) -> Result<AiRunResult, String> {
    let local_token = store
        .list_integrations()
        .ok()
        .and_then(|rows| {
            rows.into_iter()
                .find(|i| i.kind == "local_api" && i.enabled)
                .and_then(|i| {
                    serde_json::from_str::<serde_json::Value>(&i.config_json)
                        .ok()
                        .and_then(|v| {
                            v.get("token")
                                .and_then(|t| t.as_str())
                                .map(|s| s.to_string())
                        })
                })
        })
        .unwrap_or_default();

    let body = serde_json::json!({
        "agent": req.agent,
        "model": model,
        "prompt": req.prompt,
        "system": req.system,
        "template_slug": req.template_slug,
        "variables": req.variables,
        "day": req.day,
        "provider": {
            "kind": provider.kind,
            "base_url": resolve_base_url(&provider.kind, provider.base_url.as_deref()),
            "api_key": api_key,
            "max_tokens": provider.max_tokens_per_request,
            "temperature": provider.temperature_cap.min(1.0),
        },
        "local_api": {
            "base": "http://127.0.0.1:17890",
            "token": local_token,
        },
        "privacy": {
            "send_titles": store.get_setting("ai_send_titles").ok().flatten().as_deref() == Some("1"),
            "send_urls": store.get_setting("ai_send_urls").ok().flatten().as_deref() == Some("1"),
        }
    });

    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(format!("{}/v1/run", sidecar.trim_end_matches('/')))
        .json(&body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .map_err(|e| format!("ai sidecar: {e}"))?;
    if !resp.status().is_success() {
        let t = resp.text().unwrap_or_default();
        return Err(format!("ai sidecar error: {t}"));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(AiRunResult {
        text: v
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string(),
        model: v
            .get("model")
            .and_then(|t| t.as_str())
            .unwrap_or(model)
            .to_string(),
        agent: req.agent.clone(),
        prompt_tokens: v.get("prompt_tokens").and_then(|t| t.as_i64()).unwrap_or(0),
        completion_tokens: v
            .get("completion_tokens")
            .and_then(|t| t.as_i64())
            .unwrap_or(0),
        total_tokens: v.get("total_tokens").and_then(|t| t.as_i64()).unwrap_or(0),
        warning: v
            .get("warning")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string()),
    })
}

fn run_local_fallback(
    store: &Store,
    provider: &AiProvider,
    api_key: &str,
    model: &str,
    req: &AgentRequest,
) -> Result<AiRunResult, String> {
    let (system, user) = match req.agent.as_str() {
        "template" => {
            let slug = req
                .template_slug
                .as_deref()
                .ok_or_else(|| "template_slug required".to_string())?;
            let tpl = store
                .get_ai_template(slug)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("unknown template {slug}"))?;
            let mut user = tpl.user_prompt_template.clone();
            if let Some(vars) = &req.variables {
                if let Some(obj) = vars.as_object() {
                    for (k, v) in obj {
                        let val = v.as_str().map(|s| s.to_string()).unwrap_or_else(|| v.to_string());
                        user = user.replace(&format!("{{{{{k}}}}}"), &val);
                    }
                }
            }
            if user.contains("{{day}}") {
                if let Some(d) = &req.day {
                    user = user.replace("{{day}}", d);
                }
            }
            if user.contains("{{data_json}}") {
                let data = build_context_json(store, req)?;
                user = user.replace("{{data_json}}", &data);
            }
            (tpl.system_prompt, user)
        }
        "tracking_analyst" => {
            let data = build_context_json(store, req)?;
            (
                "You are AutoTrace Tracking Analyst. Use only provided JSON. Give concrete insights: focus leaks, untagged time, meetings, billable gaps. Markdown.".into(),
                format!(
                    "Analyze day {}. Context:\n{}\n\nUser ask: {}",
                    req.day.as_deref().unwrap_or("today"),
                    data,
                    req.prompt
                ),
            )
        }
        _ => (
            req.system.clone().unwrap_or_else(|| {
                "You are AutoTrace assistant. Prefer approved summaries. Be concise.".into()
            }),
            req.prompt.clone(),
        ),
    };

    let mut result = chat_completion(
        provider,
        api_key,
        model,
        &system,
        &user,
        provider.max_tokens_per_request.min(4096),
    )?;
    result.agent = req.agent.clone();
    result.warning = Some(
        "LangGraph sidecar offline — used in-process completion fallback".into(),
    );
    Ok(result)
}

fn build_context_json(store: &Store, req: &AgentRequest) -> Result<String, String> {
    let day = req
        .day
        .clone()
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    let send_titles = store.get_setting("ai_send_titles").ok().flatten().as_deref() == Some("1");
    let digest = store.focus_digest_for_day(&day).ok();
    let report = store.day_report(&day).ok();
    let distraction = store.distraction_report(&day).ok();
    let mut sessions = store.sessions_for_day(&day).unwrap_or_default();
    if !send_titles {
        for s in &mut sessions {
            s.title = None;
            s.url = None;
        }
    }
    // Prefer approved/tagged summaries for AI context.
    let sessions: Vec<_> = sessions
        .into_iter()
        .filter(|s| s.approved || s.client_id.is_some() || s.pending)
        .take(80)
        .collect();
    let payload = serde_json::json!({
        "day": day,
        "digest": digest,
        "report": report,
        "distraction": distraction,
        "sessions": sessions,
    });
    Ok(payload.to_string())
}

fn chat_completion(
    provider: &AiProvider,
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    max_tokens: i64,
) -> Result<AiRunResult, String> {
    let base = resolve_base_url(&provider.kind, provider.base_url.as_deref());
    let client = reqwest::blocking::Client::new();

    if provider.kind == "anthropic" {
        if api_key.is_empty() {
            return Err("Anthropic API key required".into());
        }
        let body = serde_json::json!({
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{ "role": "user", "content": user }]
        });
        let resp = client
            .post(format!("{base}/messages"))
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("Anthropic error: {v}"));
        }
        let text = v
            .pointer("/content/0/text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        let prompt_tokens = v
            .pointer("/usage/input_tokens")
            .and_then(|t| t.as_i64())
            .unwrap_or(0);
        let completion_tokens = v
            .pointer("/usage/output_tokens")
            .and_then(|t| t.as_i64())
            .unwrap_or(0);
        return Ok(AiRunResult {
            text,
            model: model.into(),
            agent: "completion".into(),
            prompt_tokens,
            completion_tokens,
            total_tokens: prompt_tokens + completion_tokens,
            warning: None,
        });
    }

    // OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio, custom)
    if api_key.is_empty() && !matches!(provider.kind.as_str(), "ollama" | "lmstudio") {
        return Err("API key required for this provider".into());
    }
    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "temperature": provider.temperature_cap.min(1.0),
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });
    let mut req = client
        .post(format!("{base}/chat/completions"))
        .header("content-type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(120));
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key);
    }
    let resp = req.send().map_err(|e| e.to_string())?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("LLM error: {v}"));
    }
    let text = v
        .pointer("/choices/0/message/content")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let prompt_tokens = v
        .pointer("/usage/prompt_tokens")
        .and_then(|t| t.as_i64())
        .unwrap_or_else(|| estimate_tokens(system) + estimate_tokens(user));
    let completion_tokens = v
        .pointer("/usage/completion_tokens")
        .and_then(|t| t.as_i64())
        .unwrap_or_else(|| estimate_tokens(&text));
    Ok(AiRunResult {
        text,
        model: model.into(),
        agent: "completion".into(),
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        warning: None,
    })
}
