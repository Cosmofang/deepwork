import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

// Agent pings this when it picks up / finishes a requirement.
// We relay via Supabase Realtime Broadcast so the panel updates in real-time without a DB write.
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectId?: string;
    agentId?: string;
    agentName?: string;
    requirementId?: string;
    phase?: 'picked' | 'generating' | 'done';
  };

  const projectId    = body.projectId?.trim().toUpperCase();
  const agentId      = body.agentId?.trim();
  const agentName    = body.agentName?.trim() ?? 'Agent';
  const requirementId = body.requirementId?.trim();
  const phase        = body.phase ?? 'generating';

  if (!projectId || !requirementId) {
    return NextResponse.json({ error: 'projectId and requirementId required' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createClient();

  // Broadcast to the panel's activity channel — no DB write needed
  await supabase.channel(`dw-activity-${projectId}`).send({
    type: 'broadcast',
    event: 'agent_ping',
    payload: { agentId, agentName, requirementId, phase },
  });

  return NextResponse.json({ ok: true });
}
