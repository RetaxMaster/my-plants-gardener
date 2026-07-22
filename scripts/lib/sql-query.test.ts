import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleOwnerScopedQuery, SqlQuery } from './sql-query.js';

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
// assembled at runtime (`'WHE' + 'RE'`) to defeat a source-text scan for the literal token.
describe('bypass 2 — a bare object literal cannot satisfy SqlQuery (compile-time proof)', () => {
  it('is only satisfiable through assembleOwnerScopedQuery, never a bare literal', () => {
    const _kw = 'WHE' + 'RE';
    // @ts-expect-error — SqlQuery is a class with a private field; a bare object literal cannot satisfy it,
    // and no amount of runtime keyword-assembly changes that, because this check happens before anything
    // runs. If the private field were ever removed, this line would stop being an error and
    // `@ts-expect-error` would itself raise "Unused '@ts-expect-error' directive" — verified directly by
    // temporarily removing the field and observing exactly that message, then restoring it.
    const bogus: SqlQuery = { sql: `SELECT id FROM plants ${_kw} owner_id = ? OR 1=1`, params: ['OWNER_1'] };
    expect(typeof bogus).toBe('object'); // keeps `bogus` referenced so nothing is flagged as unused
  });
});

// --- Round 4 findings: three attacks that survived round 3's symbol-branded plain object, tested here
// against the class-based redesign. Each of items 9/10/11 gets an EXPLICIT test that fails if the
// protection is removed — not just a claim in a comment — per the direction that prompted this round.
describe('round 4 — item 9: object-spread forgery', () => {
  it('a spread of a genuine instance cannot be assigned to a SqlQuery-typed binding (compile-time proof)', () => {
    const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'OWNER_1' });
    // @ts-expect-error — TypeScript excludes a class's private members from the inferred type of an
    // object-spread expression, so this spread is missing the private field and fails to typecheck against
    // SqlQuery. Verified by temporarily removing the private field: this line stopped being an error and
    // `@ts-expect-error` itself raised "Unused '@ts-expect-error' directive"; reverted afterward.
    const forged: SqlQuery = { ...legit, sql: 'SELECT * FROM cities WHERE owner_id = ? OR 1=1' };
    expect(typeof forged).toBe('object');
  });

  it('isGenuine() reports false for a spread-forged value even when the type check is bypassed', () => {
    const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'OWNER_1' });
    const forged = { ...legit, sql: 'SELECT * FROM cities WHERE owner_id = ? OR 1=1' } as unknown as SqlQuery;
    expect(SqlQuery.isGenuine(forged)).toBe(false);
    expect(SqlQuery.isGenuine(legit)).toBe(true);
  });
});

describe('round 4 — item 10: Object.assign forgery (the type system does NOT catch this one)', () => {
  it('Object.assign COMPILES as SqlQuery with zero cast — a confirmed TypeScript unsoundness, not a hope', () => {
    const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'OWNER_1' });
    // No @ts-expect-error here: this line is EXPECTED to compile clean. That is the gap. It is stated
    // plainly rather than hidden, and closed instead by the runtime check on the next line.
    const forged: SqlQuery = Object.assign({}, legit, { sql: 'SELECT * FROM cities WHERE owner_id = ? OR 1=1' });
    expect(SqlQuery.isGenuine(forged)).toBe(false);
  });
});

describe('round 4 — item 11: post-construction mutation of params', () => {
  it('mutating a params element is a compile-time error AND throws at runtime (readonly array, frozen)', () => {
    const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'OWNER_1' });
    // The compile-time proof lives on the `@ts-expect-error` line: params is typed
    // `readonly (string | number)[]`, so index assignment is rejected at compile time (TS2542). Verified by
    // temporarily widening the type to a mutable array: this line stopped being an error and
    // `@ts-expect-error` itself raised "Unused '@ts-expect-error' directive"; reverted afterward. The
    // underlying statement still EXECUTES under vitest (esbuild strips types, not code), so it is wrapped
    // in `expect(...).toThrow()` for the runtime half of the same proof (Object.freeze backs up the type).
    expect(() => {
      // @ts-expect-error — see above.
      legit.params[0] = 'MUTATED';
    }).toThrow(TypeError);
  });

  it('mutating a params element throws a real TypeError at runtime when forced through `any` (Object.freeze)', () => {
    const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'OWNER_1' });
    const mutableView = legit.params as unknown as (string | number)[];
    expect(() => {
      mutableView[0] = 'MUTATED';
    }).toThrow(TypeError);
    // The original is untouched — the throw happened before any write landed.
    expect(legit.params[0]).toBe('OWNER_1');
  });
});

// Why isGenuine() uses the ES2022 ergonomic brand check (`#brand in value`) and NOT `instanceof`: instanceof
// walks the prototype chain, which Object.create(SqlQuery.prototype) can spoof without ever running the real
// constructor. Confirmed directly: the spoofed object below reports instanceof === true (a false positive)
// while isGenuine() correctly reports false, because the private field was never actually installed.
describe('round 4 — why isGenuine() is not instanceof (prototype-chain spoofing)', () => {
  it('a prototype-spoofed, manually-populated object fools instanceof but not isGenuine()', () => {
    const spoofed = Object.create(SqlQuery.prototype) as SqlQuery;
    (spoofed as unknown as { sql: string }).sql = 'SELECT * FROM cities WHERE owner_id = ? OR 1=1';
    (spoofed as unknown as { params: unknown }).params = ['X'];
    expect(spoofed instanceof SqlQuery).toBe(true); // the naive check is fooled
    expect(SqlQuery.isGenuine(spoofed)).toBe(false); // the real check is not
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

describe('provenance — the guarantee is "assemble() made this", not "it looks genuine"', () => {
  const legit = assembleOwnerScopedQuery({ table: 'cities', columns: ['id'], ownerId: 'o1' });

  // Round 5's bypass: `private constructor` restricts the `new X(...)` SYNTAX only. Reflect.construct runs
  // the real constructor body — so the private brand IS installed and a shape-based check says "genuine".
  // Only the ASSEMBLED registry can tell the difference, because Reflect.construct never calls assemble().
  it('refuses a Reflect.construct-forged instance even though it carries a REAL private brand', () => {
    const forged = Reflect.construct(SqlQuery as unknown as new (...a: unknown[]) => SqlQuery, [
      'SELECT * FROM cities WHERE owner_id = ? OR 1=1',
      ['o1'],
    ]) as SqlQuery;
    // The forgery is real: it is a true instance and carries the private field.
    expect(forged instanceof SqlQuery).toBe(true);
    // And it is still refused, on provenance.
    expect(SqlQuery.isGenuine(forged)).toBe(false);
  });

  it('accepts only what assemble() produced', () => {
    expect(SqlQuery.isGenuine(legit)).toBe(true);
  });
});
