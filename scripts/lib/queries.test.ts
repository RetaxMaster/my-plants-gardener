import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as queries from './queries.js';

// THE GARDENER'S REAL READ BOUNDARY. The route allowlist is tiny and does not carry the bulk reads. The
// REAL guarantee now lives in scripts/lib/sql-query.ts's `assembleOwnerScopedQuery` (see its file banner
// for the two-round history of why a naming/regex check on the SQL string, and later a free-form `select`
// string, both turned out to be discipline rather than construction — a UNION or a hand-rolled bypass could
// satisfy both). This suite's naming/regex loop below is kept as a SECOND, independent net — it catches a
// builder that goes through the constructor but is handed a non-owner ref, which the structural scans at
// the bottom of this file would not catch on their own.
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
  it('buildCitiesQuery — exact SQL, owner-qualified, orders by name', () => {
    const q = queries.buildCitiesQuery('OWNER_1');
    expect(q.sql).toBe(
      'SELECT id, name, latitude, longitude, timezone, is_primary FROM cities WHERE cities.owner_id = ? ORDER BY name',
    );
    expect(q.params).toEqual(['OWNER_1']);
  });

  it('buildPlacesQuery — exact SQL, reads the place-level climate fields', () => {
    const q = queries.buildPlacesQuery('OWNER_1');
    expect(q.sql).toBe(
      'SELECT id, city_id, name, indoor, light_type, climate_controlled, humidity_character, ' +
        'indoor_temp_min_c, indoor_temp_max_c, airflow FROM places WHERE places.owner_id = ? ORDER BY name',
    );
    expect(q.params).toEqual(['OWNER_1']);
  });

  it('buildPlantsQuery — exact SQL, orders by acquisition date', () => {
    const q = queries.buildPlantsQuery('OWNER_1');
    expect(q.sql).toBe(
      'SELECT id, place_id, species_slug, nickname, acquired_on, cover_image_url FROM plants ' +
        'WHERE plants.owner_id = ? ORDER BY acquired_on',
    );
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
  // in this module is a thin caller of the shared `assembleOwnerScopedQuery` constructor (scripts/lib/
  // sql-query.ts), which is the ONLY function able to produce a SqlQuery without an explicit unsafe cast —
  // see that file for the full guarantee. This single end-to-end proof of the constructor's real, executed
  // behavior generalizes to every other builder; six copies of the same fixture test would assert the same
  // fact six times over.
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
  it('buildPlantDetailQuery — exact SQL, anchors on the owner via the plants alias', () => {
    const q = queries.buildPlantDetailQuery('OWNER_1', 'PLANT_9');
    expect(q.sql).toBe(
      'SELECT p.id, p.place_id, p.species_slug, p.nickname, p.acquired_on FROM plants p ' +
        'WHERE p.owner_id = ? AND (p.id = ?)',
    );
    expect(q.params).toEqual(['OWNER_1', 'PLANT_9']);
  });

  it('buildPlantProfileQuery — resolves ownership through the JOINed plant, not plant_profiles itself', () => {
    const q = queries.buildPlantProfileQuery('OWNER_1', 'PLANT_9');
    expect(q.sql).toBe(
      'SELECT pr.* FROM plant_profiles pr JOIN plants p ON p.id = pr.plant_id WHERE p.owner_id = ? AND (p.id = ?)',
    );
    expect(q.params).toEqual(['OWNER_1', 'PLANT_9']);
  });

  it('buildSpeciesForOwnedPlantQuery — reaches the (global) species catalogue only through an owned plant', () => {
    const q = queries.buildSpeciesForOwnedPlantQuery('OWNER_1', 'PLANT_9');
    expect(q.sql).toBe(
      'SELECT s.* FROM species s JOIN plants p ON p.species_slug = s.slug WHERE p.owner_id = ? AND (p.id = ?)',
    );
    expect(q.params).toEqual(['OWNER_1', 'PLANT_9']);
  });
});

describe('clinical-records read (Task 3.8, gardener is READ-ONLY here)', () => {
  it('buildClinicalRecordsQuery — exact SQL, anchors on the owner and windows by date', () => {
    const q = queries.buildClinicalRecordsQuery('OWNER_1', 'PLANT_9', 3);
    expect(q.sql).toBe(
      'SELECT r.id, r.recorded_on, r.body FROM plant_clinical_records r WHERE r.owner_id = ? ' +
        'AND (r.plant_id = ? AND r.recorded_on >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)) ORDER BY r.recorded_on DESC',
    );
    expect(q.params).toEqual(['OWNER_1', 'PLANT_9', 3]);
  });

  it('windows DB-side with DATE_SUB/CURDATE — never a bound JS date (project MariaDB date rule)', () => {
    const q = queries.buildClinicalRecordsQuery('OWNER_1', 'PLANT_9', 3);
    expect(q.sql).toContain('DATE_SUB(CURDATE(), INTERVAL ? MONTH)');
    expect(q.params.every((p) => typeof p !== 'object')).toBe(true);
    expect(q.sql).not.toMatch(/toISOString|\dT\d\d:/);
  });
});

// Two structural, source-text scans over THIS file, kept as DEFENCE IN DEPTH — the real guarantee lives in
// scripts/lib/sql-query.ts (the constructor + the branded SqlQuery type), not here. See that file's banner
// for why a naming/regex check and a free-form `select` string both turned out to be discipline rather than
// construction across two prior review rounds, and why the fix was to (a) remove every free-form SQL-shape
// parameter from the builders in THIS file, and (b) brand SqlQuery so it cannot be fabricated by a literal
// added here without an unmistakable unsafe cast.
describe('module-source structural guards over queries.ts (defence in depth, not the guarantee)', () => {
  it('never contains the literal token WHERE — no builder here should ever need to write one', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'queries.ts'), 'utf8');
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const whereOccurrences = withoutComments.match(/\bWHERE\b/gi) ?? [];
    expect(whereOccurrences).toEqual([]);
  });

  // This is what actually rules out a bypass builder that hand-rolls `{ sql, params }` and casts it to
  // SqlQuery, regardless of how its SQL string was spelled at runtime (the round-2 attack that defeated the
  // WHERE-token scan by building the keyword from `'WHE' + 'RE'`): producing a SqlQuery outside sql-query.ts
  // requires exactly this kind of cast (verified directly against this project's own tsc — a single
  // `as SqlQuery` does not compile; only `as unknown as SqlQuery`/`as any` does), so its ABSENCE from this
  // file is what proves every SqlQuery here came from the sanctioned constructor.
  it('never contains an unsafe cast to SqlQuery — the only way left to fabricate one outside sql-query.ts', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'queries.ts'), 'utf8');
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const unsafeCasts = withoutComments.match(/as\s+unknown\s+as\s+SqlQuery|as\s+any\b/g) ?? [];
    expect(unsafeCasts).toEqual([]);
  });
});
