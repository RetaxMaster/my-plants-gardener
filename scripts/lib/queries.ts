import { type Connection, type RowDataPacket } from 'mysql2/promise';

export interface SqlQuery { sql: string; params: (string | number)[]; }

async function run(conn: Pick<Connection, 'execute'>, q: SqlQuery): Promise<RowDataPacket[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(q.sql, q.params);
  return rows;
}

// THE GARDENER'S REAL READ BOUNDARY (Spec 4 §10.2b / §5.1). The route allowlist the platform exposes to
// this agent is deliberately tiny and does not carry the bulk reads, so the boundary is enforced HERE.
//
// A first review round proved that "every builder binds owner_id first and its SQL contains the literal
// substring `owner_id = ?`" is DISCIPLINE, not CONSTRUCTION: a builder can satisfy both checks and still be
// vacuous — `WHERE owner_id = ? OR 1=1` binds owner_id first and contains the substring, and still returns
// every owner's rows. A regex cannot distinguish a real predicate from a decorated tautology.
//
// The fix: no builder below is allowed to author its own WHERE clause. `assembleOwnerScopedQuery` is the ONLY
// function in this module that writes one, and it:
//   1. ALWAYS emits the owner predicate itself, as the FIRST condition, with ownerId bound FIRST — there is
//      no parameter, flag or overload on it that omits or relaxes that predicate;
//   2. wraps any caller-supplied extra condition in parentheses and ANDs it onto the owner predicate. A
//      tautology placed inside that fragment (`OR 1=1`) is trapped inside its own parens: `owner_id = ? AND
//      (id = ? OR 1=1)` still requires `owner_id = ?` for every row the query can return — AND can only
//      narrow a result set, never widen one, regardless of what the parenthesized side evaluates to.
// Every build*Query function below is a thin caller of this constructor — none of them contains the token
// `WHERE` itself. That is asserted directly in queries.test.ts by scanning this file's own source (with
// comments stripped) and requiring the literal token `WHERE` to appear exactly once; that is a SOURCE-TEXT
// check, not a static analysis of the compiled query, and is named as such there rather than overclaimed.
// It exists as the guard that actually rules out a hand-rolled bypass — a builder that skips this
// constructor and writes its own `{ sql, params }` literal is exactly the shape of the attack that got past
// the original naming/regex-only guards, and it is the only way left to reintroduce that defect.
//
// The naming/regex tests from the previous pass stay as a SECOND, independent net: they catch a builder
// that goes through this constructor but is handed a non-owner column (e.g. `ownerColumn: 'id'`), which the
// WHERE-count check alone would not catch (that builder never writes its own WHERE).

interface OwnerScopedQueryOptions {
  /** The `SELECT ... FROM ... [JOIN ...]` clause, WITHOUT a WHERE — this constructor writes the only one. */
  select: string;
  /** The owner-id column on this query's driving row, optionally table-aliased (e.g. `p.owner_id`). */
  ownerColumn: string;
  ownerId: string;
  /** Wrapped in parentheses and ANDed onto the owner predicate — see the module-level note on why a
   * tautology placed here can never escape and neutralize the owner scoping. */
  extra?: { condition: string; params: (string | number)[] };
  orderBy?: string;
}

// Exported so its owner-scoping behavior — including the "a tautology in `extra` cannot escape" property —
// can be proven directly, once, instead of re-derived from six builders' output shapes.
export function assembleOwnerScopedQuery(q: OwnerScopedQueryOptions): SqlQuery {
  const params: (string | number)[] = [q.ownerId];
  let sql = `${q.select} WHERE ${q.ownerColumn} = ?`;
  if (q.extra) {
    sql += ` AND (${q.extra.condition})`;
    params.push(...q.extra.params);
  }
  if (q.orderBy) sql += ` ORDER BY ${q.orderBy}`;
  return { sql, params };
}

// --- Task 3.6: the owner's whole garden — cities, places, plants ---

export function buildCitiesQuery(ownerId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    select: 'SELECT id, name, latitude, longitude, timezone, is_primary FROM cities',
    ownerColumn: 'owner_id',
    ownerId,
    orderBy: 'name',
  });
}

export function buildPlacesQuery(ownerId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    select: `SELECT id, city_id, name, indoor, light_type, climate_controlled, humidity_character,
                 indoor_temp_min_c, indoor_temp_max_c, airflow
          FROM places`,
    ownerColumn: 'owner_id',
    ownerId,
    orderBy: 'name',
  });
}

export function buildPlantsQuery(ownerId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    select: `SELECT id, place_id, species_slug, nickname, acquired_on, cover_image_url
          FROM plants`,
    ownerColumn: 'owner_id',
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

// A plant id from the model is NEVER trusted on its own: the owner predicate stays first (via the shared
// constructor), so an id the owner does not own returns zero rows rather than another garden's plant.
export function buildPlantDetailQuery(ownerId: string, plantId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    select: 'SELECT p.id, p.place_id, p.species_slug, p.nickname, p.acquired_on FROM plants p',
    ownerColumn: 'p.owner_id',
    ownerId,
    extra: { condition: 'p.id = ?', params: [plantId] },
  });
}

export function buildPlantProfileQuery(ownerId: string, plantId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    select: 'SELECT pr.* FROM plant_profiles pr JOIN plants p ON p.id = pr.plant_id',
    ownerColumn: 'p.owner_id',
    ownerId,
    extra: { condition: 'p.id = ?', params: [plantId] },
  });
}

// The species catalogue is GLOBAL reference data, not owner data — so it is reached through a plant the
// owner owns, never queried directly. That keeps the "every builder is owner-anchored" invariant true.
export function buildSpeciesForOwnedPlantQuery(ownerId: string, plantId: string): SqlQuery {
  return assembleOwnerScopedQuery({
    select: 'SELECT s.* FROM species s JOIN plants p ON p.species_slug = s.slug',
    ownerColumn: 'p.owner_id',
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
    select: 'SELECT r.id, r.recorded_on, r.body FROM plant_clinical_records r',
    ownerColumn: 'r.owner_id',
    ownerId,
    extra: {
      condition: 'r.plant_id = ? AND r.recorded_on >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)',
      params: [plantId, months],
    },
    orderBy: 'r.recorded_on DESC',
  });
}
