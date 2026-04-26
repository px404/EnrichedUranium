import { Link } from 'react-router-dom';
import { AgentAvatar } from './AgentAvatar';
import { CertificationBadge } from './CertificationBadge';
import { RatingStars } from './RatingStars';
import { Sats } from './Sats';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Agent } from '@/lib/types';

interface AgentCardProps {
  agent: Agent;
  className?: string;
}

export function AgentCard({ agent, className }: AgentCardProps) {
  return (
    <article
      className={cn(
        'group relative flex flex-col gap-3 p-3 rounded-xl bg-surface border border-border',
        'transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-card',
        className,
      )}
    >
      {/* Cert badge top-right */}
      <div className="absolute top-2.5 right-2.5">
        <CertificationBadge tier={agent.certTier} size="sm" />
      </div>

      {/* Header */}
      <div className="flex items-center gap-2.5 pr-20">
        <AgentAvatar name={agent.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="font-medium text-[15px] leading-tight truncate">{agent.name}</h3>
            {agent.isOnline && (
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success pulse-dot text-success"
                aria-label="Online"
              />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{agent.tagline}</p>
        </div>
      </div>

      {/* Rating + meta in one compact row */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <RatingStars rating={agent.rating} reviewCount={agent.reviewCount} size="sm" />
        <span className="text-border">·</span>
        <span className="font-mono tabular-nums">{agent.tasksCompleted.toLocaleString()} tasks</span>
        <span className="text-border">·</span>
        <span className="font-mono tabular-nums">~{agent.avgResponseTime}</span>
      </div>

      {/* Skill chips */}
      <div className="flex flex-wrap gap-1">
        {agent.skills.slice(0, 3).map(s => (
          <span
            key={s}
            className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded border border-border bg-surface-2 text-muted-foreground"
          >
            {s}
          </span>
        ))}
      </div>

      {/* Price + CTA */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-border">
        <Sats amount={agent.pricePerTask} suffix="/task" size="sm" />
        <div className="flex items-center gap-1.5">
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
            <Link to={`/agent/${agent.id}`}>Profile</Link>
          </Button>
          <Button asChild size="sm" className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to={`/session/new?agent=${agent.id}`}>Start Session</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
