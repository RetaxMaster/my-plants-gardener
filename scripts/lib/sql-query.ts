// The SqlQuery type + the ONLY sanctioned constructor for it.
//
// This module is on its fourth design. Every prior claim that turned out false is kept below, dated, next
// to the empirical test that actually disproved it — per this project's rule that a doc which only ever
// gains claims is a doc nobody audited. The rule going forward: a sentence of the form "there is no way
// to…" is not written here unless a test sits next to it proving the specific thing that was tried failed.
//
//   ROUND 1 (naming + regex on the SQL string): "every builder binds ownerId first and its SQL contains the
//   literal substring `owner_id = ?`" is DISCIPLINE, not construction. `WHERE owner_id = ? OR 1=1` satisfied
//   both checks and still returned every owner's rows.
//
//   ROUND 2 (a single WHERE-writing function with a free-form `select: string` parameter, plus a
//   source-text scan for the word "WHERE"): a UNION smuggled through `select` left the first UNION branch
//   completely unfiltered; a hand-rolled `{ sql, params }` literal with the keyword built at runtime
//   (`'WHE' + 'RE'`) defeated the text scan.
//
//   ROUND 3 (structured `table`/`alias`/`columns`/`joins` inputs validated against a positive identifier
//   grammar, plus a `SqlQuery` type branded with a private `unique symbol`): the grammar itself held —
//   round 4's review threw newlines, spaces, backticks, semicolons, comment tokens (`--`, `/* */`, `#`), a
//   misplaced `*`, and Unicode homoglyphs/fullwidth characters at it, and all were rejected (see
//   sql-query.test.ts for the surviving regression tests). BUT the claim "no route to a SqlQuery value
//   without an explicit unsafe cast" was FALSE, and was disproven two ways, both without any cast at all:
//     - `{ ...legit, sql: 'anything' }` was claimed to require a cast. It does not need one to be ATTEMPTED,
//       but it also does not compile: TS excludes a class's private members from the inferred type of an
//       object-spread expression, so the spread result is missing `#brand` and assigning it to a
//       `SqlQuery`-typed binding fails at compile time. (This part of round 3's claim, re-tested under the
//       round-4 design below, holds — see the spread test.)
//     - `Object.assign({}, legit, { sql: 'anything' })` DOES compile with ZERO errors when assigned to a
//       `SqlQuery`-typed binding. Confirmed directly against this project's own tsc. This is a genuine,
//       specific unsoundness in how TypeScript types `Object.assign`'s generic overload (it produces an
//       intersection type that includes the source's type, which satisfies the private-member check even
//       though the VALUE `Object.assign` actually builds at runtime never ran `SqlQuery`'s constructor and
//       has no working private field). The type system does not catch this one. See below for what does.
//
// ROUND 4 replaced the symbol-branded plain object with a real class carrying a `#private` instance field
// and a `private` constructor. ROUND 5 then showed that is still not enough on its own — `private` restricts
// the `new X(...)` SYNTAX, and `Reflect.construct(SqlQuery, [...])` bypasses the syntax while genuinely
// running the constructor, so it installs a real `#brand`. The registry below (ASSEMBLED) is what actually
// closes it, by asking about PROVENANCE rather than shape. The class still buys the following, which the
// plain branded object could not:
//   - A bare object literal or a spread of a real instance is REJECTED AT COMPILE TIME (verified: TS2741,
//     "Property '#brand' is missing" — see the `@ts-expect-error` tests). Private class fields are excluded
//     from spread's inferred type by TypeScript itself, which a `unique symbol` property is not.
//   - `Object.assign({}, legit, { sql: ... })` still COMPILES (the round-3 unsoundness above is not fixed by
//     switching to a class — confirmed by re-running the same experiment against this class). What actually
//     stops it is `SqlQuery.isGenuine()`, a RUNTIME check using the ES2022 ergonomic brand-check syntax
//     (`#brand in value`), invoked by `runQuery()` (scripts/lib/run-query.ts) before any query reaches the
//     database. This is deliberately NOT `instanceof`: `instanceof` walks the prototype chain, which
//     `Object.create(SqlQuery.prototype)` can spoof — confirmed empirically, `instanceof` said `true` on a
//     spoofed object with no real constructor call. `#brand in value` instead tests whether the private
//     field was actually installed by a real `new SqlQuery(...)` invocation; it returned `false` on every
//     forged value tried (spread-copy, Object.assign-copy, prototype-spoofed-and-manually-populated), and
//     `true` only on a genuine instance. This means: the type system closes the bare-literal and spread
//     routes; the `isGenuine()` runtime check, invoked at the point of actual use, closes Object.assign and
//     prototype spoofing, which the type system does not and — as far as has been tested — cannot.
//   - `params` is typed `readonly (string | number)[]` (not just wrapped in `Readonly<>`, which only
//     protects the property binding, not the array's own elements): `legit.params[0] = 'X'` is a compile
//     error (`TS2542`, verified). `Object.freeze` on both the instance and the params array backs this up
//     at RUNTIME for any code that reaches the array through `any` and bypasses the compile-time check —
//     confirmed to throw a real `TypeError` when run as an ES module (this package is `"type": "module"`,
//     which is always-strict; verified separately that the same mutation silently no-ops under CommonJS
//     non-strict mode, so the ES-module setting here is load-bearing for this specific guarantee).
//
// WHAT THIS LAYER DOES AND DOES NOT GUARANTEE — read this before quoting any sentence above.
//
// IT GUARANTEES: every query the gardener's sanctioned read path issues is owner-scoped, and a developer or
// an agent EDITING these builders cannot casually or accidentally widen that scope. The unsafe shapes do not
// typecheck; the ones the type system cannot see (`Object.assign` forgery, prototype spoofing,
// `Reflect.construct`) are refused at `runQuery()` before `conn.execute` is reached, on PROVENANCE.
//
// IT DOES NOT GUARANTEE CONTAINMENT against an adversary that can run arbitrary code inside this checkout.
// It cannot, and no amount of hardening in this file would change that: the agent runs as a child of the API
// and inherits its write-capable `DB_*` credentials, and this repo ships `mysql2`. Anyone able to author a
// line here can open their own connection and issue raw SQL — no proposal, no approval, no audit row.
// That is the project's #1 open item (see CLAUDE.md's agent write gate), it is closed only by an upstream env
// allowlist, a SELECT-only credential and process isolation, and NOTHING in this module moves it.
//
// Two live preconditions, either of which silently exits the guarantee if it lapses:
//   1. Every query executes through `runQuery()`. A path that reaches `conn.execute` directly is outside the
//      provenance check and nothing will say so. It is the sole such path today, verified by grep.
//   2. `extra.condition` stays a developer-authored literal (see below).
// And one universal caveat, true of every type-level guarantee and named so its absence is not mistaken for
// coverage: a value routed through `any` defeats the compile-time half. The runtime half still refuses it.
//
// THE ONE REMAINING FREE-FORM INPUT is `extra.condition`. It stays free-form for an ALGEBRAIC reason: it is
// always wrapped in parentheses and ANDed onto the owner predicate — `<ownerRef>.owner_id = ? AND
// (extra.condition)` — and `A AND (B)` is a subset of the rows satisfying `A` for EVERY possible `B`,
// well-formed or not, PROVIDED `B` does not itself break out of its own parentheses (an unbalanced `)`, or
// an embedded SQL comment token that comments out the rest of the line). This constructor does NOT validate
// that `extra.condition` is well-formed, and — per explicit direction after this was raised in round 4 —
// the fix, if this predicate is ever wrong, is to stop accepting a free-form condition at all, NOT to
// pattern-match its contents; a blacklist here would just be round 1's mistake again, one level deeper.
// This is safe TODAY because `extra.condition` is always a developer-authored string literal at its call
// sites in queries.ts — re-verified in round 4 by grepping every call site — never derived from agent/model
// input at runtime. That precondition holds by inspection, not by an enforced grammar. If `extra.condition`
// is ever populated from anything other than a developer-authored literal, THAT is the moment this
// precondition needs revisiting, and this comment needs to say so, dated.

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUALIFIED_COLUMN = /^([A-Za-z_][A-Za-z0-9_]*\.)?(\*|[A-Za-z_][A-Za-z0-9_]*)$/;
const JOIN_ON =
  /^([A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*([A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*$/;
const ORDER_BY_CLAUSE = /^([A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*(\s+(ASC|DESC))?$/i;

function assertIdentifier(value: string, what: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`${what} must be a plain SQL identifier; got "${value}".`);
  return value;
}

// Rules out a correlated-subquery column such as `(SELECT name FROM plants WHERE owner_id != ?) AS leak`,
// which would otherwise return an owner-scoped ROW SET while leaking another owner's VALUE through the
// projected column itself: a column matching this grammar cannot contain `(`, a keyword, or an operator —
// only a bare identifier, `alias.column`, `*`, or `alias.*`. Also checks that a qualified column's alias
// prefix is one of this query's own declared refs (the driving table or a join), catching a typo/dangling
// reference as a correctness bug, not a security property — the character-level grammar alone already
// rules out the subquery shape regardless of the prefix.
function assertColumn(value: string, knownRefs: ReadonlySet<string>): string {
  if (!QUALIFIED_COLUMN.test(value)) {
    throw new Error(`A column must be a bare or table-qualified identifier (optionally "*"); got "${value}".`);
  }
  const dot = value.indexOf('.');
  if (dot !== -1) {
    const ref = value.slice(0, dot);
    if (!knownRefs.has(ref)) {
      throw new Error(
        `Column "${value}" qualifies with "${ref}", which is not one of this query's refs: ${[...knownRefs].join(', ')}.`,
      );
    }
  }
  return value;
}

function assertJoinOn(value: string): string {
  if (!JOIN_ON.test(value)) throw new Error(`A JOIN's "on" must be "identifier = identifier"; got "${value}".`);
  return value;
}

function assertOrderBy(value: string): string {
  const ok = value.split(',').every((clause) => ORDER_BY_CLAUSE.test(clause.trim()));
  if (!ok) throw new Error(`orderBy must be identifiers with an optional ASC/DESC; got "${value}".`);
  return value;
}

export interface JoinSpec {
  table: string;
  alias?: string;
  /** "identifier = identifier" ONLY — validated, never an arbitrary boolean expression. */
  on: string;
}

export interface OwnerScopedQueryOptions {
  /** The driving table. Validated as a bare identifier — never a fragment containing UNION, a second
   * FROM, a subquery, or anything else that is not a plain name. */
  table: string;
  alias?: string;
  /** Each entry validated as a bare/table-qualified identifier, or `*`/`alias.*`. NEVER an expression, a
   * subquery, or an `AS` alias — see assertColumn's doc comment for why that specifically matters. */
  columns: string[];
  joins?: JoinSpec[];
  /** Which ref (the driving table's alias/name, or one of joins[].alias/.table) carries owner_id. Defaults
   * to the driving table. Validated against the ACTUAL set of refs this query declares — it cannot point
   * anywhere that is not already part of the FROM/JOIN clause this constructor just built. */
  ownerRef?: string;
  ownerId: string;
  /** The one free-form input — see the module-level note on why this is safe to leave unvalidated. */
  extra?: { condition: string; params: (string | number)[] };
  orderBy?: string;
}

// PROVENANCE, not shape. Every instance `assemble()` produces is registered here, and `isGenuine()` asks
// membership of THIS set — not "does the value look like a SqlQuery", which every previous round of this
// module got wrong in a new way.
//
// Why the private-field brand alone was NOT enough, disproven empirically rather than reasoned about:
// `Reflect.construct(SqlQuery, [maliciousSql, maliciousParams])` compiles clean — TypeScript's `private
// constructor` restricts the `new X(...)` SYNTAX, never `Reflect.construct` — and it genuinely RUNS this
// constructor, so it installs a real `#brand` and `#brand in value` answers `true`. It sailed through
// `runQuery()` into `conn.execute` with attacker-chosen SQL, reproducing round 1's `OR 1=1` end to end with
// one standard built-in, no cast and no spread. A brand answers "was this shaped by the real constructor";
// only a registry answers "did the sanctioned factory make this", and the second is the question that
// matters. `Reflect.construct` never calls `assemble()`, so it can never appear in this set.
//
// A WeakSet (not a Set) so a query becomes collectable the moment nothing else references it.
const ASSEMBLED = new WeakSet<object>();

export class SqlQuery {
  readonly sql: string;
  readonly params: readonly (string | number)[];

  // A genuinely PRIVATE class field. Not a property: it does not appear in `Object.keys`, is not copied by
  // object spread (TypeScript excludes private members from a spread's inferred type — verified), is
  // inaccessible via bracket/computed-key access from outside this class, and is installed only by this
  // constructor actually running via `new`. Its value is never read for its own sake — its only job is to
  // exist, so `#brand in value` (see isGenuine below) can ask "did a real `new SqlQuery(...)` build this?"
  readonly #brand = true;

  private constructor(sql: string, params: (string | number)[]) {
    this.sql = sql;
    // Freeze the array (not just this instance): `params` is typed `readonly`, which blocks element
    // mutation at compile time, and freezing backs that up at runtime for anything that reaches the array
    // through `any`. Verified to throw a real TypeError under this package's ESM ("type": "module", always
    // strict); the same mutation attempt silently no-ops under CommonJS non-strict mode, so this specific
    // guarantee depends on staying an ES module.
    this.params = Object.freeze(params.slice());
    Object.freeze(this);
  }

  /**
   * The RUNTIME check that closes what the type system does not (see the module banner: `Object.assign`
   * forgery still typechecks as `SqlQuery`, and `Object.create(SqlQuery.prototype)` fools `instanceof` by
   * spoofing the prototype chain without ever running this constructor). `#brand in value` is the ES2022
   * "ergonomic brand check" for private fields: it reports whether `value` genuinely has this class's
   * private slot, which is installed ONLY inside this constructor and cannot be forged by copying
   * properties, spreading, or manipulating a prototype chain. `runQuery()` (scripts/lib/run-query.ts) calls
   * this before executing any query — that is the actual enforcement point, not a decoration.
   */
  static isGenuine(value: unknown): value is SqlQuery {
    // Membership of ASSEMBLED is the guarantee. The brand check is kept as a cheap first gate and as a
    // narrowing device, but it is NOT what makes this safe — `Reflect.construct` satisfies the brand and
    // fails here, which is precisely the gap this ordering exists to close.
    return typeof value === 'object' && value !== null && #brand in value && ASSEMBLED.has(value);
  }

  /**
   * The ONLY function in this codebase that can construct a `SqlQuery` through the real constructor. The
   * driving row set it returns is owner-scoped because: (1) the owner predicate is the only WHERE this
   * function ever writes, (2) it is always the FIRST condition with ownerId bound FIRST — there is no
   * parameter or branch that omits or relaxes it, (3) the FROM/JOIN clause it assembles is built entirely
   * from validated identifiers, so there is no grammar slot for a UNION, a second FROM, or a subquery to
   * occupy, and (4) any caller-supplied `extra` condition is trapped inside parentheses ANDed onto that
   * predicate, which can only narrow the result set, never widen it, regardless of what it evaluates to.
   */
  static assemble(q: OwnerScopedQueryOptions): SqlQuery {
    const alias = q.alias !== undefined ? assertIdentifier(q.alias, 'alias') : undefined;
    const table = assertIdentifier(q.table, 'table');
    const driving = alias ?? table;

    const knownRefs = new Set<string>([driving]);
    const joinSql = (q.joins ?? [])
      .map((j) => {
        const jAlias = j.alias !== undefined ? assertIdentifier(j.alias, 'join alias') : undefined;
        const jTable = assertIdentifier(j.table, 'join table');
        const jRef = jAlias ?? jTable;
        knownRefs.add(jRef);
        return ` JOIN ${jTable}${jAlias ? ` ${jAlias}` : ''} ON ${assertJoinOn(j.on)}`;
      })
      .join('');

    const ownerRef = q.ownerRef ?? driving;
    if (!knownRefs.has(ownerRef)) {
      throw new Error(`ownerRef "${ownerRef}" is not one of this query's declared refs: ${[...knownRefs].join(', ')}.`);
    }

    const columns = q.columns.map((c) => assertColumn(c, knownRefs)).join(', ');
    const fromClause = `${table}${alias ? ` ${alias}` : ''}${joinSql}`;

    const params: (string | number)[] = [q.ownerId];
    let sql = `SELECT ${columns} FROM ${fromClause} WHERE ${ownerRef}.owner_id = ?`;
    if (q.extra) {
      sql += ` AND (${q.extra.condition})`;
      params.push(...q.extra.params);
    }
    if (q.orderBy) sql += ` ORDER BY ${assertOrderBy(q.orderBy)}`;

    const query = new SqlQuery(sql, params);
    ASSEMBLED.add(query);
    return query;
  }
}

// Exported as a plain function for call-site consistency with the rest of the codebase (queries.ts calls
// `assembleOwnerScopedQuery({...})`, matching every prior round) — a thin, non-privileged wrapper around
// the class's own static factory. It confers no additional access: it is exactly as strict as calling
// `SqlQuery.assemble` directly.
export function assembleOwnerScopedQuery(q: OwnerScopedQueryOptions): SqlQuery {
  return SqlQuery.assemble(q);
}
