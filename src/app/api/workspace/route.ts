import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { loadSnapshot, syncRoomStateToWorkspace } from '@/lib/room-state';

const DEEPWORK_ROOT = path.join(process.cwd(), '.deepwork');

// GET /api/workspace?roomId=ABC123
// Returns agent-readable DeepWork snapshot for a room.
// First tries the cached .deepwork/rooms/{roomId}/snapshot.json;
// falls back to a fresh Supabase read and writes the file for next time.
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
    const [snapshotRaw, projectKeyRaw] = await Promise.all([
      fs.readFile(snapshotPath, 'utf8'),
      fs.readFile(projectKeyPath, 'utf8').catch(() => null),
    ]);

    const snapshot = JSON.parse(snapshotRaw) as object;
    const projectKey = projectKeyRaw ? JSON.parse(projectKeyRaw) as object : null;

    return NextResponse.json(
      { snapshot, projectKey, source: 'cache' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    // Cache miss — generate fresh from Supabase
  }

  try {
    const [snapshot] = await Promise.all([
      loadSnapshot(roomId),
      syncRoomStateToWorkspace(roomId),
    ]);

    // After syncRoomStateToWorkspace, the file now exists — but return inline too
    const projectKeyRaw = await fs.readFile(projectKeyPath, 'utf8').catch(() => null);
    const projectKey = projectKeyRaw ? JSON.parse(projectKeyRaw) as object : null;

    return NextResponse.json(
      { snapshot, projectKey, source: 'live' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
