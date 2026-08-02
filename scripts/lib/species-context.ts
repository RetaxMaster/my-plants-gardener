import { speciesRecordSchema, type SpeciesRecord } from '@retaxmaster/my-plants-species-schema';

// NOTE ON THE DUPLICATION. This module is byte-identical to the doctor's `scripts/lib/species-context.ts`
// ON PURPOSE. The two agents are independent repos with no shared package between them other than
// `@retaxmaster/my-plants-species-schema`, so neither can import the other's checkout. The thing that could
// actually DRIFT — the normalization itself — is the shared `speciesRecordSchema.parse` call below, which
// lives in that one package. If a third agent needs this, promote the module into the shared package's
// `agent-kit` rather than making a third copy.

/**
 * The species half of the agent's context (Spec 3 §3.4).
 *
 * TWO THINGS, AND BOTH ARE LOAD-BEARING.
 *
 * 1. NORMALIZE, DO NOT MERELY PARSE. The bilingual `.transform()` that turns a legacy English-only
 *    string/array into `{ en, es }` runs ONLY inside `speciesRecordSchema.parse`. A bare `JSON.parse` — what
 *    this builder used to do — hands the agent a legacy-shaped record while the contract promises the
 *    normalized object. That is a live contract break for every species not yet re-cured.
 *
 * 2. THE BRIEF REPLACES THE BLOGPOST, EXCLUSIVELY. `researchBrief` is the trusted primary research;
 *    `blogBodyEn` is the editorial REINTERPRETATION and is TRANSITIONAL — present only while a species has
 *    no brief yet. They are never both non-null: sending both would double the species payload and reopen
 *    the exact ambiguity this change closes (which one is authoritative?).
 *
 * TRANSITIONAL: remove `blogBodyEn` entirely once the one-time re-curation has filled every brief (Spec 3
 * §6's cleanup). Until then it is the only species knowledge an un-re-cured species has.
 */
export interface SpeciesContext {
  recordJson: SpeciesRecord;
  researchBrief: string | null;
  blogBodyEn: string | null;
}

/** The species row as the queries return it. mysql2 may hand back a JSON column parsed OR as a string. */
export interface SpeciesContextRow {
  record: unknown;
  research_brief?: unknown;
  body_en?: unknown;
  body_es?: unknown;
}

export function buildSpeciesContext(row: SpeciesContextRow | null | undefined): SpeciesContext | null {
  if (!row) return null;
  const raw = typeof row.record === 'string' ? JSON.parse(row.record) : row.record;
  // .parse, not .safeParse: a species record that no longer satisfies the contract is a real defect, and a
  // doctor reasoning over a silently half-loaded record is worse than one that stops and reports.
  const recordJson = speciesRecordSchema.parse(raw);
  // An empty or WHITESPACE-ONLY `research_brief` carries no research content, so it is normalized to `null`
  // right here — the same "no brief yet" state as a genuinely NULL column. Trimming before the emptiness
  // check matters: a value like '   ' or '\n' is non-empty by `=== ''` but renders as an effectively blank
  // "RESEARCH BRIEF" section while also (via the mutual-exclusion check below) suppressing the `blogBodyEn`
  // fallback — worse than either alternative alone. Doing this at the source (rather than only in the
  // `blogBodyEn` check below) means every consumer of `researchBrief` — this function's own mutual-exclusion
  // check, the Markdown renderer in context-build.ts, and any future reader — sees one unambiguous null state
  // instead of having to independently remember that '' (or whitespace) also means "absent".
  const researchBriefRaw = row.research_brief == null ? null : String(row.research_brief);
  const researchBrief = researchBriefRaw === null || researchBriefRaw.trim() === '' ? null : researchBriefRaw;
  return {
    recordJson,
    researchBrief,
    // Explicit null check, not truthiness: `researchBrief` is normalized above so '' can never reach here,
    // but the check itself stays a null comparison so the mutual-exclusion invariant (blogBodyEn is non-null
    // only when researchBrief is null) cannot silently break again if that normalization ever moves.
    blogBodyEn: researchBrief == null
      ? ((row.body_en as string | null) ?? (row.body_es as string | null) ?? null)
      : null,
  };
}
