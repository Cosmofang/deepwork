const MULTICA_BASE = 'http://10.10.130.190:8080/api';
const MULTICA_TOKEN = 'mul_f82e56dced0d1a0a48099cc87e9cf3451104a15f';
const WORKSPACE_ID = 'eb02b324-7454-4af9-a242-47174178c87c';

type Priority = 'low' | 'medium' | 'high' | 'urgent';
type IssueStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

export interface MulticaIssue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  identifier: string;
  workspace_id: string;
  created_at: string;
}

export interface MulticaComment {
  id: string;
  content: string;
  author_type: 'agent' | 'member';
  created_at: string;
}

function headers() {
  return {
    'Authorization': `Bearer ${MULTICA_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function createIssue(title: string, description: string, priority: Priority = 'medium'): Promise<MulticaIssue> {
  const res = await fetch(`${MULTICA_BASE}/issues?workspace_id=${WORKSPACE_ID}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ title, description, priority }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Multica createIssue failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<MulticaIssue>;
}

export async function getIssue(issueId: string): Promise<MulticaIssue> {
  const res = await fetch(`${MULTICA_BASE}/issues/${issueId}?workspace_id=${WORKSPACE_ID}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Multica getIssue failed ${res.status}`);
  return res.json() as Promise<MulticaIssue>;
}

export async function updateIssueStatus(issueId: string, status: IssueStatus): Promise<MulticaIssue> {
  const res = await fetch(`${MULTICA_BASE}/issues/${issueId}?workspace_id=${WORKSPACE_ID}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Multica updateIssue failed ${res.status}`);
  return res.json() as Promise<MulticaIssue>;
}

export async function getComments(issueId: string): Promise<MulticaComment[]> {
  const res = await fetch(`${MULTICA_BASE}/issues/${issueId}/comments?workspace_id=${WORKSPACE_ID}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Multica getComments failed ${res.status}`);
  const data = await res.json() as MulticaComment[] | { comments?: MulticaComment[]; data?: MulticaComment[] };
  return Array.isArray(data) ? data : ((data as { comments?: MulticaComment[]; data?: MulticaComment[] }).comments ?? (data as { data?: MulticaComment[] }).data ?? []);
}

export async function addComment(issueId: string, content: string): Promise<MulticaComment> {
  const res = await fetch(`${MULTICA_BASE}/issues/${issueId}/comments?workspace_id=${WORKSPACE_ID}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Multica addComment failed ${res.status}`);
  return res.json() as Promise<MulticaComment>;
}

// Poll comments until an agent comment containing HTML appears (or timeout)
export async function pollForHtmlComment(
  issueId: string,
  { intervalMs = 8000, timeoutMs = 480_000 } = {}
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const comments = await getComments(issueId);
    for (const c of comments) {
      if (c.author_type === 'agent' && c.content.includes('<!DOCTYPE html')) {
        const match = c.content.match(/(<!DOCTYPE html[\s\S]*<\/html>)/i);
        if (match) return match[1];
        // whole content might be raw HTML
        if (c.content.trim().startsWith('<!DOCTYPE')) return c.content;
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}
