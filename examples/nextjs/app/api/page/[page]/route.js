import { join } from "node:path";
import { resolve } from "@aeratic/pagetailor";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { page } = await params;
  const q = request.nextUrl.searchParams;
  const { spec, errors } = await resolve(join(process.cwd(), "pagetailor"), page, { user: q.get("user") || undefined, role: q.get("role") || undefined });
  return Response.json({ page, spec, errors });
}
