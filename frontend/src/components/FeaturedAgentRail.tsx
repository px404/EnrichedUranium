import { Link } from 'react-router-dom';
import { ArrowRight, Clock3, Sparkles, Star } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Agent } from '@/lib/types';

interface FeaturedAgentRailProps {
  agents: Agent[];
}

const SCROLL_SPEED_PX_PER_SEC = 40;
const USER_IDLE_RESUME_MS = 2000;

export function FeaturedAgentRail({ agents }: FeaturedAgentRailProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const userScrollingRef = useRef(false);
  const userIdleTimerRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const expectedScrollRef = useRef(0);

  // Duplicate the items so the rail can loop seamlessly: when scrollLeft passes
  // halfway through scrollWidth, we silently subtract half the width and the
  // viewer never sees a jump (the second half is identical to the first).
  const railItems = agents.length > 0 ? [...agents, ...agents] : agents;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || agents.length === 0) return;

    const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduceMotionQuery.matches) return;

    expectedScrollRef.current = el.scrollLeft;

    const markUserScrolling = () => {
      userScrollingRef.current = true;
      if (userIdleTimerRef.current != null) {
        window.clearTimeout(userIdleTimerRef.current);
      }
      userIdleTimerRef.current = window.setTimeout(() => {
        userScrollingRef.current = false;
        userIdleTimerRef.current = null;
        // reset frame timing so we don't get a big dt jump when resuming
        lastFrameTimeRef.current = null;
      }, USER_IDLE_RESUME_MS);
    };

    const tick = (now: number) => {
      if (lastFrameTimeRef.current == null) {
        lastFrameTimeRef.current = now;
      }
      // clamp dt so background tabs / long pauses don't cause a giant jump
      const dt = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1);
      lastFrameTimeRef.current = now;

      const halfWidth = el.scrollWidth / 2;
      const canScroll = halfWidth > 0 && el.scrollWidth > el.clientWidth;

      if (canScroll && !pausedRef.current && !userScrollingRef.current) {
        let next = el.scrollLeft + SCROLL_SPEED_PX_PER_SEC * dt;
        if (next >= halfWidth) {
          next -= halfWidth;
        }
        el.scrollLeft = next;
      }
      // keep expected in sync so handleScroll only flags real user-initiated drift
      expectedScrollRef.current = el.scrollLeft;

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    const handleScroll = () => {
      const drift = Math.abs(el.scrollLeft - expectedScrollRef.current);
      if (drift > 1.5) {
        markUserScrolling();
      }
      expectedScrollRef.current = el.scrollLeft;
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      if (userIdleTimerRef.current != null) window.clearTimeout(userIdleTimerRef.current);
      el.removeEventListener('scroll', handleScroll);
      lastFrameTimeRef.current = null;
      rafIdRef.current = null;
      userIdleTimerRef.current = null;
    };
  }, [agents.length]);

  const handleMouseEnter = () => {
    pausedRef.current = true;
    lastFrameTimeRef.current = null;
  };

  const handleMouseLeave = () => {
    pausedRef.current = false;
    lastFrameTimeRef.current = null;
  };

  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-8 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-background to-transparent" />

      <div
        ref={scrollRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory cinematic-rail"
      >
        {railItems.map((agent, idx) => {
          const isClone = idx >= agents.length;
          return (
            <article
              key={`${agent.id}-${idx}`}
              aria-hidden={isClone || undefined}
              className="motion-lift snap-start relative min-w-[320px] max-w-[320px] md:min-w-[360px] md:max-w-[360px] rounded-2xl border border-border bg-surface p-4 shadow-card"
            >
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent pointer-events-none" />

              <div className="relative">
                <div className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-primary">
                  <Sparkles className="h-3 w-3" />
                  Featured
                </div>

                <h3 className="mt-4 text-xl font-semibold tracking-tight">{agent.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{agent.tagline}</p>

                <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                    {agent.rating.toFixed(1)}
                  </span>
                  <span>{agent.tasksCompleted.toLocaleString()} tasks</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5" />
                    {agent.avgResponseTime}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {agent.skills.slice(0, 3).map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    From <span className="font-mono text-foreground">{agent.pricePerTask}</span> sats
                  </span>
                  <Link
                    to={`/agent/${agent.id}`}
                    tabIndex={isClone ? -1 : undefined}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80 transition"
                  >
                    View agent
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
