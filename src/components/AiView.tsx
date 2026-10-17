import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiProvidersPanel } from "./AiProvidersPanel";
import { AutoTraceLogo } from "./AutoTraceLogo";
import {
  AiChat,
  AiMessage,
  AiRunResult,
  AiTemplate,
  api,
  downloadText,
  todayLocal,
} from "../lib/api";
import { analyticsApi, MentionItem, PERIODS } from "../lib/analyticsApi";

type Props = { onError: (msg: string | null) => void };

type AgentMode = "home" | "history" | "mcp" | "prompts" | "providers";

const QUICK: { id: string; label: string; prompt: string; agent: string; day?: boolean }[] = [
  {
    id: "review",
    label: "Review My Day",
    prompt: "Review my day: summarize focus, meetings, untagged time, and what needs attention.",
    agent: "tracking_analyst",
    day: true,
  },
  {
    id: "analyze",
    label: "Analyze Productivity",
    prompt: "Analyze productivity: context switches, distractions, and billable gaps.",
    agent: "tracking_analyst",
    day: true,
  },
  {
    id: "weekly",
    label: "Generate Weekly Report",
    prompt: "run template",
    agent: "template",
  },
  {
    id: "recent",
    label: "Review Recent Work",
    prompt: "Review recent approved work and highlight notable client/project time.",
    agent: "chat",
  },
];

function greetingName(): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  return `${part}`;
}

export function AiView({ onError }: Props) {
  const [mode, setMode] = useState<AgentMode>("home");
  const [enabled, setEnabled] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiRunResult | null>(null);
  const [chats, setChats] = useState<AiChat[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [showSkills, setShowSkills] = useState(false);
  const [templates, setTemplates] = useState<AiTemplate[]>([]);
  const [apiStatus, setApiStatus] = useState("…");
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionOpts, setMentionOpts] = useState<MentionItem[]>([]);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionPeriod, setMentionPeriod] = useState("month");
  const [ctxPreview, setCtxPreview] = useState<Record<string, unknown> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [sidecar, setSidecar] = useState<{ enabled: boolean; healthy: boolean } | null>(null);

  const day = todayLocal();
  const greet = useMemo(() => greetingName(), []);

  const refreshMeta = useCallback(async () => {
    try {
      const [flag, chatsList, tpls, local] = await Promise.all([
        api.getFeatureFlag("ai_enabled"),
        api.listAiChats(),
        api.listAiTemplates(),
        api.localApiStatus().catch(() => "local API off"),
      ]);
      setEnabled(flag === "1");
      setChats(chatsList);
      setTemplates(tpls);
      setApiStatus(local);
      setSidecar(await api.aiSidecarStatus().catch(() => null));
      if (!chatId && chatsList[0]) setChatId(chatsList[0].id);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [chatId, onError]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    void api
      .listAiMessages(chatId)
      .then(setMessages)
      .catch((e) => onError(String(e)));
  }, [chatId, onError]);

  async function ensureEnabled() {
    if (enabled) return true;
    await api.setFeatureFlag("ai_enabled", "1");
    setEnabled(true);
    return true;
  }

  async function ensureChat(): Promise<number> {
    if (chatId) return chatId;
    const c = await api.createAiChat(`Chat ${new Date().toLocaleString()}`);
    setChatId(c.id);
    setChats((prev) => [c, ...prev]);
    return c.id;
  }

  async function runPrompt(opts: {
    prompt: string;
    agent?: string;
    templateSlug?: string;
  }) {
    setBusy(true);
    setResult(null);
    try {
      await ensureEnabled();
      const id = await ensureChat();
      const agent = opts.agent ?? "chat";
      const r = await api.runAiAgent({
        agent,
        prompt: opts.prompt,
        chatId: id,
        day,
        templateSlug: opts.templateSlug ?? null,
        variables:
          agent === "template"
            ? { day, client_name: "All clients", billable_hours: "—" }
            : null,
      });
      setResult(r);
      setMessages(await api.listAiMessages(id));
      setInput("");
      setMode("home");
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (mentionQuery === null) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      void analyticsApi
        .mentionSearch(mentionQuery)
        .then((opts) => {
          if (cancelled) return;
          setMentionOpts(opts.filter((o) => !mentions.some((m) => m.kind === o.kind && m.id === o.id)));
          setMentionIdx(0);
        })
        .catch(() => setMentionOpts([]));
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [mentionQuery, mentions]);

  // Refresh the "what the AI will see" preview when it's open.
  useEffect(() => {
    if (!ctxPreview) return;
    if (mentions.length === 0) {
      setCtxPreview(null);
      return;
    }
    void analyticsApi.mentionContext(mentions, mentionPeriod).then(setCtxPreview).catch(() => undefined);
  }, [mentions, mentionPeriod]);

  function onInputChange(value: string, caret: number) {
    setInput(value);
    const before = value.slice(0, caret);
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(before);
    setMentionQuery(m ? m[1] : null);
  }

  function pickMention(item: MentionItem) {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const before = input.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${item.label} `);
    const next = before + input.slice(caret);
    setInput(next);
    setMentions((ms) => (ms.some((m) => m.kind === item.kind && m.id === item.id) ? ms : [...ms, item]));
    setMentionQuery(null);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  async function onSend(e?: FormEvent) {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    if (mentions.length === 0) {
      await runPrompt({ prompt: input.trim(), agent: "chat" });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await ensureEnabled();
      const id = await ensureChat();
      const context = await analyticsApi.mentionContext(mentions, mentionPeriod);
      const r = await analyticsApi.runAiChatWithContext({ prompt: input.trim(), context, chatId: id, day });
      setResult(r);
      setMessages(await api.listAiMessages(id));
      setInput("");
      setMentions([]);
      setCtxPreview(null);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onQuick(q: (typeof QUICK)[number]) {
    if (q.agent === "template") {
      await runPrompt({
        prompt: "Generate weekly focus digest",
        agent: "template",
        templateSlug: "weekly_focus_digest",
      });
      return;
    }
    await runPrompt({ prompt: q.prompt, agent: q.agent });
  }

  return (
    <div className="agent-shell">
      <div className="agent-topbar">
        <div className="agent-top-tabs">
          <button
            type="button"
            className={mode === "history" ? "active" : undefined}
            onClick={() => setMode(mode === "history" ? "home" : "history")}
          >
            <HistoryIcon /> Chat History
          </button>
          <button
            type="button"
            className={mode === "mcp" ? "active" : undefined}
            onClick={() => setMode(mode === "mcp" ? "home" : "mcp")}
          >
            <McpIcon /> MCP
          </button>
          <button
            type="button"
            className={mode === "prompts" ? "active" : undefined}
            onClick={() => setMode(mode === "prompts" ? "home" : "prompts")}
          >
            <PromptsIcon /> Prompts
          </button>
          <button
            type="button"
            className={mode === "providers" ? "active" : undefined}
            onClick={() => setMode(mode === "providers" ? "home" : "providers")}
          >
            <GearIcon /> Providers
          </button>
        </div>
        <div className="agent-top-actions">
          <label className="agent-enable">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                const v = e.target.checked;
                setEnabled(v);
                void api.setFeatureFlag("ai_enabled", v ? "1" : "0");
              }}
            />
            AI on
          </label>
          <label
            className="agent-enable"
            title="Route requests through the local LangGraph sidecar (pnpm ai:sidecar). It receives your provider API key, so it only runs on 127.0.0.1 and only when enabled here."
          >
            <input
              type="checkbox"
              checked={sidecar?.enabled ?? false}
              onChange={(e) => {
                const v = e.target.checked;
                void api
                  .setFeatureFlag("ai_sidecar_enabled", v ? "1" : "0")
                  .then(() => api.aiSidecarStatus())
                  .then(setSidecar)
                  .catch((err) => onError(String(err)));
              }}
            />
            Sidecar
            {sidecar?.enabled && (
              <span className="muted">{sidecar.healthy ? " · running" : " · not running"}</span>
            )}
          </label>
        </div>
      </div>

      <div className={`agent-body${mode === "history" ? " with-history" : ""}`}>
        {mode === "history" && (
          <aside className="agent-history">
            <div className="agent-history-head">
              <h3>Chats</h3>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void api.createAiChat(`Chat ${new Date().toLocaleTimeString()}`).then((c) => {
                    setChatId(c.id);
                    setChats((p) => [c, ...p]);
                    setMessages([]);
                    setResult(null);
                    setMode("home");
                  })
                }
              >
                + New Chat
              </button>
            </div>
            {chats.length === 0 ? (
              <p className="muted agent-history-empty">No conversations yet</p>
            ) : (
              <ul>
                {chats.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={chatId === c.id ? "active" : undefined}
                      onClick={() => {
                        setChatId(c.id);
                        setMode("home");
                      }}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        <main className="agent-main">
          {mode === "mcp" && (
            <McpPanel apiStatus={apiStatus} onClose={() => setMode("home")} />
          )}
          {mode === "prompts" && (
            <PromptsPanel
              templates={templates}
              onClose={() => setMode("home")}
              onError={onError}
            />
          )}

          {mode === "providers" && (
            <AiProvidersPanel
              onClose={() => {
                setMode("home");
                void refreshMeta();
              }}
            />
          )}

          {mode !== "mcp" && mode !== "prompts" && mode !== "providers" && (
            <div className="agent-stage">
              <AutoTraceLogo size={40} className="agent-brand-mark" />
              <h1 className="agent-greeting">
                {greet} {statusName()}
              </h1>
              <p className="agent-sub">Here&apos;s what matters right now.</p>

              <div className="agent-orb" aria-hidden />

              {(messages.length > 0 || result) && (
                <div className="agent-thread">
                  {messages.slice(-8).map((m) => (
                    <div key={m.id} className={`agent-bubble ${m.role}`}>
                      <div className="kicker">{m.role}</div>
                      <pre>{m.content}</pre>
                    </div>
                  ))}
                  {result?.warning && <p className="muted">{result.warning}</p>}
                </div>
              )}

              <form className="agent-composer" onSubmit={(e) => void onSend(e)}>
                {mentions.length > 0 && (
                  <div className="mention-chips">
                    {mentions.map((m) => (
                      <span key={`${m.kind}:${m.id}`} className={`mention-chip kind-${m.kind}`}>
                        <span className="mention-kind">{m.kind}</span> {m.label}
                        <button
                          type="button"
                          aria-label={`Remove ${m.label}`}
                          onClick={() => setMentions((ms) => ms.filter((x) => x !== m))}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <select
                      value={mentionPeriod}
                      aria-label="Period for mentioned data"
                      onChange={(e) => setMentionPeriod(e.target.value)}
                    >
                      {PERIODS.filter((p) => p.id !== "custom").map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        ctxPreview
                          ? setCtxPreview(null)
                          : void analyticsApi.mentionContext(mentions, mentionPeriod).then(setCtxPreview)
                      }
                    >
                      {ctxPreview ? "Hide data" : "What the AI will see"}
                    </button>
                  </div>
                )}
                {ctxPreview && <pre className="json-view mention-preview">{JSON.stringify(ctxPreview, null, 2)}</pre>}
                {mentionQuery !== null && mentionOpts.length > 0 && (
                  <div className="mention-pop" role="listbox" aria-label="Mention">
                    {mentionOpts.map((o, i) => (
                      <div key={`${o.kind}:${o.id}`}>
                        {(i === 0 || mentionOpts[i - 1].kind !== o.kind) && (
                          <div className="mention-group">{o.kind}s</div>
                        )}
                        <button
                          type="button"
                          role="option"
                          aria-selected={i === mentionIdx}
                          className={i === mentionIdx ? "active" : undefined}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickMention(o);
                          }}
                        >
                          <span>{o.label}</span>
                          {o.sub && <span className="muted">{o.sub}</span>}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => onInputChange(e.target.value, e.target.selectionStart)}
                  placeholder="Ask AutoTrace anything… type @ to mention a client, project or dashboard"
                  rows={3}
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (mentionQuery !== null && mentionOpts.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIdx((i) => (i + 1) % mentionOpts.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIdx((i) => (i - 1 + mentionOpts.length) % mentionOpts.length);
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        pickMention(mentionOpts[mentionIdx]);
                        return;
                      }
                      if (e.key === "Escape") {
                        setMentionQuery(null);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <div className="agent-composer-bar">
                  <button
                    type="button"
                    className="agent-skills-btn"
                    onClick={() => setShowSkills((v) => !v)}
                  >
                    <GearIcon /> Skills
                  </button>
                  <div className="agent-composer-right">
                    <button type="button" className="icon-ghost" title="Attach (soon)" disabled>
                      <ClipIcon />
                    </button>
                    <button
                      type="submit"
                      className="agent-send"
                      disabled={busy || !input.trim()}
                      aria-label="Send"
                    >
                      <SendIcon />
                    </button>
                  </div>
                </div>
              </form>
              <p className="agent-hint">Ask about schedule, focus, or recent information.</p>

              {showSkills && (
                <div className="agent-skills-pop">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSkills(false);
                      void onQuick(QUICK[0]);
                    }}
                  >
                    Review day
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSkills(false);
                      void onQuick(QUICK[2]);
                    }}
                  >
                    Weekly report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSkills(false);
                      setMode("prompts");
                    }}
                  >
                    Manage prompts…
                  </button>
                </div>
              )}

              <div className="agent-quick">
                {QUICK.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void onQuick(q)}
                  >
                    <QuickIcon id={q.id} />
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function statusName(): string {
  return "there";
}

function McpPanel({
  apiStatus,
  onClose,
}: {
  apiStatus: string;
  onClose: () => void;
}) {
  const url = "http://127.0.0.1:17890/v1/mcp";
  return (
    <div className="agent-modal-backdrop" onClick={onClose}>
      <div className="agent-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <button type="button" className="agent-modal-x" onClick={onClose}>
          ✕
        </button>
        <h2>MCP</h2>
        <p className="muted">
          Drive AutoTrace from Claude, ChatGPT, Cursor, or any MCP-capable tool — local only,
          token-gated.
        </p>
        <ul className="agent-mcp-examples">
          <li>How much time did I track today?</li>
          <li>Create a time entry for this morning&apos;s client call.</li>
          <li>What&apos;s my billable time this week?</li>
        </ul>
        <p className="kicker">Connect with one click</p>
        <div className="agent-mcp-connect">
          <button type="button" className="agent-mcp-btn" disabled title="UI shell — use URL below">
            Claude
          </button>
          <button type="button" className="agent-mcp-btn" disabled title="UI shell — use URL below">
            ChatGPT
          </button>
        </div>
        <p className="kicker">Or add it to any AI tool</p>
        <ol className="agent-mcp-steps">
          <li>
            <span>Copy local MCP endpoint</span>
            <div className="agent-copy-row">
              <code>{url}</code>
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard.writeText(url)}
              >
                Copy
              </button>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Status: {apiStatus}. Enable Local export API under Integrations and set a token.
            </p>
          </li>
          <li>Authenticate with your local API bearer token (never leaves this machine).</li>
          <li>Ask about your time, projects, and clients from that tool.</li>
        </ol>
        <div className="agent-modal-foot">
          <a className="muted" href="#docs">
            Learn more
          </a>
          <button type="button" className="btn" onClick={onClose}>
            Advanced setup
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptsPanel({
  templates,
  onClose,
  onError,
}: {
  templates: AiTemplate[];
  onClose: () => void;
  onError: (m: string | null) => void;
}) {
  const [guidance, setGuidance] = useState("Not set");
  const [tagging, setTagging] = useState("Not set");
  const [summary, setSummary] = useState("Not set");

  useEffect(() => {
    void (async () => {
      try {
        setGuidance((await api.getFeatureFlag("ai_prompt_guidance")) || "Not set");
        setTagging((await api.getFeatureFlag("ai_prompt_tagging")) || "Not set");
        setSummary((await api.getFeatureFlag("ai_prompt_summary")) || "Not set");
      } catch (e) {
        onError(String(e));
      }
    })();
  }, [onError]);

  return (
    <div className="agent-modal-backdrop" onClick={onClose}>
      <div
        className="agent-modal agent-modal-wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <button type="button" className="agent-modal-x" onClick={onClose}>
          ✕
        </button>
        <div className="agent-prompts-head">
          <div>
            <h2>Agent</h2>
            <p className="muted">
              Customize how the AutoTrace agent works. Standing guidance for your runs, plus
              reusable skills available in reports and chats.
            </p>
          </div>
          <button type="button" className="primary" disabled>
            + New Skill
          </button>
        </div>

        <section className="agent-prompts-section">
          <h3>Personal</h3>
          <p className="muted">Your prompts and skills. Applied to your agent runs only.</p>
          <div className="agent-prompt-row">
            <span>Guidance</span>
            <button type="button" className="btn">
              {guidance === "1" || guidance === "Not set" ? "Not set" : guidance.slice(0, 24)}
            </button>
          </div>
          <div className="agent-prompt-row">
            <span>Custom Tagging Instructions</span>
            <button type="button" className="btn">
              {tagging === "Not set" ? "Not set" : tagging.slice(0, 24)}
            </button>
          </div>
          <div className="agent-prompt-row">
            <span>Activity Summary Instructions</span>
            <button type="button" className="btn">
              {summary === "Not set" ? "Not set" : summary.slice(0, 24)}
            </button>
          </div>
          <div className="agent-prompt-row">
            <span>Personal Skills</span>
            <button type="button" className="btn" disabled>
              + Add Skill
            </button>
          </div>
          <p className="muted">No personal skills yet</p>
        </section>

        <section className="agent-prompts-section">
          <h3>Templates (local)</h3>
          <p className="muted">Seeded report templates you can run from quick actions.</p>
          <ul className="tree">
            {templates.map((t) => (
              <li key={t.slug} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  {t.title}
                  <span className="muted"> — {t.description}</span>
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void api
                      .runAiAgent({
                        agent: "template",
                        prompt: "run",
                        templateSlug: t.slug,
                        day: todayLocal(),
                        variables: {
                          day: todayLocal(),
                          client_name: "All clients",
                          billable_hours: "—",
                        },
                      })
                      .then((r) => downloadText(`${t.slug}.md`, r.text, "text/markdown"))
                      .catch((e) => onError(String(e)))
                  }
                >
                  Run
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="agent-prompts-section">
          <h3>Teams / Workspace</h3>
          <p className="muted">UI shells — team shared prompts & skills coming later.</p>
          <div className="agent-prompt-row">
            <span>Team Agent Context</span>
            <button type="button" className="btn" disabled>
              Not set
            </button>
          </div>
          <div className="agent-prompt-row">
            <span>Workspace Agent Context</span>
            <button type="button" className="btn" disabled>
              Not set
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5h16v14H4zM8 9h8M8 13h5" />
    </svg>
  );
}
function McpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}
function PromptsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 4h14v16H5zM8 8h8M8 12h6" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
    </svg>
  );
}
function ClipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 12l6-6a3 3 0 114 4l-8 8a4 4 0 01-6-6l8-8" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}
function QuickIcon({ id }: { id: string }) {
  if (id === "review")
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </svg>
    );
  if (id === "analyze")
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 19h16M6 16l4-6 3 3 5-8" />
      </svg>
    );
  if (id === "weekly")
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M6 4h9l3 3v13H6zM9 12h6M9 16h4" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2 2" />
    </svg>
  );
}
