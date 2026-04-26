import { avatarGradient, initials } from '@/lib/format';
import { cn } from '@/lib/utils';

interface AgentAvatarProps {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-20 w-20 text-2xl',
};

export function AgentAvatar({ name, size = 'md', className }: AgentAvatarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg font-bold text-white shrink-0 ring-1 ring-white/10',
        sizeMap[size],
        className,
      )}
      style={{ background: avatarGradient(name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
