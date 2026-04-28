import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { updateGovernanceIndex } from '@/lib/governance-index';
import {
  DEEPLOOP_SUPPORTED_EVENT_TYPES,
  DeepLoopArtifactUpdatedEvent,
  DeepLoopConflictDetectedEvent,
  DeepLoopDecisionAcceptedEvent,
  DeepLoopEventType,
  DeepLoopIntentCreatedEvent,
  DeepLoopPatchEvent,
  DeepLoopSemanticEvent,
} from '@/types/deeploop-protocol';

const DEEPLOOP_ROOT = path.join(process.cwd(), '.deeploop');
const PROJECT_ID = 'deeploop';

// Only non-destructive event types are accepted from external agents.
// Synthesis-gated writes (synthesis.started, synthesis.completed) go through /api/synthesize.
const ALLOWED_EVENT_TYPES: DeepLoopEventType[] = [
  'intent.created',
  'patch.proposed',
  'patch.applied',
  'artifact.updated',
  'decision.accepted',
  'summary.updated',
  'conflict.detected',
];

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function updateWorkspaceMetadata(roomId: string, roomDir: string, eventsPath: string) {
  const now = new Date().toISOString();
  const snapshotPath = path.join(roomDir, 'snapshot.json');
  const summaryPath = path.join(roomDir, 'summary.md');
  const latestHtmlPath = path.join(roomDir, 'latest.html');
  const indexPath = path.join(DEEPLOOP_ROOT, 'rooms', 'index.json');
  const projectKeyPath = path.join(DEEPLOOP_ROOT, 'project.json');

  const snapshot = await readJsonFile<{
    meta?: object;
    participants?: unknown[];
    intents?: unknown[];
    sections?: unknown[];
    latestSynthesis?: { round?: number } | null;
  }>(snapshotPath);

  if (snapshot) {
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(
        {
          ...snapshot,
          meta: {
            ...snapshot.meta,
            updatedAt: now,
          },
        },
        null,
        2
      ),
      'utf8'
    );
  }

  const indexEntry = {
    roomId,
    updatedAt: now,
    participants: snapshot?.participants?.length ?? 0,
    intents: snapshot?.intents?.length ?? 0,
    sections: snapshot?.sections?.length ?? 0,
    latestRound: snapshot?.latestSynthesis?.round ?? null,
  };

  const existingIndex = (await readJsonFile<typeof indexEntry[]>(indexPath)) ?? [];
  const nextIndex = existingIndex
    .filter(entry => entry.roomId !== roomId)
    .concat(indexEntry)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(nextIndex, null, 2), 'utf8');

  const existingProjectKey = (await readJsonFile<Record<string, unknown>>(projectKeyPath)) ?? {};
  const projectKey = {
    ...existingProjectKey,
    protocolVersion: '0.1',
    projectId: PROJECT_ID,
    projectName: 'DeepLoop',
    stateMode: existingProjectKey.stateMode ?? 'local-room-snapshots',
    currentRoomId: roomId,
    currentSnapshotPath: path.relative(process.cwd(), snapshotPath),
    roomsIndexPath: path.relative(process.cwd(), indexPath),
    eventsPath: path.relative(process.cwd(), eventsPath),
    realtimeChannel: `room:${roomId}`,
    supportedEventTypes: DEEPLOOP_SUPPORTED_EVENT_TYPES,
    outputs: {
      html: path.relative(process.cwd(), latestHtmlPath),
      summary: path.relative(process.cwd(), summaryPath),
    },
    permissions: {
      humanCanPropose: true,
      agentCanPropose: true,
      agentCanSynthesize: false,
      agentCanApplyPatch: false,
    },
    updatedAt: now,
  };

  await fs.writeFile(projectKeyPath, JSON.stringify(projectKey, null, 2), 'utf8');
}

function errorResponse(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

function assertNonEmptyString(value: unknown, field: string): string | NextResponse {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return errorResponse(`${field} is required`);
  }
  return value.trim();
}

function assertStringArray(value: unknown, field: string): string[] | NextResponse | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    return errorResponse(`${field} must be an array of non-empty strings`);
  }
  return value.map(item => item.trim());
}

function assertOptionalString(value: unknown, field: string): string | NextResponse | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return errorResponse(`${field} must be a non-empty string when provided`);
  }
  return value.trim();
}

function hasSemanticLinkage(event: {
  linkedEventIds?: string[];
  linkedIntents?: string[];
  affectedSections?: string[];
  affectedFiles?: string[];
  patchId?: string;
}) {
  return Boolean(event.patchId || event.linkedEventIds?.length || event.linkedIntents?.length || event.affectedSections?.length || event.affectedFiles?.length);
}

function stableEventId(type: DeepLoopEventType) {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${type.replace(/\./g, '-')}-${Date.now().toString(36)}-${randomSuffix}`;
}

function normalizeActorId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getKnownActorId(eventInput: Partial<DeepLoopSemanticEvent>) {
  return normalizeActorId(eventInput.actorId) || normalizeActorId(eventInput.participantId);
}

function getOptionalEventId(eventInput: Partial<DeepLoopSemanticEvent>) {
  const maybeWithId = eventInput as Partial<DeepLoopSemanticEvent> & { id?: unknown };
  return typeof maybeWithId.id === 'string' && maybeWithId.id.trim().length > 0
    ? maybeWithId.id.trim()
    : undefined;
}

function isErrorResult<T>(value: T | NextResponse): value is NextResponse {
  return value instanceof Response;
}

function validateWorkspaceEvent(eventInput: Partial<DeepLoopSemanticEvent>): DeepLoopSemanticEvent | NextResponse {
  if (!eventInput.type) {
    return errorResponse('event.type is required');
  }

  if (!ALLOWED_EVENT_TYPES.includes(eventInput.type as DeepLoopEventType)) {
    return errorResponse(`Event type '${eventInput.type}' is not allowed via this endpoint.`, 400, {
      allowed: ALLOWED_EVENT_TYPES,
    });
  }

  const eventType = eventInput.type as DeepLoopEventType;
  const summary = assertNonEmptyString(eventInput.summary, 'event.summary');
  if (isErrorResult(summary)) return summary;

  const actorId = getKnownActorId(eventInput);

  const base = {
    ...eventInput,
    id: getOptionalEventId(eventInput) || stableEventId(eventType),
    projectId: PROJECT_ID,
    recordedAt: new Date().toISOString(),
    summary,
    ...(actorId ? { actorId, participantId: actorId } : {}),
  };

  switch (eventInput.type) {
    case 'intent.created': {
      const section = assertNonEmptyString((eventInput as Partial<DeepLoopIntentCreatedEvent>).section, 'event.section');
      if (isErrorResult(section)) return section;
      const content = assertNonEmptyString((eventInput as Partial<DeepLoopIntentCreatedEvent>).content, 'event.content');
      if (isErrorResult(content)) return content;
      return { ...base, type: eventInput.type, section, content } as DeepLoopIntentCreatedEvent;
    }
    case 'patch.proposed':
    case 'patch.applied': {
      const event = eventInput as Partial<DeepLoopPatchEvent>;
      const affectedFiles = assertStringArray(event.affectedFiles, 'event.affectedFiles');
      if (isErrorResult(affectedFiles)) return affectedFiles;
      const linkedEventIds = assertStringArray(event.linkedEventIds, 'event.linkedEventIds');
      if (isErrorResult(linkedEventIds)) return linkedEventIds;
      const linkedIntents = assertStringArray(event.linkedIntents, 'event.linkedIntents');
      if (isErrorResult(linkedIntents)) return linkedIntents;
      const affectedSections = assertStringArray(event.affectedSections, 'event.affectedSections');
      if (isErrorResult(affectedSections)) return affectedSections;
      const status = event.status ?? (eventInput.type === 'patch.proposed' ? 'proposed' : 'applied');
      if (!['proposed', 'applied', 'rejected', 'superseded'].includes(status)) {
        return errorResponse('event.status must be proposed, applied, rejected, or superseded');
      }
      const reason = assertOptionalString(event.reason, 'event.reason');
      if (isErrorResult(reason)) return reason;
      const patchId = assertOptionalString(event.patchId, 'event.patchId');
      if (isErrorResult(patchId)) return patchId;
      if (!hasSemanticLinkage({ linkedEventIds, linkedIntents, affectedSections, affectedFiles, patchId })) {
        return errorResponse('patch events must include at least one of patchId, linkedEventIds, linkedIntents, affectedSections, or affectedFiles');
      }
      return {
        ...base,
        type: eventInput.type,
        status,
        affectedFiles,
        linkedEventIds,
        linkedIntents,
        affectedSections,
        reason,
        patchId,
      } as DeepLoopPatchEvent;
    }
    case 'artifact.updated': {
      const event = eventInput as Partial<DeepLoopArtifactUpdatedEvent>;
      const artifactType = event.artifactType ?? 'other';
      if (!['html', 'markdown', 'doc', 'code', 'other'].includes(artifactType)) {
        return errorResponse('event.artifactType must be html, markdown, doc, code, or other');
      }
      const artifactPath = assertOptionalString(event.artifactPath, 'event.artifactPath');
      if (isErrorResult(artifactPath)) return artifactPath;
      return { ...base, type: eventInput.type, artifactType, artifactPath, attributionMap: event.attributionMap } as DeepLoopArtifactUpdatedEvent;
    }
    case 'decision.accepted': {
      const event = eventInput as Partial<DeepLoopDecisionAcceptedEvent>;
      const value = assertNonEmptyString(event.value, 'event.value');
      if (isErrorResult(value)) return value;
      const decisionId = assertOptionalString(event.decisionId, 'event.decisionId');
      if (isErrorResult(decisionId)) return decisionId;
      const title = assertOptionalString(event.title, 'event.title');
      if (isErrorResult(title)) return title;
      return { ...base, type: eventInput.type, value, title, decisionId } as DeepLoopDecisionAcceptedEvent;
    }
    case 'summary.updated': {
      const section = assertOptionalString((eventInput as { section?: unknown }).section, 'event.section');
      if (isErrorResult(section)) return section;
      return { ...base, type: eventInput.type, section } as DeepLoopSemanticEvent;
    }
    case 'conflict.detected': {
      const event = eventInput as Partial<DeepLoopConflictDetectedEvent>;
      const sections = assertStringArray(event.sections, 'event.sections');
      if (isErrorResult(sections)) return sections;
      const actorIds = assertStringArray(event.actorIds, 'event.actorIds');
      if (isErrorResult(actorIds)) return actorIds;
      const conflictId = assertOptionalString(event.conflictId, 'event.conflictId');
      if (isErrorResult(conflictId)) return conflictId;
      return {
        ...base,
        type: eventInput.type,
        conflictId: conflictId || base.id,
        sections,
        actorIds,
      } as DeepLoopConflictDetectedEvent;
    }
    default:
      return errorResponse(`Unsupported event type '${eventInput.type}'`);
  }
}

// POST /api/workspace/events
// Appends a semantic event to the room's events.ndjson without triggering a full Supabase sync.
// Designed for external agents (Machine B in dual-machine protocol tests) to record
// patch.proposed, artifact.updated, decision.accepted, etc.
//
// Body: { roomId: string; event: Partial<DeepLoopSemanticEvent> }
// Returns: { ok: true; event: DeepLoopSemanticEvent }
export async function POST(req: NextRequest) {
  let body: { roomId?: string; event?: Partial<DeepLoopSemanticEvent> } & Record<string, unknown>;

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const roomId = body.roomId?.trim().toUpperCase();
  if (!roomId) {
    return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
  }

  const eventInput = body.event;
  if (!eventInput) {
    const bodyKeys = Object.keys(body as Record<string, unknown>);
    const topLevelEventFields = ['type', 'summary', 'content', 'section', 'sections', 'actorIds', 'conflictId', 'decisionId', 'value'];
    const hasTopLevelEventFields = topLevelEventFields.some(k => bodyKeys.includes(k));
    if (hasTopLevelEventFields) {
      return NextResponse.json(
        {
          error: 'event fields must be wrapped under an "event" key',
          hint: 'Send { "roomId": "...", "event": { "type": "...", "summary": "...", ... } } — not flat at the top level.',
          example: { roomId: 'YOURROOM', event: { type: 'conflict.detected', summary: 'describe conflict', sections: [], actorIds: [] } },
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'event is required' }, { status: 400 });
  }

  const validatedEvent = validateWorkspaceEvent(eventInput);
  if (isErrorResult(validatedEvent)) {
    return validatedEvent;
  }

  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const roomDir = path.join(DEEPLOOP_ROOT, 'rooms', safeId);
  const eventsPath = path.join(roomDir, 'events.ndjson');

  await fs.mkdir(roomDir, { recursive: true });

  const semanticEvent = {
    ...validatedEvent,
    roomId,
  } as DeepLoopSemanticEvent;

  await fs.appendFile(eventsPath, `${JSON.stringify(semanticEvent)}\n`, 'utf8');
  await updateGovernanceIndex(roomDir, roomId, [semanticEvent]);
  await updateWorkspaceMetadata(roomId, roomDir, eventsPath);

  return NextResponse.json({ ok: true, event: semanticEvent }, { status: 201 });
}
