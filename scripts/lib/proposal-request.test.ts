import { describe, expect, it } from 'vitest';
import { buildProposalRequest, parseProposalInput } from './proposal-request.js';

const CITY_CREATE = { type: 'city.create', name: 'Guadalajara', latitude: 20.67, longitude: -103.35, timezone: 'America/Mexico_City' };

describe('buildProposalRequest', () => {
  it('addresses the owner-scoped gardener session, with no plant in the path', () => {
    const r = buildProposalRequest('SESSION_1', { summary: 'Add a city', operations: [CITY_CREATE] });
    expect(r.path).toBe('/gardener/sessions/SESSION_1/proposals');
    expect(r.path).not.toContain('plants');
  });

  it('sends summary + operations ONLY — every identity comes from the token', () => {
    const r = buildProposalRequest('SESSION_1', { summary: 'Add a city', operations: [CITY_CREATE] });
    expect(Object.keys(r.body).sort()).toEqual(['operations', 'summary']);
  });

  it('rejects a whitespace-only summary with its own message, before the schema is consulted', () => {
    expect(() => buildProposalRequest('S1', { summary: '   ', operations: [CITY_CREATE] })).toThrow(/"summary" is required/);
  });

  it('rejects an operation the union does not admit', () => {
    expect(() => buildProposalRequest('S1', { summary: 'x', operations: [{ type: 'place.delete', placeId: 'P1' }] })).toThrow();
  });

  it('rejects two operations that overlap on the same target field', () => {
    expect(() =>
      buildProposalRequest('S1', {
        summary: 'x',
        operations: [
          { type: 'place.update', placeId: 'P1', airflow: 'still' },
          { type: 'place.update', placeId: 'P1', airflow: 'breezy' },
        ],
      }),
    ).toThrow(/overlap on "place:P1:airflow"/);
  });
});

describe('parseProposalInput', () => {
  it('separates malformed JSON from a valid-but-wrong proposal', () => {
    expect(() => parseProposalInput('{not json')).toThrow(/not valid JSON/);
    expect(() => parseProposalInput('[]')).toThrow(/must be a JSON object/);
  });

  it('returns the raw summary and operations for the builder to validate', () => {
    expect(parseProposalInput(JSON.stringify({ summary: 's', operations: [] }))).toEqual({ summary: 's', operations: [] });
  });
});
