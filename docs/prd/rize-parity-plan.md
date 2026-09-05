# AutoTrace Product Plan — Beat Rize Where It Matters

**Status:** Shipped — Waves T/A/R + Phase 4 complete  
**Date:** 2026-09-05  
**Inputs:** Rize docs + product screenshots (Timer, Activity Timeline/Event Log, bottom bar, Tracking Rules, Privacy, schedule)

---

## 1. How Rize actually works (two systems)

Rize is **not** “just a timer.” It runs **two complementary systems**:

### A. Automatic background tracking (the default)

| Step | Behavior |
|---|---|
| Capture | Polls the **one** active window → app name, window title, URL (if browser), timestamps |
| Events | Writes a fine-grained **activity/event log** (seconds-level title changes) |
| Chunking | Groups events into **time entries** on the day calendar (**live**, not end-of-day batch) |
| Rules | Keyword / app / URL rules → categories + client/project/task suggestions |
| Review | Click entry → slide-over panel → accept / edit / merge / split |
| Control | Power icon pause; **per-weekday** auto schedule; exclude via rules; privacy field toggles |

**Never:** screenshots, keystrokes, document contents, clipboard.

### B. Focus Timer (most popular intentional feature)

Separate from auto-tracking:

- User starts a **Focus session** (intent: “I’m deep working now”)
- Big circular **Timer** view + **persistent bottom bar** (elapsed / remaining + End Focus)
- Session can be tagged to Task / Project / Client + optional goal text
- Focus blocks appear on timeline alongside auto activity
- Auto-tracking can still run underneath; Focus is the *conscious* overlay users love

**Insight:** Auto-tracking recovers forgotten hours. The Timer makes people *feel* productive and in control. Both are required for Rize-like product-market fit.

---

## 2. AutoTrace today vs Rize

| Capability | Rize | AutoTrace now | Gap |
|---|---|---|---|
| Foreground metadata capture | Yes | Yes (Win + Linux/xdotool) | Harden + macOS later |
| Live session on calendar | Yes | Sessions exist; “Tracking…” live block weak | Medium |
| Activity Event Log | Yes | No (only merged sessions) | **High** |
| Apps & websites breakdown | Yes | Partial in summary | **High** |
| Focus Timer view + bottom bar | Yes (hero) | Focus *score* only — **no timer** | **Critical** |
| Power pause in UI chrome | Yes | Tray + Settings | Medium |
| Per-day tracking schedule | Mon–Sun ranges | Single work-hours window | Medium |
| Exclude site via rule | Yes | Apps mostly | Medium |
| Privacy URL/title toggles | Yes | Redact range only | Medium |
| Categories (Code/Browsing…) | Yes | Client/Project/Task only | Medium |
| Keyword-from-event | Yes | Rules UI only | Medium |
| Local-only / opt-in network | Cloud by default | **Local-first** | **Advantage** |
| Integrations opt-in | Mixed | ClickUp/webhook/local API | Advantage |

---

## 3. Strategy: match the magic, then beat on privacy + control

**Beat Rize by:**

1. Shipping Timer + Activity UX that feels as good as Rize’s screenshots  
2. Keeping **100% local** capture and tagging by default (Rize’s biggest trust gap)  
3. Making review/rules faster (keyboard-first, create-rule-from-event in 1 click)  
4. Never needing an account for the core product  

**Do not copy:** cloud AI, music player, teams/billing, burnout push spam — unless later opt-in.

---

## 4. Build phases (before roadmap Phase 4)

### Wave T — Focus Timer (P0, do first)

Most popular Rize feature. Ship this before more “phase” work.

| ID | Task | Outcome |
|---|---|---|
| T1 | Schema: `focus_sessions` (goal, client/project/task, started_at, ended_at, status) | Durable focus history |
| T2 | Commands: start / pause / resume / end / get_active_focus | Backend control |
| T3 | **Timer view** (circular ring, elapsed, stop, + note/goal, Task/Project/Client) | Match Rize Timer screenshot |
| T4 | **Persistent bottom status bar** on all views: power (track on/off) + focus elapsed + Start/End Focus | Always-visible like Rize |
| T5 | Focus blocks on day calendar / Timeline lane | Focus visible next to auto entries |
| T6 | Tray: Start/End Focus quick actions | Background usability |

**Done when:** User can start Focus, see live timer everywhere, end Focus, and find the block on today’s timeline — without cloud.

### Wave A — Activity auto-tracking excellence (P0/P1)

Make “app open → activity” as clear as Rize’s Activity screens.

| ID | Task | Outcome |
|---|---|---|
| A1 | Persist **raw activity events** (app, title, url, ts) separately from sessions | True Event Log |
| A2 | **Activity** nav: tabs **Timeline** (apps pie + list) + **Event Log** (searchable) | Match screenshots |
| A3 | Event detail side panel: metadata + Create Client/Project/Task keyword + Delete | 1-click rules from reality |
| A4 | Live “Tracking…” open session block on Calendar (finalize on context switch) | Live background tracking UX |
| A5 | Per-weekday **Automatic Tracking Schedule** (enable + start/end per day) | Replace single work-hours |
| A6 | Power toggle in bottom bar wired to pause/resume (override schedule) | Obvious on/off |
| A7 | Website exclude + app exclude in Tracking Rules (“Exclude from tracking”) | Noise control |
| A8 | Privacy: URL mode (full / domain / off), Title on/off; scheduled redaction option | Trust controls |

**Done when:** User sees every app switch in Event Log, apps breakdown for the day, can exclude youtube.com, and schedule Mon–Fri 9–6 — all local.

### Wave R — Review & categorization (P1)

| ID | Task | Outcome |
|---|---|---|
| R1 | Optional **Category** layer (Focus/Code/Meeting/Break/…) orthogonal to client/project | Rize-like sorting |
| R2 | Stronger auto-chunking (idle/meeting/focus heuristics) with confidence | Fewer junk blocks |
| R3 | Review panel: apps/titles/event-log tabs for the selected entry | Context like Rize |
| R4 | Keyboard shortcuts for approve / next pending | Faster than Rize cloud round-trips |

### Wave X — Exceed Rize (P2, after T+A)

| ID | Task | Why better |
|---|---|---|
| X1 | “What left my machine” audit log for integrations | Trust Rize can’t match |
| X2 | Billable flag + rate hints (local) | Freelancer billing |
| X3 | Context-switch score + top distractions (local) | Productivity without cloud AI |
| X4 | Optional on-device model later — never required | Privacy-preserving “AI” |
| X5 | macOS Accessibility capture (docs already exist) | Platform parity |

---

## 5. Recommended execution order

```
T1–T4  →  A1–A4  →  T5–T6  →  A5–A8  →  R1–R4  →  X*
```

**Do not start Phase 4 (teams/cloud)** until Waves T + A feel better than Rize for a solo freelancer.

---

## 6. Non-goals (for this plan)

- Music / ambience player  
- Team workspaces / utilization dashboards (Phase 4)  
- Cloud AI categorization  
- Screenshots or any content capture  

---

## 7. Success metrics (better than Rize for our users)

1. **Timer:** Start Focus → visible in <100ms in bottom bar; End Focus writes a tagged block.  
2. **Auto:** After 1 hour of work, Event Log shows accurate app/title sequence; Calendar shows live + finalized entries.  
3. **Privacy:** Default = local only; URL/title can be disabled; redact works.  
4. **Trust:** Settings always state what is/isn’t tracked (already true — keep it honest).  

---

## 8. Decision / build status

**Shipped:** Waves **T + A + R + X** and roadmap **Phases 0–4**.

### Shipped checklist

- [x] T1–T6 Focus sessions + Timer + pause/resume + bottom bar + tray + calendar
- [x] A1–A8 Activity events, Timeline/Event Log, live Tracking, schedule, privacy, exclude
- [x] R1–R4 Categories, chunking, review tabs, keyboard shortcuts
- [x] X1–X5 Privacy audit, billable/rates, distraction score, local ML banks, macOS capture + Accessibility settings

**Personal product (Phases 0–4 + Waves): complete at 100% of planned scope.** Remaining work is release tagging / signing / hardware smoke tests.
