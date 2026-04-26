import { Beaker, Radio } from 'lucide-react';
import { useMode } from '@/lib/mode';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
}

export function ModeToggle({ className }: Props) {
  const { mode, setMode } = useMode();
  return (
    <div
      className={cn(
        'inline-flex items-center h-9 p-0.5 rounded-md border border-border bg-surface-2',
        className,
      )}
      role="group"
      aria-label="Application mode"
    >
      <button
        type="button"
        onClick={() => setMode('mock')}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 h-8 rounded text-xs font-mono uppercase tracking-wider transition-colors',
          mode === 'mock'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-pressed={mode === 'mock'}
      >
        <Beaker className="h-3.5 w-3.5" />
        Mock
      </button>
      <button
        type="button"
        onClick={() => setMode('live')}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 h-8 rounded text-xs font-mono uppercase tracking-wider transition-colors',
          mode === 'live'
            ? 'bg-success text-background shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-pressed={mode === 'live'}
      >
        <Radio className={cn('h-3.5 w-3.5', mode === 'live' && 'pulse-dot')} />
        Live
      </button>
    </div>
  );
}
