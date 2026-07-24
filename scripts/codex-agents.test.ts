import { describe, it } from 'vitest';

import { assertCodexAgentsMatchSource } from '@retaxmaster/my-plants-species-schema/agent-kit/codex-parity/repo-checks';

// The real-repo assertion, delegated to the shared, parameterized check (the fixture suite lives once in the
// shared package). The `describe` title carries this repo's identity — the shared assertion does not
// interpolate `label` into its own failure messages, so this title is the ONLY place a red run can be
// attributed to this repo. REPO_ROOT is process.cwd(): vitest runs this file with cwd = the repo root.
describe('the real gardener repo', () => {
  it('has .codex/agents in sync with its source roles', () => {
    assertCodexAgentsMatchSource('the real gardener repo', process.cwd());
  });
});
