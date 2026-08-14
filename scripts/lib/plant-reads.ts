import { ApiRequestError, type ApiClient } from '@retaxmaster/my-plants-species-schema/agent-kit/api';

/**
 * The two agent-reachable plant reads the API added for Part E (spec §9):
 *   GET /plants/:id/care-events   — what was done or postponed, when, and with what reason
 *   GET /plants/:id/progress      — the owner's journal, PHOTO-STRIPPED (counts only)
 *
 * Both are marked `@AgentScopeAllowed('doctor', 'gardener')` — ONE implementation shared by both scopes,
 * never a reader per agent. The gardener stays owner-anchored: a plant outside this garden 404s.
 *
 * Both are BOUNDED. We deliberately send NO `limit`: the ceiling is a cost decision the SERVER owns, and a
 * client-side copy of that number would be a second source of truth for a value only the server enforces.
 * We take the first page and pass its `nextCursor` straight through, so the agent can see for itself that
 * older rows exist rather than mistaking one page for the whole story.
 */
export type PlantRead = unknown | { error: string };

export interface PlantReads {
  careEvents: PlantRead;
  progressEntries: PlantRead;
}

/** A failed read is REPORTED, never swallowed — the doctor's and the gardener's shared posture: an agent
 * told a tool was blocked says so; an agent handed a silent empty list concludes the plant has no history. */
async function tolerant(client: ApiClient, path: string): Promise<PlantRead> {
  try {
    return await client.getJson(path);
  } catch (err) {
    return { error: err instanceof ApiRequestError ? err.message : String((err as Error)?.message ?? err) };
  }
}

export async function loadPlantReads(client: ApiClient, plantId: string): Promise<PlantReads> {
  const [careEvents, progressEntries] = await Promise.all([
    tolerant(client, `/plants/${plantId}/care-events`),
    tolerant(client, `/plants/${plantId}/progress`),
  ]);
  return { careEvents, progressEntries };
}

/**
 * The one care read a gardener token may reach: GET /plants/:id/care — the ALREADY-computed care plan (due
 * tasks, the viability semaphore + reasons, crowding, and the per-task last-done/done-today history).
 *
 * The response is returned VERBATIM, and that is the contract, not an implementation detail: the per-task
 * history block reaches the agent only because nothing here reshapes what the API sent, and a block the API
 * adds later needs no edit in this repo. A whitelist would be a second, private copy of the response
 * contract living in a different repository from the contract itself.
 *
 * Shares the same TOLERANT posture as the two reads above, through the same `tolerant()` implementation: a
 * care-plan read failure is not fatal to a placement review, and an agent handed a silent `null` concludes
 * the plant has no care plan. It is REPORTED as `{ error }`.
 */
export async function loadCarePlan(client: ApiClient, plantId: string): Promise<PlantRead> {
  return tolerant(client, `/plants/${plantId}/care`);
}
