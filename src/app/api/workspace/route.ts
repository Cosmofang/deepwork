import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { syncRoomStateToWorkspace, toDeepWorkSnapshot } from '@/lib/room-state';
import {
  DEEPWORK_ACTION_CAPABILITIES,
  DeepWorkSemanticEvent,
} from '@/types/deepwork-protocol';

const DEEPWORK_ROOT = path.join(process.cwd(), '.deepwork');

const RECENT_EVENTS_LIMIT = 100;

async function readRecentEvents(safeId: string): Promise<DeepWorkSemanticEvent[]> {
  try {
    const raw = await fs.readFile(
      path.join(DEEPWORK_ROOT, 'rooms', safeId, 'events.ndjson'),
      'utf8'
    );

    const lines = raw.split('\n').filter(Boolean);
    const parsedEvents: DeepWorkSemanticEvent[] = [];

    for (let index = Math.max(0, lines.length - RECENT_EVENTS_LIMIT); index < lines.length; index += 1) {
      const line = lines[index];
      try {
        parsedEvents.push(JSON.parse(line) as DeepWorkSemanticEvent);
      } catch {
        // Preserve workspace readability even if one append was interrupted or hand-edited.
      }
    }

    return parsedEvents;
  } catch {
    return [];
  }
}

// GET /api/workspace?roomId=ABC123
// Returns agent-readable DeepWork snapshot for a room, including recent semantic events.
// First tries the cached .deepwork/rooms/{roomId}/snapshot.json, then converts it into the
// protocol-level DeepWorkSnapshot shape. Falls back to a fresh Supabase read and writes the file for next time.
// Response: { snapshot, projectKey, recentEvents, actionCapabilities, source: 'cache' | 'live' }
export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get('roomId')?.trim().toUpperCase();

  if (!roomId) {
    return NextResponse.json({ error: 'roomId query param required' }, { status: 400 });
  }

  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const snapshotPath = path.join(DEEPWORK_ROOT, 'rooms', safeId, 'snapshot.json');
  const projectKeyPath = path.join(DEEPWORK_ROOT, 'project.json');

  // Try cached file first (sub-millisecond read)
  try {
    const [snapshotRaw, projectKeyRaw, recentEvents] = await Promise.all([
      fs.readFile(snapshotPath, 'utf8'),
      fs.readFile(projectKeyPath, 'utf8').catch(() => null),
      readRecentEvents(safeId),
    ]);

    const roomSnapshot = JSON.parse(snapshotRaw);
    const snapshot = toDeepWorkSnapshot(roomSnapshot, recentEvents);
    const projectKey = projectKeyRaw ? JSON.parse(projectKeyRaw) as object : null;

    return NextResponse.json(
      { snapshot, projectKey, recentEvents, actionCapabilities: DEEPWORK_ACTION_CAPABILITIES, source: 'cache' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    // Cache miss — generate fresh from Supabase
  }

  try {
    await syncRoomStateToWorkspace(roomId);
    const [snapshotRaw, projectKeyRaw, recentEvents] = await Promise.all([
      fs.readFile(snapshotPath, 'utf8'),
      fs.readFile(projectKeyPath, 'utf8').catch(() => null),
      readRecentEvents(safeId),
    ]);

    const roomSnapshot = JSON.parse(snapshotRaw);
    const snapshot = toDeepWorkSnapshot(roomSnapshot, recentEvents);
    const projectKey = projectKeyRaw ? JSON.parse(projectKeyRaw) as object : null;

    return NextResponse.json(
      { snapshot, projectKey, recentEvents, actionCapabilities: DEEPWORK_ACTION_CAPABILITIES, source: 'live' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
