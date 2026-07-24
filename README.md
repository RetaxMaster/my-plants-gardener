# my-plants-gardener

A **Claude/Codex-driven gardener agent** for one owner's WHOLE garden. Opened from MyPlants, it lets the
owner talk about where their plants live and what they live in, then reads the whole garden — cities,
places and their conditions, every plant, each plant's profile and computed care plan, its species record,
and the doctor's clinical records as context — reasons about **placement and materials**, researches soil,
pots, lights and species fit when a question genuinely needs the outside world, and **proposes** changes the
owner approves: new places and cities, edited conditions, relocations, new plants.

This is not a service you "start". It is operated by an agent — Claude Code, or Codex (see "Codex parity"
below): the `CLAUDE.md`/`AGENTS.md` in this repo is the operator's playbook, driving four subagents (in
`.claude/agents/`) and a set of deterministic tools. It runs on the **same embedded agents-realtime engine**
as the Knowledge Engine and the Plant Doctor, registered as a third cwd/role, with a **per-session isolated
workspace** and a per-session scoped API token (both provided by the platform — Spec 4).

## Where it fits

```
my-plants-species-schema   the shared record contract (dependency; imported, never forked)
        │
        ├── my-plants-knowledge-engine   curates species records → DB      (sibling agent workspace)
        ├── my-plants-plant-doctor        diagnoses ONE plant               (sibling agent workspace)
        ├── my-plants-api                 the deterministic care engine + endpoints this gardener wraps
        ├── my-plants-web                 the frontend that opens the /gardener view (Spec 4)
        │
        └── my-plants-gardener            ← you are here (administers the WHOLE garden)
```

## Requirements
- Node.js 20+
- Access to the shared MariaDB the API uses (reads only, owner-anchored)
- The `@retaxmaster/my-plants-species-schema` package (installed as a packed tarball)
- The embedded engine + a per-session workspace + `gardener-context.json` (provided by the platform)

## Install & configure

```bash
npm install
cp .env.example .env   # then edit DB_* to point at your MariaDB
```

| Var | Meaning |
|---|---|
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MariaDB connection for the read tools (separate vars, never a connection string) |
| `GARDENER_SESSION_WORKSPACE` | **runtime-injected** absolute path to the session scratch dir (holds `gardener-context.json`, the OWNER pin + scoped token) |

## Tools

```bash
npm run dump-garden    # DB-direct garden map: cities → places (+ their gaps) → plants (read)
npm run read-plant     # one owned plant in depth: profile, species, care plan, clinical records (read)
npm run propose        # record a WRITE PROPOSAL the owner approves in the app (the ONLY write path)
npm test               # agents:check && tools:check && typecheck && vitest run (the full gate)
npm run typecheck      # tsc --noEmit on its own — also runs as a step of `npm test`
```

### The write model: proposals, not writes

The gardener has **no** direct write access. Its scoped token is refused by every domain-mutating endpoint;
the single write endpoint it can reach records a **proposal** — a structured list of operations plus a
summary — which the owner approves or declines in the app. The API, never the agent, performs the write.

`npm run propose` builds and submits that proposal against the owner-scoped `/gardener/sessions/:id/proposals`
endpoint — there is no plant in the path, because a gardener is pinned to an OWNER, not a plant. The response
tells the agent the proposal is `PENDING`, which is its signal to end the turn: no agent run ever waits on a
human. A declined, expired or failed proposal is reported back on the next turn in an
`<agents-rt:system-message>` block.

The proposal operations are defined by the `@retaxmaster/my-plants-species-schema` union (imported, never
mirrored). The gardener may propose exactly the operations the **capability map** grants scope `gardener` —
including `place.create`/`place.update`, `city.create`/`city.update`, `plant.create`, and `plant.update`
carrying `placeId` (relocation is the gardener's exclusive grant) — and never `progress.delete` or the
clinical-record operations. Their fields, types and one validated JSON example each live in the generated
[`AGENT-TOOLS.md`](./AGENT-TOOLS.md) — emitted from that map by `npm run tools:generate` and kept in sync by
`tools:check` (wired into `npm test`); the agent reads it before proposing.

An opt-in per-session **Dangerously Skip Permissions** mode auto-applies proposals; the agent can read that
setting but has no path to change it, and every auto-applied proposal is still recorded with its structured
operations for audit.

Reads go **direct to the DB** (fast, cannot corrupt) and are **owner-anchored by construction**: every query
carries the owner predicate, so a cross-owner read is unreachable, not merely discouraged. The one write path
goes **through the API's proposal mediator**, so validation, the owner's approval, and recompute all happen
server-side. Every tool is pinned to ONE owner via the injected `gardener-context.json`. Full workflow:
`CLAUDE.md`.

## How it is developed
Standalone repo, committed to `main`, pushed to GitHub. Registering it as a workspace **submodule** and wiring
the platform (engine role, per-session workspace, scoped token, the `/gardener` web view) is **Spec 4**. This
repo owns only its persona, tools, subagents, and tests.

## Codex parity (subagents on both Claude and Codex)

The four subagents are authored **once** as `.claude/agents/*.md` (the source of truth) and **generated** to
`.codex/agents/*.toml` via `npm run agents:generate`. Drift is caught by `npm test` (which runs `agents:check`
first), so the Codex projection can never silently diverge from the Claude source. Never hand-edit a `.toml`.

- `.codex/config.toml` enables Codex's `multi_agent_v2` (typed `spawn_agent`/`wait_agent`).
- Codex loads that config + the roles **only if this checkout is TRUSTED**: add
  `[projects."<abs path to this checkout>"] trust_level = "trusted"` to `~/.codex/config.toml`
  (or `$CODEX_HOME`). Without it, Codex ignores the repo's `.codex/`.
- On Codex the operator delegates with the typed spawn contract documented in `CLAUDE.md`/`AGENTS.md`
  (`agent_type` selects the role; `task_name` is a unique execution label; `fork_turns="none"`).

`npm run agents:check-schema` is a **billable** live probe (never part of `npm test`) that certifies
`spawn_agent` is exposed AND this repo's four roles actually load; it is run at each deploy to (re)write the
per-engine verification record (`codex-roles-verified.json`, default-deny).

## `execa` / `smol-toml` / `yaml` / `mysql2` are NOT unused

Nothing in this repo's own source imports `execa`, `smol-toml` or `yaml` — a plain grep will make them look
orphaned. They are not: `@retaxmaster/my-plants-species-schema` declares all three (plus `mysql2`) as
**optional peer dependencies** for its `agent-kit`, and npm does **not** install a dependency's optional peers
on its own — the consuming repo has to carry them itself, or the kit's own imports fail to resolve at run
time. Removing any of them breaks `agents:check` / `agents:generate` and the `agents:check-schema` probe the
production deploy's Codex re-verification window runs. Do not delete them just because nothing here imports
them directly.
