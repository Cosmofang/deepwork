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
  const [mobileTab, setMobileTab] = useState<MobileTab>('flow');
  const [afterRound, setAfterRound] = useState(0);
  const [lastSynthesisAt, setLastSynthesisAt] = useState<string | null>(null);
  const intentsEndRef = useRef<HTMLDivElement>(null);
  const prevRoomStatusRef = useRef<'collecting' | 'synthesizing' | 'done'>('collecting');
  const synthesisStartRef = useRef<number | null>(null);
  const [synthesisElapsed, setSynthesisElapsed] = useState(0);
  const supabase = createClient();

  const copyRoomCode = () => {
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
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
    const loadParticipants = () => {
      supabase
        .from('participants')
        .select('*')
        .eq('room_id', id)
        .then(({ data }) => {
          if (data) setParticipants(data as Participant[]);
        });
    };
    loadParticipants();
    const channel = supabase
      .channel(`participants:${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'participants',
        filter: `room_id=eq.${id}`,
      }, () => loadParticipants())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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

        if (nextIntent.participant_id !== participant?.id) {
          setNewIntentIds(prev => (prev.includes(nextIntent.id) ? prev : [...prev, nextIntent.id]));
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
    // Intents arrive via realtime; wait 1.2s then check how many arrived
    setTimeout(() => {
      setIntents(prev => {
        const added = prev.length - beforeCount;
        if (added > 0) {
          setPopulateToast(`✓ 已填充 ${added} 条意图`);
          setTimeout(() => setPopulateToast(''), 2800);
        }
        return prev;
      });
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
  for (const intent of intents) {
    const role = intent.participant?.role;
    if (role) intentCountByRole[role] = (intentCountByRole[role] ?? 0) + 1;
  }

  return (
    <div className="h-screen bg-[#faf7f2] flex flex-col overflow-hidden">

      {/* Synthesis loading overlay */}
      {(synthesizing || roomStatus === 'synthesizing') && (
        <div className="fixed inset-0 z-50 bg-[#faf7f2] flex items-center justify-center">
          <div className="max-w-sm w-full px-6 text-center">

            <div className="relative w-20 h-20 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border border-black/[0.06]" />
              <div
                className="absolute inset-0 rounded-full border-2 border-transparent border-t-black/30 animate-spin"
                style={{ animationDuration: '1.4s' }}
              />
              <div className="absolute inset-3 rounded-full border border-black/[0.06]" />
              <div
                className="absolute inset-3 rounded-full border-2 border-transparent border-t-black/15 animate-spin"
                style={{ animationDuration: '2.2s', animationDirection: 'reverse' }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-black/10" />
              </div>
            </div>

            <h2 className="text-xl font-semibold text-[#1c1917] mb-2">
              AI 正在合成{afterRound > 0 ? <span className="text-amber-600"> Round {currentRound}</span> : ''}
            </h2>
            <p className="text-[#78716c] text-sm mb-8">
              整合{' '}
              <span className="text-[#1c1917] font-medium">{contributingRoleIds.length} 个角色</span>
              {' '}·{' '}
              <span className="text-[#1c1917] font-medium">{intents.length} 条意图</span>
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
              <div className="rounded-2xl border border-black/[0.07] bg-black/[0.025] p-4 mb-8 text-left space-y-2.5">
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
                      <span className="text-sm text-[#57534e] flex-1 truncate">{section}</span>
                      <span className="text-xs text-[#a8a29e] flex-shrink-0">{sectionIntents.length} 条</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs text-[#57534e] transition-all duration-700">{synthesisPhase.label}</p>
              <p className="text-xs text-[#a8a29e]">{synthesisElapsed}s · 完成后自动跳转</p>
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

      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-black/[0.07] flex-shrink-0 bg-white">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <span className="font-bold text-sm md:text-base flex-shrink-0 text-[#1c1917]">DeepWork</span>
          <span className="text-[#c4bcb4] hidden md:inline">·</span>
          <button
            onClick={copyRoomCode}
            className="font-mono text-[#78716c] text-xs md:text-sm tracking-widest hover:text-[#1c1917] transition-colors truncate"
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
            <span className="text-xs text-[#a8a29e] flex-shrink-0">{participants.length}人</span>
          )}
        </div>
        {participant && role && (
          <div className="flex items-center gap-1.5 md:gap-2 bg-black/[0.04] rounded-full px-2 md:px-3 py-1.5 flex-shrink-0">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
            <span className="text-sm text-[#44403c] hidden md:inline">{participant.name}</span>
            <span className="text-xs" style={{ color: role.color }}>{role.label}</span>
          </div>
        )}
      </div>

      {/* 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: My intent */}
        <div className={`${mobileTab === 'intent' ? 'flex' : 'hidden'} md:flex w-full md:w-72 border-r border-black/[0.07] flex-col p-4 flex-shrink-0 bg-[#f5f0e8]`}>
          <div className="text-xs text-[#78716c] uppercase tracking-wider mb-3">我的意图</div>
          {role && (
            <div className="mb-3 flex items-center gap-2 text-sm" style={{ color: role.color }}>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
              {role.label}
            </div>
          )}
          <div className="mb-4">
            <p className="text-xs text-[#78716c] uppercase tracking-wider mb-2">归入板块</p>
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
                        ? { borderColor: 'rgba(0,0,0,0.25)', backgroundColor: 'rgba(0,0,0,0.07)', color: '#1c1917' }
                        : { borderColor: 'rgba(0,0,0,0.08)', color: '#78716c' }
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
                className="flex-1 bg-white border border-black/[0.08] rounded-xl px-3 py-2 text-sm text-[#1c1917] placeholder-[#c4bcb4] focus:outline-none focus:border-black/20 transition-colors"
              />
              <button
                onClick={addSection}
                disabled={!sectionDraft.trim()}
                className="px-3 py-2 rounded-xl text-xs border border-black/[0.08] text-[#44403c] hover:bg-black/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
            className="flex-1 bg-white border border-black/[0.08] rounded-xl p-3 text-sm text-[#1c1917] placeholder-[#c4bcb4] resize-none focus:outline-none focus:border-black/20 transition-colors"
          />
          <button
            onClick={submitIntent}
            disabled={!input.trim()}
            className="mt-3 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-30 border border-black/[0.12] text-[#44403c] hover:bg-black/[0.04]"
          >
            提交意图
          </button>
          <p className="text-[10px] text-[#c4bcb4] mt-2 text-center">⌘+Enter 快速提交</p>
          {participant && role?.demoIntents && role.demoIntents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-black/[0.06]">
              <p className="text-[10px] text-[#a8a29e] mb-2">示例意图</p>
              {role.demoIntents.map((demo, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(demo.content); setSelectedSection(demo.section); }}
                  className="w-full text-left text-[10px] text-[#a8a29e] hover:text-[#57534e] leading-snug mb-1.5 transition-colors line-clamp-2"
                >
                  [{demo.section}] {demo.content.slice(0, 40)}...
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Center: All intents */}
        <div className={`${mobileTab === 'flow' ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 bg-[#faf7f2]`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.07] flex-shrink-0">
            <div>
              <span className="text-xs text-[#78716c] uppercase tracking-wider">
                协作流 <span className="text-[#a8a29e]">({filteredIntents.length})</span>
              </span>
              <p className="text-xs text-[#a8a29e] mt-1">
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
                  className="px-3 py-1.5 rounded-full text-xs border border-dashed border-black/[0.12] text-[#a8a29e] hover:text-[#57534e] hover:border-black/20 transition-colors disabled:opacity-30"
                  title="为缺席角色填充示例意图"
                >
                  {populating ? '...' : `补全 ${6 - participants.length} 个角色`}
                </button>
              )}
              <button
                onClick={triggerSynthesis}
                disabled={intents.length === 0 || synthesizing || roomStatus === 'synthesizing'}
                className="px-4 py-1.5 rounded-full text-sm font-medium bg-[#1c1917] text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#2d2921] transition-colors"
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

          <div className="px-4 py-3 border-b border-black/[0.07] flex gap-2 overflow-x-auto">
            <button
              onClick={() => setSectionFilter('all')}
              className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors border"
              style={
                sectionFilter === 'all'
                  ? { borderColor: 'rgba(0,0,0,0.22)', color: '#1c1917', backgroundColor: 'rgba(0,0,0,0.06)' }
                  : { borderColor: 'rgba(0,0,0,0.08)', color: '#78716c' }
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
              <div className="text-center text-[#a8a29e] text-sm mt-16">
                <p>这个板块还没有内容</p>
                <p className="mt-2 text-xs text-[#c4bcb4]">分享房间代码 <span className="font-mono text-[#78716c]">{id}</span> 给队友</p>
              </div>
            ) : (
              <>
                {prevRoundIntents.length > 0 && (
                  <>
                    <div className="flex items-center gap-3 px-1">
                      <div className="flex-1 h-px bg-black/[0.06]" />
                      <span className="text-[10px] text-[#a8a29e] whitespace-nowrap">Round {afterRound} · {prevRoundIntents.length} 条已收录</span>
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
                              <span className="text-xs text-[#a8a29e]">{r?.label}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/[0.04] text-[#78716c] border border-black/[0.06]">{normalizeSectionName(intent.section)}</span>
                            </div>
                            <p className="text-sm text-[#78716c] leading-relaxed">{intent.content}</p>
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
                          : { borderColor: 'rgba(0,0,0,0.06)', backgroundColor: 'white' }
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
                          <span className="text-xs text-[#a8a29e]">{r?.label}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/[0.04] text-[#57534e] border border-black/[0.05]">
                            {normalizeSectionName(intent.section)}
                          </span>
                          {isNew && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              NEW
                            </span>
                          )}
                          <span className="text-xs text-[#c4bcb4] ml-auto">
                            {new Date(intent.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm text-[#44403c] leading-relaxed">{intent.content}</p>
                      </div>
                    </div>
                  );
                })}
                {lastSynthesisAt && thisRoundIntents.length === 0 && (
                  <div className="text-center mt-4 py-4 space-y-2">
                    <p className="text-[#a8a29e] text-xs">在上方提交新的意图，或一键填充第 {currentRound} 轮示例</p>
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
        <div className={`${mobileTab === 'sections' ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-l border-black/[0.07] flex-col flex-shrink-0 bg-[#f5f0e8]`}>
          <div className="px-4 py-3 border-b border-black/[0.07] flex-shrink-0">
            <span className="text-xs text-[#78716c] uppercase tracking-wider">板块状态</span>
          </div>

          <div className="px-4 py-3 border-b border-black/[0.05] flex-shrink-0">
            <div className="flex flex-wrap gap-2">
              {ROLE_IDS.map(roleId => {
                const r = ROLES[roleId];
                const joined = participants.some(p => p.role === roleId);
                const count = intentCountByRole[roleId] ?? 0;
                return (
                  <div
                    key={roleId}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition-colors"
                    style={
                      joined
                        ? { borderColor: `${r.color}40`, backgroundColor: `${r.color}12`, color: r.color }
                        : { borderColor: 'rgba(0,0,0,0.07)', color: '#c4bcb4' }
                    }
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: joined ? r.color : '#d4cfc8' }}
                    />
                    {r.label}
                    {count > 0 && (
                      <span className="text-[9px] font-mono leading-none" style={{ opacity: 0.55 }}>
                        {count}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] mt-2" style={{ color: participants.length >= 6 ? '#059669' : '#c4bcb4' }}>
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
                    className="w-full text-left rounded-2xl border border-black/[0.07] bg-white p-3 hover:bg-[#faf7f2] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#1c1917]">{card.section}</span>
                      {card.newCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          +{card.newCount} new
                        </span>
                      )}
                      <span className="text-xs text-[#a8a29e] ml-auto">{card.total} 条</span>
                    </div>
                    <p className="text-xs text-[#a8a29e] mt-1">{card.hint}</p>
                    {card.latestIntent ? (
                      <div className="mt-3 pt-3 border-t border-black/[0.05]">
                        <div className="flex items-center gap-2 text-xs mb-1">
                          <span className="text-[#78716c]">最近更新</span>
                          <span className="text-[#44403c]">{card.latestIntent.participant?.name || '匿名'}</span>
                          {latestRoleInfo && (
                            <span style={{ color: latestRoleInfo.color }}>{latestRoleInfo.label}</span>
                          )}
                        </div>
                        <p className="text-xs text-[#78716c] leading-snug line-clamp-3">
                          {card.latestIntent.content}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-[#c4bcb4] mt-3">还没有人往这个板块提交内容</p>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-2xl border border-black/[0.07] bg-white p-4 text-center">
              {synthesizing ? (
                <div>
                  <div className="w-8 h-8 border-2 border-black/[0.08] border-t-black/40 rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-[#44403c] text-sm">AI 正在合成当前共识</p>
                  <p className="text-xs text-[#a8a29e] mt-1">通常需要 20–40 秒</p>
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
                  <p className="text-[10px] text-[#c4bcb4] mt-2">为所有角色补充第 {currentRound} 轮意图</p>
                </div>
              ) : intents.length > 0 ? (
                <div>
                  <p className="text-sm text-[#44403c]">当前已经收集 {intents.length} 条协作输入</p>
                  <p className="text-xs text-[#a8a29e] mt-1">准备好后点击上方「合成」生成最新 HTML</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-[#a8a29e] mb-3">还没有意图</p>
                  <button
                    onClick={() => populateDemo()}
                    disabled={populating}
                    className="w-full py-2.5 rounded-xl text-xs font-medium border border-dashed border-black/[0.12] text-[#78716c] hover:text-[#1c1917] hover:border-black/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {populating ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border border-black/20 border-t-black/50 rounded-full animate-spin" />
                        填充中...
                      </span>
                    ) : '⚡ 一键填充演示数据'}
                  </button>
                  <p className="text-[10px] text-[#c4bcb4] mt-2">为所有缺席角色创建示例意图</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden flex-shrink-0 border-t border-black/[0.07] bg-white">
        {intents.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <button
              onClick={triggerSynthesis}
              disabled={intents.length === 0 || synthesizing || roomStatus === 'synthesizing'}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#1c1917] text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#2d2921] transition-colors"
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
              style={{ color: mobileTab === tab ? '#1c1917' : '#a8a29e' }}
            >
              <span className="text-lg leading-none">{icon}</span>
              <span className="text-[10px]">{label}</span>
              {badge && badge > 0 && (
                <span className="absolute top-2 right-1/4 translate-x-1/2 w-4 h-4 rounded-full bg-emerald-500 text-[9px] flex items-center justify-center text-white font-bold">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
              {mobileTab === tab && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[#1c1917]" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
