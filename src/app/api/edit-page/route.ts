import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

// Save a user-edited HTML page as a new version in synthesis_results.
// Distinct from /api/submit-result because:
//   - no requirementId is needed (a manual edit isn't tied to a specific intent)
//   - the actor is a panel participant, not an agent
//   - attribution_map records edit_origin so the feed/version history can label it
//
// Caller must be a member of the project (verified by participant lookup).
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectId?: string;
    panelParticipantId?: string;
    html?: string;
    summary?: string;
    basedOnSubmissionId?: string;
  };

  const projectId = body.projectId?.trim().toUpperCase();
  const panelParticipantId = body.panelParticipantId?.trim();
  const html = body.html;
  const summary = body.summary?.trim() ?? '人工编辑';
  const basedOnSubmissionId = body.basedOnSubmissionId?.trim() ?? null;

  if (!projectId || !panelParticipantId || !html) {
    return NextResponse.json(
      { error: 'projectId, panelParticipantId, and html are required' },
      { status: 400 },
    );
  }

  if (typeof html !== 'string' || html.length < 20) {
    return NextResponse.json(
      { error: 'html must be a non-empty document string' },
      { status: 400 },
    );
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createClient();

  // Verify caller is actually a member of this project
  const { data: participant, error: pErr } = await supabase
    .from('participants')
    .select('id, name, role')
    .eq('id', panelParticipantId)
    .eq('room_id', projectId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!participant) {
    return NextResponse.json({ error: 'participant is not a member of this project' }, { status: 403 });
  }

  const rawName = (participant.name as string) ?? '面板用户';
  const editorName = rawName.split('｜')[0] ?? rawName;

  const { data: result, error: insertError } = await supabase
    .from('synthesis_results')
    .insert({
      room_id: projectId,
      round: 1,
      html_content: html,
      attribution_map: {
        agent_id: panelParticipantId,
        agent_name: editorName,
        role_description: '面板编辑',
        requirement_id: '',
        summary,
        edit_origin: basedOnSubmissionId,
      },
      conflicts_resolved: null,
    })
    .select()
    .single();

  if (insertError || !result) {
    return NextResponse.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    submissionId: result.id,
    projectId,
    panelParticipantId,
  });
}
