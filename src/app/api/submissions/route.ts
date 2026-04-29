import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

// submissions → synthesis_results
// Metadata stored in attribution_map: { agent_id, agent_name, requirement_id, summary, role_description }

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')?.toUpperCase();
  const requirementId = req.nextUrl.searchParams.get('requirementId');
  const lite = req.nextUrl.searchParams.get('lite') === '1';

  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const supabase = createClient();

  // In lite mode skip the html_content column (large)
  const selectCols = lite ? 'id,room_id,attribution_map,created_at' : '*';

  let query = supabase
    .from('synthesis_results')
    .select(selectCols)
    .eq('room_id', projectId)
    .order('created_at', { ascending: false });

  if (requirementId) {
    query = query.filter('attribution_map->>requirement_id', 'eq', requirementId);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const submissions = ((data ?? []) as unknown as Record<string, unknown>[]).map((r: Record<string, unknown>) => {
    const meta = (r.attribution_map ?? {}) as Record<string, string>;
    return {
      id: r.id,
      project_id: r.room_id,
      requirement_id: meta.requirement_id ?? '',
      agent_id: meta.agent_id ?? '',
      html_content: lite ? '' : r.html_content,
      summary: meta.summary ?? '',
      thinking: meta.thinking ?? '',
      created_at: r.created_at,
      agent: {
        id: meta.agent_id ?? '',
        name: meta.agent_name ?? '未知 Agent',
        role_description: meta.role_description ?? '',
        status: 'idle',
      },
    };
  });

  return NextResponse.json({ submissions });
}
