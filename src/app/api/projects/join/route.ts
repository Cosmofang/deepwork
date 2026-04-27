import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectCode?: string;
    projectName?: string;
    name?: string;
    mode?: 'panel' | 'agent';
    roleDescription?: string;
  };

  const projectCode = body.projectCode?.trim().toUpperCase();
  const name = body.name?.trim();
  const mode = body.mode ?? 'panel';
  const roleDescription = body.roleDescription?.trim() ?? '';
  const projectName = body.projectName?.trim() || 'Untitled Project';

  if (!projectCode || !name) {
    return NextResponse.json({ error: 'projectCode and name are required' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json(
      { error: 'Supabase not configured', missing: { NEXT_PUBLIC_SUPABASE_URL: !configStatus.hasUrl, SUPABASE_SERVICE_ROLE_KEY: !configStatus.hasServiceRoleKey } },
      { status: 503 }
    );
  }

  const supabase = createClient();

  // Upsert project
  const { error: projError } = await supabase
    .from('projects')
    .upsert({ id: projectCode, name: projectName }, { onConflict: 'id' });

  if (projError) {
    return NextResponse.json({ error: projError.message }, { status: 500 });
  }

  if (mode === 'agent') {
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .insert({ project_id: projectCode, name, role_description: roleDescription, status: 'idle' })
      .select()
      .single();

    if (agentError || !agent) {
      return NextResponse.json({ error: agentError?.message ?? 'Agent insert failed' }, { status: 500 });
    }

    return NextResponse.json({ projectId: projectCode, agentId: agent.id });
  }

  // Panel mode — no DB row needed
  return NextResponse.json({ projectId: projectCode });
}
