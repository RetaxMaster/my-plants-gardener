import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('./read-plant.ts', import.meta.url)), 'utf8');

describe('read-plant.ts uses the shared seams', () => {
  it('does not hand the raw species row to the agent', () => {
    expect(SRC).toContain('buildSpeciesContext(species');
    // The exact regression: `species: species ?? null` bypasses the normalization entirely.
    expect(SRC).not.toContain('species: species ?? null');
  });

  it('loads the history and journal through the ONE shared read seam, never an inline fetch', () => {
    expect(SRC).toContain('loadPlantReads(client, plantId)');
    expect(SRC).toContain('...reads');
    // A hand-rolled call to either route here would be a second reader inside the same tool.
    expect(SRC).not.toMatch(/getJson\(`\/plants\/\$\{plantId\}\/(care-events|progress)`\)/);
  });

  it('never reaches for a photo route — photo/media reads are out of scope for the gardener', () => {
    expect(SRC).not.toContain('/photos');
  });
});
