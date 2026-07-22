import { type Connection, type RowDataPacket } from 'mysql2/promise';
import { SqlQuery } from './sql-query.js';

// The one function every query in this codebase must pass through before touching the database.
//
// `SqlQuery.isGenuine()` is the actual enforcement point, not decoration: see sql-query.ts's module banner
// for why the type system alone is NOT sufficient here — `Object.assign({}, legit, { sql: '...' })` was
// confirmed to typecheck as `SqlQuery` with zero errors, despite never running the real constructor. Every
// loader in queries.ts calls this function, so gating here closes that gap at the only place it actually
// matters: nothing this codebase builds ever executes against the database without having genuinely come
// from `assembleOwnerScopedQuery`. run-query.test.ts proves this end-to-end — a forged value is refused
// BEFORE `conn.execute` is ever called, not merely reported as "not genuine" in isolation.
export async function runQuery(conn: Pick<Connection, 'execute'>, q: SqlQuery): Promise<RowDataPacket[]> {
  if (!SqlQuery.isGenuine(q)) {
    throw new Error('runQuery() refused a value that is not a genuine SqlQuery produced by assembleOwnerScopedQuery.');
  }
  const [rows] = await conn.execute<RowDataPacket[]>(q.sql, [...q.params]);
  return rows;
}
