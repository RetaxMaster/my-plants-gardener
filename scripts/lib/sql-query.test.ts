import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleOwnerScopedQuery, type SqlQuery } from './sql-query.js';

describe('assembleOwnerScopedQuery — basic assembly', () => {
  it('emits the owner predicate as the only WHERE condition when there is no extra', () => {
    const q = assembleOwnerScopedQuery({ table: 'widgets', columns: ['id'], ownerId: 'OWNER_1' });
    expect(q.sql).toBe('SELECT id FROM widgets WHERE widgets.owner_id = ?');
    expect(q.params).toEqual(['OWNER_1']);
  });

  it('qualifies the owner predicate with the alias when one is given', () => {
    const q = assembleOwnerScopedQuery({ table: 'widgets', alias: 'w', columns: ['w.id'], ownerId: 'OWNER_1' });
    expect(q.sql).toBe('SELECT w.id FROM widgets w WHERE w.owner_id = ?');
  });

  it('assembles a JOIN and resolves ownership through a non-driving ref via ownerRef', () => {
    const q = assembleOwnerScopedQuery({
      table: 'widget_profiles',
      alias: 'wp',
      columns: ['wp.*'],
      joins: [{ table: 'widgets', alias: 'w', on: 'w.id = wp.widget_id' }],
      ownerRef: 'w',
      ownerId: 'OWNER_1',
      extra: { condition: 'w.id = ?', params: ['WIDGET_9'] },
    });
    expect(q.sql).toBe(
      'SELECT wp.* FROM widget_profiles wp JOIN widgets w ON w.id = wp.widget_id WHERE w.owner_id = ? AND (w.id = ?)',
    );
    expect(q.params).toEqual(['OWNER_1', 'WIDGET_9']);
  });

  it('appends orderBy after the predicate', () => {
    const q = assembleOwnerScopedQuery({ table: 'widgets', columns: ['id'], ownerId: 'OWNER_1', orderBy: 'id DESC' });
    expect(q.sql).toBe('SELECT id FROM widgets WHERE widgets.owner_id = ? ORDER BY id DESC');
  });
});

// The algebraic proof that a tautology in `extra` cannot escape: it stays free-form ON PURPOSE, because it
// is always parenthesized and ANDed onto the owner predicate, and `A AND (B)` is a subset of `A` for every
// possible `B` — this is a property of AND, not a pattern match over what `B` says.
describe('assembleOwnerScopedQuery — extra is trapped by AND(...), never escapes', () => {
  it('traps a tautology placed in extra inside its own parentheses', () => {
    const q = assembleOwnerScopedQuery({
      table: 'plants',
      columns: ['id', 'name'],
      ownerId: 'OWNER_1',
      extra: { condition: 'id = ? OR 1=1', params: ['PLANT_1'] },
    });
    expect(q.sql).toBe('SELECT id, name FROM plants WHERE plants.owner_id = ? AND (id = ? OR 1=1)');
    // The owner predicate sits OUTSIDE the parens and is ANDed — never ORed — onto whatever is inside them.
    expect(q.sql).toMatch(/^SELECT .* WHERE plants\.owner_id = \? AND \(.*\)$/);
  });
});

// --- Bypass 1 (round 2 → round 3): the UNION smuggled through a free-form `select` string. `select` no
// longer exists as a parameter, so the exact reviewer payload cannot even be TYPED (see the @ts-expect-error
// block below). The closest equivalent through the new structured API — trying to smuggle the same text
// into the now-validated `table` field — is exercised here and must THROW, naming the offending value.
describe('bypass 1 — UNION smuggled through a structural field', () => {
  it('throws when `table` is not a bare identifier (the UNION payload, reproduced against the new API)', () => {
    expect(() =>
      assembleOwnerScopedQuery({
        table: 'plants UNION SELECT id, name FROM plants AS p2',
        columns: ['id', 'name'],
        ownerId: 'OWNER_1',
      }),
    ).toThrow(/table must be a plain SQL identifier/);
  });

  it('throws when a JOIN table is not a bare identifier', () => {
    expect(() =>
      assembleOwnerScopedQuery({
        table: 'plants',
        alias: 'p',
        columns: ['p.id'],
        joins: [{ table: 'plants) UNION SELECT 1--', alias: 'x', on: 'p.id = x.id' }],
        ownerId: 'OWNER_1',
      }),
    ).toThrow(/join table must be a plain SQL identifier/);
  });

  it('throws on a correlated-subquery column — rows would be owner-scoped but the projected VALUE would leak', () => {
    expect(() =>
      assembleOwnerScopedQuery({
        table: 'plants',
        alias: 'p',
        columns: ['p.id', '(SELECT name FROM plants WHERE owner_id != ?) AS leak'],
        ownerId: 'OWNER_1',
      }),
    ).toThrow(/column must be a bare or table-qualified identifier/);
  });

  it('throws on a non-identifier JOIN "on" condition', () => {
    expect(() =>
      assembleOwnerScopedQuery({
        table: 'plants',
        alias: 'p',
        columns: ['p.id'],
        joins: [{ table: 'species', alias: 's', on: '1=1' }],
        ownerId: 'OWNER_1',
      }),
    ).toThrow(/JOIN's "on" must be "identifier = identifier"/);
  });

  it('throws on a malformed orderBy', () => {
    expect(() =>
      assembleOwnerScopedQuery({ table: 'plants', columns: ['id'], ownerId: 'OWNER_1', orderBy: 'id; DROP TABLE plants' }),
    ).toThrow(/orderBy must be identifiers/);
  });

  it('throws when ownerRef does not name a ref this query actually declares', () => {
    expect(() =>
      assembleOwnerScopedQuery({ table: 'plants', alias: 'p', columns: ['p.id'], ownerRef: 'bogus', ownerId: 'OWNER_1' }),
    ).toThrow(/ownerRef "bogus" is not one of this query's declared refs/);
  });

  it('throws when a qualified column references an alias this query never declared', () => {
    expect(() =>
      assembleOwnerScopedQuery({ table: 'plants', alias: 'p', columns: ['ghost.id'], ownerId: 'OWNER_1' }),
    ).toThrow(/not one of this query's refs/);
  });
});

// --- Bypass 2 (round 2 → round 3): a hand-rolled `{ sql, params }` literal, with the WHERE keyword itself
// assembled at runtime (`'WHE' + 'RE'`) to defeat a source-text scan for the literal token. The brand makes
// this a COMPILE-TIME failure rather than something a scanner has to notice. `@ts-expect-error` PROVES the
// assignment fails to typecheck: if the brand were ever accidentally removed, this line would stop being an
// error and `@ts-expect-error` would itself raise "Unused '@ts-expect-error' directive" — a trip-wire, not a
// silent pass. This is inert at runtime (vitest strips the annotation via esbuild; the remaining plain
// object literal executes harmlessly and asserts nothing), so it only has teeth under `tsc --noEmit`, which
// is why it is chained into `npm test` for this repo.
describe('bypass 2 — a hand-rolled object literal cannot satisfy the branded SqlQuery type', () => {
  it('is only satisfiable through assembleOwnerScopedQuery, never a bare literal (compile-time proof)', () => {
    const _kw = 'WHE' + 'RE';
    // @ts-expect-error — SqlQuery is branded; this object is missing the private brand property, and no
    // amount of runtime keyword-assembly changes that, because this check happens before anything runs.
    const bogus: SqlQuery = { sql: `SELECT id FROM plants ${_kw} owner_id = ? OR 1=1`, params: ['OWNER_1'] };
    expect(typeof bogus).toBe('object'); // keeps `bogus` referenced so nothing is flagged as unused
  });
});

// Defence in depth (NOT the guarantee — see the file banner above): this file itself should contain
// exactly ONE literal "WHERE" token, i.e. every other module in this repo has no reason to write one.
describe('module-source structural guard — sql-query.ts writes the only WHERE', () => {
  it('emits the literal token WHERE exactly once in this file', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'sql-query.ts'), 'utf8');
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const whereOccurrences = withoutComments.match(/\bWHERE\b/gi) ?? [];
    expect(whereOccurrences.length).toBe(1);
  });
});
