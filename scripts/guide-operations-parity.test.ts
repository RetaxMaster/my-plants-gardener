import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { permittedTypesFor, requiredFieldsFor } from '@retaxmaster/my-plants-species-schema/agent-capabilities';

// `AGENT-TOOLS.md` is GENERATED from the capability map and checked by `tools:check`, so it cannot silently
// drift. The prose operations table in CLAUDE.md ("The operations you may propose, and nothing else") is
// hand-maintained — nothing ties it to the schema, which is exactly how such a list goes stale. This test
// ties it: the table must list EXACTLY the operation types the gardener scope may propose, no fewer, no
// more. guide-pair.test.ts proves AGENTS.md is byte-identical to CLAUDE.md, so asserting against CLAUDE.md
// alone covers both files.
const CLAUDE_MD_PATH = fileURLToPath(new URL('../CLAUDE.md', import.meta.url));

/**
 * Extracts the operation identifiers from the guide's own operations table: a Markdown table row whose FIRST
 * cell is a single backtick-quoted `word.word` token, e.g. `| \`place.update\` | ... | ... |`. Anchored to
 * the start of the line so a dotted, backtick-quoted mention elsewhere in the file could never be mistaken
 * for a table row.
 */
function operationsInGuide(markdown: string): string[] {
  const rowPattern = /^\|\s*`([a-z_]+\.[a-z_]+)`\s*\|/gm;
  const found: string[] = [];
  for (const match of markdown.matchAll(rowPattern)) found.push(match[1]);
  return found;
}

describe("CLAUDE.md's operations table matches the gardener's permitted operations", () => {
  it('lists exactly the operation types the gardener scope may propose — no fewer, no more', () => {
    const guide = readFileSync(CLAUDE_MD_PATH, 'utf8');
    const documented: ReadonlySet<string> = new Set(operationsInGuide(guide));
    const permitted: ReadonlySet<string> = new Set(permittedTypesFor('gardener'));

    const missing = [...permitted].filter((t) => !documented.has(t));
    const extra = [...documented].filter((t) => !permitted.has(t));

    expect(missing, `CLAUDE.md is missing: ${missing.join(', ') || '(none)'}`).toEqual([]);
    expect(extra, `CLAUDE.md documents an operation the gardener may not propose: ${extra.join(', ') || '(none)'}`).toEqual([]);
  });

  // Mirrors the doctor's copy of this linter
  // (`repos/my-plants-plant-doctor/scripts/guide-operations-parity.test.ts`). Commit 1f6dd74 added a
  // prose-count assertion to THAT copy only, one-sided — exactly the drift-between-parallel-copies bug
  // class this repo pair keeps closing: two independently-maintained copies of one linter must not
  // disagree about what they check. The gardener's CLAUDE.md states no count today ("The operations you
  // may propose, and nothing else:"), so this assertion is CONDITIONAL: it always requires the
  // introducing sentence to exist (a wording change is still caught), and ONLY IF the sentence names a
  // count word does it assert that word equals the number of operations `permittedTypesFor('gardener')`
  // returns. It exists so that adding a count to the gardener's guide later cannot go stale silently.
  it('the prose sentence introducing the table, if it names a count, matches the number of permitted operations', () => {
    const guide = readFileSync(CLAUDE_MD_PATH, 'utf8');
    const WORDS = [
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
      'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five',
    ];
    const expected = permittedTypesFor('gardener').length;
    const match = guide.match(/The (?:([a-z-]+) )?operations you may propose/i);
    expect(match, 'the sentence introducing the operations table was not found — did its wording change?').not.toBeNull();
    if (match![1] === undefined) {
      // The gardener's guide names no count today — nothing to check against yet, and that is the
      // CORRECT verdict for this assertion, not a skipped one.
      return;
    }
    expect(
      match![1].toLowerCase(),
      `the guide says "${match![1]}" but the gardener may propose ${expected} operations`,
    ).toBe(WORDS[expected]);
  });

  it('the extraction itself is sound: it found more than zero rows', () => {
    const guide = readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(operationsInGuide(guide).length).toBeGreaterThan(0);
  });
});

// ===================================================================================================
// PER-FIELD parity — the check that would have caught the defect the live gardener reported.
//
// The block above compares WHICH OPERATIONS the guide lists. That was never enough. The live gardener
// reported: "AGENT-TOOLS.md marks `plantId` as optional in `note.create`, while CLAUDE.md declares it
// obligatory for every plant-scoped operation." Both documents were checked by a test; neither test read
// a FIELD table, so the two could — and did — say opposite things about the same field, on ELEVEN
// operations, with every gate green.
//
// The root cause was in the shared renderer: it computed `Required` from the Zod node ALONE, blind to the
// scope it was rendering for. That is fixed at the source (`requireFields` in the capability map), and
// this block is the net that makes the fix un-regressable — it ties THREE independently-authored
// artifacts together and fails if any two disagree:
//   1. the capability map (`requiredFieldsFor('gardener', op)`)  — the source of truth,
//   2. `AGENT-TOOLS.md`                                          — generated from it,
//   3. this repo's hand-written `CLAUDE.md` operations table     — the one nothing generates.
// `guide-pair.test.ts` proves `AGENTS.md` is byte-identical to `CLAUDE.md`, so asserting against
// CLAUDE.md alone covers the pair.
// ===================================================================================================
const AGENT_TOOLS_PATH = fileURLToPath(new URL('../AGENT-TOOLS.md', import.meta.url));

/**
 * A Markdown table row's cells.
 *
 * ⚠️ SPLIT ON UNESCAPED PIPES ONLY. The generated doc renders an enum type as `` `A` \| `B` \| `C` `` —
 * escaped pipes, inside a cell. A naive `[^|]*` column pattern silently fails to match any row for an
 * enum-typed field, and the test then reports that field as ABSENT rather than as disagreeing. That is a
 * false negative in the direction that matters: the check quietly stops covering exactly the rows it
 * cannot parse. (Written down because the first version of this file did precisely that, and only the
 * guide's own `(required)` markers on `health`/`task` made it visible.)
 */
function cells(line: string): string[] {
  if (!line.startsWith('|')) return [];
  return line.slice(1).split(/(?<!\\)\|/).map((c) => c.trim());
}

/**
 * The Payload cell of each operation row, keyed by operation. Row shape:
 * `| \`op.name\` | <payload cell> | <notes cell> |`.
 */
function payloadCellsInGuide(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of markdown.split('\n')) {
    const c = cells(line);
    const m = c.length >= 2 ? /^`([a-z_]+\.[a-z_]+)`$/.exec(c[0]) : null;
    if (m) out.set(m[1], c[1]);
  }
  return out;
}

/** Field names the guide's own Payload cell explicitly marks as required: `` `field` (required…) ``. */
function fieldsGuideCallsRequired(payloadCell: string): string[] {
  return [...payloadCell.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`\s*\((?:required)\b[^)]*\)/g)].map((m) => m[1]);
}

/**
 * The generated doc's own `Required` verdict per field, per operation. Sections are `### \`op.name\``;
 * rows are `| \`field\` | <type> | required|optional |…`. Returns operation → field → true(required).
 */
function requiredByOperationInToolDoc(markdown: string): Map<string, Map<string, boolean>> {
  const out = new Map<string, Map<string, boolean>>();
  let current: Map<string, boolean> | null = null;
  for (const line of markdown.split('\n')) {
    const heading = /^### `([a-z_]+\.[a-z_]+)`\s*$/.exec(line);
    if (heading) {
      current = new Map();
      out.set(heading[1], current);
      continue;
    }
    // A `#### \`field\`` sub-table documents a NESTED object's members, whose names can collide with a
    // top-level field name. Stop collecting at the first sub-table so a nested row can never overwrite the
    // top-level verdict this test is about.
    if (line.startsWith('#### ')) current = null;
    if (!current) continue;
    // Columns are always `Field | Type | Required` (+ an optional `Description`), so the verdict is index
    // 2 — after splitting on UNESCAPED pipes, since the Type column legitimately contains `\|`.
    const c = cells(line);
    const name = c.length >= 3 ? /^`([A-Za-z][A-Za-z0-9_]*)`$/.exec(c[0]) : null;
    if (name && (c[2] === 'required' || c[2] === 'optional')) current.set(name[1], c[2] === 'required');
  }
  return out;
}

describe("per-field required-ness agrees across the map, AGENT-TOOLS.md and CLAUDE.md's table", () => {
  const guide = readFileSync(CLAUDE_MD_PATH, 'utf8');
  const toolDoc = readFileSync(AGENT_TOOLS_PATH, 'utf8');
  const payloads = payloadCellsInGuide(guide);
  const docRequired = requiredByOperationInToolDoc(toolDoc);

  it('the extraction is sound: every permitted operation has a parsed field table with fields in it', () => {
    // Without this, every assertion below could pass vacuously on empty maps after a doc reformat — the
    // same vacuous-green trap the operations-table test above guards against.
    for (const op of permittedTypesFor('gardener')) {
      const fields = docRequired.get(op);
      expect(fields, `AGENT-TOOLS.md has no parsed field table for ${op}`).toBeDefined();
      expect(fields!.size, `AGENT-TOOLS.md parsed zero fields for ${op}`).toBeGreaterThan(0);
      expect(payloads.has(op), `CLAUDE.md has no payload cell for ${op}`).toBe(true);
    }
  });

  it('every field the guide calls "(required)" is `required` in the generated doc too', () => {
    // Direction: guide → doc. This is the exact shape of the reported defect (guide said obligatory, doc
    // said optional) and it generalizes past `plantId` to every field either document names.
    const disagreements: string[] = [];
    for (const op of permittedTypesFor('gardener')) {
      const fields = docRequired.get(op) ?? new Map<string, boolean>();
      for (const field of fieldsGuideCallsRequired(payloads.get(op) ?? '')) {
        if (fields.get(field) !== true) {
          disagreements.push(
            `${op}.${field}: CLAUDE.md says required, AGENT-TOOLS.md says ` +
              `${fields.has(field) ? 'optional' : 'NOTHING (field absent from the generated doc)'}`,
          );
        }
      }
    }
    expect(disagreements, disagreements.join('\n') || '(none)').toEqual([]);
  });

  it('`plantId` is required in all three artifacts on exactly the same operations — no fewer, no more', () => {
    // The one field where BOTH directions matter, so it gets a set-equality check rather than a subset
    // one. The reported defect was 11 operations wide; a one-instance assertion would have passed both
    // before and after a fix that closed only `note.create`.
    const fromMap = permittedTypesFor('gardener').filter((op) =>
      requiredFieldsFor('gardener', op).includes('plantId'),
    );
    const fromToolDoc = permittedTypesFor('gardener').filter((op) => docRequired.get(op)?.get('plantId') === true);
    const fromGuide = permittedTypesFor('gardener').filter((op) =>
      fieldsGuideCallsRequired(payloads.get(op) ?? '').includes('plantId'),
    );

    expect(fromToolDoc, 'AGENT-TOOLS.md disagrees with the capability map').toEqual(fromMap);
    expect(fromGuide, 'CLAUDE.md disagrees with the capability map').toEqual(fromMap);
    expect(fromMap.length, 'the gardener has twelve plant-scoped operations').toBe(12);
  });

  it('no operation documents `plantId` as optional — the literal regression that was reported', () => {
    // Deliberately redundant with the assertion above, and deliberately literal: it reads the rendered
    // text the agent actually sees, so it stays meaningful even if every helper in this file is rewritten.
    expect(toolDoc).not.toMatch(/^\| `plantId` \| [^|]*\| optional \|/m);
  });
});
