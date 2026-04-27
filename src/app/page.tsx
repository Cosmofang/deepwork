'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES, ROLE_IDS } from '@/lib/roles';
import { RoleId } from '@/types';

export default function EntryPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [role, setRole] = useState<RoleId | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [soloLoading, setSoloLoading] = useState(false);
  const [error, setError] = useState('');

  const generateCode = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomCode(code);
  };

  const handleSoloDemo = async () => {
    setSoloLoading(true);
    setError('');
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      const res = await fetch('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '演示者', role: 'product', roomCode: code }),
      });
      if (!res.ok) { setSoloLoading(false); setError('创建失败，请重试'); return; }
      const data = await res.json() as { participant?: { id: string } };
      if (!data.participant?.id) { setSoloLoading(false); setError('创建失败，请重试'); return; }
      localStorage.setItem(`participant_id:${code}`, data.participant.id);
      localStorage.setItem('participant_room_id', code);
      router.push(`/room/${code}`);
    } catch {
      setSoloLoading(false);
      setError('创建失败，请重试');
    }
  };

  const handleJoin = async () => {
    if (!name.trim() || !role || !roomCode.trim()) return;
    setLoading(true);
    setError('');

    const code = roomCode.trim().toUpperCase();
    try {
      const res = await fetch('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role,
          roomCode: code,
        }),
      });

      if (!res.ok) {
        setError('加入失败，请重试');
        setLoading(false);
        return;
      }

      const data = await res.json() as { participant?: { id: string } };
      if (!data.participant?.id) {
        setError('加入失败，请重试');
        setLoading(false);
        return;
      }

      localStorage.setItem(`participant_id:${code}`, data.participant.id);
      localStorage.setItem('participant_room_id', code);
      router.push(`/room/${code}`);
    } catch {
      setError('加入失败，请重试');
      setLoading(false);
    }
  };

  const canJoin = name.trim() && role && roomCode.trim() && !loading;

  return (
    <div className="min-h-screen bg-[var(--c-bg)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-2 text-[var(--c-text-1)]">DeepWork</h1>
          <p className="text-[var(--c-text-3)] text-sm mb-1">6 个角色各提意图</p>
          <p className="text-[var(--c-text-5)] text-xs mb-6">Claude 60 秒内将所有意图合成为一个产品落地页，并标注每个区块由谁主导</p>
          <div className="flex items-center justify-center gap-6 text-xs text-[var(--c-text-5)]">
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-[var(--c-overlay)] border border-[var(--c-border-3)] flex items-center justify-center text-[var(--c-text-4)] font-mono">1</span>
              <span>各选角色加入</span>
            </div>
            <div className="w-8 h-px bg-black/[0.08]" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-[var(--c-overlay)] border border-[var(--c-border-3)] flex items-center justify-center text-[var(--c-text-4)] font-mono">2</span>
              <span>提交产品意图</span>
            </div>
            <div className="w-8 h-px bg-black/[0.08]" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-[var(--c-overlay)] border border-[var(--c-border-3)] flex items-center justify-center text-[var(--c-text-4)] font-mono">3</span>
              <span>Claude 合成落地页</span>
            </div>
          </div>
        </div>

        <div className="bg-[var(--c-surface)] border border-[var(--c-border-3)] rounded-2xl p-6 space-y-5 shadow-sm">
          <div>
            <label className="text-xs text-[var(--c-text-4)] uppercase tracking-wider mb-2 block">你的名字</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canJoin && handleJoin()}
              placeholder="输入名字..."
              className="w-full bg-[var(--c-bg)] border border-[var(--c-border-3)] rounded-xl px-4 py-3 text-[var(--c-text-1)] placeholder-[var(--c-text-6)] focus:outline-none focus:border-[var(--c-border-5)] transition-colors"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--c-text-4)] uppercase tracking-wider mb-2 block">你的角色</label>
            <div className="grid grid-cols-3 gap-2">
              {ROLE_IDS.map(id => {
                const r = ROLES[id];
                const selected = role === id;
                return (
                  <button
                    key={id}
                    onClick={() => setRole(id)}
                    className="py-2.5 px-3 rounded-xl text-sm font-medium transition-all border"
                    style={
                      selected
                        ? { borderColor: r.color, color: r.color, backgroundColor: `${r.color}18` }
                        : { borderColor: 'var(--c-border-3)', color: 'var(--c-text-4)', backgroundColor: 'transparent' }
                    }
                  >
                    <span className="block">{r.label}</span>
                    <span className="mt-1 block text-[10px] font-normal leading-snug opacity-70">{r.typical}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--c-text-4)] uppercase tracking-wider mb-2 block">房间代码</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                placeholder="输入或生成"
                maxLength={8}
                className="flex-1 bg-[var(--c-bg)] border border-[var(--c-border-3)] rounded-xl px-4 py-3 text-[var(--c-text-1)] placeholder-[var(--c-text-6)] focus:outline-none focus:border-[var(--c-border-5)] transition-colors font-mono tracking-widest"
              />
              <button
                onClick={generateCode}
                className="px-4 py-3 bg-[var(--c-bg)] border border-[var(--c-border-3)] rounded-xl text-[var(--c-text-4)] hover:text-[var(--c-text-1)] hover:border-black/20 transition-colors text-sm whitespace-nowrap"
              >
                生成
              </button>
            </div>
            <p className="text-[var(--c-text-6)] text-xs mt-1.5">主持人点「生成」创建房间码，分享给其他5人，大家用同一个码进入同一个房间</p>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={handleJoin}
            disabled={!canJoin}
            className="w-full py-3.5 rounded-xl font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[var(--c-btn-bg)] text-[var(--c-btn-text)] hover:bg-[var(--c-btn-hover)]"
          >
            {loading ? '加入中...' : '进入房间 →'}
          </button>

          <div className="relative flex items-center gap-3 pt-1">
            <div className="flex-1 h-px bg-[var(--c-border-1)]" />
            <span className="text-[var(--c-text-6)] text-[10px]">或</span>
            <div className="flex-1 h-px bg-[var(--c-border-1)]" />
          </div>

          <button
            onClick={handleSoloDemo}
            disabled={soloLoading}
            className="w-full py-2.5 rounded-xl text-sm transition-all disabled:opacity-40"
            style={{ backgroundColor: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)', color: 'rgba(109,40,217,0.9)' }}
            onMouseEnter={e => { if (!soloLoading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(124,58,237,0.1)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(124,58,237,0.06)'; }}
          >
            {soloLoading ? '创建演示房间中...' : '⚡ Solo 演示 — 一人即可体验全流程'}
          </button>
          <p className="text-[var(--c-text-6)] text-[10px] text-center -mt-2">
            自动创建房间，进入后点「一键填充」即可看到 6 角色意图 + AI 合成效果
          </p>
        </div>

        <p className="text-center text-[var(--c-text-6)] text-xs mt-4">
          Deeplumen Hackathon 2025 · 4/30 演示
        </p>
      </div>
    </div>
  );
}
