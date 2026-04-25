# DeepWork Protocol Dual-Machine Test

Date: 2026-04-25
Status: Draft v0.1 test plan

## Purpose

This test verifies that DeepWork is not just a single-browser collaboration demo, but an agent-era shared project state protocol. The goal is to prove that two different machines or agent clients, such as Claude on one machine and OpenClaw on another, can attach to the same project, understand the same semantic state, exchange intent and patch records, and converge on the same artifact without manually copying chat transcripts.

The landing-page collaboration demo remains the wedge. The actual claim being tested is deeper: project state, user intent, semantic events, attribution, and governance can become a shared readable layer for humans and agents working on one project.

## Core Hypothesis

If both machines can read the same project key and canonical workspace state, then one agent can turn a user requirement into a structured event, another agent can understand that event and propose or apply a change, and both machines can verify convergence through the same snapshot and recent event stream.

A successful test should not depend on either agent reading the other agent's chat transcript. The durable coordination surface must be `project.json`, `snapshot.json`, `events.ndjson`, and the workspace reader API.

## Prerequisites

Both machines should have the same Git commit checked out. If the machines do not share a synchronized filesystem, do not rely on local `.deepwork` files alone as the canonical source. Use the same Supabase project and the same deployed or locally reachable HTTP app endpoint so both machines can resolve the same room state through `GET /api/workspace?roomId=<ROOM_ID>`.

Required environment variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` if the server client requires it, and `ANTHROPIC_API_KEY` for synthesis. If synthesis is not being tested, the protocol test can still run through `intent.created`, `patch.proposed`, and snapshot convergence.

## Test Roles

Machine A is the human-facing requirement capture agent. In the first test this can be Claude. Its responsibility is to receive a natural-language requirement, convert it into a semantic project event, and verify that the event appears in the shared state.

Machine B is the implementation or continuation agent. In the first test this can be OpenClaw. Its responsibility is to read the project key and workspace context, identify the new requirement without seeing Machine A's chat, and produce a semantic patch or artifact record that Machine A can later understand.

## Canonical State Contract

Both machines must agree on these fields before the test starts: `projectId` is `deepwork`; `protocolVersion` is `0.1`; `currentRoomId` is the test room; `eventsPath` points to the append-only semantic event stream; `currentSnapshotPath` points to the latest room snapshot; and `supportedEventTypes` includes at minimum `intent.created`, `patch.proposed`, `patch.applied`, `artifact.updated`, `synthesis.started`, and `synthesis.completed`.

If any of those fields differ between machines, the test has not established a shared project state and should stop before evaluating agent behavior.

## Step 1: Create Or Select A Test Room

`GET /api/workspace?roomId=<ROOM_ID>` now returns a protocol-level `DeepWorkSnapshot`, not the internal room database shape. Agents should read `snapshot.actors`, `snapshot.sections`, `snapshot.recentIntents`, `snapshot.decisions`, `snapshot.proposedPatches`, `snapshot.latestArtifacts`, `snapshot.unresolvedConflicts`, and `snapshot.recommendedNextActions`. The response also includes `projectKey`, `recentEvents`, and `source`.

Start the app and create a room, or choose an existing demo room. Run the demo populate action or add at least one real participant and one intent so `.deepwork/project.json` and `.deepwork/rooms/<ROOM_ID>/snapshot.json` exist.

Machine A should call `GET /api/workspace?roomId=<ROOM_ID>` and record the returned `projectKey.updatedAt`, `snapshot.meta.updatedAt`, `snapshot.actors.length`, `snapshot.recentIntents.length`, `snapshot.sections.length`, and source field. Machine B should call the same endpoint and confirm it sees the same room ID and semantically equivalent counts.

Success condition: both machines can independently read the same room state through the workspace reader API.

## Step 2: Machine A Writes A New Requirement As Intent

The human gives Machine A a requirement such as: “Reframe the demo so the first screen says DeepWork is a shared project state and intent protocol, not only a landing-page generator.”

Machine A must not leave this only in chat. It should submit or cause the app to submit an `intent.created` event associated with the room. In the current app, the safest path is the existing `/api/intents` route with a valid participant. If no valid participant exists, create or join one through the normal room flow first.

Expected semantic event shape in `events.ndjson`:

```json
{"type":"intent.created","projectId":"deepwork","roomId":"<ROOM_ID>","summary":"Reframe the demo so DeepWork is a shared project state and intent protocol, not only a landing-page generator.","section":"产品定位","content":"Reframe the demo so DeepWork is a shared project state and intent protocol, not only a landing-page generator."}
```

Success condition: Machine A can refresh `GET /api/workspace?roomId=<ROOM_ID>` and see the new intent reflected in the snapshot or recent event stream.

## Step 3: Machine B Reads Without Transcript

Machine B must not be given Machine A's chat. It should read only the shared project state by using `GET /api/workspace?roomId=<ROOM_ID>` and, where available, the recent `events.ndjson` entries.

Machine B should answer three questions from shared state alone: what changed, which section or artifact is affected, and what change it proposes next. If Machine B cannot identify the new requirement without chat context, the snapshot/event shape is not yet agent-readable enough.

Success condition: Machine B identifies the new positioning requirement and links its proposed action to that requirement.

## Step 4: Machine B Records A Semantic Patch

Machine B should propose a small patch, ideally a documentation or copy change, and record it as `patch.proposed` before or alongside applying it. The semantic record should include `summary`, `reason`, `linkedIntents` if an intent ID is available, `affectedSections`, `affectedFiles`, and `status`.

Current code provides a first-class writer path: `POST /api/workspace/events`. Use it for non-destructive semantic records from external agents. Example request:

```json
{
  "roomId": "<ROOM_ID>",
  "event": {
    "type": "patch.proposed",
    "summary": "Reframe homepage copy around shared project state and intent protocol.",
    "reason": "The latest intent changes the product narrative from landing-page demo to agent-readable collaboration layer.",
    "linkedIntents": ["<INTENT_ID>"],
    "affectedSections": ["产品定位", "首页首屏"],
    "affectedFiles": ["src/app/page.tsx", "README.md"],
    "status": "proposed"
  }
}
```

The endpoint validates the event type and required semantic fields, appends the event to `events.ndjson`, refreshes `project.json` / `rooms/index.json` metadata, and returns the recorded event. Patch events must include a non-empty `summary` plus at least one of `linkedIntents`, `affectedSections`, or `affectedFiles`; this prevents agents from writing vague patch records that cannot guide another machine. The important product behavior is that the patch meaning becomes a structured event, not only a Git diff or chat message.

Success condition: Machine A can read the patch record and explain what Machine B proposed and why without reading Machine B's chat transcript.

## Step 5: Optional Synthesis And Artifact Update

Trigger synthesis if API keys are configured. A successful synthesis should write `synthesis.started`, `synthesis.completed`, and `artifact.updated` events. The `artifact.updated` event should include the HTML artifact path and attribution map.

Success condition: both machines can discover the latest artifact from shared project state and agree on its path, round, and attribution map.

## Step 6: Governance Action Visibility

After synthesis or after writing a `conflict.detected` / `patch.proposed` event, both machines should inspect `snapshot.recommendedNextActions` from `GET /api/workspace?roomId=<ROOM_ID>`. The field is not UI copy; it is an agent-readable planning surface. Each action should include a stable `id`, `priority`, `summary`, `reason`, `suggestedAction`, and relevant protocol hints such as `eventTypes`, `affectedSections`, `affectedFiles`, or `linkedEventIds`.

For a conflict test, Machine A or the synthesis flow should record a `conflict.detected` event with a stable `conflictId`. Both machines should then verify that `recommendedNextActions` contains a `p0` action with `id: "resolve-open-conflicts"`, `suggestedAction: "write_event"`, and `eventTypes: ["decision.accepted"]`. Machine B should be able to infer the next governance move from this structured action without reading Machine A's chat.

To close the loop, Machine B should record a `decision.accepted` event whose `decisionId` exactly matches the conflict's `conflictId`, and whose `value` states the accepted resolution. Both machines should refresh `GET /api/workspace?roomId=<ROOM_ID>` and verify that the resolved conflict is absent from `snapshot.unresolvedConflicts` and is no longer counted by the `resolve-open-conflicts` action. If several conflicts exist, the action may remain but its count and `linkedEventIds` should only refer to still-unresolved conflicts.

For a patch test, Machine B should record a `patch.proposed` event. Both machines should then verify that `recommendedNextActions` contains a `p1` action with `id: "review-proposed-patches"`, `suggestedAction: "review_patch"`, and links back to the proposed patch through `linkedEventIds` or affected files/sections.

Success condition: both machines sort the same action list by priority and independently choose the same next move. A passing result proves that DeepWork can expose governance work as shared protocol state, not as hidden model reasoning or a private chat instruction.

## Step 7: Convergence Check

Both machines should independently refresh the workspace reader endpoint and compare: room ID, snapshot update time, total recent intents, total sections, latest artifact if present, latest synthesis round if discoverable, the most recent semantic event type, and the highest-priority `recommendedNextActions` item. If local `.deepwork` files are used, compare the same fields from `project.json`, `snapshot.json`, and `events.ndjson`.

Success condition: both machines report the same project state summary and can describe the latest requirement, patch, artifact, and next governance action in compatible language.

## Failure Modes To Watch

The most important failure is local-file divergence: Machine A writes `.deepwork` locally but Machine B reads a different local `.deepwork`, so both agents believe they are correct while the project state has forked. For the first test, prefer an HTTP reader or remote canonical database state.

A second failure is chat-only coordination. If Machine B can act only because the operator pasted Machine A's chat into it, DeepWork has not proven the protocol.

A third failure is raw snapshots without semantics. If Machine B sees rows but cannot infer why they matter, the snapshot needs summaries, accepted decisions, patch records, and recommended next actions.

A fourth failure is patches without attribution. If a file changes without `patch.proposed`, `patch.applied`, or `artifact.updated`, other agents can see that something changed but not why it changed.

A fifth failure is action asymmetry. If one machine sees `recommendedNextActions` but another machine cannot reproduce the same priority order or cannot map the action to a valid next event type, then the project state has not yet become a dependable planning surface for agents.

## Test Result Template

Record each run in `work-log.md` with: room ID, commit SHA, machines or agent clients used, whether both machines read the same project key, whether Machine B understood Machine A's new intent without chat transcript, whether a semantic patch or artifact event was recorded, whether snapshots converged, whether both machines saw the same highest-priority recommended action, what failed, and what protocol field should be added next.
