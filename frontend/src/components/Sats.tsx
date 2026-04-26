import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatSats } from '@/lib/format';

interface SatsProps {
  amount: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  suffix?: string;
  className?: string;
  variant?: 'default' | 'amber' | 'muted';
}

const sizeMap = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-lg',
  xl: 'text-3xl',
};

export function Sats({ amount, size = 'md', suffix, className, variant = 'amber' }: SatsProps) {
  const color =
    variant === 'amber' ? 'text-warning' :
    variant === 'muted' ? 'text-muted-foreground' :
    'text-foreground';
  return (
    <span className={cn('inline-flex items-baseline gap-1 font-mono font-semibold tabular-nums', color, sizeMap[size], className)}>
      <Zap className={cn(size === 'xl' ? 'h-6 w-6' : size === 'lg' ? 'h-4 w-4' : 'h-3 w-3', 'fill-current self-center')} />
      {formatSats(amount)}
      {suffix && <span className="text-muted-foreground font-normal">{suffix}</span>}
    </span>
  );
}
