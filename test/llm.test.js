import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { anthropicComplete, openaiComplete, googleComplete, createComplete, completeFromEnv, PROVIDERS } from "../src/llm.js";

const fakeFetch = reply => { const calls = []; const f = async (url, init) => { calls.push({ url, init: { ...init, body: JSON.parse(init.body) } }); return { ok: true, text: async () => JSON.stringify(reply) }; }; f.calls = calls; return f; };
const withFetch = async (f, fn) => { const real = globalThis.fetch; globalThis.fetch = f; try { return await fn(); } finally { globalThis.fetch = real; } };
const msg = { system: "S", user: "U" };

test("anthropic: request shape and text extraction", async () => {
  const f = fakeFetch({ content: [{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }] });
  const out = await withFetch(f, () => anthropicComplete({ apiKey: "k" })(msg));
  assert.equal(out, "ab");
  const [{ url, init }] = f.calls;
  assert.equal(url, "https://api.anthropic.com/v1/messages"); assert.equal(init.headers["x-api-key"], "k");
  assert.equal(init.body.system, "S"); assert.deepEqual(init.body.messages, [{ role: "user", content: "U" }]); assert.equal(init.body.model, "claude-sonnet-5-5");
  assert.throws(() => anthropicComplete({}), /apiKey/);
});

test("openai: system + user messages, bearer, string and array content", async () => {
  const f = fakeFetch({ choices: [{ message: { content: "hi" } }] });
  assert.equal(await withFetch(f, () => openaiComplete({ apiKey: "k", model: "m" })(msg)), "hi");
  const [{ url, init }] = f.calls;
  assert.equal(url, "https://api.openai.com/v1/chat/completions"); assert.equal(init.headers.authorization, "Bearer k");
  assert.deepEqual(init.body.messages, [{ role: "system", content: "S" }, { role: "user", content: "U" }]); assert.equal(init.body.model, "m");
  const g = fakeFetch({ choices: [{ message: { content: [{ type: "text", text: "x" }, { type: "text", text: "y" }] } }] });
  assert.equal(await withFetch(g, () => openaiComplete({ baseUrl: "http://localhost:11434/v1/", model: "llama" })(msg)), "xy");
  assert.equal(g.calls[0].url, "http://localhost:11434/v1/chat/completions"); assert.equal(g.calls[0].init.headers.authorization, undefined);
  assert.throws(() => openaiComplete({}), /apiKey/);
});

test("google: generateContent with system_instruction", async () => {
  const f = fakeFetch({ candidates: [{ content: { parts: [{ text: "g" }, { text: "h" }] } }] });
  assert.equal(await withFetch(f, () => googleComplete({ apiKey: "k" })(msg)), "gh");
  const [{ url, init }] = f.calls;
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(init.headers["x-goog-api-key"], "k"); assert.equal(init.body.system_instruction.parts[0].text, "S"); assert.equal(init.body.contents[0].parts[0].text, "U");
});

test("errors from the API are surfaced with host and status", async () => {
  const f = async () => ({ ok: false, status: 401, text: async () => "nope" });
  await assert.rejects(withFetch(f, () => openaiComplete({ apiKey: "k" })(msg)), /api\.openai\.com 401: nope/);
});

test("createComplete: provider table, required models, compatible needs a URL", async () => {
  for (const p of Object.keys(PROVIDERS)) assert.ok(PROVIDERS[p].make, p);
  const f = fakeFetch({ choices: [{ message: { content: "ok" } }] });
  await withFetch(f, () => createComplete({ provider: "groq", apiKey: "k", model: "llama-3.3-70b-versatile" })(msg));
  assert.equal(f.calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  await withFetch(f, () => createComplete({ provider: "deepseek", apiKey: "k" })(msg));
  assert.equal(f.calls[1].init.body.model, "deepseek-chat");
  await withFetch(f, () => createComplete({ provider: "compatible", baseUrl: "https://my.proxy/v1", apiKey: "k", model: "x" })(msg));
  assert.equal(f.calls[2].url, "https://my.proxy/v1/chat/completions");
  assert.throws(() => createComplete({ provider: "groq", apiKey: "k" }), /model is required/);
  assert.throws(() => createComplete({ provider: "ollama" }), /model is required/);
  assert.throws(() => createComplete({ provider: "compatible", model: "x" }), /baseUrl is required/);
  assert.throws(() => createComplete({ provider: "nope" }), /unknown LLM provider/);
});

test("completeFromEnv: picks the provider from the key, PAGETAILOR_PROVIDER wins, null when unset", async () => {
  assert.equal(completeFromEnv({}), null);
  const f = fakeFetch({ candidates: [{ content: { parts: [{ text: "g" }] } }] });
  await withFetch(f, () => completeFromEnv({ GEMINI_API_KEY: "k", PAGETAILOR_MODEL: "gemini-x" })(msg));
  assert.match(f.calls[0].url, /models\/gemini-x:generateContent/);
  const o = fakeFetch({ choices: [{ message: { content: "ok" } }] });
  await withFetch(o, () => completeFromEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", PAGETAILOR_PROVIDER: "openai" })(msg));
  assert.equal(o.calls[0].init.headers.authorization, "Bearer o");
  await withFetch(o, () => completeFromEnv({ PAGETAILOR_PROVIDER: "ollama", PAGETAILOR_MODEL: "llama3.3", PAGETAILOR_LLM_URL: "http://nas:11434/v1" })(msg));
  assert.equal(o.calls[1].url, "http://nas:11434/v1/chat/completions");
  assert.throws(() => completeFromEnv({ PAGETAILOR_PROVIDER: "zzz" }), /unknown LLM provider/);
});
