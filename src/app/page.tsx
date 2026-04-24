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
  const [error, setError] = useState('');

  const generateCode = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomCode(code);
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
          <p className="text-gray-500 text-sm mb-6">意图 + 合成，集体智慧的结晶</p>
          <div className="flex items-center justify-center gap-6 text-xs text-gray-600">
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 font-mono">1</span>
              <span>6人各选角色</span>
            </div>
            <div className="w-8 h-px bg-white/10" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 font-mono">2</span>
              <span>提交你的意图</span>
            </div>
            <div className="w-8 h-px bg-white/10" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 font-mono">3</span>
              <span>AI 合成产物</span>
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
                    {r.label}
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
        </div>

        <p className="text-center text-gray-700 text-xs mt-4">
          Deeplumen Hackathon 2025 · 4/30 演示
        </p>
      </div>
    </div>
  );
}
