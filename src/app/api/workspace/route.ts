import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { syncRoomStateToWorkspace, toDeepLoopSnapshot } from '@/lib/room-state';
import { readGovernanceIndex } from '@/lib/governance-index';
import { getSupabaseServerConfigStatus } from '@/lib/supabase-server';
import {
  DEEPLOOP_ACTION_CAPABILITIES,
  DeepLoopSemanticEvent,
} from '@/types/deeploop-protocol';

const DEEPLOOP_ROOT = path.join(process.cwd(), '.deeploop');

const RECENT_EVENTS_LIMIT = 100;

async function readRecentEvents(safeId: string): Promise<DeepLoopSemanticEvent[]> {
  try {
    const raw = await fs.readFile(
      path.join(DEEPLOOP_ROOT, 'rooms', safeId, 'events.ndjson'),
      'utf8'
    );

    const lines = raw.split('\n').filter(Boolean);
    const parsedEvents: DeepLoopSemanticEvent[] = [];

    for (let index = Math.max(0, lines.length - RECENT_EVENTS_LIMIT); index < lines.length; index += 1) {
      const line = lines[index];
      try {
        parsedEvents.push(JSON.parse(line) as DeepLoopSemanticEvent);
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
// Returns agent-readable DeepLoop snapshot for a room, including recent semantic events.
// First tries the cached .deeploop/rooms/{roomId}/snapshot.json, then converts it into the
// protocol-level DeepLoopSnapshot shape. Falls back to a fresh Supabase read and writes the file for next time.
// Response: { snapshot, projectKey, recentEvents, actionCapabilities, source: 'cache' | 'live' }
export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get('roomId')?.trim().toUpperCase();

  if (!roomId) {
    return NextResponse.json({ error: 'roomId query param required' }, { status: 400 });
  }

  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const snapshotPath = path.join(DEEPLOOP_ROOT, 'rooms', safeId, 'snapshot.json');
  const projectKeyPath = path.join(DEEPLOOP_ROOT, 'project.json');

  // Try cached file first (sub-millisecond read)
  try {
    const governanceIndexPath = path.join(DEEPLOOP_ROOT, 'rooms', safeId);
    const [snapshotRaw, projectKeyRaw, recentEvents, governanceIndex] = await Promise.all([
      fs.readFile(snapshotPath, 'utf8'),
      fs.readFile(projectKeyPath, 'utf8').catch(() => null),
      readRecentEvents(safeId),
      readGovernanceIndex(governanceIndexPath),
    ]);

    const roomSnapshot = JSON.parse(snapshotRaw);
    const snapshot = toDeepLoopSnapshot(roomSnapshot, recentEvents, governanceIndex);
    const projectKey = projectKeyRaw ? JSON.parse(projectKeyRaw) as object : null;

    return NextResponse.json(
      { snapshot, projectKey, recentEvents, actionCapabilities: DEEPLOOP_ACTION_CAPABILITIES, source: 'cache' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    // Cache miss — generate fresh from Supabase
  }

  try {
    const configStatus = getSupabaseServerConfigStatus();
    if (!configStatus.ready) {
      return NextResponse.json(
        {
          error: 'Supabase server environment is not configured',
          missing: {
            NEXT_PUBLIC_SUPABASE_URL: !configStatus.hasUrl,
            SUPABASE_SERVICE_ROLE_KEY: !configStatus.hasServiceRoleKey,
          },
          hint: 'Create .env.local from .env.local.example and set real Supabase values before running the live demo flow.',
          actionCapabilities: DEEPLOOP_ACTION_CAPABILITIES,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await syncRoomStateToWorkspace(roomId);
    const governanceIndexPath = path.join(DEEPLOOP_ROOT, 'rooms', safeId);
    const [snapshotRaw, projectKeyRaw, recentEvents, governanceIndex] = await Promise.all([
      fs.readFile(snapshotPath, 'utf8'),
      fs.readFile(projectKeyPath, 'utf8').catch(() => null),
      readRecentEvents(safeId),
      readGovernanceIndex(governanceIndexPath),
    ]);

    const roomSnapshot = JSON.parse(snapshotRaw);
    const snapshot = toDeepLoopSnapshot(roomSnapshot, recentEvents, governanceIndex);
    const projectKey = projectKeyRaw ? JSON.parse(projectKeyRaw) as object : null;

    return NextResponse.json(
      { snapshot, projectKey, recentEvents, actionCapabilities: DEEPLOOP_ACTION_CAPABILITIES, source: 'live' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
