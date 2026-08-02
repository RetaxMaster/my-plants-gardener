import { describe, expect, it } from 'vitest';
import { buildSpeciesContext } from './species-context.js';

const LEGACY_RECORD = {
  scientificName: 'Nephrolepis biserrata',
  commonNamesEn: ['Giant sword fern'],
  commonNamesEs: ['Helecho espada'],
  watering: {
    // 'top-inch-dry' is the real schema enum value (SOIL_DRYNESS in enums.ts); the plan's draft used
    // 'slightly-dry', which does not exist in @retaxmaster/my-plants-species-schema — fixed here so the
    // fixture actually satisfies speciesRecordSchema.parse().
    baseIntervalDays: 4, soilDrynessBeforeWatering: 'top-inch-dry', droughtTolerance: 'low',
    temperatureSensitivity: 'medium', lightSensitivity: 'medium', humiditySensitivity: 'high',
    reduceInDormancy: true,
  },
  misting: { benefit: 'beneficial', baseFrequencyDays: 3, note: 'Mist at dawn.' },
  light: { minimum: 'low', ideal: 'bright-indirect', maximum: 'bright-indirect' },
  temperature: { survivalMinC: 5, idealMinC: 18, idealMaxC: 27, survivalMaxC: 35 },
  humidity: { minimumPct: 50, idealPct: 70 },
  fertilizing: { activeSeasons: ['spring'], inSeasonFrequencyDays: 21, reduceInDormancy: true },
  repotting: { typicalIntervalMonths: 18, signs: ['Roots out of drainage holes'] },
  maintenance: { pruning: 'Trim spent fronds.', rotationDays: 30, leafCleaningDays: null, commonPests: ['Spider mites'] },
  nativeClimate: { description: 'Humid tropical understorey.', hardinessMinC: 10, hardinessMaxC: 32 },
  cultivars: [],
  growthHabit: 'clumping',
  metadata: { confidence: 'high', sources: [{ title: 'RHS', url: 'https://www.rhs.org.uk/', accessedAt: '2026-08-01' }] },
};

describe('buildSpeciesContext', () => {
  it('NORMALIZES a legacy-shaped row through the schema — never hands the agent the raw legacy shape', () => {
    // The exact bug this seam closes: a bare JSON.parse skips the .transform() that produces { en, es }.
    const out = buildSpeciesContext({ record: JSON.stringify(LEGACY_RECORD), research_brief: null, body_en: null, body_es: null });
    expect(out!.recordJson.maintenance.pruning).toEqual({ en: 'Trim spent fronds.', es: null });
    expect(out!.recordJson.maintenance.commonPests).toEqual({ en: ['Spider mites'], es: null });
    expect(typeof out!.recordJson.maintenance.pruning).not.toBe('string');
  });

  it('accepts the row whether mysql2 hands back a JSON string or a parsed object', () => {
    const asObject = buildSpeciesContext({ record: LEGACY_RECORD, research_brief: null, body_en: null, body_es: null });
    expect(asObject!.recordJson.nativeClimate.description).toEqual({ en: 'Humid tropical understorey.', es: null });
  });

  it('serves the BRIEF and suppresses the blogpost fallback when a brief exists', () => {
    const out = buildSpeciesContext({ record: LEGACY_RECORD, research_brief: '# Brief', body_en: 'Blog EN', body_es: 'Blog ES' });
    expect(out!.researchBrief).toBe('# Brief');
    // Mutually exclusive ON PURPOSE: sending both would double the species payload and reopen the exact
    // ambiguity this spec closes — which one is authoritative?
    expect(out!.blogBodyEn).toBeNull();
  });

  it('falls back to the blogpost body only while the brief is null (TRANSITIONAL)', () => {
    const en = buildSpeciesContext({ record: LEGACY_RECORD, research_brief: null, body_en: 'Blog EN', body_es: 'Blog ES' });
    expect(en!.researchBrief).toBeNull();
    expect(en!.blogBodyEn).toBe('Blog EN');

    const esOnly = buildSpeciesContext({ record: LEGACY_RECORD, research_brief: null, body_en: null, body_es: 'Blog ES' });
    expect(esOnly!.blogBodyEn).toBe('Blog ES');
  });

  it('treats an empty-string research_brief the same as a missing one — never populates both fields (regression)', () => {
    // The exact bug Codex found: `researchBrief ? null : fallback` uses truthiness, so a non-null but EMPTY
    // string (falsy, not null) slipped past the mutual-exclusion check and populated blogBodyEn too.
    const out = buildSpeciesContext({ record: LEGACY_RECORD, research_brief: '', body_en: 'Blog EN', body_es: 'Blog ES' });
    expect(out!.researchBrief).toBeNull();
    expect(out!.blogBodyEn).toBe('Blog EN');
  });

  it('treats a whitespace-only research_brief the same as a missing one — never populates both fields (regression)', () => {
    // The exact bug this closes: `=== ''` normalizes an EXACT empty string but not a whitespace-only one
    // (e.g. '   ' or '\n'), so a whitespace-only brief slipped past the mutual-exclusion check, producing a
    // non-null but effectively blank researchBrief AND a suppressed (null) blogBodyEn fallback — worse than
    // either alternative alone.
    const spaces = buildSpeciesContext({ record: LEGACY_RECORD, research_brief: '   ', body_en: 'Blog EN', body_es: 'Blog ES' });
    expect(spaces!.researchBrief).toBeNull();
    expect(spaces!.blogBodyEn).toBe('Blog EN');

    const whitespace = buildSpeciesContext({ record: LEGACY_RECORD, research_brief: '\n\t', body_en: null, body_es: 'Blog ES' });
    expect(whitespace!.researchBrief).toBeNull();
    expect(whitespace!.blogBodyEn).toBe('Blog ES');
  });

  it('returns null for a species row that does not exist', () => {
    expect(buildSpeciesContext(null)).toBeNull();
  });

  it('fails LOUDLY on an unparseable record rather than handing the agent a half-record', () => {
    expect(() => buildSpeciesContext({ record: { scientificName: '' }, research_brief: null, body_en: null, body_es: null })).toThrow();
  });
});

describe('read-plant.ts uses the shared seam', () => {
  it('does not hand the raw species row to the agent', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../read-plant.ts', import.meta.url)), 'utf8');
    expect(src).toContain('buildSpeciesContext(species');
    // The exact regression: `species: species ?? null` bypasses the normalization entirely.
    expect(src).not.toContain('species: species ?? null');
  });
});
