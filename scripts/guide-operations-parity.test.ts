import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { permittedTypesFor } from '@retaxmaster/my-plants-species-schema/agent-capabilities';

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

  it('the extraction itself is sound: it found more than zero rows', () => {
    const guide = readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(operationsInGuide(guide).length).toBeGreaterThan(0);
  });
});
