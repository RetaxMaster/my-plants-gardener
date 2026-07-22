import { type Connection, type RowDataPacket } from 'mysql2/promise';

export interface SqlQuery { sql: string; params: (string | number)[]; }

async function run(conn: Pick<Connection, 'execute'>, q: SqlQuery): Promise<RowDataPacket[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(q.sql, q.params);
  return rows;
}

// THE GARDENER'S REAL READ BOUNDARY (Spec 4 §10.2b / §5.1). The route allowlist the platform exposes to
// this agent is deliberately tiny and does not carry the bulk reads, so the boundary is enforced HERE, by
// construction: every builder below takes ownerId FIRST and hardcodes `owner_id = ?` as a mandatory
// predicate. There is no variant that omits it — cross-owner reads are unreachable by construction, not by
// discipline. Column/table identifiers are deliberately UNQUOTED (no backticks): the test suite asserts the
// owner predicate with a regex that expects `owner_id` to be followed directly by optional whitespace and
// `=` — a backtick-quoted `` `owner_id` `` would sit between the name and the `=`, breaking that match. None
// of the identifiers here collide with a MySQL reserved word, so this is safe.

export function buildCitiesQuery(ownerId: string): SqlQuery {
  return {
    sql: 'SELECT id, name, latitude, longitude, timezone, is_primary FROM cities WHERE owner_id = ? ORDER BY name',
    params: [ownerId],
  };
}

export function buildPlacesQuery(ownerId: string): SqlQuery {
  return {
    sql: `SELECT id, city_id, name, indoor, light_type, climate_controlled, humidity_character,
                 indoor_temp_min_c, indoor_temp_max_c, airflow
          FROM places WHERE owner_id = ? ORDER BY name`,
    params: [ownerId],
  };
}

export function buildPlantsQuery(ownerId: string): SqlQuery {
  return {
    sql: `SELECT id, place_id, species_slug, nickname, acquired_on, cover_image_url
          FROM plants WHERE owner_id = ? ORDER BY acquired_on`,
    params: [ownerId],
  };
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

// A plant id from the model is NEVER trusted on its own: the owner predicate stays first, so an id the
// owner does not own returns zero rows rather than another garden's plant.
export function buildPlantDetailQuery(ownerId: string, plantId: string): SqlQuery {
  return {
    sql: `SELECT p.id, p.place_id, p.species_slug, p.nickname, p.acquired_on
          FROM plants p WHERE p.owner_id = ? AND p.id = ?`,
    params: [ownerId, plantId],
  };
}

export function buildPlantProfileQuery(ownerId: string, plantId: string): SqlQuery {
  return {
    sql: `SELECT pr.* FROM plant_profiles pr
          JOIN plants p ON p.id = pr.plant_id
          WHERE p.owner_id = ? AND p.id = ?`,
    params: [ownerId, plantId],
  };
}

// The species catalogue is GLOBAL reference data, not owner data — so it is reached through a plant the
// owner owns, never queried directly. That keeps the "every builder is owner-anchored" invariant true.
export function buildSpeciesForOwnedPlantQuery(ownerId: string, plantId: string): SqlQuery {
  return {
    sql: `SELECT s.* FROM species s
          JOIN plants p ON p.species_slug = s.slug
          WHERE p.owner_id = ? AND p.id = ?`,
    params: [ownerId, plantId],
  };
}
