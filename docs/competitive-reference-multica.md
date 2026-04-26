# DeepWork Competitive Reference: Multica

Date: 2026-04-26
Status: Strategic reference note

## Why Multica Matters

Multica is a highly relevant adjacent product for DeepWork because it appears to operate in the same broad category of human plus agent collaboration. Public positioning describes it as an open-source managed agents platform for turning coding agents into teammates: assign tasks, track progress, compound skills, run multiple agent runtimes, and manage coding work across workspaces.

That makes Multica useful as a reality check. It shows that the market is already moving toward agent teams, managed agent execution, reusable skills, realtime progress, and self-hosted infrastructure. DeepWork should not ignore this category. However, DeepWork should also not collapse into the same product definition.

## Current Judgment

Multica and DeepWork are adjacent, but they do not have to be the same product.

Multica's likely center of gravity is managed execution. Its core work unit is a task: a human or team assigns coding work to an agent, watches progress, receives blockers/status updates, and gets code changes or outputs back. In this framing, agents become accountable teammates inside a project management and runtime environment.

DeepWork's intended center of gravity is shared semantic state. Its core work unit should be an intent, event, decision, conflict, patch, artifact, or recommended governance action. In this framing, humans and agents are not only executing tasks; they are maintaining a common, readable, attributable, governable project state.

This distinction is important. If DeepWork becomes only a place to assign tasks to Claude, OpenClaw, Codex, or Cursor Agent, then Multica is very close and likely ahead. If DeepWork remains focused on the protocol layer that records why work exists, what intent it serves, which conflicts remain, who contributed what, and what the next governance action is, then it occupies a different layer.

## Product Layer Distinction

Multica can be understood as an agent workforce management layer. It answers questions such as: which agent owns this task, what is its progress, what runtime is it using, what blocker did it report, and what code did it produce?

DeepWork should be understood as an agent-readable collaboration substrate. It answers questions such as: what is the shared project intent, which semantic events changed the state, what decisions are accepted, which patches are proposed or applied, what conflicts need governance, what artifact represents the current synthesis, and what should another agent do next without reading a private chat transcript?

A useful mental model is: Multica manages agent execution; DeepWork manages project meaning. These can be complementary. In a future architecture, Multica-like systems could execute work while DeepWork provides the semantic project state they read from and write back to.

## Strategic Risk

The main risk is narrative compression. To an outside viewer, both products may initially sound like human-agent project management. If DeepWork's demo is described as “assign work to agents and see progress,” it will look directly comparable to Multica. If the demo is described as “many humans and agents converge on a shared intent state, with attribution, conflicts, decisions, and agent-readable next actions,” the distinction becomes clearer.

The second risk is feature gravity. Task assignment, progress tracking, multi-agent support, skills, and workspaces are useful features, but they pull DeepWork toward the managed-agent-platform category. DeepWork should only build these when they serve the protocol thesis, not as the product's center.

The third risk is protocol invisibility. If the event stream, snapshot, attribution, conflict resolution, and `recommendedNextActions` are hidden behind a normal UI, judges or users may evaluate DeepWork as a collaboration app rather than a new shared-state layer. The demo should expose enough of the protocol to make the category difference visible.

## Positioning Implication

Do not position DeepWork as “project management for AI agents.” That phrase is too close to Multica. A stronger positioning is:

DeepWork is a shared project state and intent protocol for human-agent collaboration. It gives humans and agents a common semantic layer for intents, decisions, patches, artifacts, conflicts, attribution, and next actions, so any agent can join a project and understand what matters without reading private transcripts.

This keeps DeepWork anchored in shared state, intent protocol, governable synthesis, and cross-agent readability.

## Demo Implication

The landing-page collaboration demo should not merely show agents helping generate a page. It should show the protocol doing something a task manager does not naturally do:

A user or participant adds intent. The system records it as `intent.created`. Synthesis produces an attributed artifact. If requirements conflict, a `conflict.detected` event appears. The workspace snapshot exposes `recommendedNextActions` such as `resolve-open-conflicts`. Another machine or agent reads only the project state and knows to write `decision.accepted` or propose a patch. The visible output updates, but the important proof is that coordination happened through shared semantic state rather than chat copy-paste.

## Product Boundary Rule

When considering new features, use this rule:

If the feature primarily helps assign, run, monitor, or supervise agents, it belongs to the managed execution layer and should be treated as optional or integrative.

If the feature helps preserve, synthesize, govern, attribute, or expose shared project meaning across humans and agents, it belongs to DeepWork's core.

## Near-Term Actions

First, keep the protocol artifacts visible in the demo path: project key, snapshot, semantic event stream, and recommended governance actions.

Second, make the dual-machine test explicitly prove that Machine B can understand Machine A's new intent without chat transcript transfer.

Third, avoid adding generic task boards unless each task is tied to semantic events, accepted decisions, conflicts, patches, and artifacts.

Fourth, describe Multica as an adjacent managed-agent execution platform in internal strategy, not as the product definition DeepWork should copy.
