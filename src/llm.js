// Minimal Messages API call over global fetch; returns a `complete({ system, user })` for runAgent.
export function anthropicComplete({ apiKey, model = "claude-sonnet-5-5" } = {}) {
  if (!apiKey) throw new Error("anthropicComplete: apiKey is required");
  return async ({ system, user }) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages: [{ role: "user", content: user }] }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${text}`);
    return (JSON.parse(text).content ?? []).filter(b => b.type === "text").map(b => b.text).join("");
  };
}
