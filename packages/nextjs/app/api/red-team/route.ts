import { fail, readJsonObject, respond } from "~~/lib/server/http";
import { RED_TEAM_REQUEST_SHAPE, isRedTeamScenarioId, runScenario } from "~~/lib/server/red-team";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const id = body?.id;
  if (!isRedTeamScenarioId(id)) return fail(400, RED_TEAM_REQUEST_SHAPE);
  return respond("red-team", () => runScenario(id));
}
