import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSessionWorkspace } from '@retaxmaster/my-plants-species-schema/agent-kit/workspace';

/** The engine sets this to the session's scratch dir ABSOLUTE path. Deliberately NOT the process cwd:
 * cwd stays on the gardener checkout so CLAUDE.md/.claude/agents load, and the workspace arrives ONLY
 * through this variable — the shared resolver fails closed on a missing or relative path. */
export const WORKSPACE_ENV = 'GARDENER_SESSION_WORKSPACE';

export const CONTEXT_FILENAME = 'gardener-context.json';

// The OWNER pin + API credentials the platform injects per run. Note what is pinned and what is NOT: the
// doctor's context pins a PLANT, the gardener's pins an OWNER. There is no plantId here, by design — the
// gardener administers the owner's WHOLE garden, never a single plant.
export interface GardenerContext {
  ownerId: string;
  apiBaseUrl: string;
  apiToken: string;
  sessionId: string; // the proposal is SEALED to this session + run
  runId: string;
  skipPermissions: boolean;
}

function requireString(obj: Record<string, unknown>, key: keyof GardenerContext): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${CONTEXT_FILENAME} is missing a valid "${key}".`);
  return v;
}

// FAIL CLOSED on every failure mode (unset workspace, missing/malformed file, missing field). A gardener
// with no owner pin must stop — it must NEVER default to reading every owner's garden.
export function loadGardenerContext(): GardenerContext {
  const path = join(resolveSessionWorkspace(WORKSPACE_ENV), CONTEXT_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read ${path}. The platform must write ${CONTEXT_FILENAME} before a tool runs.`);
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const ctx: GardenerContext = {
    ownerId: requireString(parsed, 'ownerId'),
    apiBaseUrl: requireString(parsed, 'apiBaseUrl'),
    apiToken: requireString(parsed, 'apiToken'),
    sessionId: requireString(parsed, 'sessionId'),
    runId: requireString(parsed, 'runId'),
    skipPermissions: false,
  };
  // Fail CLOSED on anything that is not a real boolean: coercing here would let a stray "false" decide
  // whether the owner's approval gate is bypassed — the one setting that must never be guessed.
  if (parsed.skipPermissions !== undefined) {
    if (typeof parsed.skipPermissions !== 'boolean') {
      throw new Error(`${CONTEXT_FILENAME} "skipPermissions" must be a boolean when present.`);
    }
    ctx.skipPermissions = parsed.skipPermissions;
  }
  return ctx;
}
