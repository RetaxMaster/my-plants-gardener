import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@retaxmaster/my-plants-species-schema/agent-kit/api';
import { loadCarePlan } from './care-plan-read.js';

// A realistic slice of GET /plants/:id/care, plus §4.1's per-task history block, plus a key this seam has
// never heard of. The unknown key is the POINT: the gardener stores the care plan VERBATIM, so a block the
// API adds later reaches the agent with no edit here.
const CARE_PLAN = {
  plantId: 'p1',
  tasks: [{ task: 'FERTILIZE', nextDueOn: '2026-08-20', daysUntilDue: 6, status: 'upcoming' }],
  taskHistory: {
    WATER: { lastDoneOn: '2026-08-14', doneToday: true },
    FERTILIZE: { lastDoneOn: '2026-07-02', doneToday: false },
    REPOT: { lastDoneOn: null, doneToday: false },
    ROTATE: { lastDoneOn: null, doneToday: false },
    CLEAN_LEAVES: { lastDoneOn: '2026-06-30', doneToday: false },
    MIST: { lastDoneOn: null, doneToday: false },
  },
  aBlockThisSeamHasNeverHeardOf: { nested: [1, 2, 3], flag: false },
};

function fakeClient(routes: Record<string, unknown>) {
  const seen: string[] = [];
  const client = {
    getJson: async (path: string) => {
      seen.push(path);
      const value = routes[path];
      if (value === undefined) throw new ApiRequestError(404, 'not found', path);
      if (value instanceof Error) throw value;
      return value;
    },
    postJson: async () => { throw new Error('care-plan-read must never write'); },
  };
  return { client, seen };
}

describe('loadCarePlan', () => {
  it('reads the ONE care route for the named plant and returns the response VERBATIM', async () => {
    const { client, seen } = fakeClient({ '/plants/p1/care': CARE_PLAN });
    const out = await loadCarePlan(client as never, 'p1');
    expect(seen).toEqual(['/plants/p1/care']);
    expect(out).toEqual(CARE_PLAN);
  });

  it('keeps blocks it has never heard of — no whitelist between the API and the agent', async () => {
    const { client } = fakeClient({ '/plants/p1/care': CARE_PLAN });
    const out = (await loadCarePlan(client as never, 'p1')) as Record<string, unknown>;
    expect(out.taskHistory).toEqual(CARE_PLAN.taskHistory);
    expect(out.aBlockThisSeamHasNeverHeardOf).toEqual(CARE_PLAN.aBlockThisSeamHasNeverHeardOf);
  });

  it('records an API failure as { error } — never a silent null the agent reads as "no care plan"', async () => {
    const { client } = fakeClient({});
    expect(await loadCarePlan(client as never, 'p1')).toEqual({
      error: 'API 404 on /plants/p1/care: not found',
    });
  });

  it('reports a non-ApiRequestError failure too, by message', async () => {
    const { client } = fakeClient({ '/plants/p1/care': new Error('socket hang up') });
    expect(await loadCarePlan(client as never, 'p1')).toEqual({ error: 'socket hang up' });
  });
});
