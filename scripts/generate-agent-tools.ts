#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  operationSchema,
  discriminatedUnionMembers,
  type ProposalOperationType,
} from '@retaxmaster/my-plants-species-schema';
import {
  permittedTypesFor,
  omittedFieldsFor,
  requiredFieldsFor,
  assertOmitFieldsAreRealFields,
  assertRequireFieldsAreRealFields,
  type AgentScope,
} from '@retaxmaster/my-plants-species-schema/agent-capabilities';
import { renderToolDoc, assertInvariantsCover, syncToolDoc, type InvariantMap } from '@retaxmaster/my-plants-species-schema/tool-doc';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO_ROOT, 'AGENT-TOOLS.md');

// This generator serves ONE scope: the gardener. The capability map is the single source of truth for which
// operations — and which fields on them — that scope may propose. The doc lists exactly what the API will
// accept from a gardener token, and nothing more: `place.*`/`city.*`/`plant.create` are IN; the gardener's
// `plant.update` DOES carry `placeId` (relocation is the gardener's exclusive grant); `progress.delete` and
// `clinical_record.*` are absent because the map withholds them from this scope.
const SCOPE: AgentScope = 'gardener';

// The shared package owns AGENT_CAPABILITIES and operationSchema, so it owns the invariant that every
// `omitFields` entry actually names a real field — validated here at generation time (a typo fails THIS
// build loudly) and by the shared package's own suite (every test-all.sh run validates the whole map).
assertOmitFieldsAreRealFields();
// The mirror guard, for the mirror mechanism (`requireFields`, read below). A typo there would REQUIRE
// nothing — leaving the field it meant to mark obligatory documented as "optional", which is the exact
// doc-lies-to-the-agent defect the whole mechanism exists to close, arriving through a typo instead of a
// missing entry. It also refuses a field that is both withheld from and required of the same scope.
assertRequireFieldsAreRealFields();

// Each example MUST be valid against its member schema (the renderer safeParse-gates them). Values are drawn
// from the shared vocabulary: lightType from LIGHT_TYPES, airflow from AIRFLOW, humidityCharacter from
// HUMIDITY_CHARACTERS, tasks from FREQUENCY_BEARING_TASKS, dates as YYYY-MM-DD calendar dates.
// The gardener is anchored to the OWNER, not to a single plant, so every plant-scoped operation MUST name
// its target with `plantId` (unlike the doctor, whose token pins the plant). The ten plant-scoped examples
// therefore carry a `plantId` placeholder so a copied example names its plant; the place/city examples and
// `plant.create` address their target by their own ids and carry none.
const example: Record<string, unknown> = {
  'profile.update': { type: 'profile.update', plantId: 'PLANT_ID', potType: 'terracotta' },
  'plant.update': { type: 'plant.update', plantId: 'PLANT_ID', placeId: 'PLACE_ID' },
  'plant.create': { type: 'plant.create', speciesSlug: 'ficus-lyrata', placeId: 'PLACE_ID', acquiredOn: '2026-07-20', nickname: 'Figaro' },
  'progress.create': { type: 'progress.create', plantId: 'PLANT_ID', health: 'GOOD', occurredOn: '2026-07-20', observations: 'Moved to the east window.' },
  'progress.update': { type: 'progress.update', plantId: 'PLANT_ID', entryId: 'ENTRY_ID', health: 'EXCELLENT' },
  'note.create': { type: 'note.create', plantId: 'PLANT_ID', body: 'Moved this one to the shaded corner today.' },
  'frequency.set': { type: 'frequency.set', plantId: 'PLANT_ID', task: 'WATER', intervalDays: 9 },
  'frequency.clear': { type: 'frequency.clear', plantId: 'PLANT_ID', task: 'WATER' },
  'care.done': { type: 'care.done', plantId: 'PLANT_ID', task: 'WATER', occurredOn: '2026-07-20' },
  'plant.memorialize': { type: 'plant.memorialize', plantId: 'PLANT_ID' },
  'plant.gift': { type: 'plant.gift', plantId: 'PLANT_ID' },
  // `plantId` is SUPPLIED here (unlike the doctor's example above) — the gardener's token is owner-
  // anchored, not pinned to one plant, so it must name which plant's substrate it is recording as
  // refreshed. `charged` is optional (omitted means "derive from the mix").
  'substrate.refresh': { type: 'substrate.refresh', plantId: 'PLANT_ID', refreshedOn: '2026-07-20' },
  'place.create': { type: 'place.create', cityId: 'CITY_ID', name: 'Study window', indoor: true, lightType: 'BRIGHT_INDIRECT', airflow: 'some' },
  'place.update': { type: 'place.update', placeId: 'PLACE_ID', airflow: 'breezy' },
  'city.create': { type: 'city.create', name: 'Guadalajara', latitude: 20.67, longitude: -103.35, timezone: 'America/Mexico_City' },
  'city.update': { type: 'city.update', cityId: 'CITY_ID', timezone: 'America/Mexico_City' },
};

// The hand-authored example map is not automatable from a Zod schema and is not optional: every operation
// type this scope is PERMITTED to propose needs an entry here, or a future operation lands undocumented
// instead of failing the build. `permittedTypesFor` is the map's own denominator — never a hand-rolled loop.
for (const type of permittedTypesFor(SCOPE)) {
  if (!(type in example)) {
    throw new Error(`generate-agent-tools: no example authored for "${type}", which the ${SCOPE} scope may propose.`);
  }
}

const invariants: InvariantMap = {
  schemaAttached: {
    proposal:
      'profile.update / plant.update / progress.update / place.update / city.update must each change at least one field (an op carrying only its type + target id is rejected). ' +
      'care.done requires potSizeCm, soilMix and charged when task is REPOT (a repot completion that omits what physically changed leaves the crowding ratio computed against a pot that no longer exists) — and forbids all three, plus refreshedOn, on every other task.',
  },
  external: [
    'One operation per target — two ops touching the same field, entry, place, city or task are rejected.',
    'Dates are calendar dates `YYYY-MM-DD`, never ISO instants.',
    '`null` clears a nullable field; `[]` clears `tags`; a proposal carries 1–10 operations.',
    'A place edit RECOMPUTES the care plan for EVERY plant living in that place — the owner is shown how many, and you must say so in your summary too.',
    'There is no operation that deletes a plant, a place or a city (they do not exist, for anybody), and you cannot delete a progress entry (that operation exists but is not yours).',
  ],
};

assertInvariantsCover({ proposal: operationSchema }, invariants);

// Reflects into operationSchema's members through the shared package's OWN guarded accessor — never a raw
// `_def` walk here. `discriminatedUnionMembers` validates the shape before dereferencing it.
const members = discriminatedUnionMembers(operationSchema) as unknown as import('zod').ZodObject<import('zod').ZodRawShape>[];

const permitted = new Set(permittedTypesFor(SCOPE));

const tools = members
  .map((m) => ({ name: (m.shape as Record<string, { _def: { value: string } }>).type._def.value as ProposalOperationType, schema: m }))
  // The map is the ONLY source: the doc lists exactly what the API will accept from this scope.
  .filter((t) => permitted.has(t.name))
  // `requireFields` is fed from the SAME map as `omitFields`, and for the mirror reason. The `Required`
  // column used to be computed from the Zod schema alone — which is structurally unable to be right here,
  // because ONE operation union serves BOTH scopes while this doc serves exactly one. A field a scope must
  // always supply is `.optional()` in the union precisely so the OTHER scope can omit it.
  .map((t) => ({
    ...t,
    example: example[t.name],
    omitFields: omittedFieldsFor(SCOPE, t.name),
    requireFields: requiredFieldsFor(SCOPE, t.name),
  }));

const body = renderToolDoc({
  title: 'The Gardener — tool reference',
  intro:
    'Your one write tool is `npm run propose`. It records a proposal: `{ "summary": "…", "operations": [ … ] }`. Each operation is one of the objects below — copy the example, change the values, keep the `type` key.',
  tools,
  invariants,
});

const mode = process.argv.includes('--check') ? 'check' : 'write';
const r = syncToolDoc({ path: OUT, content: body, mode, currentReader: () => (existsSync(OUT) ? readFileSync(OUT, 'utf8') : null), writer: (c) => writeFileSync(OUT, c) });
if (r.problems.length) { console.error(r.problems.join('\n')); process.exit(1); }
console.log(r.wrote ? `wrote ${OUT}` : 'AGENT-TOOLS.md OK');
