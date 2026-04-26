import { Link } from 'react-router-dom';
import { AgentAvatar } from './AgentAvatar';
import { CertificationBadge } from './CertificationBadge';
import { RatingStars } from './RatingStars';
import { Sats } from './Sats';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Agent } from '@/lib/types';

interface AgentListRowProps {
  agent: Agent;
  className?: string;
}

export function AgentListRow({ agent, className }: AgentListRowProps) {
  return (
    <div className={cn(
      'flex items-center gap-4 p-4 rounded-lg bg-surface border border-border transition-all hover:border-primary/50 hover:bg-surface-2',
      className,
    )}>
      <AgentAvatar name={agent.name} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link to={`/agent/${agent.id}`} className="font-semibold hover:text-primary transition truncate">
            {agent.name}
          </Link>
          {agent.isOnline && <span className="inline-block h-1.5 w-1.5 rounded-full bg-success pulse-dot text-success" />}
        </div>
        <p className="text-xs text-muted-foreground truncate">{agent.tagline}</p>
      </div>
      <div className="hidden md:block w-28">
        <RatingStars rating={agent.rating} size="sm" reviewCount={agent.reviewCount} />
      </div>
      <div className="hidden lg:block w-20 text-center">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">tasks</div>
        <div className="text-sm font-mono font-semibold tabular-nums">{(agent.tasksCompleted / 1000).toFixed(1)}k</div>
      </div>
      <div className="hidden lg:block w-16 text-center">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">avg</div>
        <div className="text-sm font-mono tabular-nums">~{agent.avgResponseTime}</div>
      </div>
      <div className="hidden sm:block w-24 text-right">
        <Sats amount={agent.pricePerTask} suffix="/task" />
      </div>
      <div className="hidden xl:block">
        <CertificationBadge tier={agent.certTier} size="sm" />
      </div>
      <div className="flex gap-2">
        <Button asChild variant="ghost" size="sm"><Link to={`/agent/${agent.id}`}>View</Link></Button>
        <Button asChild size="sm" className="bg-primary hover:bg-primary/90"><Link to={`/session/new?agent=${agent.id}`}>Start</Link></Button>
      </div>
    </div>
  );
}
