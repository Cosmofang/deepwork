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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-2">DeepWork</h1>
          <p className="text-gray-400 text-sm mb-1">6 个角色各提意图</p>
          <p className="text-gray-600 text-xs mb-6">Claude 60 秒内将所有意图合成为一个产品落地页，并标注每个区块由谁主导</p>
          <div className="flex items-center justify-center gap-6 text-xs text-gray-600">
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 font-mono">1</span>
              <span>各选角色加入</span>
            </div>
            <div className="w-8 h-px bg-white/10" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 font-mono">2</span>
              <span>提交产品意图</span>
            </div>
            <div className="w-8 h-px bg-white/10" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 font-mono">3</span>
              <span>Claude 合成落地页</span>
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">你的名字</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canJoin && handleJoin()}
              placeholder="输入名字..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">你的角色</label>
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
                        : { borderColor: 'rgba(255,255,255,0.1)', color: '#9ca3af' }
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
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">房间代码</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                placeholder="输入或生成"
                maxLength={8}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30 transition-colors font-mono tracking-widest"
              />
              <button
                onClick={generateCode}
                className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:border-white/20 transition-colors text-sm whitespace-nowrap"
              >
                生成
              </button>
            </div>
            <p className="text-gray-700 text-xs mt-1.5">主持人点「生成」创建房间码，分享给其他5人，大家用同一个码进入同一个房间</p>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={handleJoin}
            disabled={!canJoin}
            className="w-full py-3.5 rounded-xl font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white text-black hover:bg-gray-100"
          >
            {loading ? '加入中...' : '进入房间 →'}
          </button>

          <div className="relative flex items-center gap-3 pt-1">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-gray-700 text-[10px]">或</span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          <button
            onClick={handleSoloDemo}
            disabled={soloLoading}
            className="w-full py-2.5 rounded-xl text-sm transition-all disabled:opacity-40"
            style={{ backgroundColor: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', color: 'rgba(192,132,252,0.9)' }}
            onMouseEnter={e => { if (!soloLoading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(168,85,247,0.14)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(168,85,247,0.08)'; }}
          >
            {soloLoading ? '创建演示房间中...' : '⚡ Solo 演示 — 一人即可体验全流程'}
          </button>
          <p className="text-gray-700 text-[10px] text-center -mt-2">
            自动创建房间，进入后点「一键填充」即可看到 6 角色意图 + AI 合成效果
          </p>
        </div>

        <p className="text-center text-gray-700 text-xs mt-4">
          Deeplumen Hackathon 2025 · 4/30 演示
        </p>
      </div>
    </div>
  );
}
