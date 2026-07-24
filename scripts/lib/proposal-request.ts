import {
  createProposalSchema,
  findOverlappingWriteSet,
  serializedBytes,
  MAX_SERIALIZED_BYTES,
  type CreateProposalBody,
  type ProposalOperation,
} from '@retaxmaster/my-plants-species-schema';

// The gardener validates a proposal against the API's OWN contract from the shared package
// (`createProposalSchema` + the pure `findOverlappingWriteSet` / `serializedBytes` helpers) — never a
// hand-maintained mirror. The server remains the authority and re-validates everything in strict mode;
// running the SAME schema here is defence in depth whose value is an immediate, actionable error instead of
// a 400 round trip, and — because it is the SAME schema, not a copy — the agent-side and server-side
// vocabularies can never drift.
//
// What stays LOCAL, exactly as in the doctor:
//   1. `parseProposalInput` separates "malformed JSON" from "valid JSON, invalid proposal".
//   2. A whitespace-only summary is rejected with a purpose-built message (stricter than the server's
//      `.min(1)`, which a single space passes) — the summary is the consent text the owner reads.
//   3. Actionable, agent-facing error sentences and the request shape the CLI posts.
export type { ProposalOperation, CreateProposalBody };

export interface ProposalRequest {
  path: string;
  body: CreateProposalBody;
}

function fail(msg: string): never {
  throw new Error(msg);
}

// Parse the operator-supplied JSON document. Kept separate from validation so the CLI can report
// "malformed JSON" differently from "valid JSON, invalid proposal".
export function parseProposalInput(raw: string): { summary: unknown; operations: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The proposal input is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The proposal input must be a JSON object with "summary" and "operations".');
  }
  const rec = parsed as Record<string, unknown>;
  return { summary: rec.summary, operations: rec.operations };
}

// Build the request. The body carries `summary` + `operations` and NOTHING else: ownerId / sessionId / runId
// are derived by the server from the scoped TOKEN, and sending them would be an unknown top-level property
// and a 400. The path is OWNER-scoped — there is no plant in it, because a gardener is pinned to an owner,
// not a plant. We hand the schema ONLY those two keys, so anything a caller smuggles in is dropped before
// validation rather than tripping the schema's `.strict()`.
export function buildProposalRequest(
  sessionId: string,
  input: { summary: unknown; operations: unknown },
): ProposalRequest {
  // Deliberately STRICTER than the server's `.min(1)`, and checked BEFORE safeParse so it wins with its own
  // message: a whitespace-only summary passes `.min(1)` but is useless as consent text, and the summary is
  // what the owner reads. Being stricter locally can never cause a surprise 400 — only the reverse can.
  if (typeof input.summary === 'string' && input.summary.trim().length === 0) {
    fail('"summary" is required: one short sentence describing what you want to change.');
  }

  const result = createProposalSchema.safeParse({ summary: input.summary, operations: input.operations });
  if (!result.success) {
    // The agent also has AGENT-TOOLS.md, so the raw Zod message + path is actionable enough.
    const issue = result.error.issues[0];
    fail(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }

  const { summary, operations } = result.data;

  // Two operations whose write-sets intersect are rejected: the stored snapshot must have exactly one
  // well-defined "before" per target, and an overlapping pair would make the owner's banner dishonest.
  // `findOverlappingWriteSet` is the API's own pure helper — key-for-key the same rule.
  const overlap = findOverlappingWriteSet(operations);
  if (overlap !== null) {
    fail(`Two operations overlap on "${overlap}". Express the intended end state with ONE operation per target.`);
  }

  // Bound `operations` in SERIALIZED BYTES — the SAME unit the API bounds: a control character costs six
  // bytes and an accent more than one, so a payload that passes every per-field length cap can still exceed
  // the limit through the ordinary public builder.
  const bytes = serializedBytes(operations);
  if (bytes > MAX_SERIALIZED_BYTES) {
    fail(
      `The proposal's operations are ${bytes} bytes serialized, over the ${MAX_SERIALIZED_BYTES}-byte limit. ` +
        'Note that accented characters cost more than one byte and control characters cost six. ' +
        'Shorten the observations or split it across turns.',
    );
  }

  return { path: `/gardener/sessions/${sessionId}/proposals`, body: { summary, operations } };
}
