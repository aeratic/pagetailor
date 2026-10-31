import { join } from "node:path";
import { loadProject, tokensToCss } from "@aeratic/pagetailor";

export const metadata = { title: "pagetailor + Next.js" };

export default async function RootLayout({ children }) {
  const { tokens } = await loadProject(join(process.cwd(), "pagetailor"));
  return (
    <html lang="en">
      <head><style>{tokensToCss(tokens)}</style></head>
      <body style={{ margin: 0, background: "var(--pt-color-background)", color: "var(--pt-color-text)", fontFamily: "var(--pt-font-base)", fontSize: "var(--pt-font-size)" }}>{children}</body>
    </html>
  );
}
