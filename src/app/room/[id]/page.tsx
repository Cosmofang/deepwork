'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { ROLE_IDS, ROLES } from '@/lib/roles';
import { DEFAULT_SECTION, DEFAULT_SECTIONS, normalizeSectionName } from '@/lib/sections';
import { Intent, Participant, RoleId } from '@/types';

type IntentWithParticipant = Intent & { participant: Participant };

function mergeSections(existing: string[], additions: string[]) {
  const next = [...existing];
  const seen = new Set(existing.map(normalizeSectionName));

  additions.forEach(section => {
    const normalized = normalizeSectionName(section);
    if (!seen.has(normalized)) {
      next.push(normalized);
      seen.add(normalized);
    }
  });

  return next;
}

type MobileTab = 'intent' | 'flow' | 'sections';

const SYNTHESIS_PHASES = [
  { after: 0,  label: '读取各角色意图...' },
  { after: 5,  label: '分析板块冲突与共识...' },
  { after: 12, label: '生成页面结构与文案...' },
  { after: 22, label: '优化视觉与排版细节...' },
  { after: 32, label: '校验归因，写入结果...' },
] as const;

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [intents, setIntents] = useState<IntentWithParticipant[]>([]);
  const [input, setInput] = useState('');
  const [selectedSection, setSelectedSection] = useState(DEFAULT_SECTION);
  const [sectionDraft, setSectionDraft] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [knownSections, setKnownSections] = useState<string[]>(
    DEFAULT_SECTIONS.map(section => section.name)
  );
  const [newIntentIds, setNewIntentIds] = useState<string[]>([]);
  const [roomStatus, setRoomStatus] = useState<'collecting' | 'synthesizing' | 'done'>('collecting');
  const [requestError, setRequestError] = useState('');
  const [synthesizing, setSynthesizing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [populateToast, setPopulateToast] = useState('');
  const [joinToast, setJoinToast] = useState<{ name: string; role: RoleId } | null>(null);
  const joinToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownParticipantIds = useRef<Set<string>>(new Set());
  const [mobileTab, setMobileTab] = useState<MobileTab>('flow');
  const [afterRound, setAfterRound] = useState(0);
  const [lastSynthesisAt, setLastSynthesisAt] = useState<string | null>(null);
  const intentsEndRef = useRef<HTMLDivElement>(null);
  const intentsRef = useRef<IntentWithParticipant[]>([]);
  const prevRoomStatusRef = useRef<'collecting' | 'synthesizing' | 'done'>('collecting');
  const synthesisStartRef = useRef<number | null>(null);
  const [synthesisElapsed, setSynthesisElapsed] = useState(0);
  const supabase = createClient();
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [agentRole, setAgentRole] = useState<RoleId>('designer');
  const [recentlyActiveIds, setRecentlyActiveIds] = useState<Set<string>>(new Set());
  const recentlyActiveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [agentPanelTab, setAgentPanelTab] = useState<'prompt' | 'curl'>('prompt');
  const [agentCopied, setAgentCopied] = useState(false);

  const buildAgentPrompt = (roleId: RoleId) => {
    const r = ROLES[roleId];
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `你是一个 AI 参与者，正在加入 DeepLoop 多角色意图合成会议。

**你的角色**：${r.label}（${r.typical}）

**任务**：通过以下两步 API 加入房间并提交 2–3 条产品意图。

---

### 步骤 1：加入房间

POST ${base}/api/rooms/join
Content-Type: application/json

{
  "name": "AI-${r.label}",
  "role": "${roleId}",
  "roomCode": "${id}"
}

→ 记录返回的 participant.id（后续提交意图时需要）

---

### 步骤 2：提交意图（重复 2–3 次，每次换 section 和 content）

POST ${base}/api/intents
Content-Type: application/json

{
  "participantId": "<步骤 1 返回的 id>",
  "roomId": "${id}",
  "section": "<板块名>",
  "content": "<你的意图，20–80 字>"
}

合法板块名：首屏 | 功能亮点 | 价值主张 | 社交证明 | 定价 | FAQ | CTA | 整体 | 企业介绍

---

### 角色指引

你的典型关注点：${r.typical}

请结合你的角色视角，提交 2–3 条具体可执行的意图（设计/内容/功能建议均可）。提交后即可等待主持人触发 AI 合成。`;
  };

  const buildAgentCurl = (roleId: RoleId) => {
    const r = ROLES[roleId];
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const sampleContent = r.demoIntents[0]?.content.replace(/"/g, '\\"') ?? '你的意图内容';
    return `#!/bin/bash
# DeepLoop Agent 接入脚本 — 角色：${r.label}
BASE="${base}"
ROOM="${id}"

# 步骤 1：加入房间
RESPONSE=$(curl -s -X POST "$BASE/api/rooms/join" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"AI-${r.label}","role":"${roleId}","roomCode":"${id}"}')

PID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['participant']['id'])" 2>/dev/null)
if [ -z "$PID" ]; then echo "加入失败: $RESPONSE"; exit 1; fi
echo "已加入，participant ID: $PID"

# 步骤 2：提交意图（修改 section 和 content 后可重复运行）
curl -s -X POST "$BASE/api/intents" \\
  -H "Content-Type: application/json" \\
  -d "{\\\"participantId\\\":\\\"$PID\\\",\\\"roomId\\\":\\\"$ROOM\\\",\\\"section\\\":\\\"首屏\\\",\\\"content\\\":\\\"${sampleContent}\\\"}"
echo -e "\\n✓ 意图已提交"`;
  };

  const copyAgentText = () => {
    const text = agentPanelTab === 'prompt' ? buildAgentPrompt(agentRole) : buildAgentCurl(agentRole);
    navigator.clipboard.writeText(text)
      .then(() => { setAgentCopied(true); setTimeout(() => setAgentCopied(false), 1800); })
      .catch(() => null);
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(id)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => null);
  };

  useEffect(() => {
    const pid = localStorage.getItem(`participant_id:${id}`) || localStorage.getItem('participant_id');
    if (!pid) { router.push('/'); return; }

    supabase
      .from('participants')
      .select('*')
      .eq('id', pid)
      .single()
      .then(({ data }) => {
        if (data && data.room_id === id) {
          setParticipant(data);
          localStorage.setItem(`participant_id:${id}`, data.id);
        }
        else router.push('/');
      });
  }, [id, router, supabase]);

  useEffect(() => {
    supabase
      .from('rooms')
      .select('status')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.status) {
          const s = data.status as 'collecting' | 'synthesizing' | 'done';
          prevRoomStatusRef.current = s;
          setRoomStatus(s);
        }
      });
  }, [id, supabase]);

  useEffect(() => {
    const loadParticipants = (showToast = false) => {
      supabase
        .from('participants')
        .select('*')
        .eq('room_id', id)
        .then(({ data }) => {
          if (!data) return;
          const list = data as Participant[];
          if (showToast) {
            const newcomer = list.find(p => !knownParticipantIds.current.has(p.id));
            if (newcomer) {
              if (joinToastTimer.current) clearTimeout(joinToastTimer.current);
              setJoinToast({ name: newcomer.name, role: newcomer.role as RoleId });
              joinToastTimer.current = setTimeout(() => setJoinToast(null), 3500);
            }
          }
          list.forEach(p => knownParticipantIds.current.add(p.id));
          setParticipants(list);
        });
    };
    loadParticipants(false);
    const channel = supabase
      .channel(`participants:${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'participants',
        filter: `room_id=eq.${id}`,
      }, () => loadParticipants(true))
      .subscribe();
    // Poll every 4s as fallback in case Realtime misses an INSERT
    const poll = setInterval(() => loadParticipants(false), 4000);
    return () => { clearInterval(poll); supabase.removeChannel(channel); };
  }, [id, supabase]);

  useEffect(() => {
    supabase
      .from('room_sections')
      .select('*')
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        setKnownSections(prev => mergeSections(prev, data.map(section => section.name)));
      });
  }, [id, supabase]);

  useEffect(() => {
    supabase
      .from('intents')
      .select('*, participant:participants(*)')
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const nextIntents = data as IntentWithParticipant[];
        setIntents(nextIntents);
        setKnownSections(prev => mergeSections(prev, nextIntents.map(intent => intent.section)));
      });
  }, [id]);

  useEffect(() => {
    const stored = localStorage.getItem(`after_round:${id}`);
    if (!stored) return;
    const round = parseInt(stored, 10);
    if (!round || isNaN(round)) return;
    setAfterRound(round);
    supabase
      .from('synthesis_results')
      .select('created_at')
      .eq('room_id', id)
      .eq('round', round)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.created_at) setLastSynthesisAt(data.created_at as string);
      });
  }, [id, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`intents:${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'intents',
        filter: `room_id=eq.${id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('intents')
          .select('*, participant:participants(*)')
          .eq('id', payload.new.id)
          .single();
        if (!data) return;

        const nextIntent = data as IntentWithParticipant;
        setIntents(prev => [...prev, nextIntent]);
        setKnownSections(prev => mergeSections(prev, [nextIntent.section]));

        // Keep participants state up-to-date: intent payloads include the participant,
        // so we can patch in any newcomer even if the participants Realtime event was missed.
        if (nextIntent.participant) {
          setParticipants(prev =>
            prev.some(p => p.id === nextIntent.participant!.id)
              ? prev
              : [...prev, nextIntent.participant!]
          );
        }

        if (nextIntent.participant_id !== participant?.id) {
          setNewIntentIds(prev => (prev.includes(nextIntent.id) ? prev : [...prev, nextIntent.id]));
        }

        // Mark submitter as recently active for 5s (drives pulsing status dot)
        const pid = nextIntent.participant_id;
        if (pid) {
          const existing = recentlyActiveTimers.current.get(pid);
          if (existing) clearTimeout(existing);
          setRecentlyActiveIds(prev => { const next = new Set(prev); next.add(pid); return next; });
          const timer = setTimeout(() => {
            setRecentlyActiveIds(prev => { const next = new Set(prev); next.delete(pid); return next; });
            recentlyActiveTimers.current.delete(pid);
          }, 5000);
          recentlyActiveTimers.current.set(pid, timer);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, participant?.id]);

  useEffect(() => {
    const roomSectionsChannel = supabase
      .channel(`room_sections:${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'room_sections',
        filter: `room_id=eq.${id}`,
      }, payload => {
        const sectionName = String(payload.new.name || '');
        setKnownSections(prev => mergeSections(prev, [sectionName]));
      })
      .subscribe();

    const roomChannel = supabase
      .channel(`room-status:${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${id}`,
      }, payload => {
        const status = payload.new.status as 'collecting' | 'synthesizing' | 'done';
        if (prevRoomStatusRef.current === 'synthesizing' && status === 'collecting') {
          setRequestError('合成失败，请重试');
        }
        prevRoomStatusRef.current = status;
        setRoomStatus(status);
        setSynthesizing(status === 'synthesizing');
        if (status === 'done') {
          localStorage.removeItem(`after_round:${id}`);
          router.push(`/room/${id}/result`);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(roomSectionsChannel);
      supabase.removeChannel(roomChannel);
    };
  }, [id, supabase]);

  useEffect(() => {
    intentsRef.current = intents;
    intentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [intents]);

  const submitIntent = async () => {
    if (!input.trim() || !participant) return;
    const content = input.trim();
    const section = normalizeSectionName(selectedSection);
    setRequestError('');
    setInput('');
    const res = await fetch('/api/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: id,
        participantId: participant.id,
        section,
        content,
      }),
    });

    if (!res.ok) {
      setInput(content);
      setRequestError('提交意图失败，请重试');
    }
  };

  const addSection = () => {
    void (async () => {
      const normalized = normalizeSectionName(sectionDraft);
      if (!normalized || !participant) return;

      setRequestError('');
      const res = await fetch('/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: id,
          participantId: participant.id,
          name: normalized,
        }),
      });

      if (!res.ok) {
        setRequestError('新建板块失败，请重试');
        return;
      }

      setSelectedSection(normalized);
      setSectionFilter(normalized);
      setSectionDraft('');
    })();
  };

  const populateDemo = async (round?: number) => {
    if (populating) return;
    setPopulating(true);
    setRequestError('');
    const beforeCount = intents.length;
    await fetch('/api/demo/populate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: id, ...(round && round > 1 ? { round } : {}) }),
    }).catch(() => null);
    setPopulating(false);
    // Intents arrive via realtime; read fresh count from ref after 1.2s
    setTimeout(() => {
      const added = intentsRef.current.length - beforeCount;
      if (added > 0) {
        setPopulateToast(`✓ 已填充 ${added} 条意图`);
        setTimeout(() => setPopulateToast(''), 2800);
      }
    }, 1200);
  };

  const triggerSynthesis = () => {
    if (intents.length === 0 || synthesizing || roomStatus === 'synthesizing') return;
    setSynthesizing(true);
    setRequestError('');
    localStorage.removeItem(`after_round:${id}`);
    fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: id }),
    }).catch(() => null);
    router.push(`/room/${id}/result`);
  };

  useEffect(() => {
    const active = synthesizing || roomStatus === 'synthesizing';
    if (!active) {
      synthesisStartRef.current = null;
      setSynthesisElapsed(0);
      return;
    }
    if (synthesisStartRef.current === null) synthesisStartRef.current = Date.now();
    const iv = setInterval(() => {
      setSynthesisElapsed(Math.floor((Date.now() - synthesisStartRef.current!) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [synthesizing, roomStatus]);

  const role = participant ? ROLES[participant.role as RoleId] : null;
  const filteredIntents = sectionFilter === 'all'
    ? intents
    : intents.filter(intent => normalizeSectionName(intent.section) === sectionFilter);
  const sectionCards = knownSections.map(section => {
    const sectionIntents = intents.filter(intent => normalizeSectionName(intent.section) === section);
    const newCount = sectionIntents.filter(intent => newIntentIds.includes(intent.id)).length;
    const latestIntent = sectionIntents[sectionIntents.length - 1];
    const defaultSection = DEFAULT_SECTIONS.find(item => item.name === section);

    return {
      section,
      hint: defaultSection?.hint || '自定义协作板块',
      total: sectionIntents.length,
      newCount,
      latestIntent,
    };
  });
  const totalNewCount = newIntentIds.length;

  const synthesisPhase = SYNTHESIS_PHASES.filter(p => synthesisElapsed >= p.after).at(-1)!;

  const currentRound = afterRound + 1;
  const prevRoundIntents = lastSynthesisAt
    ? filteredIntents.filter(i => new Date(i.created_at) <= new Date(lastSynthesisAt))
    : [];
  const thisRoundIntents = lastSynthesisAt
    ? filteredIntents.filter(i => new Date(i.created_at) > new Date(lastSynthesisAt))
    : filteredIntents;

  const contributingRoleIds = Array.from(
    new Set(
      intents
        .map(i => i.participant?.role)
        .filter((r): r is RoleId => Boolean(r))
    )
  );

  const activeSections = knownSections.filter(s =>
    intents.some(i => normalizeSectionName(i.section) === s)
  );

  const intentCountByRole: Record<string, number> = {};
  const intentCountByParticipant: Record<string, number> = {};
  for (const intent of intents) {
    const role = intent.participant?.role;
    if (role) intentCountByRole[role] = (intentCountByRole[role] ?? 0) + 1;
    const pid = intent.participant_id;
    if (pid) intentCountByParticipant[pid] = (intentCountByParticipant[pid] ?? 0) + 1;
  }

  return (
    <div className="h-screen bg-[var(--c-bg)] flex flex-col overflow-hidden">

      {/* Synthesis loading overlay */}
      {(synthesizing || roomStatus === 'synthesizing') && (
        <div className="fixed inset-0 z-50 bg-[var(--c-bg)] flex items-center justify-center">
          <div className="max-w-sm w-full px-6 text-center">

            <div className="relative w-20 h-20 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border border-[var(--c-border-1)]" />
              <div
                className="absolute inset-0 rounded-full border-2 border-transparent border-t-black/30 animate-spin"
                style={{ animationDuration: '1.4s' }}
              />
              <div className="absolute inset-3 rounded-full border border-[var(--c-border-1)]" />
              <div
                className="absolute inset-3 rounded-full border-2 border-transparent border-t-black/15 animate-spin"
                style={{ animationDuration: '2.2s', animationDirection: 'reverse' }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-black/10" />
              </div>
            </div>

            <h2 className="text-xl font-semibold text-[var(--c-text-1)] mb-2">
              AI 正在合成{afterRound > 0 ? <span className="text-amber-600"> Round {currentRound}</span> : ''}
            </h2>
            <p className="text-[var(--c-text-4)] text-sm mb-8">
              整合{' '}
              <span className="text-[var(--c-text-1)] font-medium">{contributingRoleIds.length} 个角色</span>
              {' '}·{' '}
              <span className="text-[var(--c-text-1)] font-medium">{intents.length} 条意图</span>
              {afterRound > 0 ? (
                <>{' '}·{' '}<span className="text-amber-600/70 text-xs">在第 {afterRound} 轮基础上增量</span></>
              ) : ' → 一个产物'}
            </p>

            {contributingRoleIds.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-8">
                {contributingRoleIds.map(roleId => {
                  const r = ROLES[roleId];
                  return (
                    <div
                      key={roleId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border"
                      style={{
                        borderColor: `${r.color}40`,
                        backgroundColor: `${r.color}12`,
                        color: r.color,
                      }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
                      {r.label}
                    </div>
                  );
                })}
              </div>
            )}

            {activeSections.length > 0 && (
              <div className="rounded-2xl border border-[var(--c-border-2)] bg-black/[0.025] p-4 mb-8 text-left space-y-2.5">
                {activeSections.map(section => {
                  const sectionIntents = intents.filter(
                    i => normalizeSectionName(i.section) === section
                  );
                  return (
                    <div key={section} className="flex items-center gap-3">
                      <div className="flex gap-0.5 flex-shrink-0">
                        {sectionIntents.slice(0, 6).map((intent, j) => {
                          const r = intent.participant ? ROLES[intent.participant.role as RoleId] : null;
                          return (
                            <div
                              key={j}
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: r?.color || '#d4cfc8' }}
                            />
                          );
                        })}
                        {sectionIntents.length > 6 && (
                          <div className="w-2 h-2 rounded-full bg-black/[0.08]" />
                        )}
                      </div>
                      <span className="text-sm text-[var(--c-text-3)] flex-1 truncate">{section}</span>
                      <span className="text-xs text-[var(--c-text-5)] flex-shrink-0">{sectionIntents.length} 条</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs text-[var(--c-text-3)] transition-all duration-700">{synthesisPhase.label}</p>
              <p className="text-xs text-[var(--c-text-5)]">{synthesisElapsed}s · 完成后自动跳转</p>
            </div>
          </div>
        </div>
      )}

      {/* Populate success toast */}
      {populateToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-5 py-2.5 rounded-2xl text-sm font-medium shadow-lg pointer-events-none"
          style={{ background: 'rgba(5,150,105,0.92)', color: '#fff', backdropFilter: 'blur(8px)' }}
        >
          {populateToast}
        </div>
      )}

      {/* Agent / participant join toast */}
      {joinToast && (() => {
        const r = ROLES[joinToast.role];
        return (
          <div
            className="fixed top-14 right-4 z-40 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg pointer-events-none"
            style={{ background: 'var(--c-surface)', border: `1px solid ${r.color}40`, backdropFilter: 'blur(12px)', minWidth: 220 }}
          >
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold" style={{ backgroundColor: `${r.color}20`, color: r.color }}>
              {joinToast.name.slice(0, 2)}
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--c-text-1)] leading-tight">{joinToast.name} 加入了</p>
              <p className="text-[11px] leading-tight mt-0.5" style={{ color: r.color }}>{r.label}</p>
            </div>
          </div>
        );
      })()}

      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-[var(--c-border-2)] flex-shrink-0 bg-[var(--c-surface)]">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <span className="font-bold text-sm md:text-base flex-shrink-0 text-[var(--c-text-1)]">DeepLoop</span>
          <span className="text-[var(--c-text-6)] hidden md:inline">·</span>
          <button
            onClick={copyRoomCode}
            className="font-mono text-[var(--c-text-4)] text-xs md:text-sm tracking-widest hover:text-[var(--c-text-1)] transition-colors truncate"
            title="点击复制房间码"
          >
            {copied ? '已复制 ✓' : id}
          </button>
          {afterRound > 0 && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-amber-500/30 text-amber-600 bg-amber-50 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              迭代 Round {currentRound}
            </span>
          )}
          {participants.length > 0 && (
            <span className="text-xs text-[var(--c-text-5)] flex-shrink-0">{participants.length}人</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowAgentPanel(true)}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors border"
            style={{ borderColor: 'var(--c-border-3)', color: 'var(--c-text-4)', backgroundColor: 'transparent' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(124,58,237,0.3)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(109,40,217,0.85)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border-3)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-4)'; }}
            title="获取 Agent 接入指令"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 1 10 10"/><circle cx="12" cy="12" r="3"/>
            </svg>
            Agent 接入
          </button>
          {participant && role && (
            <div className="flex items-center gap-1.5 md:gap-2 bg-black/[0.04] rounded-full px-2 md:px-3 py-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
              <span className="text-sm text-[var(--c-text-2)] hidden md:inline">{participant.name}</span>
              <span className="text-xs" style={{ color: role.color }}>{role.label}</span>
            </div>
          )}
        </div>
      </div>

      {/* 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: My intent */}
        <div className={`${mobileTab === 'intent' ? 'flex' : 'hidden'} md:flex w-full md:w-72 border-r border-[var(--c-border-2)] flex-col p-4 flex-shrink-0 bg-[var(--c-sidebar)]`}>
          <div className="text-xs text-[var(--c-text-4)] uppercase tracking-wider mb-3">我的意图</div>
          {role && (
            <div className="mb-3 flex items-center gap-2 text-sm" style={{ color: role.color }}>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
              {role.label}
            </div>
          )}
          <div className="mb-4">
            <p className="text-xs text-[var(--c-text-4)] uppercase tracking-wider mb-2">归入板块</p>
            <div className="flex flex-wrap gap-2">
              {knownSections.map(section => {
                const active = selectedSection === section;
                return (
                  <button
                    key={section}
                    onClick={() => setSelectedSection(section)}
                    className="px-3 py-1.5 rounded-full text-xs transition-colors border"
                    style={
                      active
                        ? { borderColor: 'var(--c-border-5)', backgroundColor: 'var(--c-overlay-md)', color: 'var(--c-text-1)' }
                        : { borderColor: 'var(--c-border-3)', color: 'var(--c-text-4)' }
                    }
                  >
                    {section}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={sectionDraft}
                onChange={e => setSectionDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sectionDraft.trim() && addSection()}
                placeholder="新建板块，例如 Demo"
                className="flex-1 bg-[var(--c-surface)] border border-[var(--c-border-3)] rounded-xl px-3 py-2 text-sm text-[var(--c-text-1)] placeholder-[var(--c-text-6)] focus:outline-none focus:border-[var(--c-border-5)] transition-colors"
              />
              <button
                onClick={addSection}
                disabled={!sectionDraft.trim()}
                className="px-3 py-2 rounded-xl text-xs border border-[var(--c-border-3)] text-[var(--c-text-2)] hover:bg-black/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                新建
              </button>
            </div>
          </div>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitIntent(); }}
            placeholder={
              selectedSection === DEFAULT_SECTION
                ? (role?.typical || '输入你的意图...')
                : `针对「${selectedSection}」补充你的想法...`
            }
            className="flex-1 bg-[var(--c-surface)] border border-[var(--c-border-3)] rounded-xl p-3 text-sm text-[var(--c-text-1)] placeholder-[var(--c-text-6)] resize-none focus:outline-none focus:border-[var(--c-border-5)] transition-colors"
          />
          <button
            onClick={submitIntent}
            disabled={!input.trim()}
            className="mt-3 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-30 border border-[var(--c-border-4)] text-[var(--c-text-2)] hover:bg-black/[0.04]"
          >
            提交意图
          </button>
          <p className="text-[10px] text-[var(--c-text-6)] mt-2 text-center">⌘+Enter 快速提交</p>
          {participant && role?.demoIntents && role.demoIntents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--c-border-1)]">
              <p className="text-[10px] text-[var(--c-text-5)] mb-2">示例意图</p>
              {role.demoIntents.map((demo, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(demo.content); setSelectedSection(demo.section); }}
                  className="w-full text-left text-[10px] text-[var(--c-text-5)] hover:text-[var(--c-text-3)] leading-snug mb-1.5 transition-colors line-clamp-2"
                >
                  [{demo.section}] {demo.content.slice(0, 40)}...
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Center: All intents */}
        <div className={`${mobileTab === 'flow' ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 bg-[var(--c-bg)]`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--c-border-2)] flex-shrink-0">
            <div>
              <span className="text-xs text-[var(--c-text-4)] uppercase tracking-wider">
                协作流 <span className="text-[var(--c-text-5)]">({filteredIntents.length})</span>
              </span>
              <p className="text-xs text-[var(--c-text-5)] mt-1">
                实时看见其他人刚刚提交了什么，以及它属于哪个板块
              </p>
              {roomStatus === 'synthesizing' && (
                <p className="text-xs text-amber-600 mt-1">另一台机器正在合成，当前房间已锁定</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {totalNewCount > 0 && (
                <button
                  onClick={() => setNewIntentIds([])}
                  className="px-3 py-1.5 rounded-full text-xs border border-emerald-500/30 text-emerald-700 hover:bg-emerald-50 transition-colors"
                >
                  清空 {totalNewCount} 条新标记
                </button>
              )}
              {participants.length < 6 && intents.length > 0 && (
                <button
                  onClick={() => populateDemo()}
                  disabled={populating}
                  className="px-3 py-1.5 rounded-full text-xs border border-dashed border-[var(--c-border-4)] text-[var(--c-text-5)] hover:text-[var(--c-text-3)] hover:border-black/20 transition-colors disabled:opacity-30"
                  title="为缺席角色填充示例意图"
                >
                  {populating ? '...' : `补全 ${6 - participants.length} 个角色`}
                </button>
              )}
              <button
                onClick={triggerSynthesis}
                disabled={intents.length === 0 || synthesizing || roomStatus === 'synthesizing'}
                className="px-4 py-1.5 rounded-full text-sm font-medium bg-[var(--c-btn-bg)] text-[var(--c-btn-text)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--c-btn-hover)] transition-colors"
              >
                {synthesizing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                    合成中
                  </span>
                ) : '合成 →'}
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-[var(--c-border-2)] flex gap-2 overflow-x-auto">
            <button
              onClick={() => setSectionFilter('all')}
              className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors border"
              style={
                sectionFilter === 'all'
                  ? { borderColor: 'var(--c-border-5)', color: 'var(--c-text-1)', backgroundColor: 'var(--c-overlay-md)' }
                  : { borderColor: 'var(--c-border-3)', color: 'var(--c-text-4)' }
              }
            >
              全部板块
            </button>
            {knownSections.map(section => {
              const newCount = sectionCards.find(card => card.section === section)?.newCount ?? 0;
              return (
                <button
                  key={section}
                  onClick={() => setSectionFilter(section)}
                  className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors border"
                  style={
                    sectionFilter === section
                      ? { borderColor: 'rgba(0,0,0,0.22)', color: '#1c1917', backgroundColor: 'rgba(0,0,0,0.06)' }
                      : { borderColor: 'rgba(0,0,0,0.08)', color: '#78716c' }
                  }
                >
                  {section}
                  {newCount > 0 ? ` · +${newCount}` : ''}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {requestError && (
              <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
                {requestError}
              </div>
            )}
            {filteredIntents.length === 0 ? (
              <div className="text-center text-[var(--c-text-5)] text-sm mt-16">
                <p>这个板块还没有内容</p>
                <p className="mt-2 text-xs text-[var(--c-text-6)]">分享房间代码 <span className="font-mono text-[var(--c-text-4)]">{id}</span> 给队友</p>
              </div>
            ) : (
              <>
                {prevRoundIntents.length > 0 && (
                  <>
                    <div className="flex items-center gap-3 px-1">
                      <div className="flex-1 h-px bg-black/[0.06]" />
                      <span className="text-[10px] text-[var(--c-text-5)] whitespace-nowrap">Round {afterRound} · {prevRoundIntents.length} 条已收录</span>
                      <div className="flex-1 h-px bg-black/[0.06]" />
                    </div>
                    {prevRoundIntents.map(intent => {
                      const p = intent.participant;
                      const r = p ? ROLES[p.role as RoleId] : null;
                      return (
                        <div
                          key={intent.id}
                          className="flex gap-3 rounded-2xl border p-3 opacity-40"
                          style={{ borderColor: 'rgba(0,0,0,0.05)', backgroundColor: 'rgba(0,0,0,0.015)' }}
                        >
                          <div className="w-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: r?.color || '#d4cfc8' }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium" style={{ color: r?.color || '#78716c' }}>{p?.name || '匿名'}</span>
                              <span className="text-xs text-[var(--c-text-5)]">{r?.label}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/[0.04] text-[var(--c-text-4)] border border-[var(--c-border-1)]">{normalizeSectionName(intent.section)}</span>
                            </div>
                            <p className="text-sm text-[var(--c-text-4)] leading-relaxed">{intent.content}</p>
                          </div>
                        </div>
                      );
                    })}
                    {thisRoundIntents.length > 0 && (
                      <div className="flex items-center gap-3 px-1">
                        <div className="flex-1 h-px bg-amber-400/30" />
                        <span className="text-[10px] text-amber-600/70 whitespace-nowrap">Round {currentRound} 新增意图</span>
                        <div className="flex-1 h-px bg-amber-400/30" />
                      </div>
                    )}
                  </>
                )}
                {thisRoundIntents.map(intent => {
                  const p = intent.participant;
                  const r = p ? ROLES[p.role as RoleId] : null;
                  const isNew = newIntentIds.includes(intent.id);
                  return (
                    <div
                      key={intent.id}
                      className="flex gap-3 rounded-2xl border p-3 transition-colors"
                      style={
                        isNew
                          ? { borderColor: 'rgba(16,185,129,0.25)', backgroundColor: 'rgba(16,185,129,0.05)' }
                          : { borderColor: 'var(--c-border-1)', backgroundColor: 'var(--c-surface)' }
                      }
                    >
                      <div
                        className="w-0.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: r?.color || '#d4cfc8' }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium" style={{ color: r?.color || '#78716c' }}>
                            {p?.name || '匿名'}
                          </span>
                          <span className="text-xs text-[var(--c-text-5)]">{r?.label}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/[0.04] text-[var(--c-text-3)] border border-[var(--c-border-1)]">
                            {normalizeSectionName(intent.section)}
                          </span>
                          {isNew && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              NEW
                            </span>
                          )}
                          <span className="text-xs text-[var(--c-text-6)] ml-auto">
                            {new Date(intent.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--c-text-2)] leading-relaxed">{intent.content}</p>
                      </div>
                    </div>
                  );
                })}
                {lastSynthesisAt && thisRoundIntents.length === 0 && (
                  <div className="text-center mt-4 py-4 space-y-2">
                    <p className="text-[var(--c-text-5)] text-xs">在上方提交新的意图，或一键填充第 {currentRound} 轮示例</p>
                    <button
                      onClick={() => populateDemo(currentRound)}
                      disabled={populating}
                      className="px-4 py-1.5 rounded-lg text-xs font-medium border border-dashed border-amber-400/40 text-amber-600 hover:text-amber-700 hover:border-amber-500/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {populating ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-3 border border-amber-400/50 border-t-amber-600 rounded-full animate-spin" />
                          填充中...
                        </span>
                      ) : `⚡ 填充第 ${currentRound} 轮示例`}
                    </button>
                  </div>
                )}
              </>
            )}
            <div ref={intentsEndRef} />
          </div>
        </div>

        {/* Right: Section status */}
        <div className={`${mobileTab === 'sections' ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-l border-[var(--c-border-2)] flex-col flex-shrink-0 bg-[var(--c-sidebar)]`}>
          <div className="px-4 py-3 border-b border-[var(--c-border-2)] flex-shrink-0">
            <span className="text-xs text-[var(--c-text-4)] uppercase tracking-wider">板块状态</span>
          </div>

          <div className="px-4 py-3 border-b border-[var(--c-border-1)] flex-shrink-0 space-y-1.5">
            {ROLE_IDS.map(roleId => {
              const r = ROLES[roleId];
              const joined = participants.find(p => p.role === roleId);
              const count = joined ? (intentCountByParticipant[joined.id] ?? 0) : 0;
              const isActive = joined ? recentlyActiveIds.has(joined.id) : false;
              const isDone = count > 0;

              if (!joined) {
                return (
                  <div key={roleId} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl opacity-35">
                    <div className="w-7 h-7 rounded-full border border-dashed border-[var(--c-border-3)] flex items-center justify-center text-[10px] text-[var(--c-text-6)]">
                      ?
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-[var(--c-text-5)]">{r.label}</p>
                      <p className="text-[10px] text-[var(--c-text-6)]">等待加入</p>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={roleId}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl transition-colors"
                  style={{ backgroundColor: isActive ? `${r.color}10` : 'transparent' }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
                    style={{ backgroundColor: `${r.color}20`, color: r.color }}
                  >
                    {joined.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-[var(--c-text-1)] truncate leading-tight">{joined.name}</p>
                    <p className="text-[10px] leading-tight" style={{ color: r.color }}>{r.label}</p>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {isActive ? (
                      <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: r.color }}>
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ backgroundColor: r.color }} />
                        提交中
                      </span>
                    ) : isDone ? (
                      <span className="flex items-center gap-1 text-[10px]" style={{ color: '#059669' }}>
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        {count} 条
                      </span>
                    ) : (
                      <span className="text-[10px] text-[var(--c-text-5)]">在线</span>
                    )}
                  </div>
                </div>
              );
            })}
            <p className="text-[10px] pt-1 pl-1" style={{ color: participants.length >= 6 ? '#059669' : 'var(--c-text-5)' }}>
              {participants.length >= 6 ? '全员就绪 ✓' : `${participants.length} / 6 位已加入`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-3">
              {sectionCards.map(card => {
                const latestRole = card.latestIntent?.participant?.role;
                const latestRoleInfo = latestRole ? ROLES[latestRole as RoleId] : null;

                return (
                  <button
                    key={card.section}
                    onClick={() => setSectionFilter(card.section)}
                    className="w-full text-left rounded-2xl border border-[var(--c-border-2)] bg-[var(--c-surface)] p-3 hover:bg-[var(--c-bg)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--c-text-1)]">{card.section}</span>
                      {card.newCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          +{card.newCount} new
                        </span>
                      )}
                      <span className="text-xs text-[var(--c-text-5)] ml-auto">{card.total} 条</span>
                    </div>
                    <p className="text-xs text-[var(--c-text-5)] mt-1">{card.hint}</p>
                    {card.latestIntent ? (
                      <div className="mt-3 pt-3 border-t border-[var(--c-border-1)]">
                        <div className="flex items-center gap-2 text-xs mb-1">
                          <span className="text-[var(--c-text-4)]">最近更新</span>
                          <span className="text-[var(--c-text-2)]">{card.latestIntent.participant?.name || '匿名'}</span>
                          {latestRoleInfo && (
                            <span style={{ color: latestRoleInfo.color }}>{latestRoleInfo.label}</span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--c-text-4)] leading-snug line-clamp-3">
                          {card.latestIntent.content}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--c-text-6)] mt-3">还没有人往这个板块提交内容</p>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-2xl border border-[var(--c-border-2)] bg-[var(--c-surface)] p-4 text-center">
              {synthesizing ? (
                <div>
                  <div className="w-8 h-8 border-2 border-[var(--c-border-3)] border-t-black/40 rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-[var(--c-text-2)] text-sm">AI 正在合成当前共识</p>
                  <p className="text-xs text-[var(--c-text-5)] mt-1">通常需要 20–40 秒</p>
                </div>
              ) : afterRound > 0 && thisRoundIntents.length === 0 ? (
                <div>
                  <p className="text-sm text-amber-600/80 mb-3">第 {currentRound} 轮暂无新意图</p>
                  <button
                    onClick={() => populateDemo(currentRound)}
                    disabled={populating}
                    className="w-full py-2.5 rounded-xl text-xs font-medium border border-dashed border-amber-400/40 text-amber-600 hover:text-amber-700 hover:border-amber-500/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {populating ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border border-amber-400/50 border-t-amber-600 rounded-full animate-spin" />
                        填充中...
                      </span>
                    ) : `⚡ 填充第 ${currentRound} 轮示例`}
                  </button>
                  <p className="text-[10px] text-[var(--c-text-6)] mt-2">为所有角色补充第 {currentRound} 轮意图</p>
                </div>
              ) : intents.length > 0 ? (
                <div>
                  <p className="text-sm text-[var(--c-text-2)]">当前已经收集 {intents.length} 条协作输入</p>
                  <p className="text-xs text-[var(--c-text-5)] mt-1">准备好后点击上方「合成」生成最新 HTML</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-[var(--c-text-5)] mb-3">还没有意图</p>
                  <button
                    onClick={() => populateDemo()}
                    disabled={populating}
                    className="w-full py-2.5 rounded-xl text-xs font-medium border border-dashed border-[var(--c-border-4)] text-[var(--c-text-4)] hover:text-[var(--c-text-1)] hover:border-black/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {populating ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border border-black/20 border-t-black/50 rounded-full animate-spin" />
                        填充中...
                      </span>
                    ) : '⚡ 一键填充演示数据'}
                  </button>
                  <p className="text-[10px] text-[var(--c-text-6)] mt-2">为所有缺席角色创建示例意图</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden flex-shrink-0 border-t border-[var(--c-border-2)] bg-[var(--c-surface)]">
        {intents.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <button
              onClick={triggerSynthesis}
              disabled={intents.length === 0 || synthesizing || roomStatus === 'synthesizing'}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-[var(--c-btn-bg)] text-[var(--c-btn-text)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--c-btn-hover)] transition-colors"
            >
              {synthesizing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                  合成中...
                </span>
              ) : `合成 → (${intents.length} 条意图)`}
            </button>
          </div>
        )}
        <div className="flex">
          {([
            { tab: 'intent' as MobileTab, label: '我的意图', icon: '✍️' },
            { tab: 'flow' as MobileTab, label: '协作流', icon: '💬', badge: totalNewCount },
            { tab: 'sections' as MobileTab, label: '板块状态', icon: '📋' },
          ] as { tab: MobileTab; label: string; icon: string; badge?: number }[]).map(({ tab, label, icon, badge }) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className="flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors relative"
              style={{ color: mobileTab === tab ? 'var(--c-text-1)' : 'var(--c-text-5)' }}
            >
              <span className="text-lg leading-none">{icon}</span>
              <span className="text-[10px]">{label}</span>
              {badge && badge > 0 && (
                <span className="absolute top-2 right-1/4 translate-x-1/2 w-4 h-4 rounded-full bg-emerald-500 text-[9px] flex items-center justify-center text-white font-bold">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
              {mobileTab === tab && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[var(--c-btn-bg)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Agent 接入指令面板 */}
      {showAgentPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAgentPanel(false); }}
        >
          <div
            className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border-3)', maxHeight: '90vh' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--c-border-2)' }}>
              <div>
                <h2 className="font-semibold text-sm text-[var(--c-text-1)]">Agent 接入指令</h2>
                <p className="text-xs text-[var(--c-text-5)] mt-0.5">将下方指令粘贴给任何 AI Agent，即可自动加入本房间并提交意图</p>
              </div>
              <button
                onClick={() => setShowAgentPanel(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-[var(--c-text-4)] hover:text-[var(--c-text-1)]"
                style={{ backgroundColor: 'var(--c-overlay)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Role selector */}
            <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: 'var(--c-border-1)' }}>
              <p className="text-xs text-[var(--c-text-4)] uppercase tracking-wider mb-2">为哪个角色生成指令</p>
              <div className="flex flex-wrap gap-2">
                {ROLE_IDS.map(rid => {
                  const r = ROLES[rid];
                  const active = agentRole === rid;
                  return (
                    <button
                      key={rid}
                      onClick={() => setAgentRole(rid)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all border"
                      style={
                        active
                          ? { borderColor: r.color, color: r.color, backgroundColor: `${r.color}18` }
                          : { borderColor: 'var(--c-border-3)', color: 'var(--c-text-4)' }
                      }
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b" style={{ borderColor: 'var(--c-border-1)' }}>
              {(['prompt', 'curl'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setAgentPanelTab(tab)}
                  className="px-5 py-2.5 text-xs font-medium transition-colors relative"
                  style={{ color: agentPanelTab === tab ? 'var(--c-text-1)' : 'var(--c-text-4)' }}
                >
                  {tab === 'prompt' ? '💬 System Prompt（Claude / GPT）' : '🖥 Shell Script（Claude Code / 终端）'}
                  {agentPanelTab === tab && (
                    <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-[var(--c-text-1)]" />
                  )}
                </button>
              ))}
            </div>

            {/* Code block */}
            <div className="flex-1 overflow-y-auto p-5">
              <div
                className="relative rounded-xl p-4 font-mono text-xs leading-relaxed overflow-x-auto"
                style={{ backgroundColor: 'var(--c-bg)', border: '1px solid var(--c-border-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--c-text-2)' }}
              >
                {agentPanelTab === 'prompt' ? buildAgentPrompt(agentRole) : buildAgentCurl(agentRole)}
              </div>
            </div>

            {/* Footer actions */}
            <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--c-border-2)' }}>
              <p className="text-[10px] text-[var(--c-text-5)]">
                房间码 <span className="font-mono text-[var(--c-text-3)]">{id}</span> · {agentPanelTab === 'prompt' ? '粘贴到 AI 对话框' : '保存为 .sh 后执行'}
              </p>
              <button
                onClick={copyAgentText}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={
                  agentCopied
                    ? { backgroundColor: 'rgba(5,150,105,0.1)', border: '1px solid rgba(5,150,105,0.3)', color: 'rgb(5,150,105)' }
                    : { backgroundColor: 'var(--c-btn-bg)', color: 'var(--c-btn-text)' }
                }
              >
                {agentCopied ? '已复制 ✓' : '复制指令'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
