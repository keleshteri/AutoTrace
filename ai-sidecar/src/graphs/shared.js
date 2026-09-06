import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";

export function makeModel(provider, model) {
  if (provider.kind === "anthropic") {
    return new ChatAnthropic({
      model,
      apiKey: provider.api_key,
      maxTokens: provider.max_tokens,
      temperature: provider.temperature,
    });
  }
  return new ChatOpenAI({
    model,
    apiKey: provider.api_key || "ollama",
    configuration: { baseURL: provider.base_url },
    maxTokens: provider.max_tokens,
    temperature: provider.temperature,
  });
}

export async function toolFetch(local, path) {
  if (!local?.token) return { error: "local_api_token_missing" };
  const res = await fetch(`${local.base.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${local.token}` },
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return res.json();
}

const GraphState = Annotation.Root({
  system: Annotation,
  prompt: Annotation,
  context: Annotation,
  text: Annotation,
  prompt_tokens: Annotation,
  completion_tokens: Annotation,
});

export async function runSimpleGraph(opts) {
  const llm = makeModel(opts.provider, opts.model);

  const callLlm = async (state) => {
    const sys = state.context
      ? `${state.system}\n\nContext JSON:\n${state.context}`
      : state.system;
    const resp = await llm.invoke([
      new SystemMessage(sys),
      new HumanMessage(state.prompt),
    ]);
    const text =
      typeof resp.content === "string"
        ? resp.content
        : JSON.stringify(resp.content);
    const usage = resp.usage_metadata || {};
    return {
      text,
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
    };
  };

  const graph = new StateGraph(GraphState)
    .addNode("llm", callLlm)
    .addEdge(START, "llm")
    .addEdge("llm", END)
    .compile();

  const out = await graph.invoke({
    system: opts.system,
    prompt: opts.prompt,
    context: opts.context ?? "",
    text: "",
    prompt_tokens: 0,
    completion_tokens: 0,
  });

  return {
    text: out.text,
    model: opts.model,
    agent: "graph",
    prompt_tokens: out.prompt_tokens,
    completion_tokens: out.completion_tokens,
    total_tokens: out.prompt_tokens + out.completion_tokens,
    warning: null,
  };
}
