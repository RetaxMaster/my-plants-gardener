# Changelog

All notable changes to the Gardener agent are documented here. Written for humans: what changed for the
plant owner and for whoever operates this agent, not a commit dump.

## Unreleased

### Added

- **The Gardener: a new agent for your whole garden.** Where the Plant Doctor looks after one plant, the
  Gardener looks after everything around your plants — the cities and places they live in, the conditions of
  each spot, and which plant belongs where. You talk to it about placement and materials; it reads your
  entire garden and reasons about fit.
- **It reads the whole garden, and reports the gaps.** A single command builds a map of every city, every
  place and its conditions (light, indoor/outdoor, climate control, humidity, temperature range, airflow),
  and the plants living in each place. Where a place's condition is unset, the map says so plainly rather
  than guessing — a gap is reported as a gap.
- **It can look at one plant in depth for placement.** For any plant you own, it loads that plant's profile,
  its species record, its computed care plan, and the Plant Doctor's clinical notes as context — so its
  advice about where the plant should live is grounded in how the plant is actually doing.
- **It proposes; you approve.** The Gardener never changes your garden on its own. Everything it wants to do
  — add a place or a city, edit a spot's conditions, register a new plant, or **move a plant to a better
  place** — arrives as a proposal you approve or decline in the app, rendered as `before → after`. Relocating
  a plant is the Gardener's job (the Doctor cannot do it); diagnosing illness is the Doctor's (the Gardener
  will point you there instead of treating it).
- **A place edit is never silent about its reach.** Because a place is shared by every plant living in it,
  editing that place recomputes the care plan for all of them — and the Gardener is required to tell you how
  many plants a change affects before you approve it.
- **It researches the outside world only when a question needs it.** Choosing a soil mix, a pot, a grow light
  or a humidifier, or judging whether a new species could thrive in one of your places, goes to a research
  subagent that returns concrete, sourced options — while questions your garden already answers are answered
  from your garden, not the web.
- **A generated tool reference, `AGENT-TOOLS.md`.** The Gardener ships a complete, always-current reference
  for its one write tool — every operation it may propose, each field's type and accepted values, and one
  valid example each — generated from the same capability map the API enforces, so it lists exactly what the
  Gardener is allowed to do and nothing more.
- **The Gardener can now leave a free-text note on a plant's timeline**, via the new `note.create`
  operation — naming the plant it targets, since its token has no pinned plant of its own. A quick "moved
  the pot for more light" alongside a relocation, applied only once you approve it.
- **The Gardener can now ask to move a plant to the pantheon or mark it as gifted**, via the new
  `plant.memorialize`/`plant.gift` operations — naming the plant it targets, since its token has no pinned
  plant of its own. Because a memorial can't be undone, the Gardener is instructed to ask you to say so
  explicitly, in words, before it ever sends either request — over and above the approval you'd give it in
  the app anyway. It cannot bring a plant back on its own: reviving one from gifted is something only you
  can do.
- **The garden map now shows a memorialized or gifted plant without a place.** Where it once assumed every
  plant nested under a city and a place, the map now lists these plants separately, under their own
  section, carrying the place and city they last lived in as a reminder rather than a live location.

### Security

- **Reads can never cross into another owner's garden.** Every database read the Gardener issues is anchored
  to your owner id by construction: the query layer refuses to build a read that is not owner-scoped, and
  that refusal is proven by tests rather than trusted by convention. The Gardener's credentials are also
  refused by every endpoint that could change your data — its only write path records a proposal for you to
  approve.
- **Web content and your own labels are treated as untrusted.** Text the research subagents fetch, and the
  names and nicknames in your garden, are handled as data the agent classifies — never as instructions it
  obeys, however they are phrased.
