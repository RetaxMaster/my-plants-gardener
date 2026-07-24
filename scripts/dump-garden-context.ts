import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectToDb } from '@retaxmaster/my-plants-species-schema/agent-kit/db';
import { resolveSessionWorkspace } from '@retaxmaster/my-plants-species-schema/agent-kit/workspace';
import { loadGardenerContext, WORKSPACE_ENV } from './lib/context.js';
import { loadCities, loadPlaces, loadPlants } from './lib/queries.js';
import { buildGardenContext, renderGardenMarkdown } from './lib/garden-context.js';

// The garden map (Spec 4 §4.2, the `garden_surveyor`'s fuel). Pinned to ONE owner: ownerId comes from the
// injected context, never an argument, and every query carries it as a mandatory owner predicate.
async function main(): Promise<void> {
  const ctx = loadGardenerContext();
  const workspace = resolveSessionWorkspace(WORKSPACE_ENV);
  const conn = await connectToDb();
  try {
    const garden = buildGardenContext({
      ownerId: ctx.ownerId,
      cities: await loadCities(conn, ctx.ownerId),
      places: await loadPlaces(conn, ctx.ownerId),
      plants: await loadPlants(conn, ctx.ownerId),
    });
    const dir = join(workspace, 'context');
    mkdirSync(dir, { recursive: true });
    const jsonPath = join(dir, 'garden-context.json');
    const mdPath = join(dir, 'garden-context.md');
    writeFileSync(jsonPath, JSON.stringify(garden, null, 2) + '\n', 'utf8');
    writeFileSync(mdPath, renderGardenMarkdown(garden), 'utf8');
    // Print ABSOLUTE paths: cwd stays on the checkout, so a bare relative path resolves nowhere useful for
    // the operator OR for a subagent it delegates to.
    const plantCount = garden.cities.reduce((n, c) => n + c.places.reduce((m, p) => m + p.plants.length, 0), 0);
    const placeCount = garden.cities.reduce((n, c) => n + c.places.length, 0);
    console.log(`Wrote the garden map for owner ${garden.ownerId} (${garden.cities.length} cities, ${placeCount} places, ${plantCount} plants).`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${mdPath}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
