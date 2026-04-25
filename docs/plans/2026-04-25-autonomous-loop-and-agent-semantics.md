# DeepWork Autonomous Loop And Agent Semantics

Date: 2026-04-25
Status: Working direction

## Objective

DeepWork should evolve from a landing page collaboration demo into a repeatable working protocol for humans and agents sharing the same project state. The immediate test target is a dual-machine workflow: one machine running Claude and another running OpenClaw, both connected to the same DeepWork project and able to understand each other's new requirements, proposed changes, and generated outputs without manual copy-paste.

## Core Feasibility Judgment

The proposed workflow is feasible if DeepWork separates chat interaction from project-state facts. A user may speak naturally to an agent, but the durable collaboration unit must be a structured semantic event written into the shared project state. Other agents should not need to read the full chat transcript to understand what changed; they should read a project key, a current snapshot, and recent semantic events.

The key architecture distinction is:

Chat is the interaction layer. Events are the collaboration layer. Snapshot is the fast-read state layer. Artifacts are the visible output layer.

## Minimum Working Loop

```text
User natural language
→ Agent semantic interpretation
→ Protocol event
→ Shared state update
→ Realtime notification or snapshot refresh
→ Other agent reads semantic delta
→ Agent proposes patch or artifact
→ Patch/artifact event recorded
→ Synthesis updates visible output
→ All participants share the same new project state
```

This loop is the core product. If any step is missing, DeepWork risks becoming ordinary agent chat or isolated file editing. If this loop works, DeepWork proves the existence of an agent-era shared project state layer.

## Project Key Role

The project key, such as `.deepwork/project.json`, should be stable and small. It should not be treated as the constantly changing source of truth. Its job is discovery: tell Claude, OpenClaw, Hermes, Codex, VSCode, or another client how to attach to the project.

The project key should point to:

- the canonical project identity
- the latest snapshot location
- the event write endpoint or event file
- the realtime subscription channel
- current artifact locations
- supported event types
- basic permissions and roles

For dual-machine testing, local `.deepwork` files are useful as cache/export, but they should not be the only cross-machine truth unless the machines share a synchronized folder. The safer first test is to keep `.deepwork/project.json` local and point it to the same remote Supabase or HTTP-backed state service.

## Snapshot Role

The snapshot must be optimized for fast understanding. It should be readable in one request or one file read. It should include both raw data and semantic summaries so another agent can quickly understand the current project without replaying the whole event history.

Recommended snapshot contents:

- project identity and protocol version
- current goal and positioning
- participants and agents
- sections and their current summaries
- recent intents
- accepted decisions
- proposed patches
- latest artifacts
- unresolved conflicts
- recommended next actions

The important design rule is that a newly attached agent should understand the latest shared context in milliseconds.

## Event Stream Role

The event stream is the append-only collaboration history. It records meaningful project changes, not every UI state change. The first useful event types should be:

- `intent.created`: a human or agent introduced a new requirement, idea, concern, or direction
- `section.created`: a new collaboration board/section was created
- `decision.accepted`: a direction became accepted shared state
- `patch.proposed`: an agent proposed a file/code/content change
- `patch.applied`: a proposed change was actually applied
- `artifact.updated`: an output such as HTML, Markdown, PRD, or code view changed
- `synthesis.started`: synthesis began for a set of intents/events
- `synthesis.completed`: synthesis produced a new artifact and attribution
- `conflict.detected`: the system found competing requirements
- `summary.updated`: a section or project summary was refreshed

## Agent Output Semantics

Agent outputs must become structured records. A useful agent output is not just “I changed the page.” It should explain the business meaning of the change, link it to the relevant intent, and make it easy for other agents to continue.

A minimal `patch.proposed` or `patch.applied` record should include:

```json
{
  "type": "patch.proposed",
  "summary": "Update homepage narrative from landing page generator to shared project state protocol.",
  "reason": "Project positioning is moving from Harness tooling toward Ecosystem collaboration infrastructure.",
  "linkedIntents": ["intent_123"],
  "affectedSections": ["首页首屏", "产品定义", "Demo 叙事"],
  "affectedFiles": ["src/app/page.tsx", "README.md"],
  "status": "proposed"
}
```

This semantic wrapper lets another agent understand why the change exists without reading a full diff first.

## Realtime Collaboration

Multiplayer visibility should use realtime events, not file polling. In the current app, Supabase Realtime already handles `intents`, `room_sections`, `participants`, `rooms`, and `synthesis_results`. For the protocol version, this should become a generic project event subscription model.

The product-level behavior should be:

- if Claude creates a new intent, OpenClaw sees it immediately
- if OpenClaw proposes or applies a patch, Claude sees the semantic patch event immediately
- if one agent synthesizes a new artifact, all clients see the artifact reference and attribution
- if an agent joins later, it can read the snapshot and recent events instead of requiring a live transcript

## First Dual-Machine Test

The first Claude + OpenClaw test should verify the following sequence:

1. Both machines open the same repo and read the same project key.
2. Both resolve the same project ID and canonical state location.
3. Claude receives a natural language requirement from the user and writes it as `intent.created`.
4. OpenClaw sees the new intent through realtime or by refreshing the snapshot.
5. OpenClaw turns that intent into a proposed code/content/artifact change and records `patch.proposed` or `artifact.updated`.
6. Claude sees the semantic patch record and can summarize what OpenClaw changed and why.
7. A synthesis step creates or updates a visible artifact, such as `latest.html` or a project brief.
8. Both machines converge on the same snapshot.

## Main Risks

The first risk is local-file divergence. If one machine writes `.deepwork` locally and the other machine cannot see it, the test will appear broken even if the model is sound. Use a remote canonical state for the first dual-machine test.

The second risk is natural-language-only output. If agents talk but do not write semantic events, the shared state never changes.

The third risk is a snapshot that is too raw. If it is just database rows, another agent still has to infer intent. Add section summaries and recent semantic deltas.

The fourth risk is code changes without semantic patch records. File diffs alone do not tell other agents the project meaning of the change.

## Near-Term Build Direction

The next practical step is to make the protocol explicit in the repo. Recommended deliverables:

- a formal DeepWork Protocol v0.1 document
- a concrete `.deepwork/project.json` schema
- a snapshot schema with semantic summaries
- an event schema with the initial event types above
- a simple reader utility that loads project key + snapshot + recent events
- a writer path for `intent.created`, `patch.proposed`, and `artifact.updated`
- a dual-machine test script for Claude and OpenClaw

## Success Definition

DeepWork succeeds at this stage if a user can tell one agent a new requirement, another agent can understand and act on it without manual copying, and both agents can converge on the same updated project state and visible artifact.
