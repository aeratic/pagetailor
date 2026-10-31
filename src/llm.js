// Model adapters: each returns a `complete({ system, user }) => text` for runAgent / runAsk, over global fetch.
// Any provider works with the same shape; pagetailor depends on no SDK.

const post = async (url, headers, body) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
};
const need = (apiKey, name) => { if (!apiKey) throw new Error(`${name}: apiKey is required`); };

export function anthropicComplete({ apiKey, model = "claude-sonnet-5-5", baseUrl = "https://api.anthropic.com", maxTokens = 2048 } = {}) {
  need(apiKey, "anthropicComplete");
  return async ({ system, user }) => {
    const r = await post(`${baseUrl}/v1/messages`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
    return (r.content ?? []).filter(b => b.type === "text").map(b => b.text).join("");
  };
}

// OpenAI chat completions; also the wire format of Groq, Mistral, DeepSeek, xAI, OpenRouter, Ollama and many others.
export function openaiComplete({ apiKey, model = "gpt-5.5", baseUrl = "https://api.openai.com/v1", maxTokens = 2048, headers = {} } = {}) {
  if (baseUrl.includes("api.openai.com")) need(apiKey, "openaiComplete");
  return async ({ system, user }) => {
    const r = await post(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...headers },
      { model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
    const c = r.choices?.[0]?.message?.content;
    return Array.isArray(c) ? c.filter(p => p.type === "text").map(p => p.text).join("") : c ?? "";
  };
}

export function googleComplete({ apiKey, model = "gemini-3.8-flash", baseUrl = "https://generativelanguage.googleapis.com/v1beta", maxTokens = 2048 } = {}) {
  need(apiKey, "googleComplete");
  return async ({ system, user }) => {
    const r = await post(`${baseUrl}/models/${model}:generateContent`, { "x-goog-api-key": apiKey },
      { system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } });
    return (r.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("");
  };
}

// Known providers: env var holding the key, base URL and default model (null = PAGETAILOR_MODEL required).
export const PROVIDERS = {
  anthropic:  { key: "ANTHROPIC_API_KEY",  make: anthropicComplete },
  openai:     { key: "OPENAI_API_KEY",     make: openaiComplete },
  google:     { key: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], make: googleComplete },
  groq:       { key: "GROQ_API_KEY",       make: openaiComplete, baseUrl: "https://api.groq.com/openai/v1", model: null },
  mistral:    { key: "MISTRAL_API_KEY",    make: openaiComplete, baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest" },
  deepseek:   { key: "DEEPSEEK_API_KEY",   make: openaiComplete, baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  xai:        { key: "XAI_API_KEY",        make: openaiComplete, baseUrl: "https://api.x.ai/v1", model: null },
  openrouter: { key: "OPENROUTER_API_KEY", make: openaiComplete, baseUrl: "https://openrouter.ai/api/v1", model: null },
  ollama:     { key: null,                 make: openaiComplete, baseUrl: "http://localhost:11434/v1", model: null },
  compatible: { key: "PAGETAILOR_LLM_KEY", make: openaiComplete, baseUrl: null, model: null },
};

// createComplete({ provider, model?, apiKey?, baseUrl? }): one call for every provider above.
export function createComplete({ provider, model, apiKey, baseUrl, ...rest } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown LLM provider "${provider}" (known: ${Object.keys(PROVIDERS).join(", ")})`);
  const url = baseUrl ?? p.baseUrl;
  if (provider === "compatible" && !url) throw new Error("provider compatible: baseUrl is required (PAGETAILOR_LLM_URL)");
  const m = model ?? ("model" in p ? p.model : undefined);
  if (m === null) throw new Error(`provider ${provider}: model is required (PAGETAILOR_MODEL)`);
  return p.make({ apiKey, ...(m ? { model: m } : {}), ...(url ? { baseUrl: url } : {}), ...rest });
}

// Reads the provider from the environment: PAGETAILOR_PROVIDER, or the first provider whose key is set.
// PAGETAILOR_MODEL overrides the model, PAGETAILOR_LLM_URL the base URL. Returns null when nothing is configured.
export function completeFromEnv(env = process.env) {
  const keyOf = p => [].concat(PROVIDERS[p].key ?? []).map(k => env[k]).find(Boolean);
  const provider = env.PAGETAILOR_PROVIDER || Object.keys(PROVIDERS).find(p => PROVIDERS[p].key && keyOf(p));
  if (!provider) return null;
  if (!PROVIDERS[provider]) throw new Error(`unknown LLM provider "${provider}" (known: ${Object.keys(PROVIDERS).join(", ")})`);
  return createComplete({ provider, apiKey: keyOf(provider), model: env.PAGETAILOR_MODEL || undefined, baseUrl: env.PAGETAILOR_LLM_URL || undefined });
}
export const LLM_HELP = "set an LLM key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY) or PAGETAILOR_PROVIDER=ollama|compatible, plus PAGETAILOR_MODEL";
