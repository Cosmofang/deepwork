import { NextRequest, NextResponse } from 'next/server';
import { ROLE_IDS, ROLES } from '@/lib/roles';
import { syncRoomStateToWorkspace } from '@/lib/room-state';
import { createClient } from '@/lib/supabase-server';
import { RoleId } from '@/types';

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    name?: string;
    role?: RoleId;
    roomCode?: string;
  };

  const name = body.name?.trim();
  const role = body.role;
  const roomCode = body.roomCode?.trim().toUpperCase();

  if (!name || !roomCode || !role || !ROLE_IDS.includes(role)) {
    return NextResponse.json({ error: 'Invalid join request' }, { status: 400 });
  }

  const supabase = createClient();

  const { error: roomError } = await supabase
    .from('rooms')
    .upsert({ id: roomCode, status: 'collecting' }, { onConflict: 'id' });

  if (roomError) {
    return NextResponse.json({ error: roomError.message }, { status: 500 });
  }

  const { data: participant, error: participantError } = await supabase
    .from('participants')
    .insert({ room_id: roomCode, name, role, color: ROLES[role].color })
    .select()
    .single();

  if (participantError || !participant) {
    return NextResponse.json({ error: participantError?.message || 'Join failed' }, { status: 500 });
  }

  await syncRoomStateToWorkspace(roomCode, {
    type: 'room_joined',
    participantId: participant.id,
    participantName: participant.name,
    role,
    summary: `${participant.name} 以 ${ROLES[role].label} 身份加入房间`,
  });

  return NextResponse.json({ participant });
}
