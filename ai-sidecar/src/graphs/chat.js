import { runSimpleGraph, toolFetch } from "./shared.js";

export async function runChat(body) {
  const day = body.day || new Date().toISOString().slice(0, 10);
  const sessions = await toolFetch(body.local_api, `/v1/sessions?day=${day}`);
  const context = JSON.stringify({ day, sessions }, null, 2);
  const result = await runSimpleGraph({
    provider: body.provider,
    model: body.model,
    system:
      body.system ||
      "You are AutoTrace chat. Use tool context (approved session summaries). Be concise. Do not invent time entries.",
    prompt: body.prompt,
    context,
  });
  return { ...result, agent: "chat" };
}
