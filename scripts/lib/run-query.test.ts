import { describe, expect, it, vi } from 'vitest';
import { assembleOwnerScopedQuery, SqlQuery } from './sql-query.js';
import { runQuery } from './run-query.js';

// The end-to-end proof that the isGenuine() gate is real: it must refuse a forged value BEFORE
// conn.execute is ever called — not merely report "not genuine" as an isolated fact. This is what
// "items 9/10/11 need a test that fails if the protection is removed" means at the point of actual use.
describe('runQuery — the actual enforcement point', () => {
  it('executes a genuine SqlQuery and returns its rows', async () => {
    const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'OWNER_1' });
    const execute = vi.fn().mockResolvedValue([[{ id: 'city-1' }], []]);
    const rows = await runQuery({ execute } as never, legit);
    expect(execute).toHaveBeenCalledWith(legit.sql, ['OWNER_1']);
    expect(rows).toEqual([{ id: 'city-1' }]);
  });

  it('refuses a spread-forged value and NEVER calls conn.execute', async () => {
    const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'OWNER_1' });
    const forged = { ...legit, sql: 'SELECT * FROM cities WHERE owner_id = ? OR 1=1' } as unknown as SqlQuery;
    const execute = vi.fn().mockResolvedValue([[{ id: 'city-1' }], []]);
    await expect(runQuery({ execute } as never, forged)).rejects.toThrow(/refused a value that is not a genuine SqlQuery/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an Object.assign-forged value and NEVER calls conn.execute', async () => {
    const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'OWNER_1' });
    const forged: SqlQuery = Object.assign({}, legit, { sql: 'SELECT * FROM cities WHERE owner_id = ? OR 1=1' });
    const execute = vi.fn().mockResolvedValue([[{ id: 'city-1' }], []]);
    await expect(runQuery({ execute } as never, forged)).rejects.toThrow(/refused a value that is not a genuine SqlQuery/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a prototype-spoofed value and NEVER calls conn.execute', async () => {
    const spoofed = Object.create(SqlQuery.prototype) as SqlQuery;
    (spoofed as unknown as { sql: string }).sql = 'SELECT * FROM cities WHERE owner_id = ? OR 1=1';
    (spoofed as unknown as { params: unknown }).params = ['X'];
    const execute = vi.fn().mockResolvedValue([[{ id: 'city-1' }], []]);
    await expect(runQuery({ execute } as never, spoofed)).rejects.toThrow(/refused a value that is not a genuine SqlQuery/);
    expect(execute).not.toHaveBeenCalled();
  });
});
