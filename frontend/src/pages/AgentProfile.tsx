import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Send, Zap, Clock, CheckCircle2, TrendingUp, Calendar, Code2, ChevronDown, Wrench, Shield, AlertTriangle, Loader2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { AgentAvatar } from '@/components/AgentAvatar';
import { CertificationBadge } from '@/components/CertificationBadge';
import { RatingStars } from '@/components/RatingStars';
import { ReliabilityBar } from '@/components/ReliabilityBar';
import { Sats } from '@/components/Sats';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { getAgent, getReviews } from '@/lib/mockData';
import { hashHue, ratingColor, relativeDate, truncateAddr } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { useMode } from '@/lib/mode';
import type { Agent, Review } from '@/lib/types';

const AgentProfile = () => {
  const { agentId = '' } = useParams();
  const { requireMock, isLive, mode } = useMode();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewFilter, setReviewFilter] = useState<'all' | '5' | '4' | 'low'>('all');
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);

  const runTest = () => {
    if (!testInput.trim()) {
      toast({ title: 'Add some input first', variant: 'destructive' });
      return;
    }
    if (!requireMock('Sandbox test request')) return;
    setTestRunning(true);
    setTestOutput(null);
    setTimeout(() => {
      setTestOutput(JSON.stringify({
        status: 'success',
        agent: agent?.id,
        latency_ms: Math.floor(800 + Math.random() * 1200),
        cost_sats: agent?.pricePerTask,
        result: `[mock output] Processed: "${testInput.slice(0, 60)}${testInput.length > 60 ? '…' : ''}"`,
      }, null, 2));
      setTestRunning(false);
      toast({ title: 'Test complete', description: 'No charge — sandbox call.' });
    }, 1500);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([getAgent(agentId), getReviews(agentId)]).then(([a, r]) => {
      setAgent(a ?? null);
      setReviews(r);
      setLoading(false);
    });
  }, [agentId, mode]);

  if (loading) {
    return (
      <Layout>
        <div className="container py-8 space-y-6">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </Layout>
    );
  }
  if (!agent) {
    return (
      <Layout>
        <div className="container py-20 text-center">
          <h1 className="text-2xl font-bold">
            {isLive ? 'No agent data' : 'Agent not found'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isLive
              ? 'Backend not connected. Switch to Mock mode in the navbar to preview agent profiles.'
              : 'This agent does not exist or has been removed.'}
          </p>
          <Button asChild className="mt-6"><Link to="/browse">Browse agents</Link></Button>
        </div>
      </Layout>
    );
  }

  const hue = hashHue(agent.name);
  const filteredReviews = reviews.filter(r => {
    if (reviewFilter === 'all') return true;
    if (reviewFilter === '5') return r.rating === 5;
    if (reviewFilter === '4') return r.rating === 4;
    return r.rating <= 3;
  });

  const breakdown = [5, 4, 3, 2, 1].map(s => ({
    star: s,
    count: reviews.filter(r => r.rating === s).length,
    pct: reviews.length ? (reviews.filter(r => r.rating === s).length / reviews.length) * 100 : 0,
  }));

  return (
    <Layout>
      {/* Banner */}
      <div
        className="relative h-40 md:h-52 border-b border-border"
        style={{
          background: `radial-gradient(ellipse at top, hsl(${hue} 70% 35% / 0.5), transparent 60%), linear-gradient(180deg, hsl(${hue} 50% 12%), hsl(var(--background)))`,
        }}
      >
        <div className="container">
          <Link to="/browse" className="absolute top-4 left-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </div>
      </div>

      <div className="container -mt-16 md:-mt-20 relative z-10 pb-20">
        {/* Header card */}
        <div className="rounded-lg bg-surface border border-border p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-end gap-6">
            <AgentAvatar name={agent.name} size="xl" className="ring-4 ring-background" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl md:text-3xl font-bold">{agent.name}</h1>
                {agent.isOnline && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-success">
                    <span className="h-2 w-2 rounded-full bg-success pulse-dot text-success" /> Online
                  </span>
                )}
                <CertificationBadge tier={agent.certTier} size="md" />
              </div>
              <p className="text-muted-foreground">{agent.tagline}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <RatingStars rating={agent.rating} reviewCount={agent.reviewCount} size="lg" />
                <div className="text-xs font-mono text-muted-foreground">{agent.id}</div>
              </div>
            </div>
            <div className="flex gap-2 md:flex-col lg:flex-row">
              <Button asChild size="lg" className="bg-primary hover:bg-primary/90">
                <Link to={`/session/new?agent=${agent.id}`}>
                  <Zap className="h-4 w-4 mr-1.5" /> Start Session
                </Link>
              </Button>
              <Button size="lg" variant="outline" onClick={() => { setTestOpen(true); setTestOutput(null); }}>
                <Send className="h-4 w-4 mr-1.5" /> Send Test Request
              </Button>
            </div>
          </div>

          {/* Reliability */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reliability Score</span>
            </div>
            <ReliabilityBar score={agent.reliabilityScore} />
          </div>

          {/* Quick stats */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-px rounded-lg overflow-hidden bg-border">
            <QuickStat icon={CheckCircle2} label="Tasks Completed" value={agent.tasksCompleted.toLocaleString()} />
            <QuickStat icon={Clock} label="Avg Response" value={`~${agent.avgResponseTime}`} />
            <QuickStat icon={TrendingUp} label="Success Rate" value={`${agent.successRate}%`} />
            <QuickStat icon={Calendar} label="Member Since" value="Mar 2024" />
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="mt-8">
          <TabsList className="bg-surface border border-border">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="reviews">Reviews ({reviews.length})</TabsTrigger>
            <TabsTrigger value="methods">Methods & Tools</TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="mt-6 grid lg:grid-cols-[1fr_360px] gap-6">
            <div className="space-y-6">
              <Section title="About this Agent">
                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{agent.description}</p>
              </Section>

              <Section title="Serves">
                <div className="flex flex-wrap gap-2">
                  {agent.serves.map(s => (
                    <span key={s} className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium uppercase tracking-wide">
                      {s === 'humans' ? 'Humans' : s === 'agents' ? 'AI Agents' : 'Automated Pipelines'}
                    </span>
                  ))}
                </div>
              </Section>

              <Section title="Specializations">
                <ul className="space-y-3">
                  {agent.specializations.map(s => (
                    <li key={s.tag} className="flex items-start gap-3">
                      <span className="mt-0.5 px-2 py-0.5 text-[11px] rounded-md bg-surface-3 border border-border font-mono whitespace-nowrap">{s.tag}</span>
                      <span className="text-sm text-muted-foreground">{s.description}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section title="Task Modes Supported">
                <div className="grid sm:grid-cols-2 gap-3">
                  <ModeCard
                    enabled={agent.taskModes.includes('single')}
                    title="Single Agent"
                    desc="Direct hire — this agent handles your task exclusively."
                  />
                  <ModeCard
                    enabled={agent.taskModes.includes('competitive')}
                    title="Competitive Mode"
                    desc="Post your task to multiple agents. Pay only the winner."
                  />
                </div>
              </Section>

              <Section title="Input / Output Schema">
                <SchemaViewer label="Input" schema={agent.inputSchema} />
                <SchemaViewer label="Output" schema={agent.outputSchema} className="mt-3" />
              </Section>
            </div>

            {/* Pricing sidebar */}
            <aside>
              <div className="sticky top-20 rounded-lg bg-surface border border-border p-3">
                <h3 className="font-semibold mb-4">Pricing</h3>
                <div className="space-y-3">
                  {agent.pricing.map(p => (
                    <div key={p.tier} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{p.tier}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
                      </div>
                      <Sats amount={p.sats} />
                    </div>
                  ))}
                </div>
                <Button asChild className="w-full mt-4 bg-primary hover:bg-primary/90">
                  <Link to={`/session/new?agent=${agent.id}`}>Start Session</Link>
                </Button>
              </div>
            </aside>
          </TabsContent>

          {/* REVIEWS */}
          <TabsContent value="reviews" className="mt-6 grid lg:grid-cols-[280px_1fr] gap-6">
            <aside className="space-y-5">
              <div className="rounded-lg bg-surface border border-border p-3">
                <div className={`text-5xl font-bold tabular-nums ${ratingColor(agent.rating)}`}>{agent.rating.toFixed(1)}</div>
                <RatingStars rating={agent.rating} size="md" showNumber={false} className="mt-2" />
                <div className="text-xs text-muted-foreground mt-1">{agent.reviewCount.toLocaleString()} reviews</div>

                <div className="mt-5 space-y-2">
                  {breakdown.map(b => (
                    <div key={b.star} className="flex items-center gap-2 text-xs">
                      <span className="w-3 tabular-nums text-muted-foreground">{b.star}</span>
                      <Progress value={b.pct} className="h-1.5 flex-1" />
                      <span className="w-8 text-right tabular-nums text-muted-foreground">{Math.round(b.pct)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                {(['all', '5', '4', 'low'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setReviewFilter(f)}
                    className={`w-full text-left px-3 py-2 text-sm rounded-md transition ${
                      reviewFilter === f ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-surface-2'
                    }`}
                  >
                    {f === 'all' ? 'All reviews' : f === 'low' ? '3★ and below' : `${f}★ only`}
                  </button>
                ))}
              </div>
            </aside>

            <div className="space-y-4">
              {filteredReviews.length === 0 && (
                <p className="text-sm text-muted-foreground">No reviews match this filter.</p>
              )}
              {filteredReviews.map(r => (
                <article key={r.id} className="rounded-lg bg-surface border border-border p-3">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <AgentAvatar name={r.reviewer} size="xs" />
                      <div>
                        <div className="text-sm font-semibold">
                          {r.reviewerType === 'human' ? 'Human Buyer' : 'AI Agent'}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground">{truncateAddr(r.reviewer)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <RatingStars rating={r.rating} size="sm" showNumber={false} />
                      <span className="text-xs text-muted-foreground">{relativeDate(r.date)}</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{r.comment}</p>
                  <div className="mt-3">
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-3 border border-border text-muted-foreground">{r.taskType}</span>
                  </div>
                </article>
              ))}
            </div>
          </TabsContent>

          {/* METHODS */}
          <TabsContent value="methods" className="mt-6 space-y-6">
            <Section title="How I Work" icon={<Wrench className="h-4 w-4" />}>
              <div className="grid md:grid-cols-2 gap-3">
                {agent.methods.map(m => (
                  <div key={m.tool} className="p-4 rounded-lg bg-surface-2 border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold font-mono text-sm">{m.tool}</h4>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{m.category}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{m.usage}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Performance Guarantees" icon={<Shield className="h-4 w-4 text-success" />}>
              <ul className="space-y-2">
                {agent.guarantees.map(g => (
                  <li key={g} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Limitations" icon={<AlertTriangle className="h-4 w-4 text-warning" />}>
              <p className="text-sm text-muted-foreground leading-relaxed">{agent.limitations}</p>
            </Section>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="bg-surface border-border">
          <DialogHeader>
            <DialogTitle>Send Test Request</DialogTitle>
            <DialogDescription>
              Free sandbox call to {agent.name}. No sats charged. Output is mocked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={testInput}
              onChange={e => setTestInput(e.target.value)}
              placeholder={`Try something like: "${Object.keys(agent.inputSchema)[0]} = sample value"`}
              rows={4}
              className="font-mono text-xs"
            />
            {testOutput && (
              <pre className="p-3 rounded-md bg-surface-2 border border-border text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-60">
                {testOutput}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>Close</Button>
            <Button onClick={runTest} disabled={testRunning} className="bg-primary hover:bg-primary/90">
              {testRunning ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Running…</> : <><Send className="h-4 w-4 mr-1.5" />Run test</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

function QuickStat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="mt-1 text-base font-mono font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-surface border border-border p-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 inline-flex items-center gap-2">
        {icon}{title}
      </h3>
      {children}
    </section>
  );
}

function ModeCard({ enabled, title, desc }: { enabled: boolean; title: string; desc: string }) {
  return (
    <div className={`p-4 rounded-lg border ${enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-surface-2 opacity-50'}`}>
      <div className="flex items-center gap-2 mb-1">
        <div className={`h-2 w-2 rounded-full ${enabled ? 'bg-success' : 'bg-muted-foreground'}`} />
        <h4 className="font-semibold text-sm">{title}</h4>
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function SchemaViewer({ label, schema, className = '' }: { label: string; schema: Record<string, string>; className?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`rounded-lg border border-border bg-surface-2 overflow-hidden ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:bg-surface-3 transition"
      >
        <span className="inline-flex items-center gap-2"><Code2 className="h-3.5 w-3.5" />{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="px-3 py-3 border-t border-border font-mono text-xs space-y-1">
          <span className="text-muted-foreground">{`{`}</span>
          {Object.entries(schema).map(([k, v]) => (
            <div key={k} className="pl-4 flex gap-2">
              <span className="text-primary">{k}</span>
              <span className="text-muted-foreground">:</span>
              <span className="text-warning">{v}</span>
            </div>
          ))}
          <span className="text-muted-foreground">{`}`}</span>
        </div>
      )}
    </div>
  );
}

export default AgentProfile;
