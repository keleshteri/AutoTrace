import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, type AiBudget, type AiProvider, type AiUsageSummary } from "../lib/api";

type Kind = "anthropic" | "openai" | "openrouter" | "ollama" | "lmstudio" | "custom";

const KINDS: { id: Kind; label: string; needsKey: boolean; placeholderModel: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)", needsKey: true, placeholderModel: "claude-opus-5" },
  { id: "openai", label: "OpenAI", needsKey: true, placeholderModel: "gpt-4o-mini" },
  { id: "openrouter", label: "OpenRouter", needsKey: true, placeholderModel: "openai/gpt-4o-mini" },
  { id: "ollama", label: "Ollama (local)", needsKey: false, placeholderModel: "llama3.2" },
  { id: "lmstudio", label: "LM Studio (local)", needsKey: false, placeholderModel: "local-model" },
  { id: "custom", label: "Custom OpenAI-compatible", needsKey: false, placeholderModel: "model-id" },
];

type Draft = {
  id: number | null;
  kind: Kind;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  maxTokens: string;
  isDefault: boolean;
  enabled: boolean;
};

const emptyDraft = (isDefault: boolean): Draft => ({
  id: null,
  kind: "anthropic",
  label: "",
  baseUrl: "",
  apiKey: "",
  models: "",
  maxTokens: "4096",
  isDefault,
  enabled: true,
});

function draftFrom(p: AiProvider): Draft {
  return {
    id: p.id,
    kind: (KINDS.some((k) => k.id === p.kind) ? p.kind : "custom") as Kind,
    label: p.label,
    baseUrl: p.base_url ?? "",
    apiKey: "",
    models: p.allowed_models.join(", "),
    maxTokens: String(p.max_tokens_per_request),
    isDefault: p.is_default,
    enabled: p.enabled,
  };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Providers, model allow-lists and spend limits for the opt-in AI agent. */
export function AiProvidersPanel({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [budgets, setBudgets] = useState<AiBudget[]>([]);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, b, u] = await Promise.all([
        api.listAiProviders(),
        api.listAiBudgets(),
        api.getAiUsageSummary(),
      ]);
      setProviders(p);
      setBudgets(b);
      setUsage(u);
    } catch (e) {
      setNotice({ kind: "error", text: errText(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const kindInfo = KINDS.find((k) => k.id === draft?.kind) ?? KINDS[0];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const maxTokens = Number(draft.maxTokens);
    if (!draft.label.trim()) {
      setNotice({ kind: "error", text: "Give the provider a name." });
      return;
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      setNotice({ kind: "error", text: "Max tokens must be a positive whole number." });
      return;
    }
    if (draft.id === null && kindInfo.needsKey && !draft.apiKey) {
      setNotice({ kind: "error", text: `${kindInfo.label} needs an API key.` });
      return;
    }
    setBusy(true);
    try {
      await api.upsertAiProvider({
        id: draft.id,
        kind: draft.kind,
        label: draft.label.trim(),
        baseUrl: draft.baseUrl.trim() || null,
        // Blank on edit = keep the stored key.
        apiKey: draft.apiKey ? draft.apiKey : draft.id === null ? "" : null,
        enabled: draft.enabled,
        isDefault: draft.isDefault,
        allowedModels: draft.models
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
        maxTokensPerRequest: maxTokens,
        temperatureCap: 1,
      });
      setDraft(null);
      setNotice({ kind: "ok", text: "Provider saved." });
      await refresh();
    } catch (err) {
      setNotice({ kind: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const test = async (p: AiProvider) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.testAiProvider(p.id);
      setNotice({
        kind: "ok",
        text: `${p.label} answered with ${r.model} (${r.total_tokens} tokens).${
          r.warning ? ` ${r.warning}` : ""
        }`,
      });
      await refresh();
    } catch (err) {
      setNotice({ kind: "error", text: `${p.label}: ${errText(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: AiProvider) => {
    if (!window.confirm(`Remove ${p.label}? Its stored API key is deleted too.`)) return;
    try {
      await api.deleteAiProvider(p.id);
      await refresh();
    } catch (err) {
      setNotice({ kind: "error", text: errText(err) });
    }
  };

  return (
    <div className="agent-modal-backdrop" onClick={onClose}>
      <div
        className="agent-modal agent-modal-wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-providers-title"
      >
        <button type="button" className="agent-modal-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2 id="ai-providers-title">AI providers</h2>
        <p className="muted">
          Bring your own model. Keys are encrypted on this device and only sent to the provider you
          pick. Local models (Ollama, LM Studio) keep everything on your machine.
        </p>

        {notice && (
          <p
            className={notice.kind === "error" ? "ai-notice ai-notice-error" : "ai-notice"}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        )}

        <section className="agent-prompts-section">
          <div className="ai-section-head">
            <h3>Providers</h3>
            {!draft && (
              <button
                type="button"
                className="btn"
                onClick={() => setDraft(emptyDraft(providers.length === 0))}
              >
                + Add provider
              </button>
            )}
          </div>

          {providers.length === 0 && !draft && (
            <p className="muted">
              No providers yet. Add one to start chatting with your tracked time.
            </p>
          )}

          <ul className="ai-provider-list">
            {providers.map((p) => (
              <li key={p.id} className="ai-provider-row">
                <div>
                  <strong>{p.label}</strong>
                  {p.is_default && <span className="ai-pill">Default</span>}
                  {!p.enabled && <span className="ai-pill ai-pill-muted">Off</span>}
                  <div className="muted">
                    {KINDS.find((k) => k.id === p.kind)?.label ?? p.kind}
                    {p.allowed_models.length > 0 && ` · ${p.allowed_models.join(", ")}`}
                    {p.has_api_key ? " · key saved" : ""}
                  </div>
                </div>
                <div className="ai-provider-actions">
                  <button type="button" className="btn" disabled={busy} onClick={() => void test(p)}>
                    Test
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setDraft(draftFrom(p))}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void remove(p)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {draft && (
            <form className="ai-provider-form" onSubmit={save}>
              <label>
                <span>Type</span>
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}
                >
                  {KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Name</span>
                <input
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="e.g. Work Claude"
                />
              </label>
              <label>
                <span>
                  API key{" "}
                  {draft.id !== null && <em className="muted">(leave blank to keep current)</em>}
                  {!kindInfo.needsKey && <em className="muted">(optional)</em>}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                />
              </label>
              <label>
                <span>
                  Base URL <em className="muted">(optional)</em>
                </span>
                <input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="Provider default"
                />
              </label>
              <label>
                <span>
                  Allowed models <em className="muted">(comma separated; first is the default)</em>
                </span>
                <input
                  value={draft.models}
                  onChange={(e) => setDraft({ ...draft, models: e.target.value })}
                  placeholder={kindInfo.placeholderModel}
                />
              </label>
              <label>
                <span>Max tokens per request</span>
                <input
                  inputMode="numeric"
                  value={draft.maxTokens}
                  onChange={(e) => setDraft({ ...draft, maxTokens: e.target.value })}
                />
              </label>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={draft.isDefault}
                  onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
                />
                Use as default
              </label>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <div className="ai-provider-actions">
                <button type="submit" className="btn" disabled={busy}>
                  {busy ? "Saving…" : "Save provider"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>

        <BudgetSection budgets={budgets} usage={usage} onSaved={refresh} onError={(t) => setNotice({ kind: "error", text: t })} />
      </div>
    </div>
  );
}

function BudgetSection({
  budgets,
  usage,
  onSaved,
  onError,
}: {
  budgets: AiBudget[];
  usage: AiUsageSummary | null;
  onSaved: () => Promise<void>;
  onError: (text: string) => void;
}) {
  const day = budgets.find((b) => b.period === "day");
  const month = budgets.find((b) => b.period === "month");
  const [dayTokens, setDayTokens] = useState("");
  const [monthTokens, setMonthTokens] = useState("");

  useEffect(() => {
    setDayTokens(day ? String(day.token_limit) : "");
    setMonthTokens(month ? String(month.token_limit) : "");
  }, [day, month]);

  const saveBudget = async (period: "day" | "month", raw: string, current?: AiBudget) => {
    const tokenLimit = Number(raw);
    if (!Number.isInteger(tokenLimit) || tokenLimit < 1) {
      onError("Token limits must be positive whole numbers.");
      return;
    }
    try {
      await api.setAiBudget({
        period,
        tokenLimit,
        requestLimit: current?.request_limit ?? (period === "day" ? 100 : 2000),
        costUsdLimit: current?.cost_usd_limit ?? null,
        warnAtPct: current?.warn_at_pct ?? 80,
      });
      await onSaved();
    } catch (e) {
      onError(errText(e));
    }
  };

  return (
    <section className="agent-prompts-section">
      <h3>Usage limits</h3>
      <p className="muted">
        Hard caps checked before every request. You are warned at {day?.warn_at_pct ?? 80}% of a
        limit.
      </p>
      {usage && (
        <p className={usage.blocked ? "ai-notice ai-notice-error" : "muted"}>
          Today: {usage.day_tokens.toLocaleString()} tokens / {usage.day_requests} requests · This
          month: {usage.month_tokens.toLocaleString()} tokens / {usage.month_requests} requests
          {usage.blocked ? " — limit reached, AI requests are paused." : ""}
        </p>
      )}
      <div className="ai-budget-grid">
        <label>
          <span>Daily token limit</span>
          <input inputMode="numeric" value={dayTokens} onChange={(e) => setDayTokens(e.target.value)} />
        </label>
        <button type="button" className="btn" onClick={() => void saveBudget("day", dayTokens, day)}>
          Save
        </button>
        <label>
          <span>Monthly token limit</span>
          <input
            inputMode="numeric"
            value={monthTokens}
            onChange={(e) => setMonthTokens(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => void saveBudget("month", monthTokens, month)}
        >
          Save
        </button>
      </div>
    </section>
  );
}
