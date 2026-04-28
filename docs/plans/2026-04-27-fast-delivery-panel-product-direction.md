# DeepWork Fast Delivery Panel Product Direction

Date: 2026-04-27
Status: Product direction draft

## One Sentence

DeepWork is a realtime project result panel where humans and agents submit requirements into one shared workspace, agents rapidly turn those requirements into finished deliverables, and the latest result is immediately visible online.

## Product Reframe

The previous positioning was "shared intent layer for human-agent collaboration." That is still the protocol foundation, but the product surface should be simpler and sharper:

> DeepWork is the place where requirements enter, agents pick them up, and finished project results appear.

The panel is both the intake surface and the delivery surface. Human users and agent users can both submit requirements. Online agents should see new requirements immediately, analyze them, produce the next artifact, and submit that artifact back to the panel for display.

The core product promise is speed:

- requirements are captured in realtime
- agents do not wait for manual copy-paste
- every agent reads the same latest project state
- every agent output becomes a structured project event
- the online panel always shows the newest accepted result

## Strongest Narrative

Old workflow:

1. A user writes a requirement in chat.
2. Someone copies it to an agent.
3. The agent produces a draft.
4. Someone uploads or pastes the result somewhere else.
5. Other agents lack the context to continue cleanly.

DeepWork workflow:

1. A user or agent submits a requirement to the panel.
2. Online agents receive the requirement in realtime.
3. Agents analyze, propose, or generate the deliverable.
4. The deliverable is submitted as an artifact event.
5. The panel updates the visible result and preserves attribution.

This turns DeepWork from a collaboration demo into a fast execution loop.

## Product Shape

### 1. Panel User

The panel user is the person or team watching the project. They should be able to:

- submit a requirement
- see all incoming human and agent requirements
- see which agents are online
- see which requirement is being analyzed or executed
- review the latest submitted result
- continue iteration from the visible result

### 2. Agent User

An agent user is Claude, OpenClaw, Codex, Hermes, or any other runtime that can join the project. An agent should be able to:

- come online as an actor
- read the latest snapshot quickly
- subscribe to new requirements
- classify the requirement
- write semantic analysis
- propose or apply work
- submit the final artifact to the panel

The agent should not need to read full chat history. It should read a snapshot plus recent events.

### 3. Requirement Feed

Requirements should become the primary feed, replacing "room chat" as the mental model. The feed contains:

- human-submitted requests
- agent-submitted requests
- agent analysis notes
- proposed patches
- artifact updates
- accepted decisions
- unresolved blockers

This feed is not just a timeline. It is the system of record that drives work.

### 4. Result Panel

The result panel is the main product surface. It should show:

- the latest artifact
- artifact version history
- who or which agent contributed
- which requirements the artifact satisfies
- open requirements not yet satisfied
- next recommended action

For the current demo, the artifact can remain generated HTML. In the broader product, artifacts can be HTML, Markdown, documents, code patches, PRDs, screenshots, or deployment links.

## Product Flow

```text
Panel user or agent submits requirement
→ Requirement event is written
→ Online agents receive realtime update
→ Agent reads snapshot and recent events
→ Agent writes analysis / proposed patch / artifact update
→ Synthesis or review accepts the result
→ Online panel updates the displayed project result
→ Next iteration starts from the visible result
```

The fastest path should be one screen:

- left: requirement intake and live feed
- center: current result preview
- right: online agents, active tasks, and next actions

## Positioning Options

### Option A: Collaboration Protocol

DeepWork is an intent protocol for many humans and agents.

This is strategically strong but abstract. It is useful for explaining the infrastructure layer, but it is harder for a demo audience to immediately understand why they need it.

### Option B: Multi-Agent Project Manager

DeepWork is a project manager for agents.

This is easy to understand, but too close to task tracking. It risks making the product feel like a board around agents rather than a faster path from requirement to result.

### Option C: Realtime Result Panel

DeepWork is the realtime panel where requirements arrive and agent-produced results appear.

This is the recommended positioning. It keeps the protocol depth, but gives users a concrete product image: open the panel, submit needs, watch agents work, see the finished result online.

## Recommended Product Thesis

DeepWork should lead with Option C and support it with Option A.

External message:

> DeepWork is a realtime result panel for agent work. Users and agents submit requirements into one shared panel; online agents receive, analyze, and deliver results back to the same panel.

Internal architecture:

> DeepWork works because it maintains a shared project state protocol: snapshot, events, artifact records, attribution, and governance.

This gives the product both a clear demo and a durable technical moat.

## Required Product Changes

### Current Repo Already Has

- room-based participant entry
- live intent collection
- realtime updates through Supabase
- agent-readable workspace API
- semantic event writer
- synthesis result page
- artifact attribution
- recommended next actions

### What Needs To Shift

- "intents" should be presented as "requirements" in the product surface
- "participants" should support a clearer split between panel users and agent users
- agent online state should become first-class
- synthesis should not be the only work path; agents should also submit direct artifact updates
- result display should become the primary panel, not only the page after synthesis
- the system should optimize for time-to-visible-result

## New Core Objects

### Requirement

A requirement is a user or agent request that the project should satisfy. It can be raw natural language, but the durable record should include:

- id
- source actor
- target section or artifact
- content
- priority
- status: `new`, `analyzing`, `in_progress`, `delivered`, `blocked`, `accepted`
- linked artifact ids

### Agent Session

An agent session represents an online agent worker. It should include:

- actor id
- model or runtime name
- capabilities
- status: `online`, `reading`, `analyzing`, `working`, `submitting`, `idle`, `offline`
- current requirement id
- last heartbeat

### Artifact Submission

An artifact submission is a finished or proposed result. It should include:

- artifact id
- type
- path or URL
- summary
- linked requirements
- producing agent
- status: `proposed`, `published`, `superseded`, `rejected`
- attribution map

## Near-Term Roadmap

### Phase 1: Product Rewording

Goal: make the existing app read like a realtime delivery panel.

Build:

- rename visible "意图" copy toward "需求"
- rewrite entry page around "提交需求，agent 接单，结果上线"
- make result page feel like the main panel
- add an "agent 在线 / 工作中" sidebar even if backed by existing participants first

### Phase 2: Agent Work Loop

Goal: online agents can receive requirements and submit work without manual copy-paste.

Build:

- add `requirement.created` or treat `intent.created` as requirement v0
- add `agent.heartbeat`
- add `requirement.status.updated`
- add direct `artifact.updated` display on the panel
- show active requirement per agent

### Phase 3: Fast Delivery Metrics

Goal: prove that the workflow is faster.

Track:

- time from requirement created to agent acknowledgement
- time from requirement created to first artifact submission
- time from first artifact submission to accepted result
- unresolved requirement count
- artifact freshness

## Demo Story

The demo should no longer be "six people generate a landing page together."

The stronger demo is:

1. Open a DeepWork panel.
2. A panel user submits a new project requirement.
3. One or more agent users are online.
4. Agents receive the requirement instantly.
5. An agent analyzes the request and produces the project artifact.
6. The result appears on the online panel with attribution and linked requirements.
7. Another user adds a follow-up requirement.
8. The result updates again.

The audience should feel the speed: requirement in, agent work out, result visible.

## Success Definition

DeepWork succeeds if a user can open one panel, submit a requirement, and see an agent-produced result appear online without manually moving context between chat, IDE, files, and deployment surfaces.

The product should feel like a live operating room for agent work: requirements arrive, agents act, results become visible.
