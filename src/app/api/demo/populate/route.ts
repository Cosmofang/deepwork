import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';
import { ROLE_IDS, ROLES } from '@/lib/roles';
import { normalizeSectionName } from '@/lib/sections';
import { RoleId } from '@/types';
import { syncRoomStateToWorkspace, RoomStateEvent } from '@/lib/room-state';

// POST /api/demo/populate
// Round 1 (default): creates synthetic participants for missing roles and fills demoIntents.
// Round 2+ (round >= 2): fills demoIntents2 for all existing participants that don't yet
// have the Round 2 content (content-based idempotency on the first demoIntents2 item).
export async function POST(req: NextRequest) {
  const body = await req.json() as { roomId?: string; round?: number };
  const roomId = body.roomId?.trim().toUpperCase();
  const round = typeof body.round === 'number' ? body.round : 1;

  if (!roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json(
      {
        error: 'Supabase server environment is not configured',
        missing: {
          NEXT_PUBLIC_SUPABASE_URL: !configStatus.hasUrl,
          SUPABASE_SERVICE_ROLE_KEY: !configStatus.hasServiceRoleKey,
        },
        hint: 'Create .env.local from .env.local.example and set real Supabase values before populating demo data.',
      },
      { status: 503 }
    );
  }

  const supabase = createClient();

  // Ensure room exists
  const { error: roomError } = await supabase
    .from('rooms')
    .upsert({ id: roomId, status: 'collecting' }, { onConflict: 'id' });

  if (roomError) {
    return NextResponse.json({ error: roomError.message }, { status: 500 });
  }

  // Find roles already represented in the room (with their participant IDs)
  const { data: existing } = await supabase
    .from('participants')
    .select('id, role')
    .eq('room_id', roomId);

  const existingParticipants = existing ?? [];
  const existingRoles = new Set(existingParticipants.map(p => p.role as RoleId));
  const missingRoles = ROLE_IDS.filter(r => !existingRoles.has(r));

  let totalIntents = 0;
  const workspaceEvents: RoomStateEvent[] = [];

  // ── Round 2+ path: fill demoIntents2 for all existing participants ──────────
  if (round >= 2 && existingParticipants.length > 0) {
    // Content-based idempotency: fetch all existing intent contents per participant.
    const { data: existingIntents } = await supabase
      .from('intents')
      .select('participant_id, content')
      .eq('room_id', roomId);

    const intentContentsByParticipant = new Map<string, Set<string>>();
    for (const i of existingIntents ?? []) {
      if (!intentContentsByParticipant.has(i.participant_id as string)) {
        intentContentsByParticipant.set(i.participant_id as string, new Set());
      }
      intentContentsByParticipant.get(i.participant_id as string)!.add(i.content as string);
    }

    for (const p of existingParticipants) {
      const roleInfo = ROLES[p.role as RoleId];
      if (!roleInfo?.demoIntents2?.length) continue;
      const existingContents = intentContentsByParticipant.get(p.id) ?? new Set<string>();
      // Skip if the first Round 2 intent already exists (already populated).
      if (existingContents.has(roleInfo.demoIntents2[0].content)) continue;

      for (const demo of roleInfo.demoIntents2) {
        if (existingContents.has(demo.content)) continue;
        const section = normalizeSectionName(demo.section);
        await supabase
          .from('room_sections')
          .upsert({ room_id: roomId, name: section, created_by: p.id }, { onConflict: 'room_id,name' });
        const { error: intentErr } = await supabase
          .from('intents')
          .insert({ room_id: roomId, participant_id: p.id, section, content: demo.content });
        if (!intentErr) {
          totalIntents++;
          workspaceEvents.push({
            type: 'intent_created',
            participantId: p.id,
            participantName: roleInfo.label,
            role: p.role as RoleId,
            section,
            summary: demo.content,
            content: demo.content,
          });
        }
      }
    }

    if (workspaceEvents.length > 0) {
      await syncRoomStateToWorkspace(roomId, workspaceEvents[workspaceEvents.length - 1], workspaceEvents.slice(0, -1));
    }
    return NextResponse.json({ added: 0, intents: totalIntents, round });
  }

  // ── Round 1 path (default) ───────────────────────────────────────────────────

  // For existing participants with 0 submitted intents, fill their demo intents too.
  // This lets a solo presenter click "一键填充" and get full 6-role attribution.
  if (existingParticipants.length > 0) {
    const { data: existingIntents } = await supabase
      .from('intents')
      .select('participant_id')
      .eq('room_id', roomId);

    const participantsWithIntents = new Set((existingIntents ?? []).map(i => i.participant_id as string));

    for (const p of existingParticipants) {
      if (participantsWithIntents.has(p.id)) continue;
      const roleInfo = ROLES[p.role as RoleId];
      if (!roleInfo) continue;

      for (const demo of roleInfo.demoIntents) {
        const section = normalizeSectionName(demo.section);
        await supabase
          .from('room_sections')
          .upsert(
            { room_id: roomId, name: section, created_by: p.id },
            { onConflict: 'room_id,name' }
          );
        const { error: intentErr } = await supabase
          .from('intents')
          .insert({ room_id: roomId, participant_id: p.id, section, content: demo.content });
        if (!intentErr) {
          totalIntents++;
          workspaceEvents.push({
            type: 'intent_created',
            participantId: p.id,
            participantName: roleInfo.label,
            role: p.role as RoleId,
            section,
            summary: demo.content,
            content: demo.content,
          });
        }
      }
    }
  }

  // For each missing role: create participant then submit their demo intents
  for (const roleId of missingRoles) {
    const roleInfo = ROLES[roleId];

    const { data: participant, error: pErr } = await supabase
      .from('participants')
      .insert({
        room_id: roomId,
        name: roleInfo.label,
        role: roleId,
        color: roleInfo.color,
      })
      .select()
      .single();

    if (pErr || !participant) continue;

    workspaceEvents.push({
      type: 'room_joined',
      participantId: participant.id,
      participantName: participant.name,
      role: roleId,
      summary: `${participant.name} 以 ${roleInfo.label} 身份加入演示房间`,
    });

    for (const demo of roleInfo.demoIntents) {
      const section = normalizeSectionName(demo.section);

      // Upsert section
      await supabase
        .from('room_sections')
        .upsert(
          { room_id: roomId, name: section, created_by: participant.id },
          { onConflict: 'room_id,name' }
        );

      const { error: intentErr } = await supabase
        .from('intents')
        .insert({
          room_id: roomId,
          participant_id: participant.id,
          section,
          content: demo.content,
        });

      if (!intentErr) {
        totalIntents++;
        workspaceEvents.push({
          type: 'intent_created',
          participantId: participant.id,
          participantName: participant.name,
          role: roleId,
          section,
          summary: demo.content,
          content: demo.content,
        });
      }
    }
  }

  // Sync workspace state once at the end instead of once per event.
  // Each syncRoomStateToWorkspace call does 5 parallel Supabase reads (loadSnapshot);
  // calling it for every intent (18+) makes populate take 10+ seconds.
  // Write all individual events to events.ndjson in a single pass, then call sync once.
  if (workspaceEvents.length > 0) {
    await syncRoomStateToWorkspace(roomId, workspaceEvents[workspaceEvents.length - 1], workspaceEvents.slice(0, -1));
  }

  return NextResponse.json({ added: missingRoles.length, intents: totalIntents });
}
