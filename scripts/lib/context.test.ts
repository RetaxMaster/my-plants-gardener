import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGardenerContext, CONTEXT_FILENAME } from './context.js';

const ORIGINAL = process.env.GARDENER_SESSION_WORKSPACE;
afterEach(() => { process.env.GARDENER_SESSION_WORKSPACE = ORIGINAL; });

const seed = (ctx: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), 'gardener-ctx-'));
  writeFileSync(join(dir, CONTEXT_FILENAME), JSON.stringify(ctx));
  process.env.GARDENER_SESSION_WORKSPACE = dir;
  return dir;
};

const FULL = { ownerId: 'O1', apiBaseUrl: 'http://127.0.0.1:8000', apiToken: 't', sessionId: 'S1', runId: 'R1' };

describe('loadGardenerContext', () => {
  it('pins the OWNER, and carries no plantId at all', () => {
    seed(FULL);
    const ctx = loadGardenerContext();
    expect(ctx.ownerId).toBe('O1');
    // GardenerContext genuinely has no plantId field — the cast goes through `unknown` because the two
    // types don't structurally overlap (a plain `as Record<string, unknown>` fails to compile under strict
    // mode with no index signature on GardenerContext). This is exactly the point of the assertion: the
    // absence is a COMPILE-TIME fact, not just a runtime one.
    expect((ctx as unknown as Record<string, unknown>).plantId).toBeUndefined();
  });

  it('reads the API base URL, token and the session/run seal', () => {
    seed(FULL);
    const ctx = loadGardenerContext();
    expect(ctx.apiBaseUrl).toBe('http://127.0.0.1:8000');
    expect(ctx.apiToken).toBe('t');
    expect(ctx.sessionId).toBe('S1');
    expect(ctx.runId).toBe('R1');
    expect(ctx.skipPermissions).toBe(false);
  });

  it('carries skipPermissions through when it is a real boolean', () => {
    seed({ ...FULL, skipPermissions: true });
    expect(loadGardenerContext().skipPermissions).toBe(true);
  });

  it('fails CLOSED when the workspace is unset', () => {
    delete process.env.GARDENER_SESSION_WORKSPACE;
    expect(() => loadGardenerContext()).toThrow(/GARDENER_SESSION_WORKSPACE/);
  });

  it('fails CLOSED on a missing ownerId — it must NEVER default to every owner', () => {
    seed({ ...FULL, ownerId: '' });
    expect(() => loadGardenerContext()).toThrow(/ownerId/);
  });

  it('fails CLOSED when the context file itself is missing', () => {
    process.env.GARDENER_SESSION_WORKSPACE = mkdtempSync(join(tmpdir(), 'gardener-ctx-empty-'));
    expect(() => loadGardenerContext()).toThrow(new RegExp(CONTEXT_FILENAME));
  });

  it('refuses a non-boolean skipPermissions rather than coercing it', () => {
    seed({ ...FULL, skipPermissions: 'false' });
    expect(() => loadGardenerContext()).toThrow(/skipPermissions/);
  });
});
