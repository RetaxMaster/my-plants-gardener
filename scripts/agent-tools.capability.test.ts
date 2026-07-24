import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROPOSAL_OPERATION_TYPES } from '@retaxmaster/my-plants-species-schema';
import { mayPropose, omittedFieldsFor } from '@retaxmaster/my-plants-species-schema/agent-capabilities';

const doc = readFileSync(join(process.cwd(), 'AGENT-TOOLS.md'), 'utf8');

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
});
