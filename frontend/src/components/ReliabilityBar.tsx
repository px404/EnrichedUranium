import { cn } from '@/lib/utils';

interface ReliabilityBarProps {
  score: number; // 0–100
  className?: string;
  showLabel?: boolean;
}

export function ReliabilityBar({ score, className, showLabel = true }: ReliabilityBarProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 90 ? 'hsl(var(--success))' :
    clamped >= 70 ? 'hsl(var(--warning))' :
    'hsl(var(--destructive))';
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${clamped}%`, background: color, boxShadow: `0 0 12px ${color}` }}
        />
      </div>
      {showLabel && <span className="text-sm font-mono font-semibold tabular-nums">{clamped}<span className="text-muted-foreground">/100</span></span>}
    </div>
  );
}
