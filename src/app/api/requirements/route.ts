import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';
import type { Priority } from '@/types';

// Encode priority into the section field so no schema change is needed
const SECTION: Record<Priority, string> = {
  normal: '__REQ__',
  important: '__REQ_H__',
  urgent: '__REQ_U__',
};

const WEIGHT: Record<string, number> = {
  __REQ__: 50,
  __REQ_H__: 75,
  __REQ_U__: 100,
};

const PRIORITY_FROM_SECTION: Record<string, Priority> = {
  __REQ__: 'normal',
  __REQ_H__: 'important',
  __REQ_U__: 'urgent',
};

const REQ_SECTIONS = Object.values(SECTION);
const PENDING_SECTION = '__REQ_PENDING__';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function verifyParticipant(supabase: any, projectId: string, participantId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('participants')
    .select('id')
    .eq('id', participantId)
    .eq('room_id', projectId)
    .maybeSingle();
  return Boolean(data && !error);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectId?: string;
    content?: string;
    participantId?: string;
    priority?: Priority;
  };

  const projectId = body.projectId?.trim().toUpperCase();
  const content = body.content?.trim();
  const participantId = body.participantId?.trim();
  const priority: Priority = body.priority ?? 'normal';

  if (!projectId || !content || !participantId) {
    return NextResponse.json({ error: 'projectId, content, and participantId are required' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const supabase = createClient();

  if (!(await verifyParticipant(supabase, projectId, participantId))) {
    return NextResponse.json({ error: 'participant is not a member of this project' }, { status: 403 });
  }

  const section = SECTION[priority] ?? SECTION.normal;
  const { data: intent, error } = await supabase
    .from('intents')
    .insert({ room_id: projectId, participant_id: participantId, section, content })
    .select()
    .single();

  if (error || !intent) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({
    requirement: {
      id: intent.id,
      project_id: intent.room_id,
      content: intent.content,
      posted_by: participantId,
      created_at: intent.created_at,
      priority,
      weight: WEIGHT[section] ?? 50,
    },
  });
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')?.toUpperCase();
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('intents')
    .select('*')
    .eq('room_id', projectId)
    .in('section', [...REQ_SECTIONS, PENDING_SECTION])
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const requirements = (data ?? []).map((i: Record<string, unknown>) => {
    const sec = (i.section as string) ?? '__REQ__';
    const isPending = sec === PENDING_SECTION;
    return {
      id: i.id,
      project_id: i.room_id,
      content: i.content,
      posted_by: i.participant_id,
      created_at: i.created_at,
      priority: isPending ? 'normal' : (PRIORITY_FROM_SECTION[sec] ?? 'normal'),
      weight: isPending ? 0 : (WEIGHT[sec] ?? 50),
      pending: isPending || undefined,
    };
  });

  return NextResponse.json({ requirements });
}

// PATCH /api/requirements — confirm a pending requirement (promote to active).
// Requires projectId + participantId. Caller must be a member of the project,
// and the requirement must belong to that project.
export async function PATCH(req: NextRequest) {
  const body = await req.json() as { id?: string; projectId?: string; participantId?: string; priority?: Priority };
  const id = body.id?.trim();
  const projectId = body.projectId?.trim().toUpperCase();
  const participantId = body.participantId?.trim();
  const priority: Priority = body.priority ?? 'normal';

  if (!id || !projectId || !participantId) {
    return NextResponse.json({ error: 'id, projectId, and participantId are required' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const supabase = createClient();

  if (!(await verifyParticipant(supabase, projectId, participantId))) {
    return NextResponse.json({ error: 'participant is not a member of this project' }, { status: 403 });
  }

  // Load and verify the requirement is in this project AND is currently pending
  const { data: intent, error: loadError } = await supabase
    .from('intents')
    .select('id, room_id, section')
    .eq('id', id)
    .maybeSingle();

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!intent) return NextResponse.json({ error: 'requirement not found' }, { status: 404 });
  if (intent.room_id !== projectId) {
    return NextResponse.json({ error: 'requirement does not belong to this project' }, { status: 403 });
  }
  if (intent.section !== PENDING_SECTION) {
    return NextResponse.json({ error: 'only pending requirements can be promoted' }, { status: 409 });
  }

  const { error } = await supabase
    .from('intents')
    .update({ section: SECTION[priority] ?? SECTION.normal })
    .eq('id', id)
    .eq('section', PENDING_SECTION);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/requirements?id=xxx&projectId=xxx&participantId=xxx
// Requires projectId + participantId. Caller must be a member of the project.
// - For active requirements: caller must be the original poster (participant_id match).
// - For pending requirements (AI suggestions): any project member can dismiss.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim();
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim().toUpperCase();
  const participantId = req.nextUrl.searchParams.get('participantId')?.trim();

  if (!id || !projectId || !participantId) {
    return NextResponse.json({ error: 'id, projectId, and participantId are required' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const supabase = createClient();

  if (!(await verifyParticipant(supabase, projectId, participantId))) {
    return NextResponse.json({ error: 'participant is not a member of this project' }, { status: 403 });
  }

  const { data: intent, error: loadError } = await supabase
    .from('intents')
    .select('id, room_id, section, participant_id')
    .eq('id', id)
    .maybeSingle();

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!intent) return NextResponse.json({ error: 'requirement not found' }, { status: 404 });
  if (intent.room_id !== projectId) {
    return NextResponse.json({ error: 'requirement does not belong to this project' }, { status: 403 });
  }

  // For active (non-pending) requirements, only the poster can delete.
  // Pending suggestions can be dismissed by any project member.
  if (intent.section !== PENDING_SECTION && intent.participant_id !== participantId) {
    return NextResponse.json({ error: 'only the original poster can delete this requirement' }, { status: 403 });
  }

  const { error } = await supabase.from('intents').delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
