import { NextRequest, NextResponse } from 'next/server';
import { normalizeSectionName } from '@/lib/sections';
import { syncRoomStateToWorkspace } from '@/lib/room-state';
import { createClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    roomId?: string;
    participantId?: string;
    name?: string;
  };

  const roomId = body.roomId?.trim().toUpperCase();
  const participantId = body.participantId?.trim();
  const name = normalizeSectionName(body.name || '');

  if (!roomId || !participantId || !name) {
    return NextResponse.json({ error: 'Invalid section request' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: participant } = await supabase
    .from('participants')
    .select('id, name, role, room_id')
    .eq('id', participantId)
    .maybeSingle();

  if (!participant || participant.room_id !== roomId) {
    return NextResponse.json({ error: 'Participant does not belong to room' }, { status: 403 });
  }

  const { data: section, error } = await supabase
    .from('room_sections')
    .upsert(
      {
        room_id: roomId,
        name,
        created_by: participantId,
      },
      { onConflict: 'room_id,name' }
    )
    .select()
    .single();

  if (error || !section) {
    return NextResponse.json({ error: error?.message || 'Section insert failed' }, { status: 500 });
  }

  await syncRoomStateToWorkspace(roomId, {
    type: 'section_added',
    participantId,
    participantName: participant.name,
    role: participant.role,
    section: name,
    summary: `新增板块：${name}`,
  });

  return NextResponse.json({ section });
}
