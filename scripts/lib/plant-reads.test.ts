import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@retaxmaster/my-plants-species-schema/agent-kit/api';
import { loadPlantReads } from './plant-reads.js';

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
