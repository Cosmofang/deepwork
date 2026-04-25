import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@/lib/supabase-server';
import { DEFAULT_SECTION, normalizeSectionName } from '@/lib/sections';
import { ROLES } from '@/lib/roles';
import { Intent, Participant, RoleId, Room, RoomSection, SynthesisResult } from '@/types';
import {
  DEEPWORK_SUPPORTED_EVENT_TYPES,
  DeepWorkProjectKey,
  DeepWorkSemanticEvent,
  toSemanticEventType,
} from '@/types/deepwork-protocol';

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
  linkedIntents?: string[];
  affectedSections?: string[];
  affectedFiles?: string[];
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

interface RoomSnapshot {
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

const DEEPWORK_ROOT = path.join(process.cwd(), '.deepwork');
const WORKSPACE_ROOT = path.join(DEEPWORK_ROOT, 'rooms');

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

  const projectKey: DeepWorkProjectKey = {
    protocolVersion: '0.1',
    projectId: 'deepwork',
    projectName: 'DeepWork',
    stateMode: 'local-room-snapshots',
    currentRoomId: snapshot.meta.roomId,
    currentSnapshotPath: path.relative(process.cwd(), path.join(roomDir, 'snapshot.json')),
    roomsIndexPath: path.relative(process.cwd(), indexPath),
    eventsPath: path.relative(process.cwd(), path.join(roomDir, 'events.ndjson')),
    realtimeChannel: `room:${snapshot.meta.roomId}`,
    supportedEventTypes: DEEPWORK_SUPPORTED_EVENT_TYPES,
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

  await fs.writeFile(path.join(DEEPWORK_ROOT, 'project.json'), JSON.stringify(projectKey, null, 2), 'utf8');
}

function toSemanticEventPayload(roomId: string, event: RoomStateEvent): DeepWorkSemanticEvent {
  const type = toSemanticEventType(event.type);
  const base = {
    type,
    projectId: 'deepwork',
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
        linkedIntents: event.linkedIntents,
        affectedSections: event.affectedSections,
        affectedFiles: event.affectedFiles,
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
    case 'conflict.detected':
      return {
        ...base,
        type,
        conflictId: event.conflictId,
        sections: event.sections,
        actorIds: event.actorIds,
      };
    case 'summary.updated':
      return {
        ...base,
        type,
        section: event.section || DEFAULT_SECTION,
      };
    default:
      throw new Error(`Unsupported DeepWork semantic event type: ${type}`);
  }
}

export async function syncRoomStateToWorkspace(roomId: string, event?: RoomStateEvent) {
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

  if (event) {
    const eventPayload = toSemanticEventPayload(roomId, event);
    await fs.appendFile(path.join(roomDir, 'events.ndjson'), `${JSON.stringify(eventPayload)}\n`, 'utf8');
  }

  await writeProjectEntry(snapshot, roomDir);

  return {
    roomDir,
    snapshotPath: path.join(roomDir, 'snapshot.json'),
  };
}
