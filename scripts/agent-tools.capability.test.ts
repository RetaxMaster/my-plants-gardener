import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROPOSAL_OPERATION_TYPES } from '@retaxmaster/my-plants-species-schema';
import { mayPropose, omittedFieldsFor, requiredFieldsFor } from '@retaxmaster/my-plants-species-schema/agent-capabilities';

const doc = readFileSync(join(process.cwd(), 'AGENT-TOOLS.md'), 'utf8');

/** A backtick-quoted token, built without embedding a backtick in a template literal. */
const backtick = (s: string) => String.fromCharCode(96) + s + String.fromCharCode(96);


describe('AGENT-TOOLS.md is derived from the capability map', () => {
  it('documents exactly the operation types the gardener scope permits', () => {
    for (const type of PROPOSAL_OPERATION_TYPES) {
      const heading = `### \`${type}\``;
      expect(doc.includes(heading), `${type}`).toBe(mayPropose('gardener', type));
    }
  });

  it('never mentions a field the map withholds from the gardener', () => {
    for (const type of PROPOSAL_OPERATION_TYPES) {
      if (!mayPropose('gardener', type)) continue;
      for (const field of omittedFieldsFor('gardener', type)) {
        expect(doc, `${type}.${field} must not be documented`).not.toContain(field);
      }
    }
  });

  it('concretely: the gardener IS told about placeId — relocation is its exclusive grant', () => {
    expect(doc).toContain('placeId');
  });

  it('concretely: neither the withheld progress.delete nor the clinical-record ops are documented', () => {
    expect(doc).not.toContain('### `progress.delete`');
    expect(doc).not.toContain('clinical_record');
  });

  // The mirror of the omitFields check above, and the one that closes the reported defect at THIS repo's
  // own boundary: a field the capability map REQUIRES of the gardener must render as `required` in this
  // repo's generated doc. It cannot come from the Zod schema — `plantId` is `.optional()` there so the
  // DOCTOR can omit it entirely — so if the generator ever stops threading `requireFields`, the doc
  // silently goes back to telling the agent a mandatory field is optional. That is exactly what happened,
  // on eleven operations at once, with every test in this repo green.
  it('marks every field the map REQUIRES of the gardener as `required` in the generated doc', () => {
    let asserted = 0;
    for (const type of PROPOSAL_OPERATION_TYPES) {
      if (!mayPropose('gardener', type)) continue;
      for (const field of requiredFieldsFor('gardener', type)) {
        // Scope the search to THIS operation's own section, so a `required` row belonging to a DIFFERENT
        // operation can never satisfy the assertion for this one.
        const section = doc.split('### ' + backtick(type))[1]?.split('\n### ')[0] ?? '';
        expect(section, type + '.' + field + ' must be documented as required').toMatch(
          new RegExp('^\\| ' + backtick(field) + ' \\|[^|]*\\| required \\|', 'm'),
        );
        asserted += 1;
      }
    }
    // Never let this pass vacuously: the gardener really does have eleven required-`plantId` operations,
    // so a run that asserted nothing means the map, not the doc, is what broke.
    expect(asserted, 'the map required nothing of the gardener — that is itself the regression').toBe(11);
  });
});
