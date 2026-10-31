// One async function per data source, same names as data-catalog.yaml.
// Receives the node's params and { user, role }. Replace the demo data with your API calls.
const days = (n, base) => Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, value: Math.round(base + Math.sin(i / 2) * base * 0.2 + i * 15) }));

export default {
  "analytics.revenue": async ({ period = "30d" }) => days({ "7d": 7, "30d": 30, "90d": 90 }[period], 1200),
  "sales.total": async () => 48250,
  "sales.by_region": async () => [
    { region: "Nord", total: 21000 }, { region: "Centro", total: 15250 }, { region: "Sud", total: 12000 },
  ],
  "tasks.mine": async (_, { user }) => [
    { id: 1, title: `Rivedere il report settimanale (${user ?? "anon"})`, done: false },
    { id: 2, title: "Chiamare il fornitore", done: true },
    { id: 3, title: "Preparare la riunione di lunedì", done: false },
  ],
  "stock.levels": async () => [
    { sku: "A-100", name: "Vite M6", qty: 1200 }, { sku: "B-220", name: "Staffa", qty: 85 }, { sku: "C-310", name: "Guarnizione", qty: 0 },
  ],
};
