# DeepWork Three-Pass Validation

Date: 2026-04-24
Status: Completed at logic-and-build level

## Goal

Validate the first end-to-end collaboration loop three times in reasoning order, identify the most likely failures for the first Claude + OpenClaw test, and fix the highest-risk logic before real environment testing.

## Validation Method

Because `.env.local` is not present in this workspace, the full live Supabase + Anthropic flow could not be executed against production services.

So this validation used:

- full code-path walkthrough
- three scenario passes
- consistency audit between client, API, database, and local snapshot files
- build verification after each fix

This is enough to catch the most dangerous structural failures before first real integration testing.

## Pass 1: Single-Machine Happy Path

Scenario:

- one user joins a room
- creates a section or uses a default section
- submits an intent
- triggers synthesis
- expects local snapshot files to reflect the latest state

### Problems Found

1. `synthesize` trusted client-submitted intents instead of fetching latest room intents from the server
2. the room could enter synthesis based on stale browser state
3. synthesis had no room-level lock, so repeated clicks or parallel requests could create inconsistent rounds
4. participant identity in local storage was not room-scoped, which could create wrong-room identity reuse

### Fixes Applied

- `src/app/api/synthesize/route.ts`
  synthesis now fetches latest intents from Supabase server-side
- `src/app/api/synthesize/route.ts`
  room status is set to `synthesizing` before generation and reset safely on failure
- `src/app/page.tsx`
  participant IDs are now stored per room
- `src/app/room/[id]/page.tsx`
  room page now validates that the stored participant belongs to the current room

### Result

The single-machine loop is now much closer to the intended truth model:

- browser does not define the truth
- server defines the truth
- synthesis uses canonical room data

## Pass 2: Dual-Machine Collaboration

Scenario:

- Claude machine joins room
- OpenClaw machine joins same room
- both add intents
- one side creates a new section
- both expect to see the same section structure and room state

### Problems Found

1. custom sections were only added to local React state and were not persisted
2. therefore a section created on one machine would not appear on the other machine until an intent happened to use it
3. room status changes such as `synthesizing` were not visible cross-machine
4. intent creation did not verify that the participant belonged to that room

### Fixes Applied

- added `room_sections` persistence in schema and types
- added `src/app/api/sections/route.ts`
  so section creation is now a real shared event
- updated `src/app/room/[id]/page.tsx`
  to load room sections from Supabase and subscribe to realtime `room_sections`
- updated `src/app/room/[id]/page.tsx`
  to subscribe to room status updates
- updated `src/app/api/intents/route.ts`
  to validate room membership before insert

### Result

The collaboration model is now materially better for first dual-machine testing:

- section creation is shared
- section structure survives reload
- room-level synthesis lock is visible to another machine
- forged or mismatched participant writes are blocked

## Pass 3: Reopen Project And Read Shared State

Scenario:

- one machine or agent reopens the project later
- it should find a stable project entry point
- it should discover the latest room snapshot quickly

### Problems Found

1. there was no top-level project key file
2. room snapshots existed but there was no single stable entry file telling another agent where to read
3. room summaries did not expose a project-wide discovery layer

### Fixes Applied

- `src/lib/room-state.ts`
  now writes `.deepwork/project.json`
- `src/lib/room-state.ts`
  now writes `.deepwork/rooms/index.json`
- `src/lib/room-state.ts`
  still writes room-scoped:
  - `snapshot.json`
  - `events.ndjson`
  - `summary.md`
  - `latest.html`

### Result

The project now has a real top-level entry point for first protocol-native reading experiments.

It is not yet a fully remote or hybrid canonical state service, but it is enough to support:

- project discovery
- latest room discovery
- snapshot loading by another tool

## High-Risk Issues That Are Now Resolved

These were the main blockers for first real testing and are now fixed:

1. stale client intent list driving synthesis
2. no shared persistence for custom sections
3. missing room-scoped participant identity
4. no top-level project key for reopened state
5. missing room membership validation on writes
6. weak cross-machine visibility for room synthesis state

## Remaining Gaps

These are still important, but they no longer block the first real collaboration test.

### 1. Real Live Environment

Still required:

- `.env.local`
- real Supabase project
- schema migration execution
- Anthropic API key

### 2. Cross-Machine File Sync

The app now writes local files correctly, but another machine will only see them if there is:

- shared disk
- Syncthing
- iCloud Drive
- Dropbox
- Git-based handoff
- or a remote canonical state layer

### 3. Full Protocol-Native Agent Attach

There is now a `project.json`, but Claude and OpenClaw are not yet fully implemented as protocol-native readers and writers.

That is the next layer.

## Solution Summary

The solution is now based on three principles:

1. server truth over browser truth
2. shared persistence over local-only UI state
3. stable project entry point over ad hoc room-only files

## Execution Plan For First Real Test

### Step 1

Prepare environment:

- create `.env.local`
- run `supabase/schema.sql`
- run migration `supabase/migrations/20260424_add_intent_section.sql`
- run migration `supabase/migrations/20260424_add_room_sections.sql`

### Step 2

Launch one shared DeepWork service.

Important:

- both machines must connect to the same service
- both machines must connect to the same Supabase project

### Step 3

Run the first dual-machine scenario:

- Claude machine creates room and joins
- OpenClaw machine joins same room
- Claude creates a new section
- OpenClaw confirms it appears
- both add intents to different sections
- one side triggers synthesis
- the other side sees room lock and final result

### Step 4

Verify local project files:

- `.deepwork/project.json`
- `.deepwork/rooms/index.json`
- `.deepwork/rooms/<ROOM_ID>/snapshot.json`
- `.deepwork/rooms/<ROOM_ID>/events.ndjson`
- `.deepwork/rooms/<ROOM_ID>/latest.html`

### Step 5

Reopen the project from another agent/runtime and check whether:

- it can read `project.json`
- it can resolve the current room
- it can load the snapshot
- it can understand sections and latest synthesis

## Landing Plan

### Short Term

Use the current app as the first shared-state collaboration runtime.

### Medium Term

Implement a reader utility that opens `.deepwork/project.json` and returns:

- current room
- snapshot path
- latest sections
- latest events

### Next Product Step

Move from room-centric demo to protocol-centric project attach flow.

That means:

- make `project.json` first-class
- make snapshot schema stable
- make event types explicit
- add one external reader/writer client

## Confidence

Confidence is now high that the first real dual-machine test can validate the core wedge:

- shared intent input
- shared section structure
- shared synthesis result
- stable local state export

Confidence is not yet high for:

- fully autonomous agent-native collaboration
- remote canonical ecosystem behavior
- advanced governance

Those remain later phases.
