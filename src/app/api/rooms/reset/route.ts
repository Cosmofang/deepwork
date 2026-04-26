import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const body = await req.json() as { roomId?: string };
  const roomId = body.roomId?.trim().toUpperCase();

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
        hint: 'Create .env.local from .env.local.example and set real Supabase values before resetting a room.',
      },
      { status: 503 }
    );
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
