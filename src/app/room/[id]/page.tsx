'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { ROLES } from '@/lib/roles';
import { Intent, Participant, RoleId } from '@/types';

type IntentWithParticipant = Intent & { participant: Participant };

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [intents, setIntents] = useState<IntentWithParticipant[]>([]);
  const [input, setInput] = useState('');
  const [synthesizing, setSynthesizing] = useState(false);
  const intentsEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    const pid = localStorage.getItem('participant_id');
    if (!pid) { router.push('/'); return; }

    supabase
      .from('participants')
      .select('*')
      .eq('id', pid)
      .single()
      .then(({ data }) => {
        if (data) setParticipant(data);
        else router.push('/');
      });
  }, []);

  useEffect(() => {
    supabase
      .from('intents')
      .select('*, participant:participants(*)')
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (data) setIntents(data as IntentWithParticipant[]); });
  }, [id]);

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
        if (data) setIntents(prev => [...prev, data as IntentWithParticipant]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  useEffect(() => {
    intentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [intents]);

  const submitIntent = async () => {
    if (!input.trim() || !participant) return;
    const content = input.trim();
    setInput('');
    await supabase.from('intents').insert({
      room_id: id,
      participant_id: participant.id,
      content,
    });
  };

  const triggerSynthesis = async () => {
    if (intents.length === 0 || synthesizing) return;
    setSynthesizing(true);

    try {
      const res = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: id, intents }),
      });
      if (res.ok) router.push(`/room/${id}/result`);
      else setSynthesizing(false);
    } catch {
      setSynthesizing(false);
    }
  };

  const role = participant ? ROLES[participant.role as RoleId] : null;

  return (
    <div className="h-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold">DeepWork</span>
          <span className="text-gray-600">·</span>
          <span className="font-mono text-gray-400 text-sm tracking-widest">{id}</span>
        </div>
        {participant && role && (
          <div className="flex items-center gap-2 bg-white/5 rounded-full px-3 py-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: role.color }} />
            <span className="text-sm text-gray-300">{participant.name}</span>
            <span className="text-xs" style={{ color: role.color }}>{role.label}</span>
          </div>
        )}
      </div>

      {/* 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: My intent */}
        <div className="w-60 border-r border-white/10 flex flex-col p-4 flex-shrink-0">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">我的意图</div>
          {role && (
            <div className="mb-3 flex items-center gap-2 text-sm" style={{ color: role.color }}>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
              {role.label}
            </div>
          )}
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitIntent(); }}
            placeholder={role?.typical || '输入你的意图...'}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-white/20 transition-colors"
          />
          <button
            onClick={submitIntent}
            disabled={!input.trim()}
            className="mt-3 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-30 border border-white/20 hover:bg-white/5"
          >
            提交意图
          </button>
          <p className="text-[10px] text-gray-700 mt-2 text-center">⌘+Enter 快速提交</p>
        </div>

        {/* Center: All intents */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              所有人的意图 <span className="text-gray-600">({intents.length})</span>
            </span>
            <button
              onClick={triggerSynthesis}
              disabled={intents.length === 0 || synthesizing}
              className="px-4 py-1.5 rounded-full text-sm font-medium bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
            >
              {synthesizing ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                  合成中
                </span>
              ) : '合成 →'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {intents.length === 0 ? (
              <div className="text-center text-gray-600 text-sm mt-16">
                <p>等待大家输入意图...</p>
                <p className="mt-2 text-xs text-gray-700">分享房间代码 <span className="font-mono text-gray-500">{id}</span> 给队友</p>
              </div>
            ) : (
              intents.map(intent => {
                const p = intent.participant;
                const r = p ? ROLES[p.role as RoleId] : null;
                return (
                  <div key={intent.id} className="flex gap-3">
                    <div
                      className="w-0.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: r?.color || '#444' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium" style={{ color: r?.color || '#888' }}>
                          {p?.name || '匿名'}
                        </span>
                        <span className="text-xs text-gray-600">{r?.label}</span>
                        <span className="text-xs text-gray-700 ml-auto">
                          {new Date(intent.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 leading-relaxed">{intent.content}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={intentsEndRef} />
          </div>
        </div>

        {/* Right: Preview */}
        <div className="w-72 border-l border-white/10 flex flex-col flex-shrink-0">
          <div className="px-4 py-3 border-b border-white/10 flex-shrink-0">
            <span className="text-xs text-gray-500 uppercase tracking-wider">产物预览</span>
          </div>
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm p-6 text-center">
            {synthesizing ? (
              <div>
                <div className="w-8 h-8 border-2 border-white/10 border-t-white/60 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-gray-400">AI 正在合成</p>
                <p className="text-xs text-gray-600 mt-1">通常需要 15-30 秒</p>
              </div>
            ) : (
              <div>
                <p>收集意图后</p>
                <p>点击「合成」生成产物</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
