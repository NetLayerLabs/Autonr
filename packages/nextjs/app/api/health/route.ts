import { NextResponse } from "next/server";
import type { HealthResponse } from "~~/lib/api/types";
import { getHealth } from "~~/lib/server/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json<HealthResponse>(getHealth());
}
