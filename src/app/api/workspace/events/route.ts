import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { DeepWorkSemanticEvent, DeepWorkEventType } from '@/types/deepwork-protocol';

const DEEPWORK_ROOT = path.join(process.cwd(), '.deepwork');

// Only non-destructive event types are accepted from external agents.
// Synthesis-gated writes (synthesis.started, synthesis.completed) go through /api/synthesize.
const ALLOWED_EVENT_TYPES: DeepWorkEventType[] = [
  'intent.created',
  'patch.proposed',
  'patch.applied',
  'artifact.updated',
  'decision.accepted',
  'summary.updated',
  'conflict.detected',
];

// POST /api/workspace/events
// Appends a semantic event to the room's events.ndjson without triggering a full Supabase sync.
// Designed for external agents (Machine B in dual-machine protocol tests) to record
// patch.proposed, artifact.updated, decision.accepted, etc.
//
// Body: { roomId: string; event: Partial<DeepWorkSemanticEvent> }
// Returns: { ok: true; event: DeepWorkSemanticEvent }
export async function POST(req: NextRequest) {
  let body: { roomId?: string; event?: Partial<DeepWorkSemanticEvent> };

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
  if (!eventInput?.type) {
    return NextResponse.json({ error: 'event.type is required' }, { status: 400 });
  }

  if (!ALLOWED_EVENT_TYPES.includes(eventInput.type as DeepWorkEventType)) {
    return NextResponse.json(
      {
        error: `Event type '${eventInput.type}' is not allowed via this endpoint.`,
        allowed: ALLOWED_EVENT_TYPES,
      },
      { status: 400 }
    );
  }

  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const roomDir = path.join(DEEPWORK_ROOT, 'rooms', safeId);
  const eventsPath = path.join(roomDir, 'events.ndjson');

  await fs.mkdir(roomDir, { recursive: true });

  const semanticEvent = {
    projectId: 'deepwork',
    roomId,
    recordedAt: new Date().toISOString(),
    summary: eventInput.summary || eventInput.type,
    ...eventInput,
  } as DeepWorkSemanticEvent;

  await fs.appendFile(eventsPath, `${JSON.stringify(semanticEvent)}\n`, 'utf8');

  return NextResponse.json({ ok: true, event: semanticEvent }, { status: 201 });
}
