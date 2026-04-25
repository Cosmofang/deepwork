import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { ROLE_IDS, ROLES } from '@/lib/roles';
import { normalizeSectionName } from '@/lib/sections';
import { RoleId } from '@/types';
import { syncRoomStateToWorkspace, RoomStateEvent } from '@/lib/room-state';

// POST /api/demo/populate
// Creates synthetic participants for any roles not yet in the room,
// then submits each one's pre-written demo intents. Idempotent — calling
// it again skips roles that already have a participant.
export async function POST(req: NextRequest) {
  const body = await req.json() as { roomId?: string };
  const roomId = body.roomId?.trim().toUpperCase();

  if (!roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
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

  for (const event of workspaceEvents) {
    await syncRoomStateToWorkspace(roomId, event);
  }

  return NextResponse.json({ added: missingRoles.length, intents: totalIntents });
}
