import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// This repo's own CLAUDE.md/AGENTS.md pair is kept BYTE-FOR-BYTE identical except each file's H1 title (line
// 1) and its self-reference sentence ("This file (`X.md`) and its peer `Y.md` are kept **byte-for-byte
// identical** …").
//
// WHY THE STRONG ASSERTION. The two files address different runtimes — Claude Code and Codex — and the
// workspace guide's intent-parity rule allows only their DELEGATION SYNTAX to differ. This repo satisfies
// that rule by stating BOTH runtimes' syntax in BOTH files, which lands the pair at whole-file equality
// anyway. That is deliberate: parity a test can fail on beats parity a reviewer has to notice. Neither file
// may delegate content to the other — a line like "everything else in CLAUDE.md applies" is a defect,
// because each runtime loads only its own file.

const CLAUDE_MD_PATH = fileURLToPath(new URL('../CLAUDE.md', import.meta.url));
const AGENTS_MD_PATH = fileURLToPath(new URL('../AGENTS.md', import.meta.url));

// Matches this pair's actual self-reference sentence — but only the CORRECT self/peer naming for a given
// file. The two alternations must NOT be independent: "AGENTS.md ... its peer AGENTS.md" (naming itself as
// its own peer) is exactly the copy-paste slip this guard exists to catch, so it must NOT be exempted.
const selfReferenceLine = (self: 'CLAUDE' | 'AGENTS', peer: 'CLAUDE' | 'AGENTS') =>
  new RegExp(
    `^This file \\(\`${self}\\.md\`\\) and its peer \`${peer}\\.md\` are kept \\*\\*byte-for-byte identical\\*\\* except each file's$`,
  );

const CLAUDE_SELF_REFERENCE_LINE = selfReferenceLine('CLAUDE', 'AGENTS');
const AGENTS_SELF_REFERENCE_LINE = selfReferenceLine('AGENTS', 'CLAUDE');

describe('CLAUDE.md / AGENTS.md guide pair', () => {
  const claudeLines = readFileSync(CLAUDE_MD_PATH, 'utf8').split('\n');
  const agentsLines = readFileSync(AGENTS_MD_PATH, 'utf8').split('\n');

  it('is identical apart from the H1 title and the self-reference line', () => {
    expect(claudeLines.length).toBe(agentsLines.length);

    let selfReferenceLinesSeen = 0;

    for (let i = 0; i < claudeLines.length; i++) {
      const lineNumber = i + 1;
      const claudeLine = claudeLines[i];
      const agentsLine = agentsLines[i];

      if (lineNumber === 1) {
        // The H1 title is allowed to differ (each file names itself).
        continue;
      }

      if (CLAUDE_SELF_REFERENCE_LINE.test(claudeLine) && AGENTS_SELF_REFERENCE_LINE.test(agentsLine)) {
        selfReferenceLinesSeen++;
        continue;
      }

      expect(agentsLine).toBe(claudeLine);
    }

    // Sanity: the filter above must actually have matched, or this test would pass vacuously even if the
    // whole self-reference sentence were deleted.
    expect(selfReferenceLinesSeen).toBe(1);
  });
});
