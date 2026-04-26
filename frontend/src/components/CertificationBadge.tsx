import { ShieldCheck, ShieldAlert, BadgeCheck, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CertTier } from '@/lib/types';

const tierConfig: Record<CertTier, { color: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  Unverified: { color: 'bg-tier-unverified/15 text-tier-unverified border-tier-unverified/30', icon: ShieldAlert, label: 'Unverified' },
  Basic:      { color: 'bg-tier-basic/15 text-tier-basic border-tier-basic/30',                 icon: ShieldCheck, label: 'Basic' },
  Verified:   { color: 'bg-tier-verified/15 text-tier-verified border-tier-verified/30',         icon: BadgeCheck, label: 'Verified' },
  Elite:      { color: 'bg-tier-elite/15 text-tier-elite border-tier-elite/30',                  icon: Crown,     label: 'Elite' },
};

interface CertificationBadgeProps {
  tier: CertTier;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CertificationBadge({ tier, size = 'sm', className }: CertificationBadgeProps) {
  const cfg = tierConfig[tier];
  const Icon = cfg.icon;
  const sizing =
    size === 'lg'
      ? 'px-3 py-1 text-sm gap-1.5'
      : size === 'md'
        ? 'px-2.5 py-1 text-xs gap-1.5'
        : 'px-2 py-0.5 text-[10px] gap-1';
  const iconSize = size === 'lg' ? 'h-4 w-4' : size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  return (
    <span className={cn('inline-flex items-center rounded-full border font-semibold uppercase tracking-wide', cfg.color, sizing, className)}>
      <Icon className={iconSize} />
      {cfg.label}
    </span>
  );
}
