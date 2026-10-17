/**
 * Analytics IPC mock (Tracked Time, Dashboards, Reports, Routines, Meetings,
 * Resourcing, Focus overview, @mentions). Returns JS source defining
 * `analyticsInvoke(cmd, args)` → value, or `undefined` when unhandled.
 */
export function mockAnalyticsSource(): string {
  return `
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDay = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = new Date();
  const todayStr = fmtDay(today);
  const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return fmtDay(d); };
  const monday = (s) => { const d = new Date(s + "T00:00:00"); const wd = (d.getDay() + 6) % 7; return addDays(s, -wd); };

  const projects = [
    { id: 11, name: "Billing revamp", client: [1, "Northstar Labs"] },
    { id: 12, name: "Packaging refresh", client: [2, "Juniper Supply"] },
    { id: 13, name: "Content studio", client: [3, "Solstice Media"] },
    { id: 14, name: "Internal", client: [4, "AutoTrace"] },
  ];
  const apps = [["Code", null], ["Chrome", "https://github.com/acme"], ["Slack", null], ["Figma", null], ["Chrome", "https://docs.google.com/x"], ["Zoom", null]];
  const cats = ["Code", "Browsing", "Communication", "Design", "Docs", "Meeting"];

  // Deterministic synthetic sessions for the last 45 days (weekdays busier).
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const sessions = [];
  let sid = 1;
  for (let back = 44; back >= 0; back--) {
    const day = addDays(todayStr, -back);
    const wd = (new Date(day + "T00:00:00").getDay() + 6) % 7;
    if (wd >= 5 && rnd() < 0.8) continue;
    let mins = 8 * 60 + 30;
    const blocks = 6 + Math.floor(rnd() * 5);
    for (let b = 0; b < blocks; b++) {
      const len = 20 + Math.floor(rnd() * 80);
      const p = projects[Math.floor(rnd() * projects.length)];
      const ai = Math.floor(rnd() * apps.length);
      const untagged = rnd() < 0.15;
      const s = new Date(day + "T00:00:00"); s.setMinutes(mins);
      const e = new Date(s.getTime() + len * 60000);
      const iso = (d) => fmtDay(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":00";
      sessions.push({
        id: sid++, app_id: ai + 1, app_name: apps[ai][0], title: p.name + " — work", url: apps[ai][1],
        started_at: iso(s), ended_at: iso(e), idle: false,
        client_id: untagged ? null : p.client[0], project_id: untagged ? null : p.id, task_id: null,
        client_name: untagged ? null : p.client[1], project_name: untagged ? null : p.name, task_name: null,
        approved: rnd() < 0.7, manual: false, notes: null, confidence: 0.8, pending: rnd() < 0.1,
        category: cats[ai], billable: p.id !== 14,
      });
      mins += len + Math.floor(rnd() * 20);
    }
  }

  const secs = (s) => (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000;
  const domain = (u) => u ? u.split("://")[1].split("/")[0].replace(/^www\\./, "") : null;
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function dimVal(dim, s) {
    const day = s.started_at.slice(0, 10);
    switch (dim) {
      case "project": return s.project_id ? [String(s.project_id), s.project_name] : ["none", "No label"];
      case "client": return s.client_id ? [String(s.client_id), s.client_name] : ["none", "No label"];
      case "task": return ["none", "No label"];
      case "category": return [s.category.toLowerCase(), s.category];
      case "app": return [s.app_name.toLowerCase(), s.app_name];
      case "domain": { const d = domain(s.url); return d ? [d, d] : ["none", "No website"]; }
      case "billable": return s.billable ? ["1", "Billable"] : ["0", "Non-billable"];
      case "status": return s.approved ? ["approved", "Approved"] : s.pending ? ["pending", "Pending"] : ["auto", "Auto"];
      case "day": { const d = new Date(day + "T00:00:00"); return [day, WD[(d.getDay() + 6) % 7] + " " + d.getDate()]; }
      case "week": { const m = monday(day); return [m, "Wk of " + m.slice(5)]; }
      case "month": return [day.slice(0, 7), day.slice(0, 7)];
      case "weekday": { const i = (new Date(day + "T00:00:00").getDay() + 6) % 7; return [String(i), WD[i]]; }
      case "hour": { const h = s.started_at.slice(11, 13); return [h, h + ":00"]; }
      default: return ["all", "All"];
    }
  }
  function timeAxis(dim, from, to) {
    const out = [];
    if (dim === "weekday") return WD.map((l, i) => ({ key: String(i), label: l }));
    if (dim === "hour") { for (let h = 0; h < 24; h++) out.push({ key: pad(h), label: pad(h) + ":00" }); return out; }
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const [key, label] = dimVal(dim, { started_at: d + "T09:00:00" });
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, label });
    }
    return out;
  }
  const isTime = (d) => ["day", "week", "month", "weekday", "hour"].includes(d);
  function inRange(q, from, to) {
    return sessions.filter((s) => {
      const d = s.started_at.slice(0, 10);
      return d >= from && d <= to && (q.filters || []).every((f) => !f.values.length || f.values.includes(dimVal(f.dim, s)[0]));
    });
  }
  function kpis(list) {
    const total = list.reduce((a, s) => a + secs(s), 0);
    const days = new Set(list.map((s) => s.started_at.slice(0, 10))).size;
    return { total_secs: total, entries: list.length, active_days: days, daily_avg_secs: days ? Math.round(total / days) : 0,
      billable_secs: list.filter((s) => s.billable).reduce((a, s) => a + secs(s), 0) };
  }
  function runQuery(q) {
    const list = inRange(q, q.from, q.to);
    const rowL = {}, colL = {}, cell = {}, rs = {}, cs = {};
    for (const s of list) {
      const [rk, rl] = dimVal(q.rows_by, s), [ck, cl] = dimVal(q.cols_by, s), v = secs(s);
      rowL[rk] = rl; colL[ck] = cl;
      cell[rk + "|" + ck] = (cell[rk + "|" + ck] || 0) + v; rs[rk] = (rs[rk] || 0) + v; cs[ck] = (cs[ck] || 0) + v;
    }
    const axis = (dim, L, sums) => isTime(dim) ? timeAxis(dim, q.from, q.to)
      : Object.keys(L).map((key) => ({ key, label: L[key] })).sort((a, b) => sums[b.key] - sums[a.key]);
    const rows = axis(q.rows_by, rowL, rs), cols = axis(q.cols_by, colL, cs);
    const k = kpis(list);
    let previous = null, delta = null;
    if (q.compare_previous) {
      const n = Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86400000) + 1;
      previous = kpis(inRange(q, addDays(q.from, -n), addDays(q.from, -1)));
      delta = previous.total_secs ? ((k.total_secs - previous.total_secs) / previous.total_secs) * 100 : null;
    }
    return { query: q, rows, cols,
      cells: rows.map((r) => cols.map((c) => cell[r.key + "|" + c.key] || 0)),
      row_totals: rows.map((r) => rs[r.key] || 0), col_totals: cols.map((c) => cs[c.key] || 0),
      kpis: k, previous, delta_pct: delta };
  }
  function period(p) {
    const m = monday(todayStr);
    switch (p) {
      case "yesterday": return [addDays(todayStr, -1), addDays(todayStr, -1)];
      case "week": return [m, todayStr];
      case "last_week": return [addDays(m, -7), addDays(m, -1)];
      case "last_7_days": return [addDays(todayStr, -6), todayStr];
      case "month": return [todayStr.slice(0, 8) + "01", todayStr];
      case "last_30_days": return [addDays(todayStr, -29), todayStr];
      default: return [todayStr, todayStr];
    }
  }

  let dashId = 3;
  const dashboards = [
    { id: 1, name: "Label Breakdown", description: "Projects per day this week", period: "week", pinned: true, template: null,
      query: { from: "", to: "", rows_by: "project", cols_by: "day", filters: [], include_idle: false, compare_previous: true },
      created_at: "", updated_at: "1" },
    { id: 2, name: "Client hours", description: "This month by week", period: "month", pinned: true, template: "client_breakdown",
      query: { from: "", to: "", rows_by: "client", cols_by: "week", filters: [], include_idle: false, compare_previous: true },
      created_at: "", updated_at: "1" },
  ];
  const withDates = (d) => { const [f, t] = period(d.period); return { ...d, query: { ...d.query, from: f, to: t } }; };
  const templates = [
    { slug: "timesheet", name: "Weekly timesheet", description: "Hours per project for each day of the week", period: "week", rows_by: "project", cols_by: "day" },
    { slug: "category_mix", name: "Category mix", description: "Focus, meetings, code and more per day", period: "week", rows_by: "category", cols_by: "day" },
    { slug: "apps_hours", name: "Apps by hour of day", description: "Which apps you use at which hour", period: "last_7_days", rows_by: "app", cols_by: "hour" },
  ];
  const reportRun = (() => {
    const [f, t] = period("today");
    const r = runQuery({ from: f, to: t, rows_by: "project", cols_by: "day", filters: [], include_idle: false, compare_previous: true });
    return { id: 1, report_id: 1, period_from: f, period_to: t, trigger: "manual", status: "ready", result: r,
      insights: [
        { kind: "highlight", title: "Best block: Billing revamp", detail: "1h 32m uninterrupted, starting " + WD[(today.getDay() + 6) % 7] + " 10:12." },
        { kind: "highlight", title: "Most time: Billing revamp", detail: "2h 40m — 41% of the total." },
        { kind: "anomaly", title: "Tracked time is 38% below the previous period", detail: "3h 05m now vs 5h 00m before." },
        { kind: "info", title: "2 entries waiting for review", detail: "Pending entries aren't confirmed yet." },
      ],
      ai_summary: "- You split work between **Northstar Labs** (Billing revamp) and **Juniper Supply**.\\n- The day's best block was a 1h 32m stretch on Billing revamp.\\n- Suggestion: review the 2 pending entries before end of day.",
      error: null, created_at: todayStr + "T17:00:00" };
  })();
  const routines = [
    ["Start of day", { kind: "weekdays", time: "08:30" }, "digest", { period: "yesterday" }, true, "ready"],
    ["End of day", { kind: "weekdays", time: "17:00" }, "digest", { period: "today" }, true, "ready"],
    ["Client health check", { kind: "weekly", weekday: 0, time: "09:00" }, "report", { report_id: 1 }, true, "ready"],
    ["Midday check-in", { kind: "weekdays", time: "12:30" }, "digest", { period: "today" }, false, null],
    ["Weekly timesheet export", { kind: "weekly", weekday: 0, time: "09:00" }, "export_csv", { period: "last_week" }, false, "failed"],
  ].map(([name, schedule, action_kind, action, enabled, last_status], i) =>
    ({ id: i + 1, name, schedule, action_kind, action, enabled, builtin: null, last_run_at: todayStr + "T08:30:00", last_status }));
  const meetings = [
    { id: 1, calendar_event_id: 1, title: "Daily Code Pairing + Sync", started_at: todayStr + "T16:00:00", ended_at: todayStr + "T17:00:00",
      attendees: ["macgill@example.com", "glendale@example.com"], attendance: "unknown", client_id: 1, project_id: 11,
      client_name: "Northstar Labs", project_name: "Billing revamp", has_transcript: false, transcript: null, summary: null, session_id: null },
    { id: 2, calendar_event_id: 2, title: "Weekly Sync - Model Optimization", started_at: todayStr + "T10:00:00", ended_at: todayStr + "T10:30:00",
      attendees: ["team@example.com"], attendance: "attend", client_id: 2, project_id: 12, client_name: "Juniper Supply",
      project_name: "Packaging refresh", has_transcript: true, transcript: "Alice: Let's review the packaging refresh.\\nBob: Mockups are done.",
      summary: "- Mockups for packaging refresh are done\\n\\n**Action items**\\n1. Send mockups to Juniper", session_id: 99 },
  ];

  function analyticsInvoke(cmd, args) {
    switch (cmd) {
      case "resolve_period": return period(args.period);
      case "run_time_query": return runQuery(args.query);
      case "time_query_sessions": return inRange(args.query, args.query.from, args.query.to).filter((s) =>
        (args.rowKey == null || dimVal(args.query.rows_by, s)[0] === args.rowKey) &&
        (args.colKey == null || dimVal(args.query.cols_by, s)[0] === args.colKey));
      case "export_time_query_csv": return "csv";
      case "list_dashboards": return dashboards.map(withDates);
      case "list_dashboard_templates": return templates;
      case "save_dashboard": {
        const d = { id: args.id ?? dashId++, name: args.name, description: args.description, period: args.period,
          pinned: true, template: null, query: args.query, created_at: "", updated_at: String(Date.now()) };
        const i = dashboards.findIndex((x) => x.id === d.id);
        if (i >= 0) dashboards[i] = d; else dashboards.push(d);
        return withDates(d);
      }
      case "create_dashboard_from_template": {
        const t = templates.find((x) => x.slug === args.slug);
        const d = { id: dashId++, name: t.name, description: t.description, period: t.period, pinned: true, template: t.slug,
          query: { from: "", to: "", rows_by: t.rows_by, cols_by: t.cols_by, filters: [], include_idle: false, compare_previous: true },
          created_at: "", updated_at: "1" };
        dashboards.push(d);
        return withDates(d);
      }
      case "set_dashboard_pinned": { const d = dashboards.find((x) => x.id === args.id); if (d) d.pinned = args.pinned; return null; }
      case "delete_dashboard": return null;
      case "list_reports": return [{ id: 1, name: "Daily summary", dashboard_id: 1, dashboard_name: "Label Breakdown", period: "today",
        schedule: { kind: "daily", time: "17:00" }, ai_enabled: true, enabled: true, last_run_at: reportRun.created_at, run_count: 1 }];
      case "list_report_runs": return [reportRun];
      case "run_report": return reportRun;
      case "save_report": return null;
      case "list_routines": return routines;
      case "set_routine_enabled": { const r = routines.find((x) => x.id === args.id); if (r) r.enabled = args.enabled; return null; }
      case "run_routine": return { id: 1, routine_id: args.id, routine_name: "End of day", trigger: "manual", status: "ready",
        output: "**" + todayStr + "** · 6h 12m tracked (+8% vs previous)\\n\\n- Billing revamp — 2h 40m\\n- Packaging refresh — 1h 50m\\n\\n★ **Best block: Billing revamp** — 1h 32m uninterrupted",
        started_at: todayStr + "T17:00:00", ended_at: todayStr + "T17:00:01" };
      case "list_routine_runs": return [];
      case "list_meetings": return args.from === todayStr ? meetings : [];
      case "update_meeting": { const m = meetings.find((x) => x.id === args.id); if (args.attendance) m.attendance = args.attendance; return m; }
      case "capacity_report": {
        const out = []; let ct = 0, cp = 0, cc = 0; const weeks = {};
        for (let d = args.from; d <= args.to; d = addDays(d, 1)) {
          const wd = (new Date(d + "T00:00:00").getDay() + 6) % 7;
          const tr = d <= todayStr ? sessions.filter((s) => s.started_at.startsWith(d)).reduce((a, s) => a + secs(s), 0) : 0;
          const pl = wd < 5 ? (d >= todayStr ? 6 * 3600 : 5 * 3600) : 0, cap = wd < 5 ? 8 * 3600 : 0;
          ct += tr; cp += pl; cc += cap;
          out.push({ day: d, tracked_secs: tr, planned_secs: pl, capacity_secs: cap, cum_tracked_secs: ct, cum_planned_secs: cp, cum_capacity_secs: cc });
          const wk = monday(d); weeks[wk] = weeks[wk] || { key: wk, label: "Wk of " + wk.slice(5), tracked_secs: 0, planned_secs: 0, capacity_secs: 0, load_pct: 0 };
          weeks[wk].tracked_secs += tr; weeks[wk].planned_secs += pl * (wk === monday(todayStr) ? 1.45 : 1); weeks[wk].capacity_secs += cap;
        }
        const ws = Object.values(weeks).map((w) => ({ ...w, load_pct: w.capacity_secs ? Math.max(w.tracked_secs, w.planned_secs) * 100 / w.capacity_secs : 0 }));
        return { from: args.from, to: args.to, tracked_secs: ct, planned_secs: cp, capacity_secs: cc,
          utilization_pct: cc ? ct * 100 / cc : 0, weekly_capacity_hours: 40, days: out, weeks: ws };
      }
      case "focus_overview": return { day: todayStr, focus_secs: 4 * 3600 + 14 * 60, focus_sessions: 6, break_secs: 68 * 60,
        week: [["Mon", 3.1 * 3600], ["Tue", 5.4 * 3600], ["Wed", 5.6 * 3600], ["Thu", 4.8 * 3600], ["Fri", 4.2 * 3600], ["Sat", 0], ["Sun", 0]],
        week_total_secs: 23.1 * 3600, week_avg_session_secs: 59 * 60, distraction_secs: 30 * 60,
        top_distractions: [{ label: "Slack", secs: 13 * 60, pct: 45 }, { label: "mail.superhuman.com", secs: 13 * 60, pct: 43 }, { label: "Discord", secs: 4 * 60, pct: 12 }] };
      case "list_block_rules": return [{ id: 1, pattern: "youtube.com", match_field: "url", mode: "soft", enabled: true }, { id: 2, pattern: "reddit.com", match_field: "url", mode: "soft", enabled: true }];
      case "mention_search": {
        const q = (args.q || "").toLowerCase();
        const items = [
          ...dashboards.map((d) => ({ kind: "dashboard", id: String(d.id), label: d.name, sub: d.description })),
          ...projects.map((p) => ({ kind: "client", id: String(p.client[0]), label: p.client[1], sub: null })),
          ...projects.map((p) => ({ kind: "project", id: String(p.id), label: p.name, sub: p.client[1] })),
        ];
        return items.filter((i) => i.label.toLowerCase().includes(q));
      }
      case "mention_context": return { note: "Durations are seconds.", mentions: args.mentions.map((m) => ({ mention: { kind: m.kind, label: m.label }, kpis: kpis(sessions.slice(0, 20)) })) };
      default: return undefined;
    }
  }
`;
}
