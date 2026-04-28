import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@/lib/supabase-server';
import { DEFAULT_SECTION, normalizeSectionName } from '@/lib/sections';
import { ROLE_IDS, ROLES } from '@/lib/roles';
import { Intent, Participant, RoleId, Room, RoomSection, SynthesisResult } from '@/types';
import {
  DEEPLOOP_SUPPORTED_EVENT_TYPES,
  DeepLoopArtifactUpdatedEvent,
  DeepLoopConflictDetectedEvent,
  DeepLoopProjectKey,
  DeepLoopSnapshot,
  DeepLoopPatchEvent,
  DeepLoopRecommendedAction,
  DeepLoopSemanticEvent,
  toSemanticEventType,
} from '@/types/deeploop-protocol';
import { GovernanceIndex, readGovernanceIndex, updateGovernanceIndex } from '@/lib/governance-index';

type IntentWithParticipant = Intent & { participant: Participant | null };

export interface RoomStateEvent {
  type:
    | 'room_joined'
    | 'intent_created'
    | 'section_added'
    | 'synthesis_started'
    | 'synthesis_completed'
    | 'patch.proposed'
    | 'patch.applied'
    | 'artifact.updated'
    | 'decision.accepted'
    | 'conflict.detected'
    | 'summary.updated';
  participantId?: string;
  participantName?: string;
  role?: RoleId;
  section?: string;
  summary?: string;
  content?: string;
  round?: number;
  linkedEventIds?: string[];
  linkedIntents?: string[];
  affectedSections?: string[];
  affectedFiles?: string[];
  patchId?: string;
  patchStatus?: 'proposed' | 'applied' | 'rejected' | 'superseded';
  reason?: string;
  artifactType?: 'html' | 'markdown' | 'doc' | 'code' | 'other';
  artifactPath?: string;
  attributionMap?: Record<string, string>;
  decisionId?: string;
  title?: string;
  value?: string;
  conflictId?: string;
  sections?: string[];
  actorIds?: string[];
}

export interface RoomSnapshot {
  meta: {
    roomId: string;
    updatedAt: string;
    snapshotVersion: 1;
  };
  room: Room | null;
  participants: Participant[];
  sections: Array<{
    name: string;
    total: number;
    latestAt: string | null;
    latestBy: {
      participantId: string;
      name: string;
      role: RoleId;
      roleLabel: string;
    } | null;
    preview: string | null;
  }>;
  intents: Array<{
    id: string;
    section: string;
    content: string;
    createdAt: string;
    participant: {
      id: string;
      name: string;
      role: RoleId;
      roleLabel: string;
      color: string;
    } | null;
  }>;
  latestSynthesis: {
    id: string;
    round: number;
    createdAt: string;
    attributionMap: Record<string, string>;
    conflictsResolved: string[];
  } | null;
}

interface RoomIndexEntry {
  roomId: string;
  updatedAt: string;
  participants: number;
  intents: number;
  sections: number;
  latestRound: number | null;
}

const DEEPLOOP_ROOT = path.join(process.cwd(), '.deeploop');
const WORKSPACE_ROOT = path.join(DEEPLOOP_ROOT, 'rooms');

function stableEventId(type: string) {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${type.replace(/\./g, '-')}-${Date.now().toString(36)}-${randomSuffix}`;
}

function eventIdentity(event: DeepLoopSemanticEvent) {
  return event.id || event.recordedAt;
}

function sanitizeRoomId(roomId: string) {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function roleLabel(role: RoleId) {
  return ROLES[role]?.label || role;
}

function buildSummary(snapshot: RoomSnapshot) {
  const lines = [
    `# Room ${snapshot.meta.roomId}`,
    '',
    `更新时间：${snapshot.meta.updatedAt}`,
    `参与者：${snapshot.participants.length} 人`,
    `意图：${snapshot.intents.length} 条`,
    '',
    '## 板块概览',
  ];

  if (snapshot.sections.length === 0) {
    lines.push('', '暂无板块内容');
  } else {
    snapshot.sections.forEach(section => {
      const latest = section.latestBy
        ? `${section.latestBy.name} · ${section.latestBy.roleLabel}`
        : '暂无更新';
      lines.push(
        '',
        `- ${section.name}：${section.total} 条`,
        `  最近更新：${latest}`,
        `  摘要：${section.preview || '暂无内容'}`
      );
    });
  }

  if (snapshot.latestSynthesis) {
    lines.push(
      '',
      '## 最新合成',
      '',
      `- Round ${snapshot.latestSynthesis.round}`,
      `- 生成时间：${snapshot.latestSynthesis.createdAt}`,
      `- 归因区块：${Object.keys(snapshot.latestSynthesis.attributionMap || {}).length} 个`,
      `- 冲突解决：${snapshot.latestSynthesis.conflictsResolved.length} 条`
    );
  }

  return lines.join('\n');
}

export async function loadSnapshot(roomId: string): Promise<RoomSnapshot> {
  const supabase = createClient();

  const [{ data: room }, { data: participants }, { data: sections }, { data: intents }, { data: latestSynthesis }] =
    await Promise.all([
      supabase.from('rooms').select('*').eq('id', roomId).maybeSingle(),
      supabase.from('participants').select('*').eq('room_id', roomId).order('joined_at', { ascending: true }),
      supabase.from('room_sections').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
      supabase
        .from('intents')
        .select('*, participant:participants(*)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true }),
      supabase
        .from('synthesis_results')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const participantRows = (participants ?? []) as Participant[];
  const sectionRows = (sections ?? []) as RoomSection[];
  const intentRows = (intents ?? []) as IntentWithParticipant[];
  const roomRow = (room ?? null) as Room | null;
  const synthesisRow = (latestSynthesis ?? null) as SynthesisResult | null;

  const sectionsMap = new Map<string, RoomSnapshot['sections'][number]>();
  sectionRows.forEach(section => {
    const name = normalizeSectionName(section.name);
    sectionsMap.set(name, {
      name,
      total: 0,
      latestAt: null,
      latestBy: null,
      preview: null,
    });
  });

  intentRows.forEach(intent => {
    const section = normalizeSectionName(intent.section || DEFAULT_SECTION);
    const current = sectionsMap.get(section);
    const role = intent.participant?.role as RoleId | undefined;
    const next = {
      name: section,
      total: (current?.total ?? 0) + 1,
      latestAt: intent.created_at,
      latestBy: intent.participant && role
        ? {
            participantId: intent.participant.id,
            name: intent.participant.name,
            role,
            roleLabel: roleLabel(role),
          }
        : null,
      preview: intent.content,
    };

    sectionsMap.set(section, next);
  });

  return {
    meta: {
      roomId,
      updatedAt: new Date().toISOString(),
      snapshotVersion: 1,
    },
    room: roomRow,
    participants: participantRows,
    sections: Array.from(sectionsMap.values()),
    intents: intentRows.map(intent => {
      const role = intent.participant?.role as RoleId | undefined;
      return {
        id: intent.id,
        section: normalizeSectionName(intent.section || DEFAULT_SECTION),
        content: intent.content,
        createdAt: intent.created_at,
        participant: intent.participant && role
          ? {
              id: intent.participant.id,
              name: intent.participant.name,
              role,
              roleLabel: roleLabel(role),
              color: intent.participant.color,
            }
          : null,
      };
    }),
    latestSynthesis: synthesisRow
      ? {
          id: synthesisRow.id,
          round: synthesisRow.round,
          createdAt: synthesisRow.created_at,
          attributionMap: synthesisRow.attribution_map || {},
          conflictsResolved: synthesisRow.conflicts_resolved || [],
        }
      : null,
  };
}

async function writeProjectEntry(snapshot: RoomSnapshot, roomDir: string) {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  const indexPath = path.join(WORKSPACE_ROOT, 'index.json');

  let currentIndex: RoomIndexEntry[] = [];
  try {
    const existing = await fs.readFile(indexPath, 'utf8');
    currentIndex = JSON.parse(existing) as RoomIndexEntry[];
  } catch {
    currentIndex = [];
  }

  const nextEntry: RoomIndexEntry = {
    roomId: snapshot.meta.roomId,
    updatedAt: snapshot.meta.updatedAt,
    participants: snapshot.participants.length,
    intents: snapshot.intents.length,
    sections: snapshot.sections.length,
    latestRound: snapshot.latestSynthesis?.round ?? null,
  };

  const nextIndex = currentIndex
    .filter(entry => entry.roomId !== snapshot.meta.roomId)
    .concat(nextEntry)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  await fs.writeFile(indexPath, JSON.stringify(nextIndex, null, 2), 'utf8');

  const projectKey: DeepLoopProjectKey = {
    protocolVersion: '0.1',
    projectId: 'deeploop',
    projectName: 'DeepLoop',
    stateMode: 'local-room-snapshots',
    currentRoomId: snapshot.meta.roomId,
    currentSnapshotPath: path.relative(process.cwd(), path.join(roomDir, 'snapshot.json')),
    roomsIndexPath: path.relative(process.cwd(), indexPath),
    eventsPath: path.relative(process.cwd(), path.join(roomDir, 'events.ndjson')),
    realtimeChannel: `room:${snapshot.meta.roomId}`,
    supportedEventTypes: DEEPLOOP_SUPPORTED_EVENT_TYPES,
    outputs: {
      html: path.relative(process.cwd(), path.join(roomDir, 'latest.html')),
      summary: path.relative(process.cwd(), path.join(roomDir, 'summary.md')),
    },
    permissions: {
      humanCanPropose: true,
      agentCanPropose: true,
      agentCanSynthesize: false,
      agentCanApplyPatch: false,
    },
    updatedAt: snapshot.meta.updatedAt,
  };

  await fs.writeFile(path.join(DEEPLOOP_ROOT, 'project.json'), JSON.stringify(projectKey, null, 2), 'utf8');
}

function toSemanticEventPayload(roomId: string, event: RoomStateEvent): DeepLoopSemanticEvent {
  const type = toSemanticEventType(event.type);
  const base = {
    id: stableEventId(type),
    type,
    projectId: 'deeploop',
    roomId,
    actorId: event.participantId,
    participantId: event.participantId,
    participantName: event.participantName,
    role: event.role,
    summary: event.summary || type,
    recordedAt: new Date().toISOString(),
  };

  switch (type) {
    case 'intent.created':
      return {
        ...base,
        type,
        section: event.section || DEFAULT_SECTION,
        content: event.content || event.summary || '',
      };
    case 'section.created':
      return {
        ...base,
        type,
        section: event.section || DEFAULT_SECTION,
      };
    case 'actor.joined':
      return {
        ...base,
        type,
      };
    case 'synthesis.started':
    case 'synthesis.completed':
      return {
        ...base,
        type,
        round: event.round,
      };
    case 'patch.proposed':
    case 'patch.applied':
      return {
        ...base,
        type,
        status: event.patchStatus ?? (type === 'patch.proposed' ? 'proposed' : 'applied'),
        linkedEventIds: event.linkedEventIds,
        linkedIntents: event.linkedIntents,
        affectedSections: event.affectedSections,
        affectedFiles: event.affectedFiles,
        patchId: event.patchId,
        reason: event.reason,
      };
    case 'artifact.updated':
      return {
        ...base,
        type,
        artifactType: event.artifactType || 'other',
        artifactPath: event.artifactPath,
        attributionMap: event.attributionMap,
      };
    case 'decision.accepted':
      return {
        ...base,
        type,
        decisionId: event.decisionId,
        title: event.title,
        value: event.value,
      };
    case 'conflict.detected': {
      const conflictId = event.conflictId || base.id;
      return {
        ...base,
        type,
        conflictId,
        sections: event.sections,
        actorIds: event.actorIds,
      };
    }
    case 'summary.updated':
      return {
        ...base,
        type,
        section: event.section || DEFAULT_SECTION,
      };
    default:
      throw new Error(`Unsupported DeepLoop semantic event type: ${type}`);
  }
}

function buildDeepLoopSnapshot(snapshot: RoomSnapshot, recentEvents: DeepLoopSemanticEvent[] = [], governanceIndex?: GovernanceIndex | null): DeepLoopSnapshot {
  // Seed proposed patches from the persistent governance index (survives >100 event windows).
  // Then add any recent patch.proposed events not yet in the index, and remove any closed by recent events.
  const indexedPatchIds = new Set(
    (governanceIndex?.openPatches ?? []).map(p => eventIdentity(p) || p.patchId || '').filter(Boolean)
  );
  const indexedPatchPatchIds = new Set(
    (governanceIndex?.openPatches ?? []).map(p => p.patchId).filter(Boolean) as string[]
  );
  const recentProposals = recentEvents
    .filter((event): event is DeepLoopPatchEvent => event.type === 'patch.proposed')
    .filter(p => !indexedPatchIds.has(eventIdentity(p)) && !(p.patchId && indexedPatchPatchIds.has(p.patchId)));
  const allPatches: DeepLoopPatchEvent[] = [
    ...(governanceIndex?.openPatches ?? []),
    ...recentProposals,
  ];
  const proposedPatches = allPatches.filter(proposedPatch => {
      const proposedPatchId = eventIdentity(proposedPatch);
      const proposedPatchIds = [proposedPatchId, proposedPatch.patchId].filter(Boolean) as string[];
      return !recentEvents.some(event => {
        if (event.type !== 'patch.applied' && event.type !== 'decision.accepted') return false;

        const linkedEventIds = 'linkedEventIds' in event ? event.linkedEventIds : undefined;
        const linkedIntents = 'linkedIntents' in event ? event.linkedIntents : undefined;
        const decisionId = 'decisionId' in event ? event.decisionId : undefined;
        const patchId = 'patchId' in event ? event.patchId : undefined;
        return Boolean(
          (decisionId && proposedPatchIds.includes(decisionId)) ||
          (patchId && proposedPatchIds.includes(patchId)) ||
          linkedEventIds?.some(id => proposedPatchIds.includes(id)) ||
          linkedIntents?.some(id => proposedPatchIds.includes(id))
        );
      });
    });

  const latestArtifacts = recentEvents
    .filter((event): event is DeepLoopArtifactUpdatedEvent => event.type === 'artifact.updated')
    .map(event => ({
      id: eventIdentity(event),
      type: event.artifactType,
      path: event.artifactPath || 'unknown',
      updatedAt: event.recordedAt,
      attributionMap: event.attributionMap,
    }));

  if (snapshot.latestSynthesis && latestArtifacts.length === 0) {
    latestArtifacts.push({
      id: snapshot.latestSynthesis.id,
      type: 'html',
      path: `.deeploop/rooms/${sanitizeRoomId(snapshot.meta.roomId)}/latest.html`,
      updatedAt: snapshot.latestSynthesis.createdAt,
      attributionMap: snapshot.latestSynthesis.attributionMap,
    });
  }

  const recommendedNextActions: DeepLoopRecommendedAction[] = [];

  if (snapshot.intents.length === 0) {
    recommendedNextActions.push({
      id: 'collect-first-intent',
      priority: 'p0',
      summary: 'Collect at least one human or agent intent before synthesis.',
      reason: 'Synthesis should be grounded in explicit shared intent rather than an empty room.',
      eventTypes: ['intent.created'],
      suggestedAction: 'write_event',
    });
  }

  if (!snapshot.latestSynthesis && snapshot.intents.length > 0) {
    recommendedNextActions.push({
      id: 'run-first-synthesis',
      priority: 'p0',
      summary: 'Run synthesis to turn the current intent set into an attributed artifact.',
      reason: 'The room has intent records but no visible synthesized artifact yet.',
      eventTypes: ['synthesis.started', 'synthesis.completed', 'artifact.updated'],
      suggestedAction: 'run_synthesis',
    });
  }

  // Stale synthesis: intents have been added since the last synthesis round.
  if (snapshot.latestSynthesis && snapshot.intents.length > 0) {
    const synthAt = new Date(snapshot.latestSynthesis.createdAt).getTime();
    const newIntents = snapshot.intents.filter(
      i => new Date(i.createdAt).getTime() > synthAt
    );
    if (newIntents.length > 0) {
      const affectedSections = Array.from(new Set(newIntents.map(intent => intent.section)));
      recommendedNextActions.push({
        id: `resynthesize-after-round-${snapshot.latestSynthesis.round}`,
        priority: 'p0',
        summary: `Re-synthesize to incorporate ${newIntents.length} new intent${newIntents.length === 1 ? '' : 's'} added after round ${snapshot.latestSynthesis.round}.`,
        reason: 'The latest artifact no longer reflects all recorded intent in the shared project state.',
        eventTypes: ['synthesis.started', 'synthesis.completed', 'artifact.updated'],
        suggestedAction: 'run_synthesis',
        affectedSections,
        linkedEventIds: newIntents.map(intent => intent.id),
        governancePolicy: {
          rule: 'human_review_required',
          reason: 'Re-synthesis changes the visible shared artifact and should be triggered by a trusted facilitator or explicit team action.',
          requiredEventTypes: ['synthesis.started', 'synthesis.completed', 'artifact.updated'],
          allowedActorTrustLevels: ['owner', 'trusted'],
        },
      });
    }
  }

  if (proposedPatches.length > 0) {
    const affectedSections = Array.from(new Set(proposedPatches.flatMap(patch => patch.affectedSections ?? [])));
    const affectedFiles = Array.from(new Set(proposedPatches.flatMap(patch => patch.affectedFiles ?? [])));
    const linkedPatchIds = proposedPatches
      .flatMap(patch => [eventIdentity(patch), patch.patchId])
      .filter(Boolean) as string[];
    recommendedNextActions.push({
      id: 'review-proposed-patches',
      priority: 'p1',
      summary: `Review ${proposedPatches.length} proposed patch${proposedPatches.length === 1 ? '' : 'es'} — record decision.accepted or patch.applied for each accepted change.`,
      reason: 'Proposed agent or human changes should be governed explicitly before they become shared project state.',
      eventTypes: ['decision.accepted', 'patch.applied'],
      suggestedAction: 'review_patch',
      affectedSections: affectedSections.length ? affectedSections : undefined,
      affectedFiles: affectedFiles.length ? affectedFiles : undefined,
      linkedEventIds: Array.from(new Set(linkedPatchIds)),
      closeWith: {
        eventType: 'patch.applied',
        field: 'linkedEventIds',
        acceptedValues: Array.from(new Set(linkedPatchIds)),
        note: 'Alternatively write decision.accepted with decisionId equal to one of these values to accept the proposed patch without applying it in this endpoint.',
      },
      governancePolicy: {
        rule: 'human_review_required',
        reason: 'Applying or accepting patches changes shared project state and should be explicitly reviewed before closure.',
        requiredEventTypes: ['decision.accepted', 'patch.applied'],
        allowedActorTrustLevels: ['owner', 'trusted'],
      },
    });
  }

  // Unresolved conflicts: seed from persistent governance index, then add recent unindexed ones.
  const resolvedIds = new Set(
    recentEvents
      .filter(e => e.type === 'decision.accepted')
      .map(e => e.decisionId || '')
      .filter(Boolean)
  );
  const indexedConflictIds = new Set(
    (governanceIndex?.openConflicts ?? []).map(c => c.id || c.conflictId || '').filter(Boolean)
  );
  const indexedConflictConflictIds = new Set(
    (governanceIndex?.openConflicts ?? []).map(c => c.conflictId).filter(Boolean) as string[]
  );
  const recentConflicts = recentEvents.filter(
    (event): event is DeepLoopConflictDetectedEvent => event.type === 'conflict.detected'
  ).filter(e => !indexedConflictIds.has(eventIdentity(e)) && !(e.conflictId && indexedConflictConflictIds.has(e.conflictId)));

  type ConflictLike = { id?: string; conflictId?: string; summary: string; sections?: string[]; actorIds?: string[]; recordedAt?: string };
  const allConflicts: ConflictLike[] = [
    ...(governanceIndex?.openConflicts ?? []).map(c => ({ id: c.id, conflictId: c.conflictId, summary: c.summary, sections: c.sections, actorIds: c.actorIds, recordedAt: c.recordedAt })),
    ...recentConflicts.map(e => ({ id: eventIdentity(e), conflictId: e.conflictId, summary: e.summary, sections: e.sections, actorIds: e.actorIds, recordedAt: e.recordedAt })),
  ];
  const unresolvedConflicts = allConflicts.filter(c => {
    const id = c.id || c.conflictId || '';
    return !resolvedIds.has(id) && !(c.conflictId && resolvedIds.has(c.conflictId));
  });
  if (unresolvedConflicts.length > 0) {
    const affectedSections = Array.from(new Set(unresolvedConflicts.flatMap(c => c.sections ?? [])));
    const conflictIds = unresolvedConflicts.map(c => c.id || c.conflictId || '').filter(Boolean);
    recommendedNextActions.push({
      id: 'resolve-open-conflicts',
      priority: 'p0',
      summary: `Resolve ${unresolvedConflicts.length} unresolved conflict${unresolvedConflicts.length === 1 ? '' : 's'} — write a decision.accepted event for each resolved conflict.`,
      reason: 'Conflicts are governance hooks; synthesis should not silently hide incompatible requirements.',
      eventTypes: ['decision.accepted'],
      suggestedAction: 'write_event',
      affectedSections: affectedSections.length ? affectedSections : undefined,
      linkedEventIds: conflictIds,
      closeWith: {
        eventType: 'decision.accepted',
        field: 'decisionId',
        acceptedValues: conflictIds,
        note: 'Use one accepted value per decision.accepted event so other agents can verify the conflict closure from shared state.',
      },
      governancePolicy: {
        rule: 'human_review_required',
        reason: 'Conflict resolution is a team decision; agents may surface options but should not silently choose between incompatible human intents.',
        requiredEventTypes: ['decision.accepted'],
        allowedActorTrustLevels: ['owner', 'trusted'],
      },
    });
  }

  // Missing roles: name which of the 6 canonical roles have not yet joined.
  const joinedRoles = new Set(snapshot.participants.map(p => p.role as RoleId));
  const missingRoles = ROLE_IDS.filter(r => !joinedRoles.has(r));
  if (missingRoles.length > 0 && snapshot.intents.length > 0) {
    const presentRoles = ROLE_IDS.filter(r => joinedRoles.has(r));
    const labels = missingRoles.map(r => ROLES[r]?.label ?? r).join(', ');
    recommendedNextActions.push({
      id: 'invite-missing-roles',
      priority: 'p2',
      summary: `Invite the missing role${missingRoles.length === 1 ? '' : 's'} to contribute intent: ${labels}.`,
      reason: 'The demo and protocol both depend on preserving multiple perspectives before synthesis.',
      eventTypes: ['actor.joined', 'intent.created'],
      suggestedAction: 'invite_actor',
      actorScope: {
        missingActorRoles: missingRoles,
        presentActorRoles: presentRoles,
        note: 'Actor roles are role IDs, not section names; use this scope to invite or simulate the absent perspectives without overloading affectedSections.',
      },
    });
  }

  const contributorsBySection = new Map<string, Set<string>>();
  snapshot.intents.forEach(intent => {
    if (!intent.participant?.id) return;
    const section = normalizeSectionName(intent.section || DEFAULT_SECTION);
    const contributors = contributorsBySection.get(section) ?? new Set<string>();
    contributors.add(intent.participant.id);
    contributorsBySection.set(section, contributors);
  });

  return {
    meta: {
      projectId: 'deeploop',
      roomId: snapshot.meta.roomId,
      protocolVersion: '0.1',
      snapshotVersion: 1,
      updatedAt: snapshot.meta.updatedAt,
    },
    goal: 'Turn human and agent intent into shared, attributed project artifacts.',
    positioning: 'DeepLoop is a shared project state and intent protocol for human-agent collaboration.',
    actors: snapshot.participants.map(participant => ({
      id: participant.id,
      type: 'human',
      name: participant.name,
      role: participant.role,
      trustLevel: 'trusted',
    })),
    sections: snapshot.sections.map(section => ({
      name: section.name,
      status: 'active',
      summary: section.preview,
      totalIntents: section.total,
      contributors: Array.from(contributorsBySection.get(section.name) ?? []),
      updatedAt: section.latestAt,
    })),
    recentIntents: snapshot.intents.slice(-20).map(intent => ({
      id: intent.id,
      section: intent.section,
      content: intent.content,
      actorId: intent.participant?.id,
      createdAt: intent.createdAt,
    })),
    decisions: recentEvents
      .filter(event => event.type === 'decision.accepted')
      .map(event => ({
        id: event.decisionId || eventIdentity(event),
        title: event.title || event.summary,
        value: event.value || event.summary,
        status: 'accepted' as const,
        acceptedAt: event.recordedAt,
      })),
    proposedPatches,
    latestArtifacts,
    unresolvedConflicts: unresolvedConflicts.map(c => ({
      id: c.id || c.conflictId || '',
      summary: c.summary,
      sections: c.sections,
      actorIds: c.actorIds,
    })),
    recommendedNextActions,
  };
}

export function toDeepLoopSnapshot(snapshot: RoomSnapshot, recentEvents: DeepLoopSemanticEvent[] = [], governanceIndex?: GovernanceIndex | null): DeepLoopSnapshot {
  return buildDeepLoopSnapshot(snapshot, recentEvents, governanceIndex);
}

export async function syncRoomStateToWorkspace(roomId: string, event?: RoomStateEvent, priorEvents: RoomStateEvent[] = []) {
  const snapshot = await loadSnapshot(roomId);
  const roomDir = path.join(WORKSPACE_ROOT, sanitizeRoomId(roomId));

  await fs.mkdir(roomDir, { recursive: true });
  await fs.writeFile(path.join(roomDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  await fs.writeFile(path.join(roomDir, 'summary.md'), buildSummary(snapshot), 'utf8');

  if (snapshot.latestSynthesis) {
    const supabase = createClient();
    const { data: latestRow } = await supabase
      .from('synthesis_results')
      .select('html_content')
      .eq('id', snapshot.latestSynthesis.id)
      .maybeSingle();

    if (latestRow?.html_content) {
      await fs.writeFile(path.join(roomDir, 'latest.html'), latestRow.html_content, 'utf8');
    }
  }

  const events = event ? [...priorEvents, event] : priorEvents;
  if (events.length > 0) {
    const semanticEvents = events.map(nextEvent => toSemanticEventPayload(roomId, nextEvent));
    const lines = semanticEvents.map(e => JSON.stringify(e)).join('\n');
    await fs.appendFile(path.join(roomDir, 'events.ndjson'), `${lines}\n`, 'utf8');
    await updateGovernanceIndex(roomDir, sanitizeRoomId(roomId), semanticEvents as DeepLoopSemanticEvent[]);
  }

  await writeProjectEntry(snapshot, roomDir);

  return {
    roomDir,
    snapshotPath: path.join(roomDir, 'snapshot.json'),
  };
}
