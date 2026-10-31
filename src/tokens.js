// Flatten tokens.yaml into CSS variables: color.primary -> --pt-color-primary, spacing.md -> 16px
export function tokensToCss(tokens, prefix = "--pt") {
  const out = [];
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (v && typeof v === "object") walk(v, `${path}-${k}`);
      else out.push(`${path}-${k}: ${typeof v === "number" ? v + "px" : v};`);
    }
  };
  walk(tokens, prefix);
  return `:root { ${out.join(" ")} }`;
}
