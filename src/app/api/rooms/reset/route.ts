import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const body = await req.json() as { roomId?: string };
  const roomId = body.roomId?.trim().toUpperCase();

  if (!roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('rooms')
    .update({ status: 'collecting' })
    .eq('id', roomId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
