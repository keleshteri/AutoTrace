import { runSimpleGraph } from "./shared.js";

const BUILTIN = {
  daily_work_report: {
    system:
      "You are AutoTrace report writer. Use only provided data. Professional markdown.",
    user: "Daily work report for {{day}}. Client: {{client_name}}. Billable hours hint: {{billable_hours}}.",
  },
  weekly_focus_digest: {
    system: "Summarize weekly focus from context. Stay factual.",
    user: "Week around {{day}}. Write wins, risks, 3 habits.",
  },
  untagged_cleanup: {
    system: "Suggest tagging rules as a markdown table.",
    user: "Suggest rules for day {{day}} from context.",
  },
  client_status_email: {
    system: "Write a polite client status email (Subject + Body).",
    user: "Client {{client_name}}, day {{day}}.",
  },
};

export async function runTemplate(body) {
  const slug = body.template_slug || "daily_work_report";
  const tpl = BUILTIN[slug] || BUILTIN.daily_work_report;
  let user = tpl.user;
  const vars = body.variables || {};
  for (const [k, v] of Object.entries(vars)) {
    user = user.replaceAll(`{{${k}}}`, String(v));
  }
  if (body.day) user = user.replaceAll("{{day}}", body.day);
  const result = await runSimpleGraph({
    provider: body.provider,
    model: body.model,
    system: body.system || tpl.system,
    prompt: `${user}\n\n${body.prompt || ""}`.trim(),
  });
  return { ...result, agent: "template" };
}
