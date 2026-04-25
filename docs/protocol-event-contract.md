# DeepWork Protocol v0.1 Semantic Event Contract

Date: 2026-04-25
Status: Implementation-aligned draft

## Purpose

This document pins the semantic event contract currently implied by `src/types/deepwork-protocol.ts`, `src/lib/room-state.ts`, and `POST /api/workspace/events`. It exists so Claude, OpenClaw, browser clients, and future agents can write collaboration state in the same language instead of leaving important meaning in chat transcripts or raw file diffs.

DeepWork's protocol claim is that chat is only the interaction layer. The durable collaboration layer is an append-only stream of semantic events plus a fast snapshot derived from those events and canonical room state.

## Contract Principles

Every event should be understandable without the original conversation. A later agent should be able to answer what changed, why it changed, who or what caused it, what project section it affects, and whether it is merely proposed or already accepted/applied.

Events are append-only. Do not edit old lines in `events.ndjson` to change history. Instead, write a new event such as `decision.accepted`, `patch.applied`, `patch.rejected` in a future protocol, or another `summary.updated` event.

Raw implementation details are not enough. A Git diff may show that `src/app/page.tsx` changed, but a `patch.proposed` or `patch.applied` event must explain the product meaning of that change.

## Required Base Fields

All semantic events should include these fields after validation or normalization:

```json
{
  "type": "intent.created",
  "projectId": "deepwork",
  "roomId": "ROOM123",
  "summary": "Short human-readable meaning of the event.",
  "recordedAt": "2026-04-25T00:00:00.000Z"
}
```

`actorId`, `participantId`, `participantName`, and `role` should be included whenever the writer knows them. Agent writers should prefer stable IDs such as `agent:openclaw:<machine-name>` or `agent:claude:<machine-name>` rather than anonymous labels.

## Supported Event Types

The current TypeScript contract supports: `actor.joined`, `intent.created`, `section.created`, `decision.accepted`, `patch.proposed`, `patch.applied`, `artifact.updated`, `synthesis.started`, `synthesis.completed`, `conflict.detected`, and `summary.updated`.

The external writer endpoint currently accepts only non-destructive or explicitly semantic records: `intent.created`, `patch.proposed`, `patch.applied`, `artifact.updated`, `decision.accepted`, `summary.updated`, and `conflict.detected`. Synthesis events should be written by the synthesis flow, not by arbitrary external agents.

## Event Shapes

### `intent.created`

Use this when a human or agent introduces a new requirement, idea, constraint, concern, or desired direction.

```json
{
  "type": "intent.created",
  "summary": "Reframe DeepWork as a shared project state and intent protocol.",
  "section": "产品定位",
  "content": "The first screen should make clear this is not only a landing-page generator."
}
```

Required semantic fields are `summary`, `section`, and `content`.

### `patch.proposed`

Use this before or alongside a code, content, schema, or documentation change that another actor should understand and review.

```json
{
  "type": "patch.proposed",
  "summary": "Reframe homepage copy around shared project state.",
  "reason": "The latest accepted direction moves DeepWork from demo tool to collaboration protocol.",
  "linkedIntents": ["intent_123"],
  "affectedSections": ["产品定位", "首页首屏"],
  "affectedFiles": ["src/app/page.tsx", "README.md"],
  "status": "proposed"
}
```

Patch events must include at least one of `linkedIntents`, `affectedSections`, or `affectedFiles`. This guard prevents vague agent messages from polluting the shared state.

### `patch.applied`

Use this when a proposed or directly applied change has actually been made in the project folder.

```json
{
  "type": "patch.applied",
  "summary": "Added protocol event contract documentation.",
  "reason": "External agents need exact event shapes before the dual-machine test.",
  "affectedSections": ["协议", "双机器协作"],
  "affectedFiles": ["docs/protocol-event-contract.md"],
  "status": "applied"
}
```

For auditability, an applied patch should ideally link to a prior proposed patch or intent. If none exists, `reason` and `affectedFiles` become mandatory in practice even if the current endpoint only enforces `summary` plus one semantic linkage field.

### `artifact.updated`

Use this when a visible output changes, such as generated HTML, a Markdown brief, a code artifact, or a design document.

```json
{
  "type": "artifact.updated",
  "summary": "Latest landing-page artifact generated for round 2.",
  "artifactType": "html",
  "artifactPath": ".deepwork/rooms/ROOM123/latest.html",
  "attributionMap": {
    "hero": "participant_designer",
    "pricing": "participant_product"
  }
}
```

`artifactType` should be one of `html`, `markdown`, `doc`, `code`, or `other`.

### `decision.accepted`

Use this when a direction becomes shared state rather than merely a suggestion.

```json
{
  "type": "decision.accepted",
  "summary": "Positioning decision accepted.",
  "title": "Product positioning",
  "value": "DeepWork is a shared project state and intent protocol for human-agent collaboration."
}
```

A later agent should treat accepted decisions as stronger than raw intents unless a newer decision supersedes them.

### `conflict.detected`

Use this when two or more requirements cannot be merged silently.

```json
{
  "type": "conflict.detected",
  "summary": "Homepage should be both minimal and documentation-heavy.",
  "sections": ["首页首屏", "技术说明"],
  "actorIds": ["participant_designer", "participant_developer"]
}
```

The system should expose conflicts instead of hiding them in generated artifacts. Conflict events are governance hooks.

### `summary.updated`

Use this when a section or project summary has been refreshed for faster agent reading.

```json
{
  "type": "summary.updated",
  "summary": "产品定位 now emphasizes protocol, shared state, attribution, and cross-agent readability.",
  "section": "产品定位"
}
```

## Writer Behavior For External Agents

External agents should write through `POST /api/workspace/events` when possible. A valid request is:

```json
{
  "roomId": "ROOM123",
  "event": {
    "type": "patch.proposed",
    "summary": "Reframe homepage copy around shared project state.",
    "reason": "A new positioning intent changed the product narrative.",
    "affectedSections": ["产品定位"],
    "affectedFiles": ["src/app/page.tsx"],
    "status": "proposed"
  }
}
```

The endpoint normalizes `projectId`, `roomId`, and `recordedAt`, appends one JSON line to `.deepwork/rooms/<ROOM_ID>/events.ndjson`, and refreshes project metadata. It does not currently mutate Supabase rows for external events, so agents should treat it as a semantic event writer rather than a replacement for the existing room UI or synthesis APIs.

## Snapshot Implications

`GET /api/workspace?roomId=<ROOM_ID>` returns a protocol-level snapshot built from room state plus recent semantic events. Recent patch events appear in `snapshot.proposedPatches`. Accepted decisions appear in `snapshot.decisions`. Artifact events appear in `snapshot.latestArtifacts`. Conflict events appear in `snapshot.unresolvedConflicts` only while they are still unresolved.

Conflict resolution is identity-based. A `conflict.detected` event should include a stable `conflictId` whenever possible. To mark that conflict resolved, write a `decision.accepted` event whose `decisionId` equals the conflict's `conflictId`, and whose `value` records the accepted human or team decision. After that event appears in the recent event stream, the conflict should disappear from `snapshot.unresolvedConflicts` and the `resolve-open-conflicts` recommended action should no longer count it.

Example resolution event:

```json
{
  "type": "decision.accepted",
  "summary": "Resolved homepage density conflict.",
  "decisionId": "synth-r2-c0",
  "title": "Homepage density",
  "value": "Use a minimal hero section with one expandable technical details block below the fold."
}
```

`snapshot.recommendedNextActions` is intentionally structured rather than plain text. Each action includes `id`, `priority`, `summary`, `reason`, optional `suggestedAction`, and optional protocol hints such as `eventTypes`, `affectedSections`, `affectedFiles`, and `linkedEventIds`. This lets another agent distinguish urgent governance blockers from lower-priority demo completeness suggestions, and lets it choose the correct next event to write without parsing prose.

This means the first dual-machine test should verify not only that `events.ndjson` receives a line, but also that the workspace reader translates that line into the correct snapshot field and the correct structured recommended action when action is needed.

## Open Questions

The current protocol does not yet model rejection or supersession as first-class event types, although patch status already includes `rejected` and `superseded`. A future version should decide whether status changes are represented by new events or by `decision.accepted` records that point to prior patches.

The current external writer is local-file backed. For a true cross-machine test, both agents need either a shared filesystem or a remote canonical writer. Until that exists, Supabase room state and `GET /api/workspace` are better for shared reading, while local `.deepwork` remains a cache/export and local protocol proving ground.
