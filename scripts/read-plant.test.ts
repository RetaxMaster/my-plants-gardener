import { describe, expect, it } from 'vitest';

describe('read-plant.ts uses the shared seam', () => {
  it('does not hand the raw species row to the agent', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./read-plant.ts', import.meta.url)), 'utf8');
    expect(src).toContain('buildSpeciesContext(species');
    // The exact regression: `species: species ?? null` bypasses the normalization entirely.
    expect(src).not.toContain('species: species ?? null');
  });
});
