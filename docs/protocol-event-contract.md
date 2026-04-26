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

`actorId`, `participantId`, `participantName`, and `role` should be included whenever the writer knows them. Agent writers should prefer stable IDs such as `agent:openclaw:<machine-name>` or `agent:claude:<machine-name>` rather than anonymous labels. The external writer normalizes known actor identity by mirroring a provided `actorId` or `participantId` onto both fields, so downstream readers can use either protocol-native `actorId` or legacy room-oriented `participantId` without losing attribution.

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

Patch events must include at least one of `patchId`, `linkedEventIds`, `linkedIntents`, `affectedSections`, or `affectedFiles`. This guard prevents vague agent messages from polluting the shared state. Use `linkedEventIds` to point to protocol events such as a prior `patch.proposed`; use `linkedIntents` only for intent IDs from room state or `intent.created` events. `patchId` is an optional stable alias for the patch proposal or closure target.

A proposed patch stops being open when a later `patch.applied` or `decision.accepted` event links back to its event ID through `linkedEventIds` or `decisionId`. If the proposal carries a semantic `patchId`, that `patchId` is accepted as an alias for the generated event `id`; closing events may reference either value. This keeps `snapshot.proposedPatches` and the `review-proposed-patches` recommended action focused on still-unreviewed governance work instead of every patch ever proposed.

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

For auditability, an applied patch should ideally link to a prior proposed patch or intent through `patchId`, `linkedEventIds`, or `linkedIntents`. A common closure shape is `{ "type": "patch.applied", "patchId": "<snapshot.proposedPatches[].id>", "affectedFiles": [...] }`. If none exists, `reason` and `affectedFiles` become mandatory in practice even if the current endpoint only enforces `summary` plus one semantic linkage field.

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

When a decision resolves a `conflict.detected` event, its `decisionId` must be a non-empty string exactly matching the conflict's `conflictId`. The external writer validates `decisionId` and `title` when they are provided, so an empty string cannot accidentally create an uncloseable or misleading governance event.

External agent writers do not need to invent event IDs. `POST /api/workspace/events` assigns a stable `id` to each accepted semantic event when one is not provided. Internal writers that use `syncRoomStateToWorkspace()` follow the same identity rule, so room events created by joins, intents, synthesis, artifacts, and conflicts can also be linked from snapshots and recommended actions. For `conflict.detected`, both writer paths assign `conflictId` from that event ID when `conflictId` is omitted, so every recorded conflict has a closeable identity. Agents may still provide their own deterministic `conflictId` when they need cross-run reproducibility.

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

The system should expose conflicts instead of hiding them in generated artifacts. Conflict events are governance hooks. If a synthesis-origin conflict only has a natural-language description and cannot yet identify affected sections or actors, writers should still include `sections: []` and `actorIds: []` to keep the event shape consistent with the external writer contract.

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

The reader response also includes top-level `actionCapabilities`, a small machine-readable registry for `recommendedNextActions[].suggestedAction`. This keeps verbs such as `write_event`, `run_synthesis`, `invite_actor`, and `review_patch` from becoming private UI conventions. A continuation agent should read the selected action, then look up its capability to learn whether there is a writer endpoint, which event types normally close the action, and whether human review is required before changing visible shared state.

The reader currently loads the latest 100 parseable lines from `events.ndjson` for governance derivation. This keeps normal hackathon and dual-machine tests from losing open conflicts or proposed patches after a short burst of joins, intents, artifact updates, and decisions, while still bounding reader cost. Until DeepWork adds durable indexed governance state, long-running rooms should keep closure events close to the proposal or conflict they close, or periodically summarize/archive older resolved events.

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

`snapshot.recommendedNextActions` is intentionally structured rather than plain text. Each action includes `id`, `priority`, `summary`, `reason`, optional `suggestedAction`, and optional protocol hints such as `eventTypes`, `affectedSections`, `affectedFiles`, `linkedEventIds`, `actorScope`, `closeWith`, and `governancePolicy`. This lets another agent distinguish urgent governance blockers from lower-priority demo completeness suggestions, and lets it choose the correct next event to write without parsing prose. For `resolve-open-conflicts`, `closeWith` points to `decision.accepted.decisionId` values that can close the currently unresolved conflicts. For `review-proposed-patches`, `linkedEventIds` includes both generated proposal event IDs and semantic `patchId` aliases when present, and `closeWith` points to `patch.applied.linkedEventIds` values that can close those proposals. For `invite-missing-roles`, `actorScope.missingActorRoles` and `actorScope.presentActorRoles` expose role IDs as actor coverage, not section names, so a continuation agent can invite or simulate absent perspectives without misreading roles as artifact areas. For stale artifacts, `resynthesize-after-round-*` now also carries `governancePolicy.rule: "human_review_required"`, because re-synthesis changes the visible shared artifact even though the final write path remains the synthesis endpoint rather than the external event writer.

`governancePolicy` is the permission and review surface for recommended actions. It records whether an action may be handled by an agent event writer or whether human/team review is required before closure. Current conflict, patch-review, and stale-synthesis actions use `rule: "human_review_required"` because resolving incompatible intent, accepting a patch, or regenerating the shared artifact changes project state. Agents may still propose options, draft events, or surface the close path, but they should not treat `closeWith` or `suggestedAction` as permission to auto-close governance work unless the policy and actor trust level allow it.

For internal room events, the same identity rule applies to semantic events written through `syncRoomStateToWorkspace()`. A reader should therefore expect `synthesis.completed`, `artifact.updated`, and room-flow `intent.created` events to carry stable IDs just like events written by `POST /api/workspace/events`. Internal `patch.proposed` and `patch.applied` room-state events should preserve `affectedSections`, `affectedFiles`, `linkedEventIds`, `linkedIntents`, optional `patchId`, and `reason`, so a patch proposed or applied inside the app has the same governance context as one written through the external writer endpoint. This keeps `latestArtifacts[].id`, `decisions[].id`, `unresolvedConflicts[].id`, and `recommendedNextActions[].linkedEventIds` in the same identity space instead of mixing protocol IDs with timestamps.

## Reader Resilience

`GET /api/workspace?roomId=<ROOM_ID>` should treat the event stream as append-only operational data, not as a single fragile JSON blob. If one recent `events.ndjson` line is malformed because an append was interrupted or a local file was hand-edited during a test, the reader should skip that line and continue returning the parseable recent events, snapshot, project key, and recommended actions.

This is not permission to tolerate invalid writers. Writers should still emit one valid JSON object per line, and validation failures should happen at write time. Reader resilience exists so a dual-machine test does not lose the whole shared planning surface because of one bad cache line.

## Open Questions

The current protocol does not yet model rejection or supersession as first-class event types, although patch status already includes `rejected` and `superseded`. A future version should decide whether status changes are represented by new events or by `decision.accepted` records that point to prior patches.

The current external writer is local-file backed. For a true cross-machine test, both agents need either a shared filesystem or a remote canonical writer. Until that exists, Supabase room state and `GET /api/workspace` are better for shared reading, while local `.deepwork` remains a cache/export and local protocol proving ground.
