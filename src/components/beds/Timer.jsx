import { useEffect, useState } from 'react';

export function formatDuration(total) {
  const s = Math.max(0, Math.floor(total || 0));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

export default function Timer({ startedAt, stoppedAt = null, initialSeconds = 0, className = '' }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  const elapsed = (Number(initialSeconds) || 0) + (end - new Date(startedAt).getTime()) / 1000;
  return <span className={`font-mono tabular-nums ${className}`}>{formatDuration(elapsed)}</span>;
}