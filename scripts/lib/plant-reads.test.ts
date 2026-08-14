import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@retaxmaster/my-plants-species-schema/agent-kit/api';
import { loadPlantReads, loadCarePlan } from './plant-reads.js';

const CARE_EVENTS = {
  limit: 25,
  nextCursor: null,
  items: [{ id: 'c1', task: 'FERTILIZE', type: 'DONE', occurredOn: '2026-07-18', reason: null, symptom: null }],
};
const PROGRESS = {
  limit: 25,
  nextCursor: 'e9',
  items: [{ id: 'e1', occurredOn: '2026-07-20', health: 'GOOD', isImport: false, observations: null, sizeCm: 50, tags: [], photoCount: 2 }],
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
    postJson: async () => { throw new Error('plant-reads must never write'); },
  };
  return { client, seen };
}

describe('loadPlantReads', () => {
  it('fetches both reads for the named plant and returns them under stable keys', async () => {
    const { client, seen } = fakeClient({
      '/plants/p1/care-events': CARE_EVENTS,
      '/plants/p1/progress': PROGRESS,
    });
    const out = await loadPlantReads(client as never, 'p1');
    expect(seen.sort()).toEqual(['/plants/p1/care-events', '/plants/p1/progress']);
    expect(out.careEvents).toEqual(CARE_EVENTS);
    expect(out.progressEntries).toEqual(PROGRESS);
  });

  it('records a failed read as an error and still returns the other one — never a silent empty list', async () => {
    const { client } = fakeClient({ '/plants/p1/progress': PROGRESS });
    const out = await loadPlantReads(client as never, 'p1');
    // `ApiRequestError`'s message does NOT quote a string body (only a JSON body gets `JSON.stringify`'d) —
    // see agent-kit/api.ts: `typeof body === 'string' ? body : JSON.stringify(body)`. The fixture body here
    // is the plain string 'not found', so it appears unquoted.
    expect(out.careEvents).toEqual({ error: 'API 404 on /plants/p1/care-events: not found' });
    expect(out.progressEntries).toEqual(PROGRESS);
  });

  it('reports a non-ApiRequestError failure too, by message', async () => {
    const { client } = fakeClient({
      '/plants/p1/care-events': CARE_EVENTS,
      '/plants/p1/progress': new Error('socket hang up'),
    });
    const out = await loadPlantReads(client as never, 'p1');
    expect(out.progressEntries).toEqual({ error: 'socket hang up' });
  });

  it('never writes: the seam has no path to postJson', async () => {
    const { client } = fakeClient({ '/plants/p1/care-events': CARE_EVENTS, '/plants/p1/progress': PROGRESS });
    await expect(loadPlantReads(client as never, 'p1')).resolves.toBeDefined();
  });
});

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

describe('loadCarePlan', () => {
  it('reads the ONE care route for the named plant and returns the response VERBATIM, unknown blocks included', async () => {
    const { client, seen } = fakeClient({ '/plants/p1/care': CARE_PLAN });
    const out = (await loadCarePlan(client as never, 'p1')) as Record<string, unknown>;
    expect(seen).toEqual(['/plants/p1/care']);
    expect(out).toEqual(CARE_PLAN);
    expect(out.aBlockThisSeamHasNeverHeardOf).toEqual(CARE_PLAN.aBlockThisSeamHasNeverHeardOf);
  });

  // The error-message derivation itself (ApiRequestError vs a generic Error) is the SAME `tolerant()`
  // implementation already exercised above by `loadPlantReads` — not re-asserted here to avoid a duplicate
  // copy of the same two cases.
});
