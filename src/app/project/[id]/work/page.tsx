'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Requirement, Submission, UserStatus, PresenceData } from '@/types';

type WorkStatus = 'connecting' | 'idle' | 'working' | 'done_waiting';

const REQ_SECTIONS = ['__REQ__', '__REQ_H__', '__REQ_U__'];
const SECTION_WEIGHT: Record<string, number> = { __REQ__: 50, __REQ_H__: 75, __REQ_U__: 100 };
const SECTION_PRIORITY: Record<string, string> = { __REQ__: 'normal', __REQ_H__: 'important', __REQ_U__: 'urgent' };

const COLORS = ['#f59e0b', '#3b82f6', '#ec4899', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'];
function getUserColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const STATUS_COLOR: Record<WorkStatus, string> = {
  connecting:   'var(--c-text-5)',
  idle:         'var(--c-text-4)',
  working:      '#f59e0b',
  done_waiting: '#4ade80',
};

export default function AgentWorkPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = id.toUpperCase();

  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('');
  const [agentRole, setAgentRole] = useState('');
  const [status, setStatus] = useState<WorkStatus>('connecting');
  const [currentReq, setCurrentReq] = useState<Requirement | null>(null);
  const [mySubmissions, setMySubmissions] = useState<Submission[]>([]);
  const [allReqs, setAllReqs] = useState<Requirement[]>([]);
  const [error, setError] = useState('');
  const [viewingHtml, setViewingHtml] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(true);
  const [, setTick] = useState(0);

  const processingRef = useRef(false);
  const agentIdRef = useRef<string | null>(null);
  const presenceRef = useRef<((data: PresenceData) => void) | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  // ── presence ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!agentId || !agentName) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`dw-prs-${projectId}`, { config: { presence: { key: agentId } } });

    ch.subscribe(async (s) => {
      if (s !== 'SUBSCRIBED') return;
      presenceRef.current = (data) => void ch.track(data);
      presenceRef.current({
        userId: agentId,
        name: agentName,
        status: 'idle',
        isAgent: true,
        roleDescription: agentRole,
        color: getUserColor(agentId),
        lastActiveAt: Date.now(),
      });
    });

    return () => { presenceRef.current = null; void supabase.removeChannel(ch); };
  }, [agentId, agentName, agentRole, projectId]);

  // Re-track whenever work status changes — bump lastActiveAt every time status flips
  // so an actively-processing agent stays "online", and an idle agent that hasn't
  // taken a job in 100 s will fall into the offline group on the panel.
  const presenceStatus: UserStatus = status === 'working' ? 'working' : 'idle';
  useEffect(() => {
    if (!agentId || !agentName) return;
    presenceRef.current?.({
      userId: agentId,
      name: agentName,
      status: presenceStatus,
      isAgent: true,
      roleDescription: agentRole,
      color: getUserColor(agentId),
      lastActiveAt: Date.now(),
    });
  }, [presenceStatus, agentId, agentName, agentRole]);

  // ── weighted requirement selection ────────────────────────────────────────

  const findHighestWeight = useCallback((reqs: Requirement[], subs: Submission[]) => {
    const submittedReqIds = new Set(subs.map(s => s.requirement_id));
    const pending = reqs.filter(r => !submittedReqIds.has(r.id));
    if (pending.length === 0) return null;
    return pending.sort((a, b) => {
      const wDiff = (b.weight ?? 50) - (a.weight ?? 50);
      if (wDiff !== 0) return wDiff;
      // Among equal weight: older requirement wins
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })[0];
  }, []);

  // ── processing ─────────────────────────────────────────────────────────────

  const processRequirement = useCallback(async (req: Requirement, aId: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setStatus('working');
    setCurrentReq(req);
    setError('');

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, requirementId: req.id, agentId: aId }),
      });
      const text = await res.text();
      const data = (text ? JSON.parse(text) : {}) as { submission?: Submission; error?: string; submissionId?: string };

      if (res.status === 409) {
        setStatus('done_waiting');
      } else if (!res.ok || !data.submission) {
        setError(data.error ?? '生成失败，等待下一条需求');
        setStatus('idle');
      } else {
        setMySubmissions(prev => [data.submission!, ...prev]);
        setStatus('done_waiting');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
      setStatus('idle');
    } finally {
      processingRef.current = false;
    }
  }, [projectId]);

  // ── bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const stored = localStorage.getItem(`agent_id:${projectId}`);
    const name = localStorage.getItem('user_name') ?? 'Agent';
    setAgentName(name);

    if (!stored) { router.replace('/'); return; }

    setAgentId(stored);
    agentIdRef.current = stored;

    const supabase = createClient();

    const init = async () => {
      const [reqRes, subRes, participantRes] = await Promise.all([
        fetch(`/api/requirements?projectId=${projectId}`),
        fetch(`/api/submissions?projectId=${projectId}`),
        supabase.from('participants').select('name').eq('id', stored).maybeSingle(),
      ]);

      const reqData = await reqRes.json() as { requirements: Requirement[] };
      const subData = await subRes.json() as { submissions: Submission[] };
      const reqs = reqData.requirements ?? [];
      const subs = (subData.submissions ?? []).filter((s: Submission) => s.agent_id === stored);

      setAllReqs(reqs);
      setMySubmissions(subs);

      if (participantRes.data?.name) {
        const raw = participantRes.data.name as string;
        const parts = raw.split('｜');
        setAgentName(parts[0] ?? name);
        setAgentRole(parts[1] ?? '');
      }

      const best = findHighestWeight(reqs, subs);
      if (best && autoMode) {
        setStatus('idle');
        void processRequirement(best, stored);
      } else {
        setStatus('idle');
      }
    };

    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── realtime: new requirements ────────────────────────────────────────────

  useEffect(() => {
    if (!agentId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`agent-work-${projectId}-${agentId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'intents', filter: `room_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const sec = row.section as string;
          if (!REQ_SECTIONS.includes(sec)) return;

          const req: Requirement = {
            id: row.id as string,
            project_id: row.room_id as string,
            content: row.content as string,
            posted_by: row.participant_id as string,
            created_at: row.created_at as string,
            priority: SECTION_PRIORITY[sec] as Requirement['priority'] ?? 'normal',
            weight: SECTION_WEIGHT[sec] ?? 50,
          };

          setAllReqs(prev => {
            const updated = [req, ...prev];
            // If auto mode and not processing, start on the highest-weight req
            if (autoMode && !processingRef.current && agentIdRef.current) {
              setMySubmissions(subs => {
                const best = [req, ...prev].sort((a, b) => {
                  const wDiff = (b.weight ?? 50) - (a.weight ?? 50);
                  return wDiff !== 0 ? wDiff : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                }).find(r => !subs.some(s => s.requirement_id === r.id));
                if (best) {
                  setCurrentReq(best);
                  void processRequirement(best, agentIdRef.current!);
                } else {
                  setStatus('idle');
                }
                return subs;
              });
            } else {
              setStatus('idle');
            }
            return updated;
          });
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [agentId, projectId, autoMode, processRequirement]);

  // ── render ────────────────────────────────────────────────────────────────

  const statusLabel = {
    connecting:   '连接中...',
    idle:         '等待需求...',
    working:      '⚡ 生成中...',
    done_waiting: '✓ 已提交，等待下一条需求',
  }[status];

  const statusDotCls = status === 'working'
    ? 'bg-amber-400 animate-pulse'
    : status === 'done_waiting'
    ? 'bg-green-400'
    : 'opacity-20';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--c-bg)', color: 'var(--c-text-1)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--c-border-2)' }}>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">DeepLoop</span>
          <span className="text-xs" style={{ color: 'var(--c-border-5)' }}>·</span>
          <span className="font-mono text-xs px-2 py-1 rounded" style={{ color: 'var(--c-text-5)', background: 'var(--c-overlay-md)' }}>
            {projectId}
          </span>
          <span className="text-xs" style={{ color: 'var(--c-border-5)' }}>·</span>
          <div className="flex items-center gap-1.5">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
              style={{ background: agentId ? getUserColor(agentId) : 'var(--c-overlay-md)', color: '#000' }}
            >
              {agentName[0]?.toUpperCase()}
            </div>
            <span className="text-xs text-purple-400">本机 Claude · {agentName}</span>
            {agentRole && <span className="text-xs" style={{ color: 'var(--c-text-5)' }}>· {agentRole}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoMode(m => !m)}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-all"
            style={autoMode
              ? { background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.35)', color: '#a855f7' }
              : { background: 'var(--c-overlay-md)', border: '1px solid var(--c-border-3)', color: 'var(--c-text-5)' }
            }
          >
            <span>{autoMode ? '⚡' : '⏸'}</span>
            {autoMode ? '自动模式' : '手动模式'}
          </button>
          <a href={`/project/${projectId}`} className="text-xs transition-colors" style={{ color: 'var(--c-text-5)' }}>
            查看面板 →
          </a>
        </div>
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-5 py-8 flex flex-col gap-6">
        {/* Status card */}
        <div className="rounded-2xl p-5" style={{ border: '1px solid var(--c-border-2)', background: 'var(--c-overlay)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotCls}`}
              style={status === 'connecting' || status === 'idle' ? { background: 'var(--c-text-5)' } : {}}
            />
            <span className="text-sm font-medium" style={{ color: STATUS_COLOR[status] }}>{statusLabel}</span>
          </div>

          {status === 'working' && (
            <div className="mt-1">
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--c-overlay-md)' }}>
                <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--c-text-6)' }}>本机 Claude worker 正在分析面板任务并生成结果...</p>
            </div>
          )}

          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        </div>

        {/* Current requirement */}
        {currentReq && (
          <div className="rounded-2xl p-5" style={{ border: '1px solid var(--c-border-2)', background: 'var(--c-overlay)' }}>
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--c-text-5)' }}>当前需求</p>
              {currentReq.priority !== 'normal' && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: currentReq.priority === 'urgent' ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)',
                    color: currentReq.priority === 'urgent' ? '#ef4444' : '#3b82f6',
                    border: `1px solid ${currentReq.priority === 'urgent' ? 'rgba(239,68,68,0.35)' : 'rgba(59,130,246,0.35)'}`,
                  }}
                >
                  {currentReq.priority === 'urgent' ? '紧急' : '重要'} · 权重 {currentReq.weight}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--c-text-2)' }}>{currentReq.content}</p>
            <p className="text-xs mt-3" style={{ color: 'var(--c-text-6)' }}>{timeAgo(currentReq.created_at)}</p>
          </div>
        )}

        {/* Manual trigger */}
        {!autoMode && status === 'idle' && agentId && (() => {
          const best = findHighestWeight(allReqs, mySubmissions);
          return best ? (
            <button
              onClick={() => void processRequirement(best, agentId)}
              className="w-full py-3 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.35)', color: '#a855f7' }}
            >
              处理需求「{best.priority !== 'normal' ? `${best.priority === 'urgent' ? '紧急' : '重要'} · ` : ''}权重 {best.weight}」
            </button>
          ) : null;
        })()}

        {/* My submissions */}
        {mySubmissions.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-5)' }}>我的提交记录</p>
            <div className="flex flex-col gap-3">
              {mySubmissions.map(s => {
                const req = allReqs.find(r => r.id === s.requirement_id);
                return (
                  <div key={s.id} className="rounded-xl p-4" style={{ border: '1px solid var(--c-border-2)', background: 'var(--c-overlay)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-green-500 text-xs">✓ 已提交</span>
                      <span className="text-[10px]" style={{ color: 'var(--c-text-6)' }}>{timeAgo(s.created_at)}</span>
                    </div>
                    {req && <p className="text-xs mb-2 line-clamp-1" style={{ color: 'var(--c-text-5)' }}>{req.content}</p>}
                    {s.summary && <p className="text-xs mb-3" style={{ color: 'var(--c-text-3)' }}>{s.summary}</p>}
                    <div className="relative rounded-lg overflow-hidden" style={{ height: 120, border: '1px solid var(--c-border-1)', background: 'var(--c-input)' }}>
                      <iframe
                        srcDoc={s.html_content}
                        sandbox="allow-scripts"
                        title={`my-sub-${s.id}`}
                        className="w-full h-full"
                        style={{ transform: 'scale(0.4)', transformOrigin: 'top left', width: '250%', height: '250%', pointerEvents: 'none' }}
                      />
                      <div className="absolute inset-0" />
                    </div>
                    <button
                      onClick={() => setViewingHtml(s.html_content)}
                      className="mt-2 w-full py-1.5 rounded-lg text-xs transition-all"
                      style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', color: '#a855f7' }}
                    >
                      查看完整成品
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {mySubmissions.length === 0 && status === 'idle' && allReqs.length === 0 && (
          <div className="text-center text-sm py-12" style={{ color: 'var(--c-text-6)' }}>
            等待面板用户发布需求...
          </div>
        )}
      </div>

      {/* Full result modal */}
      {viewingHtml && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
            <button onClick={() => setViewingHtml(null)} className="text-white/50 hover:text-white transition-colors text-sm">
              ← 返回
            </button>
            <button
              onClick={() => { const b = new Blob([viewingHtml], { type: 'text/html' }); window.open(URL.createObjectURL(b), '_blank'); }}
              className="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}
            >
              新窗口打开
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe srcDoc={viewingHtml} sandbox="allow-scripts" title="full-result" className="w-full h-full border-0" />
          </div>
        </div>
      )}
    </div>
  );
}
