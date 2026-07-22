import { type Connection, type RowDataPacket } from 'mysql2/promise';
import { assembleOwnerScopedQuery, type SqlQuery } from './sql-query.js';

export type { SqlQuery };

async function run(conn: Pick<Connection, 'execute'>, q: SqlQuery): Promise<RowDataPacket[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(q.sql, q.params);
  return rows;
}

// THE GARDENER'S REAL READ BOUNDARY (Spec 4 §10.2b / §5.1). The route allowlist the platform exposes to
// this agent is deliberately tiny and does not carry the bulk reads, so the boundary is enforced HERE.
//
// Every builder below calls `assembleOwnerScopedQuery` (scripts/lib/sql-query.ts) — the only function that
// can produce a `SqlQuery` without an explicit unsafe cast, and the only place a WHERE clause is written.
// No builder here supplies raw SQL text for the SELECT/FROM/JOIN shape: each passes STRUCTURED
// table/alias/column/join values, which the constructor validates against a positive identifier grammar
// before it builds anything — see sql-query.ts for the two-round history of why a naming/regex guard, and
// later a free-form `select` string, both turned out to be discipline rather than construction.
//
// Two structural, source-text scans in queries.test.ts back this up as DEFENCE IN DEPTH (not the guarantee
// itself, which lives in sql-query.ts): this file must never contain the literal token "WHERE" — every
// builder here should have no reason to write one — and it must never contain an unsafe cast to SqlQuery
// (`as unknown as SqlQuery` / `as any`), which is the only way left to fabricate one outside the shared
// constructor.

export function buildCitiesQuery(ownerId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    table: 'cities',
    columns: ['id', 'name', 'latitude', 'longitude', 'timezone', 'is_primary'],
    ownerId,
    orderBy: 'name',
  });
}

export function buildPlacesQuery(ownerId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    table: 'places',
    columns: [
      'id', 'city_id', 'name', 'indoor', 'light_type', 'climate_controlled', 'humidity_character',
      'indoor_temp_min_c', 'indoor_temp_max_c', 'airflow',
    ],
    ownerId,
    orderBy: 'name',
  });
}

export function buildPlantsQuery(ownerId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    table: 'plants',
    columns: ['id', 'place_id', 'species_slug', 'nickname', 'acquired_on', 'cover_image_url'],
    ownerId,
    orderBy: 'acquired_on',
  });
}

export async function loadCities(conn: Pick<Connection, 'execute'>, ownerId: string): Promise<RowDataPacket[]> {
  return run(conn, buildCitiesQuery(ownerId));
}

export async function loadPlaces(conn: Pick<Connection, 'execute'>, ownerId: string): Promise<RowDataPacket[]> {
  return run(conn, buildPlacesQuery(ownerId));
}

export async function loadPlants(conn: Pick<Connection, 'execute'>, ownerId: string): Promise<RowDataPacket[]> {
  return run(conn, buildPlantsQuery(ownerId));
}

// --- Task 3.7: per-plant and species reads, still owner-anchored ---

// A plant id from the model is NEVER trusted on its own: the owner predicate stays first (assembled by the
// shared constructor), so an id the owner does not own returns zero rows rather than another garden's plant.
export function buildPlantDetailQuery(ownerId: string, plantId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    table: 'plants',
    alias: 'p',
    columns: ['p.id', 'p.place_id', 'p.species_slug', 'p.nickname', 'p.acquired_on'],
    ownerId,
    extra: { condition: 'p.id = ?', params: [plantId] },
  });
}

export function buildPlantProfileQuery(ownerId: string, plantId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    table: 'plant_profiles',
    alias: 'pr',
    columns: ['pr.*'],
    joins: [{ table: 'plants', alias: 'p', on: 'p.id = pr.plant_id' }],
    // plant_profiles has no owner_id column of its own — ownership is resolved through the joined plant.
    ownerRef: 'p',
    ownerId,
    extra: { condition: 'p.id = ?', params: [plantId] },
  });
}

// The species catalogue is GLOBAL reference data, not owner data — so it is reached through a plant the
// owner owns, never queried directly. That keeps the "every builder is owner-anchored" invariant true.
export function buildSpeciesForOwnedPlantQuery(ownerId: string, plantId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    table: 'species',
    alias: 's',
    columns: ['s.*'],
    joins: [{ table: 'plants', alias: 'p', on: 'p.species_slug = s.slug' }],
    // species has no owner_id column either (global reference data) — ownership is resolved through the
    // joined plant, same as buildPlantProfileQuery above.
    ownerRef: 'p',
    ownerId,
    extra: { condition: 'p.id = ?', params: [plantId] },
  });
}

// --- Task 3.8: the doctor's clinical records, as placement context (CONDITIONAL on Task 0.5 — confirmed) ---

// The doctor's clinical records are CONTEXT for placement and materials advice, never a licence to
// diagnose (Spec 4 §4.4). The gardener only ever READS them — `clinical_record.create`/`.update` are
// `{ allowed: false }` for the gardener scope in AGENT_CAPABILITIES, so no write path is added here or
// anywhere else. Windowed like the doctor's own context, and owner-anchored like every other builder above.
// The window boundary is resolved DB-side via CURDATE() rather than a JS Date/ISO string bound from Node —
// same rule as the rest of the project (never compare date/time columns against a Node-computed instant,
// which MariaDB may reparse in the session timezone). recorded_on is itself a bare DATE column with no
// time-of-day component, and (plant_id, recorded_on) is unique, so no created_at tiebreak is needed.
export function buildClinicalRecordsQuery(ownerId: string, plantId: string, months: number): SqlQuery {
  return assembleOwnerScopedQuery({
    table: 'plant_clinical_records',
    alias: 'r',
    columns: ['r.id', 'r.recorded_on', 'r.body'],
    ownerId,
    extra: {
      condition: 'r.plant_id = ? AND r.recorded_on >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)',
      params: [plantId, months],
    },
    orderBy: 'r.recorded_on DESC',
  });
}
