// The branded query type + the ONLY sanctioned constructor for it.
//
// This module exists because two prior guards were defeated in review, and both failure modes are the
// point, so they are recorded here rather than erased:
//
//   ROUND 1 (naming + regex on the SQL string): "every builder binds ownerId first and its SQL contains the
//   literal substring `owner_id = ?`" is DISCIPLINE, not construction. `WHERE owner_id = ? OR 1=1` satisfied
//   both checks and still returned every owner's rows — a regex cannot distinguish a real predicate from a
//   decorated tautology.
//
//   ROUND 2 (a single WHERE-writing function with a free-form `select: string` parameter, plus a
//   source-text scan asserting exactly one `WHERE` token in the file): still discipline dressed as
//   construction, because the CALLER, not the constructor, owned the query's grammar through `select`.
//     - A UNION smuggled through `select` (`'SELECT id, name FROM plants UNION SELECT id, name FROM
//       plants AS p2'`) produced exactly one `WHERE` token, bound ownerId first, and left the FIRST UNION
//       branch completely unfiltered — an unparenthesized `WHERE` in a `UNION` binds only to the LAST
//       branch in standard SQL, so the first branch returned every owner's rows.
//     - A hand-rolled `{ sql, params }` literal using `const _kw = 'WHE' + 'RE'` reproduced the original
//       `OR 1=1` payload while defeating the source-text scan, which can only see contiguous literal
//       tokens, never a keyword assembled at runtime.
//   Both were caught only by a human/peer reading the grammar, never by the guards themselves — which is
//   the definition of a guard that does not actually hold.
//
// ROUND 3 (this module) removes the free-form `select` string entirely. `assembleOwnerScopedQuery` takes
// STRUCTURED inputs — a driving table + optional alias, a column list, an optional join list, and which of
// those refs carries `owner_id` — and assembles the `SELECT ... FROM ... [JOIN ...] WHERE ...` clause
// itself. Every structural input is validated against a POSITIVE identifier grammar (a whitelist of what is
// allowed), not a blacklist of forbidden keywords: `UNION`, a second `FROM`, a subquery, or a keyword
// assembled from concatenated fragments all fail that grammar and THROW, naming the offending value,
// because none of them can ever be a bare SQL identifier (or an `identifier.identifier` pair, or an
// `identifier = identifier` join condition). There is no textual scan to defeat here — the shape is
// unrepresentable, not undetected.
//
// `SqlQuery` is additionally a BRANDED type: it carries a private, module-scoped `unique symbol` that no
// other file can spell. A hand-rolled `{ sql, params }` object literal — however its SQL string was
// assembled, including via a keyword built at runtime, which is exactly what defeated the round-2
// source-text scan — fails to structurally satisfy `SqlQuery`. Verified directly against this project's own
// tsc: a same-file object literal that spells the brand key compiles with ZERO errors (lexical access to
// the symbol is enough), but from a DIFFERENT file, neither a bare return nor a single `as SqlQuery` cast
// compiles (`TS2352: ... may be a mistake ... convert the expression to 'unknown' first`) — only
// `as unknown as SqlQuery` (or `as any`) gets through. That is precisely why this constructor and the brand
// live in their OWN module, separate from queries.ts where the builders live: queries.ts has no lexical
// access to the brand symbol, so any bypass added there is FORCED into a conspicuous, grep-able
// `as unknown as SqlQuery` / `as any`, rather than a silent structural match. queries.test.ts asserts there
// are zero such casts in queries.ts, as defence in depth alongside (not instead of) this type-level gate.
//
// THE ONE REMAINING FREE-FORM INPUT is `extra.condition`, and it stays free-form for an ALGEBRAIC reason,
// not because it was overlooked: it is always wrapped in parentheses and ANDed onto the owner predicate —
// `<ownerRef>.owner_id = ? AND (extra.condition)` — and `A AND (B)` is a subset of the rows satisfying `A`
// for EVERY possible `B`, well-formed or not, PROVIDED `B` does not itself break out of its own
// parentheses (an unbalanced `)`, or an embedded SQL comment token). This constructor does NOT validate
// that `extra.condition` is well-formed. That is safe TODAY because `extra.condition` is always a
// developer-authored string literal at its call sites in queries.ts, never derived from agent/model input
// at runtime — that precondition holds by inspection of those call sites, not by an enforced grammar. If
// `extra.condition` is ever populated from anything other than a developer-authored literal, THAT is the
// moment this precondition needs revisiting, and this comment would need to say so.

const SQL_QUERY_BRAND: unique symbol = Symbol('SqlQuery');

export type SqlQuery = Readonly<{
  sql: string;
  params: (string | number)[];
  readonly [SQL_QUERY_BRAND]: true;
}>;

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

// The ONLY function in this codebase that can produce a value of type SqlQuery without an explicit unsafe
// cast. The driving row set it returns is owner-scoped because: (1) the owner predicate is the only WHERE
// this function ever writes, (2) it is always the FIRST condition with ownerId bound FIRST — there is no
// parameter or branch that omits or relaxes it, (3) the FROM/JOIN clause it assembles is built entirely
// from validated identifiers, so there is no grammar slot for a UNION, a second FROM, or a subquery to
// occupy, and (4) any caller-supplied `extra` condition is trapped inside parentheses ANDed onto that
// predicate, which can only narrow the result set, never widen it, regardless of what it evaluates to.
export function assembleOwnerScopedQuery(q: OwnerScopedQueryOptions): SqlQuery {
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

  return { sql, params, [SQL_QUERY_BRAND]: true };
}
