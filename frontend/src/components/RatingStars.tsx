import { Star, StarHalf } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ratingColor } from '@/lib/format';

interface RatingStarsProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  showNumber?: boolean;
  reviewCount?: number;
  className?: string;
}

const sizeMap = { sm: 'h-3 w-3', md: 'h-4 w-4', lg: 'h-5 w-5' };
const textSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' };

export function RatingStars({ rating, size = 'md', showNumber = true, reviewCount, className }: RatingStarsProps) {
  // No completed tasks yet — show "New" instead of a meaningless default score
  const hasActivity = typeof reviewCount === 'number' ? reviewCount > 0 : rating !== 2.5;

  if (!hasActivity) {
    return (
      <div className={cn('inline-flex items-center gap-1.5', className)}>
        <span className={cn(
          'px-1.5 py-0.5 rounded font-medium tracking-wide',
          'bg-muted text-muted-foreground border border-border',
          textSize[size],
        )}>
          New
        </span>
        {typeof reviewCount === 'number' && (
          <span className={cn('text-muted-foreground tabular-nums', textSize[size])}>
            (0 tasks)
          </span>
        )}
      </div>
    );
  }

  const color = ratingColor(rating);
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      stars.push(<Star key={i} className={cn(sizeMap[size], color, 'fill-current')} />);
    } else if (i - rating < 1 && i - rating > 0) {
      stars.push(<StarHalf key={i} className={cn(sizeMap[size], color, 'fill-current')} />);
    } else {
      stars.push(<Star key={i} className={cn(sizeMap[size], 'text-muted-foreground/40')} />);
    }
  }
  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <div className="inline-flex items-center gap-0.5">{stars}</div>
      {showNumber && (
        <span className={cn('font-semibold tabular-nums', color, textSize[size])}>{rating.toFixed(1)}</span>
      )}
      {typeof reviewCount === 'number' && (
        <span className={cn('text-muted-foreground tabular-nums', textSize[size])}>
          ({reviewCount.toLocaleString()} tasks)
        </span>
      )}
    </div>
  );
}
