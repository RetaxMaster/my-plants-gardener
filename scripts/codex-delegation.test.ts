import { describe, it } from 'vitest';

import { assertTypedDelegationContract } from '@retaxmaster/my-plants-species-schema/agent-kit/codex-parity/repo-checks';

// The real-repo assertion, delegated to the shared, parameterized check (the fixture suite lives once in the
// shared package). It asserts the operator guide documents a valid typed spawn for EVERY generated role —
// task_name present and distinct from the role, agent_type naming an existing .codex/agents/<role>.toml, and
// fork_turns="none" — across both CLAUDE.md and AGENTS.md. The `describe` title carries this repo's identity.
describe('the real gardener repo delegation contract', () => {
  it('documents a valid typed spawn for every generated role', () => {
    assertTypedDelegationContract('the real gardener repo', process.cwd());
  });
});
