import { ApiRequestError, type ApiClient } from '@retaxmaster/my-plants-species-schema/agent-kit/api';

/**
 * The one care read a gardener token may reach:
 *   GET /plants/:id/care — the ALREADY-computed care plan (due tasks, the viability semaphore + reasons,
 *   crowding, and the per-task last-done/done-today history).
 *
 * The response is returned VERBATIM, and that is the contract, not an implementation detail: the per-task
 * history block reaches the agent only because nothing here reshapes what the API sent, and a block the API
 * adds later needs no edit in this repo. A whitelist would be a second, private copy of the response
 * contract living in a different repository from the contract itself.
 *
 * TOLERANT, exactly like `plant-reads.ts`: a care-plan read failure is not fatal to a placement review, and
 * an agent handed a silent `null` concludes the plant has no care plan. It is REPORTED as `{ error }`.
 */
export async function loadCarePlan(client: ApiClient, plantId: string): Promise<unknown> {
  try {
    return await client.getJson(`/plants/${plantId}/care`);
  } catch (err) {
    return { error: err instanceof ApiRequestError ? err.message : String((err as Error)?.message ?? err) };
  }
}
