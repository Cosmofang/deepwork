'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES, ROLE_IDS } from '@/lib/roles';
import { RoleId } from '@/types';
import { createClient } from '@/lib/supabase';

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

    const supabase = createClient();
    const code = roomCode.trim().toUpperCase();

    const { error: roomError } = await supabase
      .from('rooms')
      .upsert({ id: code, status: 'collecting' }, { onConflict: 'id' });

    if (roomError) {
      setError('创建房间失败，请重试');
      setLoading(false);
      return;
    }

    const { data: participant, error: pError } = await supabase
      .from('participants')
      .insert({ room_id: code, name: name.trim(), role, color: ROLES[role].color })
      .select()
      .single();

    if (pError || !participant) {
      setError('加入失败，请重试');
      setLoading(false);
      return;
    }

    localStorage.setItem('participant_id', participant.id);
    router.push(`/room/${code}`);
  };

  const canJoin = name.trim() && role && roomCode.trim() && !loading;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-2">DeepWork</h1>
          <p className="text-gray-500 text-sm">意图 + 合成，集体智慧的结晶</p>
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
