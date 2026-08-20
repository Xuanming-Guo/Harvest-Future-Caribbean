import { config } from "../config.js";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export type LlmConfiguration =
  | { mode: "fixture"; adapter: "fixture" }
  | { mode: "configured"; adapter: string; model: string; baseUrl: string; apiKey: string };

export function readLlmConfiguration(): LlmConfiguration {
  const values = [config.agentLlmProvider, config.agentLlmModel, config.agentLlmBaseUrl, config.agentLlmApiKey];
  if (values.every((value) => !value)) return { mode: "fixture", adapter: "fixture" };
  if (values.some((value) => !value)) {
    throw new Error("LLM configuration is incomplete. Set AGENT_LLM_PROVIDER, AGENT_LLM_MODEL, AGENT_LLM_BASE_URL, and AGENT_LLM_API_KEY together, or leave all four blank for the fixture.");
  }
  if (config.agentLlmProvider !== "openai-compatible") {
    throw new Error(`Unsupported AGENT_LLM_PROVIDER '${config.agentLlmProvider}'. Use 'openai-compatible' or leave all LLM variables blank.`);
  }
  return {
    mode: "configured",
    adapter: `openai-compatible:${config.agentLlmModel}`,
    model: config.agentLlmModel,
    baseUrl: config.agentLlmBaseUrl,
    apiKey: config.agentLlmApiKey,
  };
}

export async function completeStructured<T>(
  system: string,
  context: unknown,
  validate: (value: unknown) => T,
): Promise<{ value: T; adapter: string }> {
  const llm = readLlmConfiguration();
  if (llm.mode === "fixture") throw new Error("Structured completion was requested while the fixture adapter is active.");
  const response = await fetch(`${llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${llm.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(context) },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Configured LLM provider returned HTTP ${response.status}. No tool action was executed.`);
  }
  const body = await response.json() as ChatCompletionResponse;
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Configured LLM provider returned no structured content. No tool action was executed.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Configured LLM provider returned invalid JSON. No tool action was executed.");
  }
  return { value: validate(parsed), adapter: llm.adapter };
}
