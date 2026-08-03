import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectToDb } from '@retaxmaster/my-plants-species-schema/agent-kit/db';
import { createApiClient, ApiRequestError } from '@retaxmaster/my-plants-species-schema/agent-kit/api';
import { resolveSessionWorkspace } from '@retaxmaster/my-plants-species-schema/agent-kit/workspace';
import { buildSpeciesContext } from '@retaxmaster/my-plants-species-schema/agent-kit/species-context';
import { loadGardenerContext, WORKSPACE_ENV } from './lib/context.js';
import { loadPlantDetail, loadPlantProfile, loadSpeciesForOwnedPlant, loadClinicalRecords } from './lib/queries.js';

// One owned plant, in depth (Spec 4 §4.3). The gardener reads a plant to judge its PLACEMENT and MATERIALS —
// its detail, its profile, its species record, its computed care plan, and the doctor's clinical records as
// context (never a licence to diagnose). Pinned to the OWNER by the injected context: the CLI accepts a
// plant id but NEVER an owner, and every query carries `ctx.ownerId` as its first predicate, so a plant the
// owner does not own resolves to zero rows and the tool exits non-zero — it can never reach another garden.
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { plant: { type: 'string' }, months: { type: 'string' } } });
  const plantId = values.plant;
  if (!plantId) {
    console.error('Usage: npm run read-plant -- --plant <id> [--months N]');
    process.exit(2);
  }
  const months = Number(values.months ?? 3);
  if (!Number.isInteger(months) || months < 1) {
    console.error('--months must be a positive integer');
    process.exit(2);
  }

  const ctx = loadGardenerContext();
  const workspace = resolveSessionWorkspace(WORKSPACE_ENV);
  const client = createApiClient(ctx);
  const conn = await connectToDb();
  try {
    const detail = await loadPlantDetail(conn, ctx.ownerId, plantId);
    if (detail.length === 0) {
      // Owner-anchored: an id outside this garden yields zero rows. Fail closed, naming the id, never
      // silently returning an empty plant.
      console.error(`Plant ${plantId} is not in this garden.`);
      process.exit(1);
    }
    const [profile] = await loadPlantProfile(conn, ctx.ownerId, plantId);
    const [species] = await loadSpeciesForOwnedPlant(conn, ctx.ownerId, plantId);
    const clinicalRecords = await loadClinicalRecords(conn, ctx.ownerId, plantId, months);

    // The one care read the gardener token may reach: GET /plants/:id/care returns the ALREADY-computed care
    // plan (due tasks, viability semaphore + reasons, crowding). The API's care-read handler admits the
    // gardener scope (Spec 4 §10.2 / Task 4.8); the token is refused by every other domain endpoint.
    let carePlan: unknown = null;
    try {
      carePlan = await client.getJson(`/plants/${plantId}/care`);
    } catch (err) {
      // A care-plan read failure is not fatal to placement review — record it and continue with what the DB
      // gave, exactly as the doctor reports a blocked tool rather than faking data.
      carePlan = { error: err instanceof ApiRequestError ? err.message : String((err as Error)?.message ?? err) };
    }

    const plantContext = {
      generatedAt: new Date().toISOString(),
      ownerId: ctx.ownerId,
      window: { months },
      plant: detail[0],
      profile: profile ?? null,
      // The species record is NORMALIZED through the shared schema before the agent sees it (Spec 3 §3.4) —
      // the raw row would hand a legacy English-only record straight through, and `research_brief` would
      // arrive as an unnamed column. Same three keys the doctor emits, so the two agents' vocabularies do
      // not fork.
      species: buildSpeciesContext(species as never),
      carePlan,
      clinicalRecords,
    };

    const dir = join(workspace, 'context');
    mkdirSync(dir, { recursive: true });
    const outPath = join(dir, `plant-${plantId}.json`);
    writeFileSync(outPath, JSON.stringify(plantContext, null, 2) + '\n', 'utf8');
    // ABSOLUTE path: cwd stays on the checkout, so read/pass this exact path (and hand it to any subagent).
    console.log(`Wrote plant ${plantId} (${clinicalRecords.length} clinical records) to:`);
    console.log(`  ${outPath}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
