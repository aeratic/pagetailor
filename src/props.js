// Component props schema: { name: "string" | "number?" | "enum[a,b]" | "string[]" | "text" ... }
const RESERVED = new Set(["data", "names", "__pt"]);
const BASES = new Set(["string", "number", "boolean", "string[]", "number[]"]);

export function parseType(str) {
  let s = String(str).trim();
  const optional = s.endsWith("?");
  if (optional) s = s.slice(0, -1).trim();
  const m = /^enum\[(.*)\]$/.exec(s);
  if (m) return { base: "enum", optional, values: m[1].split(",").map(v => v.trim()).filter(Boolean) };
  if (s === "text") s = "string";
  if (!BASES.has(s)) throw new Error(`unknown prop type "${str}"`);
  return { base: s, optional };
}

const check = (t, v) => {
  switch (t.base) {
    case "string": return typeof v === "string" ? null : "expected string";
    case "number": return typeof v === "number" && !Number.isNaN(v) ? null : "expected number";
    case "boolean": return typeof v === "boolean" ? null : "expected boolean";
    case "string[]": return Array.isArray(v) && v.every(x => typeof x === "string") ? null : "expected string[]";
    case "number[]": return Array.isArray(v) && v.every(x => typeof x === "number") ? null : "expected number[]";
    case "enum": return t.values.includes(String(v)) ? null : `value ${JSON.stringify(v)} not in [${t.values.join(", ")}]`;
  }
};

export function validateProps(props, schema) {
  if (!schema) return [];
  const errors = [], p = props ?? {};
  const types = {};
  for (const [k, s] of Object.entries(schema)) {
    try { types[k] = parseType(s); } catch { types[k] = { bad: s }; }
  }
  for (const k of Object.keys(p)) if (!RESERVED.has(k) && !types[k]) errors.push(`prop "${k}": unknown prop`);
  for (const [k, t] of Object.entries(types)) {
    if (RESERVED.has(k)) continue;
    if (t.bad !== undefined) { errors.push(`prop "${k}": unknown type "${t.bad}" in registry`); continue; }
    const v = p[k];
    if (v === undefined || v === null) { if (!t.optional) errors.push(`prop "${k}": missing required`); continue; }
    const e = check(t, v); if (e) errors.push(`prop "${k}": ${e}`);
  }
  return errors;
}

const zodOf = (t, z) => {
  const base = { string: () => z.string(), number: () => z.number(), boolean: () => z.boolean(),
    "string[]": () => z.array(z.string()), "number[]": () => z.array(z.number()), enum: () => z.enum(t.values) }[t.base]();
  return t.optional ? base.nullable().optional() : base;
};

export function propsToZod(schema, z) {
  if (!schema) return z.looseObject({});
  return z.object(Object.fromEntries(Object.entries(schema).filter(([k]) => !RESERVED.has(k)).map(([k, s]) => [k, zodOf(parseType(s), z)])));
}

export function buildCatalog(registry, z) {
  const components = {};
  for (const [name, entry] of Object.entries(registry ?? {}))
    for (const version of Object.keys(entry.versions ?? {})) {
      const c = { props: propsToZod(entry.props, z), description: entry.description ?? name };
      if (entry.container) c.slots = ["default"];
      components[`${name}@${version}`] = c;
    }
  return { components, actions: {} };
}
