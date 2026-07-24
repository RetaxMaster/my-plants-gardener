import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { createApiClient, ApiRequestError } from '@retaxmaster/my-plants-species-schema/agent-kit/api';
import { loadGardenerContext } from './lib/context.js';
import { buildProposalRequest, parseProposalInput } from './lib/proposal-request.js';

// The gardener's ONLY write tool, and it does not write: it records a WRITE PROPOSAL the owner approves in
// the app. The API — never this tool, never the agent — performs the write.
//
//   npm run propose -- --json '{"summary":"…","operations":[…]}'
//   npm run propose -- --file /absolute/path/to/proposal.json
//
// The body carries summary + operations ONLY. ownerId / sessionId / runId come from the scoped token;
// sending them is an unknown property and a 400.
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { json: { type: 'string' }, file: { type: 'string' } } });
  if ((values.json === undefined) === (values.file === undefined)) {
    console.error('Usage: npm run propose -- --json \'{"summary":"…","operations":[…]}\'   (or --file <path>)');
    process.exit(2);
  }

  const raw = values.file !== undefined ? readFileSync(values.file, 'utf8') : String(values.json);
  const ctx = loadGardenerContext();
  const client = createApiClient(ctx);

  const parsed = parseProposalInput(raw);
  const req = buildProposalRequest(ctx.sessionId, parsed);

  const result = (await client.postJson<Record<string, unknown>>(req.path, req.body)) ?? {};
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  // Typed API errors pass through VERBATIM — never mask what the server said.
  if (err instanceof ApiRequestError) console.error(err.message);
  else console.error(err?.message ?? err);
  console.error('\nNo proposal was recorded. Report this to the owner and end your turn — do NOT edit the tooling.');
  process.exit(1);
});
