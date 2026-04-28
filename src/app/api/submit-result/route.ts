import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

// Direct result submission — agent supplies html/summary itself (no Claude call)
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectId?: string;
    requirementId?: string;
    agentId?: string;
    html?: string;
    summary?: string;
  };

  const projectId = body.projectId?.trim().toUpperCase();
  const requirementId = body.requirementId?.trim();
  const agentId = body.agentId?.trim();
  const html = body.html?.trim();
  const summary = body.summary?.trim() ?? '';

  if (!projectId || !requirementId || !agentId || !html) {
    return NextResponse.json(
      { error: 'projectId, requirementId, agentId, html required' },
      { status: 400 },
    );
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createClient();

  // Verify requirement exists
  const { data: intent } = await supabase
    .from('intents')
    .select('id')
    .eq('id', requirementId)
    .eq('room_id', projectId)
    .maybeSingle();

  if (!intent) {
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
  }

  // Dedup check
  const { data: existing } = await supabase
    .from('synthesis_results')
    .select('id')
    .eq('room_id', projectId)
    .filter('attribution_map->>requirement_id', 'eq', requirementId)
    .filter('attribution_map->>agent_id', 'eq', agentId)
    .maybeSingle();

  if (existing?.id) {
    return NextResponse.json(
      { error: 'Already submitted', submissionId: existing.id },
      { status: 409 },
    );
  }

  // Fetch agent display name
  const { data: participant } = await supabase
    .from('participants')
    .select('name')
    .eq('id', agentId)
    .maybeSingle();

  const rawName = (participant?.name as string) ?? 'Agent';
  const nameParts = rawName.split('｜');
  const agentName = nameParts[0] ?? rawName;
  const roleDescription = nameParts[1] ?? '';

  const { data: result, error: insertError } = await supabase
    .from('synthesis_results')
    .insert({
      room_id: projectId,
      round: 1,
      html_content: html,
      attribution_map: {
        agent_id: agentId,
        agent_name: agentName,
        role_description: roleDescription,
        requirement_id: requirementId,
        summary,
      },
      conflicts_resolved: null,
    })
    .select()
    .single();

  if (insertError || !result) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Insert failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    submissionId: result.id,
    projectId,
    requirementId,
    agentId,
  });
}
