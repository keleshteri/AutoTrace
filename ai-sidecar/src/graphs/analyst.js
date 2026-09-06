import { runSimpleGraph, toolFetch } from "./shared.js";

export async function runAnalyst(body) {
  const day = body.day || new Date().toISOString().slice(0, 10);
  const [sessions, report] = await Promise.all([
    toolFetch(body.local_api, `/v1/sessions?day=${day}`),
    toolFetch(body.local_api, `/v1/export/${day}`).catch(() => null),
  ]);
  const context = JSON.stringify({ day, sessions, export_hint: report }, null, 2);
  const result = await runSimpleGraph({
    provider: body.provider,
    model: body.model,
    system:
      "You are AutoTrace Tracking Analyst. Use only provided JSON. Cover focus leaks, untagged time, meetings, billable gaps. Output markdown.",
    prompt: body.prompt || "Analyze this day.",
    context,
  });
  return { ...result, agent: "tracking_analyst" };
}
