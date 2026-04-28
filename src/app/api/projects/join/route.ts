import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

// Mapping: projects → rooms, agents → participants(role='employee'), panel → participants(role='product')
// mode='panel' creates ONLY a panel participant (a human posting requirements).
// mode='agent' creates ONLY an agent participant (a worker that will pick up requirements).
// Each connect call is exactly one role — joining as panel does NOT also register an agent,
// otherwise the panel UI would falsely show an agent online without any worker actually running.

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectCode?: string;
    name?: string;
    mode?: 'panel' | 'agent';
    roleDescription?: string;
  };

  const projectCode = body.projectCode?.trim().toUpperCase();
  const name = body.name?.trim();
  const mode = body.mode ?? 'panel';
  const roleDescription = body.roleDescription?.trim() ?? '';

  if (!projectCode || !name) {
    return NextResponse.json({ error: 'projectCode and name are required' }, { status: 400 });
  }

  if (mode !== 'panel' && mode !== 'agent') {
    return NextResponse.json({ error: 'mode must be "panel" or "agent"' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json(
      { error: 'Supabase not configured', missing: { NEXT_PUBLIC_SUPABASE_URL: !configStatus.hasUrl, SUPABASE_SERVICE_ROLE_KEY: !configStatus.hasServiceRoleKey } },
      { status: 503 }
    );
  }

  const supabase = createClient();

  // Upsert room
  const { error: roomError } = await supabase
    .from('rooms')
    .upsert({ id: projectCode, status: 'collecting' }, { onConflict: 'id' });

  if (roomError) {
    return NextResponse.json({ error: roomError.message }, { status: 500 });
  }

  if (mode === 'panel') {
    const { data, error } = await supabase
      .from('participants')
      .insert({ room_id: projectCode, name, role: 'product', color: '#3b82f6' })
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Panel participant insert failed' }, { status: 500 });
    }

    return NextResponse.json({
      projectId: projectCode,
      panelParticipantId: data.id,
      mode,
    });
  }

  // mode === 'agent'
  const agentDisplayName = roleDescription ? `${name}｜${roleDescription}` : name;
  const { data, error } = await supabase
    .from('participants')
    .insert({ room_id: projectCode, name: agentDisplayName, role: 'employee', color: '#6366f1' })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Agent insert failed' }, { status: 500 });
  }

  return NextResponse.json({
    projectId: projectCode,
    agentId: data.id,
    mode,
  });
}
