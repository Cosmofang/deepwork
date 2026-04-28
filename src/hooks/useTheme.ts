'use client';

import { useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSize = 's' | 'm' | 'l';

const FONT_PX: Record<FontSize, number> = { s: 16, m: 17, l: 18 };

function applyTheme(mode: ThemeMode) {
  const html = document.documentElement;
  if (mode === 'dark') {
    html.classList.add('dark');
  } else if (mode === 'light') {
    html.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) html.classList.add('dark');
    else html.classList.remove('dark');
  }
}

function applyFontSize(size: FontSize) {
  document.documentElement.style.fontSize = `${FONT_PX[size]}px`;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [fontSize, setFontSize] = useState<FontSize>('m');

  useEffect(() => {
    const savedMode = (localStorage.getItem('dw-theme') as ThemeMode) || 'system';
    const savedSize = (localStorage.getItem('dw-font') as FontSize) || 'm';
    setMode(savedMode);
    setFontSize(savedSize);
    applyTheme(savedMode);
    applyFontSize(savedSize);

    if (savedMode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => applyTheme('system');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, []);

  const changeMode = useCallback((m: ThemeMode) => {
    setMode(m);
    localStorage.setItem('dw-theme', m);
    applyTheme(m);
  }, []);

  const changeFontSize = useCallback((s: FontSize) => {
    setFontSize(s);
    localStorage.setItem('dw-font', s);
    applyFontSize(s);
  }, []);

  return { mode, fontSize, changeMode, changeFontSize };
}
