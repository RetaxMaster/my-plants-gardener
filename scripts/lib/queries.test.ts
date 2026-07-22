import { describe, expect, it, vi } from 'vitest';
import * as queries from './queries.js';

// THE GARDENER'S REAL READ BOUNDARY. The route allowlist is tiny and does not carry the bulk reads, so the
// boundary is enforced HERE, by construction: every builder takes ownerId FIRST and emits `owner_id = ?` as
// a mandatory predicate. A builder that could omit it is a cross-owner read waiting to happen.
const BUILDERS = Object.entries(queries).filter(([n]) => n.startsWith('build') && n.endsWith('Query'));

describe('owner-anchored query layer', () => {
  it('exports at least one builder (guards against a vacuous pass)', () => {
    expect(BUILDERS.length).toBeGreaterThan(0);
  });

  for (const [name, fn] of BUILDERS) {
    it(`${name} binds owner_id as its first parameter`, () => {
      const q = (fn as (ownerId: string, ...rest: never[]) => { sql: string; params: unknown[] })('OWNER_1');
      expect(q.sql).toMatch(/owner_id\s*=\s*\?/);
      expect(q.params[0]).toBe('OWNER_1');
    });
  }

  it('exposes NO function whose name suggests an unscoped read', () => {
    expect(Object.keys(queries).filter((n) => /All|Any|Global|Unscoped/.test(n))).toEqual([]);
  });
});

describe('garden-wide builders (Task 3.6)', () => {
  it('buildCitiesQuery orders by name and reads the primary flag', () => {
    const q = queries.buildCitiesQuery('OWNER_1');
    expect(q.sql).toContain('FROM cities');
    expect(q.sql).toContain('is_primary');
    expect(q.params).toEqual(['OWNER_1']);
  });

  it('buildPlacesQuery reads the place-level climate fields', () => {
    const q = queries.buildPlacesQuery('OWNER_1');
    expect(q.sql).toContain('FROM places');
    expect(q.sql).toContain('climate_controlled');
    expect(q.params).toEqual(['OWNER_1']);
  });

  it('buildPlantsQuery orders by acquisition date', () => {
    const q = queries.buildPlantsQuery('OWNER_1');
    expect(q.sql).toContain('FROM plants');
    expect(q.sql).toContain('ORDER BY acquired_on');
    expect(q.params).toEqual(['OWNER_1']);
  });

  it('loadCities runs the built query against the injected connection', async () => {
    const execute = vi.fn().mockResolvedValue([[{ id: 'city-1', name: 'CDMX' }], []]);
    const rows = await queries.loadCities({ execute } as never, 'OWNER_1');
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('FROM cities'), ['OWNER_1']);
    expect(rows).toEqual([{ id: 'city-1', name: 'CDMX' }]);
  });

  it('loadPlaces runs the built query against the injected connection', async () => {
    const execute = vi.fn().mockResolvedValue([[{ id: 'place-1' }], []]);
    const rows = await queries.loadPlaces({ execute } as never, 'OWNER_1');
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('FROM places'), ['OWNER_1']);
    expect(rows).toEqual([{ id: 'place-1' }]);
  });

  it('loadPlants runs the built query against the injected connection', async () => {
    const execute = vi.fn().mockResolvedValue([[{ id: 'plant-1' }], []]);
    const rows = await queries.loadPlants({ execute } as never, 'OWNER_1');
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('FROM plants'), ['OWNER_1']);
    expect(rows).toEqual([{ id: 'plant-1' }]);
  });

  // A cross-owner read must return NOTHING — proven against a fake DB that actually HONORS its params
  // (a stub that ignores its query can never catch a wrong query — this project found that defect six
  // times in one phase). This fake filters by the bound owner id, so a query missing/wrong on owner_id
  // would leak another owner's row here instead of returning [].
  it('a query issued with another owner id returns nothing from a param-honoring fake DB', async () => {
    const FIXTURE = [
      { id: 'city-1', owner_id: 'OWNER_1', name: 'CDMX' },
      { id: 'city-2', owner_id: 'OWNER_2', name: 'Monterrey' },
    ];
    const execute = vi.fn(async (_sql: string, params: unknown[]) => {
      const ownerId = params[0];
      return [FIXTURE.filter((r) => r.owner_id === ownerId), []];
    });
    const rowsForStranger = await queries.loadCities({ execute } as never, 'OWNER_STRANGER');
    expect(rowsForStranger).toEqual([]);
    const rowsForOwner1 = await queries.loadCities({ execute } as never, 'OWNER_1');
    expect(rowsForOwner1).toEqual([{ id: 'city-1', owner_id: 'OWNER_1', name: 'CDMX' }]);
  });
});
