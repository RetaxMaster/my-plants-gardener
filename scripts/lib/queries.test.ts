import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  //
  // This is deliberately exercised ONLY through loadCities, not duplicated once per loader: every builder
  // in this module is now a thin caller of the shared `assembleOwnerScopedQuery` constructor, and the
  // "exactly one WHERE in the module" test below proves structurally that there is no OTHER way to build a
  // query here. So this single end-to-end proof of the constructor's real, executed behavior generalizes to
  // every other builder — six copies of the same fixture test would assert the same fact six times over.
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

describe('per-plant and species builders (Task 3.7)', () => {
  it('buildPlantDetailQuery still anchors on the owner, not only on the plant id', () => {
    const q = queries.buildPlantDetailQuery('OWNER_1', 'PLANT_9');
    expect(q.sql).toMatch(/owner_id\s*=\s*\?/);
    expect(q.params).toEqual(['OWNER_1', 'PLANT_9']);
  });

  it('buildPlantProfileQuery reaches the profile through the owned plant, not the profile table alone', () => {
    const q = queries.buildPlantProfileQuery('OWNER_1', 'PLANT_9');
    expect(q.sql).toContain('plant_profiles');
    expect(q.sql).toMatch(/owner_id\s*=\s*\?/);
    expect(q.params).toEqual(['OWNER_1', 'PLANT_9']);
  });

  it('buildSpeciesForOwnedPlantQuery reaches the (global) species catalogue only through an owned plant', () => {
    const q = queries.buildSpeciesForOwnedPlantQuery('OWNER_1', 'PLANT_9');
    expect(q.sql).toContain('species');
    expect(q.sql).toMatch(/owner_id\s*=\s*\?/);
    expect(q.params).toEqual(['OWNER_1', 'PLANT_9']);
  });
});

describe('clinical-records read (Task 3.8, gardener is READ-ONLY here)', () => {
  it('buildClinicalRecordsQuery anchors on the owner and windows by date', () => {
    const q = queries.buildClinicalRecordsQuery('OWNER_1', 'PLANT_9', 3);
    expect(q.sql).toMatch(/owner_id\s*=\s*\?/);
    expect(q.params.slice(0, 2)).toEqual(['OWNER_1', 'PLANT_9']);
  });

  it('windows DB-side with DATE_SUB/CURDATE — never a bound JS date (project MariaDB date rule)', () => {
    const q = queries.buildClinicalRecordsQuery('OWNER_1', 'PLANT_9', 3);
    expect(q.sql).toContain('DATE_SUB(CURDATE(), INTERVAL ? MONTH)');
    expect(q.params).toEqual(['OWNER_1', 'PLANT_9', 3]);
    expect(q.params.every((p) => typeof p !== 'object')).toBe(true);
    expect(q.sql).not.toMatch(/toISOString|\dT\d\d:/);
  });
});

// The construction guarantee itself. A first review round showed that "binds owner_id first + the SQL
// contains the substring owner_id = ?" is DISCIPLINE (a naming/regex convention every author must remember
// to honor), not CONSTRUCTION (a shape the language/API makes impossible to violate). The reviewer's
// counter-example — `WHERE owner_id = ? OR 1=1` — satisfied every prior guard and still returned every
// owner's rows. These tests prove the shared constructor genuinely closes that gap.
describe('assembleOwnerScopedQuery — the ONLY place a WHERE clause is written', () => {
  it('emits the owner predicate first, with ownerId bound first, when there is no extra condition', () => {
    const q = queries.assembleOwnerScopedQuery({ select: 'SELECT id FROM widgets', ownerColumn: 'owner_id', ownerId: 'OWNER_1' });
    expect(q.sql).toBe('SELECT id FROM widgets WHERE owner_id = ?');
    expect(q.params).toEqual(['OWNER_1']);
  });

  it('ANDs a caller-supplied extra condition onto the owner predicate, wrapped in parentheses', () => {
    const q = queries.assembleOwnerScopedQuery({
      select: 'SELECT id FROM widgets',
      ownerColumn: 'owner_id',
      ownerId: 'OWNER_1',
      extra: { condition: 'id = ?', params: ['WIDGET_1'] },
    });
    expect(q.sql).toBe('SELECT id FROM widgets WHERE owner_id = ? AND (id = ?)');
    expect(q.params).toEqual(['OWNER_1', 'WIDGET_1']);
  });

  // THE reviewer's attack, reproduced through the sanctioned API rather than as a hand-rolled bypass: the
  // most natural way to try to slip a tautology in is to put it in `extra`. It still cannot escape, because
  // it lands INSIDE the parentheses this constructor wraps around `extra` — `owner_id = ? AND (1=1)` is
  // logically `owner_id = ? AND true`, which is exactly `owner_id = ?`: AND can only narrow a result set,
  // never widen it, no matter what the parenthesized side evaluates to. Quoting the generated SQL directly.
  it('traps a tautology placed in `extra` inside its own parentheses — it can only narrow, never widen', () => {
    const q = queries.assembleOwnerScopedQuery({
      select: 'SELECT id, name FROM plants',
      ownerColumn: 'owner_id',
      ownerId: 'OWNER_1',
      extra: { condition: 'id = ? OR 1=1', params: ['PLANT_1'] },
    });
    expect(q.sql).toBe('SELECT id, name FROM plants WHERE owner_id = ? AND (id = ? OR 1=1)');
    expect(q.params).toEqual(['OWNER_1', 'PLANT_1']);
    // The owner predicate is OUTSIDE the parens and ANDed — never ORed — onto whatever is inside them.
    expect(q.sql).toMatch(/^SELECT .* WHERE owner_id = \? AND \(.*\)$/);
  });
});

// The structural guard that actually rules out a hand-rolled bypass: if a future (or hostile) author adds
// a builder that returns `{ sql, params }` directly instead of calling assembleOwnerScopedQuery, that
// builder writes its OWN "WHERE" — which is exactly how the reviewer's `buildPlantsFullListQuery` attack
// got past the naming/regex guards (it bound owner_id first and contained the substring "owner_id = ?",
// while ALSO containing an unguarded "OR 1=1" the regex could not see).
//
// HONESTY NOTE: this is a scan of this file's OWN SOURCE TEXT (comments stripped), not a static analysis of
// the compiled/executed query plan. It proves "no code path in this module writes a second WHERE", which is
// exactly the property needed here (every builder is a thin caller of one constructor) — but it would not
// catch, say, a WHERE assembled by string concatenation from fragments that individually avoid the literal
// token "WHERE". That residual is accepted for this module: every builder above is a static, non-computed
// SQL template, so there is no fragment-concatenation path left to word around this check.
describe('module-source structural guard — exactly one WHERE-writing site', () => {
  it('emits the literal token WHERE exactly once in this file (inside assembleOwnerScopedQuery)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'queries.ts'), 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const whereOccurrences = withoutComments.match(/\bWHERE\b/gi) ?? [];
    expect(whereOccurrences.length).toBe(1);
  });
});
