# DeepWork Protocol v0

Date: 2026-04-24
Status: Draft

## Goal

Define the minimum shared protocol that allows multiple humans and multiple agents to attach to the same project, read the latest state, and write new collaboration events safely.

This protocol is designed for the current DeepWork wedge:

- project-based collaboration
- section-based intent input
- live synthesis
- attribution
- cross-machine readability

## Design Principles

### 1. Entry Must Be Small

An agent should need only one stable file to discover the rest of the project state.

### 2. State Must Be Readable Without UI

A second machine or a different agent runtime must be able to understand the project by reading files or endpoints, without opening the web app.

### 3. Events And State Must Both Exist

The protocol must support:

- current snapshot for fast loading
- event log for audit and replay

### 4. Attribution Is First-Class

Every contribution must retain its actor identity.

### 5. Merge Is Explicit

The protocol should distinguish:

- proposal
- accepted shared state
- synthesized view

## Protocol Surface

The minimum protocol surface is:

1. project key
2. state snapshot
3. event stream
4. synthesized artifacts
5. actor model

## Directory Convention

Recommended local structure:

```text
.deepwork/
  project.json
  protocol.json
  rooms/
    ROOM_ID/
      snapshot.json
      events.ndjson
      summary.md
      latest.html
```

For project-attached mode, this can later evolve into:

```text
.deepwork/
  project.json
  snapshot.json
  events.ndjson
  outputs/
    latest.html
    latest.md
```

## 1. Project Key

File:

`/.deepwork/project.json`

Purpose:

- give the project a stable identity
- tell any client where the latest state lives
- declare protocol version
- declare available sections and write channels

Example:

```json
{
  "protocolVersion": "0.1",
  "projectId": "deepwork-demo",
  "projectName": "DeepWork",
  "workspaceRoot": ".",
  "stateMode": "hybrid",
  "snapshotPath": ".deepwork/snapshot.json",
  "eventsPath": ".deepwork/events.ndjson",
  "outputs": {
    "html": ".deepwork/outputs/latest.html"
  },
  "stateEndpoint": null,
  "sections": [
    "整体",
    "首屏",
    "价值主张",
    "功能亮点",
    "定价",
    "FAQ",
    "社交证明",
    "CTA"
  ],
  "permissions": {
    "human.canPropose": true,
    "agent.canPropose": true,
    "agent.canSynthesize": false
  }
}
```

### Required Fields

- `protocolVersion`
- `projectId`
- `stateMode`
- `snapshotPath`
- `eventsPath`

### Optional Fields

- `projectName`
- `outputs`
- `stateEndpoint`
- `sections`
- `permissions`

## 2. Snapshot Schema

File:

`snapshot.json`

Purpose:

- provide fast, single-read understanding of the latest shared project state

Example:

```json
{
  "meta": {
    "projectId": "deepwork-demo",
    "snapshotVersion": 1,
    "updatedAt": "2026-04-24T12:00:00.000Z"
  },
  "actors": [
    {
      "id": "user-1",
      "type": "human",
      "name": "Akulee",
      "role": "product"
    },
    {
      "id": "agent-codex-1",
      "type": "agent",
      "name": "Codex",
      "role": "builder"
    }
  ],
  "sections": [
    {
      "id": "hero",
      "name": "首屏",
      "status": "active",
      "summary": "强调 shared intent 与多人协作",
      "updatedAt": "2026-04-24T12:00:00.000Z"
    }
  ],
  "intents": [
    {
      "id": "intent-1",
      "section": "首屏",
      "content": "首屏要直接讲 shared project state",
      "actorId": "user-1",
      "createdAt": "2026-04-24T11:59:00.000Z"
    }
  ],
  "decisions": [
    {
      "id": "decision-1",
      "title": "当前叙事主轴",
      "value": "Harness -> Ecosystem",
      "status": "accepted"
    }
  ],
  "latestSynthesis": {
    "id": "syn-3",
    "round": 3,
    "artifactType": "html",
    "path": ".deepwork/outputs/latest.html",
    "updatedAt": "2026-04-24T12:00:00.000Z"
  }
}
```

### Snapshot Requirements

- must be readable in one file read
- must include current actors
- must include current sections
- must include recent intents or an index to them
- must include latest synthesis reference
- should include accepted decisions

## 3. Event Schema

File:

`events.ndjson`

Purpose:

- append-only project history
- replay support
- auditability
- conflict diagnosis

Example lines:

```json
{"type":"actor_joined","actorId":"user-1","name":"Akulee","role":"product","recordedAt":"2026-04-24T11:55:00.000Z"}
{"type":"intent_created","intentId":"intent-1","actorId":"user-1","section":"首屏","summary":"首屏要直接讲 shared project state","recordedAt":"2026-04-24T11:59:00.000Z"}
{"type":"section_added","section":"治理","actorId":"user-1","recordedAt":"2026-04-24T12:01:00.000Z"}
{"type":"synthesis_completed","synthesisId":"syn-3","round":3,"artifactType":"html","recordedAt":"2026-04-24T12:02:00.000Z"}
```

### Minimum Event Types

- `actor_joined`
- `intent_created`
- `section_added`
- `synthesis_started`
- `synthesis_completed`
- `decision_accepted`
- `conflict_marked`

### Event Rules

- append only
- each event must include `recordedAt`
- each event should include `actorId` when applicable
- each event should be self-describing enough for replay

## 4. Actor Model

Actors are all writers and readers participating in the collaboration state.

### Actor Types

- `human`
- `agent`
- `service`

### Suggested Actor Fields

- `id`
- `type`
- `name`
- `role`
- `capabilities`
- `trustLevel`

Example:

```json
{
  "id": "agent-codex-1",
  "type": "agent",
  "name": "Codex",
  "role": "builder",
  "capabilities": ["read_snapshot", "append_event", "propose_patch"],
  "trustLevel": "scoped"
}
```

## 5. Write Semantics

Agents and humans should not directly mutate shared state arbitrarily.

Preferred flow:

1. read `project.json`
2. load `snapshot.json`
3. inspect recent `events.ndjson`
4. produce a new proposal or intent
5. append an event through the protocol writer
6. let the system refresh snapshot and outputs

This keeps state transitions legible and reduces hidden overwrites.

## 6. Merge Semantics

The protocol should separate three layers:

### Proposal Layer

Raw contributor input.

Examples:

- new intent
- new section
- content suggestion
- design direction

### Shared State Layer

The accepted current understanding of the project.

Examples:

- canonical sections
- accepted decisions
- current summaries

### Artifact Layer

Generated or assembled output.

Examples:

- HTML preview
- design mock
- docs draft
- code patch proposal

This separation is important because many collaboration failures come from confusing proposal with accepted state.

## 7. Attribution Rules

Every generated artifact or summary should preserve source mapping where possible.

At minimum:

- each intent has an actor
- each section summary should reference contributing actors
- each synthesized artifact should expose attribution metadata

For HTML output, this can be represented with:

- `data-source`
- `data-contributors`
- a sidecar attribution map

## 8. Cross-Machine Read Strategy

The protocol should support three deployment modes.

### Mode A: Local Only

- snapshot and events live only on one machine
- useful for solo prototypes

### Mode B: File Sync

- snapshot and events are written locally
- sync via iCloud, Dropbox, Syncthing, Git, or shared disk

Good for:

- simple multi-machine setups
- low infra complexity

### Mode C: Hybrid

- local snapshot for fast reads
- remote endpoint for canonical state and realtime updates

Good for:

- multi-agent collaboration
- multiple IDEs
- cross-organization use

Recommended default for DeepWork:

`hybrid`

## 9. Governance Hooks

Protocol v0 does not need a full governance system, but it should leave room for one.

Suggested optional fields:

- actor trust level
- section owner
- approval required
- write scope
- proposal status

This avoids needing a breaking redesign later.

## 10. Current Mapping To Repo

The current repo already partially implements this protocol:

- room snapshots are written under `.deepwork/rooms/<ROOM_ID>/`
- `snapshot.json` exists in room scope
- `events.ndjson` exists in room scope
- `latest.html` exists after synthesis
- the room UI already works with sections and synthesis rounds

This means Protocol v0 can be introduced incrementally instead of via rewrite.

## Recommended Next Implementation Tasks

1. Add a stable top-level `project.json`
2. Align room snapshot shape with the protocol snapshot shape
3. Add explicit event types for section creation and synthesis start
4. Add `decision` objects into snapshot
5. Add a simple reader utility for external agents
6. Add a writer guard so all writes go through one protocol layer

## Non-Goals For v0

Do not include yet:

- billing
- marketplace ranking
- enterprise auth
- fully autonomous swarm governance

Protocol v0 should only prove:

- one project can expose one shared state
- multiple actors can read it
- multiple actors can append to it
- the system can synthesize artifacts without losing attribution
