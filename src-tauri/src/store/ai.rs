//! Local AI: provider CRUD, budgets, usage, templates, chat.

use rusqlite::{params, OptionalExtension};

use super::{AiBudget, AiChat, AiMessage, AiProvider, AiTemplate, AiUsageRow, AiUsageSummary, Result, Store, StoreError};

fn parse_models(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(json).unwrap_or_default()
}

impl Store {
    pub fn list_ai_providers(&self) -> Result<Vec<AiProvider>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, kind, label, base_url, api_key_enc, enabled, is_default,
                    allowed_models, max_tokens_per_request, temperature_cap
             FROM ai_providers ORDER BY is_default DESC, id ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                let key: Option<String> = row.get(4)?;
                let models: String = row.get(7)?;
                Ok(AiProvider {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    label: row.get(2)?,
                    base_url: row.get(3)?,
                    has_api_key: key.as_ref().map(|k| !k.is_empty()).unwrap_or(false),
                    enabled: row.get::<_, i64>(5)? != 0,
                    is_default: row.get::<_, i64>(6)? != 0,
                    allowed_models: parse_models(&models),
                    max_tokens_per_request: row.get(8)?,
                    temperature_cap: row.get::<_, f64>(9)? as f32,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_ai_provider_secret(&self, id: i64) -> Result<Option<(AiProvider, Option<String>)>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let row = conn
            .query_row(
                "SELECT id, kind, label, base_url, api_key_enc, enabled, is_default,
                        allowed_models, max_tokens_per_request, temperature_cap
                 FROM ai_providers WHERE id = ?1",
                params![id],
                |row| {
                    let key: Option<String> = row.get(4)?;
                    let models: String = row.get(7)?;
                    Ok((
                        AiProvider {
                            id: row.get(0)?,
                            kind: row.get(1)?,
                            label: row.get(2)?,
                            base_url: row.get(3)?,
                            has_api_key: key.as_ref().map(|k| !k.is_empty()).unwrap_or(false),
                            enabled: row.get::<_, i64>(5)? != 0,
                            is_default: row.get::<_, i64>(6)? != 0,
                            allowed_models: parse_models(&models),
                            max_tokens_per_request: row.get(8)?,
                            temperature_cap: row.get::<_, f64>(9)? as f32,
                        },
                        key,
                    ))
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn default_ai_provider(&self) -> Result<Option<(AiProvider, Option<String>)>> {
        let list = self.list_ai_providers()?;
        let id = list
            .iter()
            .find(|p| p.enabled && p.is_default)
            .or_else(|| list.iter().find(|p| p.enabled))
            .map(|p| p.id);
        match id {
            Some(id) => self.get_ai_provider_secret(id),
            None => Ok(None),
        }
    }

    pub fn upsert_ai_provider(
        &self,
        id: Option<i64>,
        kind: &str,
        label: &str,
        base_url: Option<&str>,
        api_key_enc: Option<&str>,
        enabled: bool,
        is_default: bool,
        allowed_models: &[String],
        max_tokens_per_request: i64,
        temperature_cap: f32,
    ) -> Result<AiProvider> {
        let models = serde_json::to_string(allowed_models).unwrap_or_else(|_| "[]".into());
        let conn = self.conn.lock().expect("store mutex poisoned");
        if is_default {
            conn.execute("UPDATE ai_providers SET is_default = 0", [])?;
        }
        let id = if let Some(id) = id {
            if let Some(key) = api_key_enc {
                conn.execute(
                    "UPDATE ai_providers SET kind=?1, label=?2, base_url=?3, api_key_enc=?4,
                     enabled=?5, is_default=?6, allowed_models=?7, max_tokens_per_request=?8,
                     temperature_cap=?9, updated_at=datetime('now') WHERE id=?10",
                    params![
                        kind,
                        label,
                        base_url,
                        key,
                        enabled as i64,
                        is_default as i64,
                        models,
                        max_tokens_per_request,
                        temperature_cap as f64,
                        id
                    ],
                )?;
            } else {
                conn.execute(
                    "UPDATE ai_providers SET kind=?1, label=?2, base_url=?3,
                     enabled=?4, is_default=?5, allowed_models=?6, max_tokens_per_request=?7,
                     temperature_cap=?8, updated_at=datetime('now') WHERE id=?9",
                    params![
                        kind,
                        label,
                        base_url,
                        enabled as i64,
                        is_default as i64,
                        models,
                        max_tokens_per_request,
                        temperature_cap as f64,
                        id
                    ],
                )?;
            }
            id
        } else {
            conn.execute(
                "INSERT INTO ai_providers (kind, label, base_url, api_key_enc, enabled, is_default,
                 allowed_models, max_tokens_per_request, temperature_cap)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    kind,
                    label,
                    base_url,
                    api_key_enc.unwrap_or(""),
                    enabled as i64,
                    is_default as i64,
                    models,
                    max_tokens_per_request,
                    temperature_cap as f64
                ],
            )?;
            conn.last_insert_rowid()
        };
        drop(conn);
        self.get_ai_provider_secret(id)?
            .map(|(p, _)| p)
            .ok_or_else(|| StoreError::Msg("provider missing after upsert".into()))
    }

    pub fn delete_ai_provider(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM ai_providers WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_ai_budgets(&self) -> Result<Vec<AiBudget>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, period, token_limit, request_limit, cost_usd_limit, warn_at_pct
             FROM ai_budgets ORDER BY period",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AiBudget {
                    id: row.get(0)?,
                    period: row.get(1)?,
                    token_limit: row.get(2)?,
                    request_limit: row.get(3)?,
                    cost_usd_limit: row.get(4)?,
                    warn_at_pct: row.get::<_, f64>(5)? as f32,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn set_ai_budget(
        &self,
        period: &str,
        token_limit: i64,
        request_limit: i64,
        cost_usd_limit: Option<f64>,
        warn_at_pct: f32,
    ) -> Result<AiBudget> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO ai_budgets (period, token_limit, request_limit, cost_usd_limit, warn_at_pct)
             VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(period) DO UPDATE SET
               token_limit=excluded.token_limit,
               request_limit=excluded.request_limit,
               cost_usd_limit=excluded.cost_usd_limit,
               warn_at_pct=excluded.warn_at_pct,
               updated_at=datetime('now')",
            params![period, token_limit, request_limit, cost_usd_limit, warn_at_pct as f64],
        )?;
        drop(conn);
        self.list_ai_budgets()?
            .into_iter()
            .find(|b| b.period == period)
            .ok_or_else(|| StoreError::Msg("budget missing".into()))
    }

    pub fn record_ai_usage(
        &self,
        provider_id: Option<i64>,
        model: &str,
        agent: &str,
        prompt_tokens: i64,
        completion_tokens: i64,
        estimated_cost_usd: Option<f64>,
        request_id: Option<&str>,
        status: &str,
        detail: Option<&str>,
    ) -> Result<()> {
        let total = prompt_tokens + completion_tokens;
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO ai_usage (provider_id, model, agent, prompt_tokens, completion_tokens,
             total_tokens, estimated_cost_usd, request_id, status, detail)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                provider_id,
                model,
                agent,
                prompt_tokens,
                completion_tokens,
                total,
                estimated_cost_usd,
                request_id,
                status,
                detail
            ],
        )?;
        Ok(())
    }

    fn usage_totals_since(&self, since: &str) -> Result<(i64, i64)> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let (tokens, reqs): (i64, i64) = conn.query_row(
            "SELECT IFNULL(SUM(total_tokens),0), COUNT(*) FROM ai_usage
             WHERE created_at >= ?1 AND status = 'ok'",
            params![since],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok((tokens, reqs))
    }

    pub fn ai_usage_summary(&self) -> Result<AiUsageSummary> {
        let day_start = chrono::Local::now().format("%Y-%m-%dT00:00:00").to_string();
        let month_start = chrono::Local::now().format("%Y-%m-01T00:00:00").to_string();
        let (day_tokens, day_requests) = self.usage_totals_since(&day_start)?;
        let (month_tokens, month_requests) = self.usage_totals_since(&month_start)?;
        let budgets = self.list_ai_budgets()?;
        let day_budget = budgets.iter().find(|b| b.period == "day").cloned();
        let month_budget = budgets.iter().find(|b| b.period == "month").cloned();

        let mut warn = false;
        let mut blocked = false;
        if let Some(b) = &day_budget {
            if day_tokens >= b.token_limit || day_requests >= b.request_limit {
                blocked = true;
            } else if day_tokens as f32 >= b.token_limit as f32 * (b.warn_at_pct / 100.0) {
                warn = true;
            }
        }
        if let Some(b) = &month_budget {
            if month_tokens >= b.token_limit || month_requests >= b.request_limit {
                blocked = true;
            } else if month_tokens as f32 >= b.token_limit as f32 * (b.warn_at_pct / 100.0) {
                warn = true;
            }
        }

        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, provider_id, model, agent, prompt_tokens, completion_tokens, total_tokens,
                    estimated_cost_usd, status, created_at
             FROM ai_usage ORDER BY id DESC LIMIT 40",
        )?;
        let recent = stmt
            .query_map([], |row| {
                Ok(AiUsageRow {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    model: row.get(2)?,
                    agent: row.get(3)?,
                    prompt_tokens: row.get(4)?,
                    completion_tokens: row.get(5)?,
                    total_tokens: row.get(6)?,
                    estimated_cost_usd: row.get(7)?,
                    status: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(AiUsageSummary {
            day_tokens,
            day_requests,
            month_tokens,
            month_requests,
            day_budget,
            month_budget,
            warn,
            blocked,
            recent,
        })
    }

    /// Returns Ok(warning_message) or Err if blocked. `projected` extra tokens for this call.
    pub fn ai_budget_gate(&self, projected_tokens: i64) -> Result<Option<String>> {
        let summary = self.ai_usage_summary()?;
        if summary.blocked {
            return Err(StoreError::Msg(
                "AI budget exceeded for day or month — raise limits in AI settings or wait for reset"
                    .into(),
            ));
        }
        if let Some(b) = &summary.day_budget {
            if summary.day_tokens + projected_tokens > b.token_limit {
                return Err(StoreError::Msg(
                    "This request would exceed today's token budget".into(),
                ));
            }
        }
        if let Some(b) = &summary.month_budget {
            if summary.month_tokens + projected_tokens > b.token_limit {
                return Err(StoreError::Msg(
                    "This request would exceed this month's token budget".into(),
                ));
            }
        }
        Ok(if summary.warn {
            Some("Approaching AI usage budget warning threshold".into())
        } else {
            None
        })
    }

    pub fn list_ai_templates(&self) -> Result<Vec<AiTemplate>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, slug, title, description, agent, system_prompt, user_prompt_template,
                    output_schema_json, version FROM ai_templates ORDER BY title",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AiTemplate {
                    id: row.get(0)?,
                    slug: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    agent: row.get(4)?,
                    system_prompt: row.get(5)?,
                    user_prompt_template: row.get(6)?,
                    output_schema_json: row.get(7)?,
                    version: row.get(8)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_ai_template(&self, slug: &str) -> Result<Option<AiTemplate>> {
        Ok(self
            .list_ai_templates()?
            .into_iter()
            .find(|t| t.slug == slug))
    }

    pub fn list_ai_chats(&self) -> Result<Vec<AiChat>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt =
            conn.prepare("SELECT id, title, created_at, updated_at FROM ai_chats ORDER BY id DESC")?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AiChat {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_ai_chat(&self, title: &str) -> Result<AiChat> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO ai_chats (title) VALUES (?1)",
            params![title],
        )?;
        let id = conn.last_insert_rowid();
        Ok(AiChat {
            id,
            title: title.into(),
            created_at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
            updated_at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
        })
    }

    pub fn list_ai_messages(&self, chat_id: i64) -> Result<Vec<AiMessage>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, chat_id, role, content, created_at FROM ai_messages
             WHERE chat_id = ?1 ORDER BY id ASC",
        )?;
        let rows = stmt
            .query_map(params![chat_id], |row| {
                Ok(AiMessage {
                    id: row.get(0)?,
                    chat_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn add_ai_message(&self, chat_id: i64, role: &str, content: &str) -> Result<AiMessage> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO ai_messages (chat_id, role, content) VALUES (?1,?2,?3)",
            params![chat_id, role, content],
        )?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE ai_chats SET updated_at = datetime('now') WHERE id = ?1",
            params![chat_id],
        )?;
        Ok(AiMessage {
            id,
            chat_id,
            role: role.into(),
            content: content.into(),
            created_at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
        })
    }

    pub fn ai_enabled(&self) -> bool {
        self.get_setting("ai_enabled")
            .ok()
            .flatten()
            .map(|v| v == "1")
            .unwrap_or(false)
    }
}
