import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface StatCounterProps {
  value: number;
  suffix?: string;
  duration?: number;
  className?: string;
}

export function StatCounter({ value, suffix = '', duration = 1400, className }: StatCounterProps) {
  const [n, setN] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(value * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const formatted = value % 1 === 0 ? Math.floor(n).toLocaleString() : n.toFixed(1);
  return (
    <span className={cn('tabular-nums', className)}>
      {formatted}{suffix}
    </span>
  );
}
