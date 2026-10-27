import { useEffect, useState } from 'react';
import { formatDuration } from './Timer';

export default function IdleTimer({
  startedAt,
  stoppedAt = null,
  initialSeconds = 0,
  limitMinutes = 180,
  className = '',
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const start = Date.parse(startedAt);
  const stopped = Date.parse(stoppedAt);
  const end = Number.isFinite(stopped) ? stopped : Date.now();
  const elapsed = Number.isFinite(start)
    ? Math.max(0, (Number(initialSeconds) || 0) + (end - start) / 1000)
    : Number(initialSeconds) || 0;
  const limitReached = elapsed >= limitMinutes * 60;

  return (
    <div className="text-right">
      <span className={`font-mono tabular-nums ${limitReached ? 'text-red-700' : ''} ${className}`}>
        {formatDuration(elapsed)}
      </span>
      {limitReached && (
        <p role="status" className="mt-1 text-[10px] font-semibold text-red-700">
          Limite de ociosidade atingido
        </p>
      )}
    </div>
  );
}
