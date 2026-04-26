import { useEffect, useRef, useState } from 'react';
import { Inbox, CheckCircle2, Loader2, RefreshCw, KeyRound } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Sats } from '@/components/Sats';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useMode } from '@/lib/mode';
import { api } from '@/lib/api';
import type { BackendRequest } from '@/lib/api';
import { getIdentityPubkey } from '@/lib/identity';
import { relativeTime } from '@/lib/adapters';
import { cn } from '@/lib/utils';

// ── Mock types / data ─────────────────────────────────────────────────────────

interface InboxTask {
  id: string;
  type: string;
  offered: number;
  mode: 'single' | 'competitive';
  buyer: 'Human' | 'Agent';
  expiresAt: number;
  preview: string;
  // Live mode: carry the full request for result submission
  request?: BackendRequest;
  // Live: result text entered by seller
  resultText?: string;
}

const TASK_TYPES = ['translation', 'summarization', 'copywriting', 'sentiment', 'code-review'];
const PREVIEWS = [
  'Translate the attached pitch deck into Modern Standard Arabic, preserving formatting…',
  'Summarize this 40-page market research PDF into 5 key bullet points with citations…',
  'Write three landing-page hero variants for an AI dev-tools SaaS targeting senior engineers…',
  'Classify these 200 customer support tickets by sentiment and urgency level…',
  'Review the attached PR for security issues and style violations. TS/React codebase…',
];

// ── helpers ───────────────────────────────────────────────────────────────────

function requestToTask(r: BackendRequest): InboxTask {
  return {
    id: r.id,
    type: r.capability_tag,
    offered: r.budget_sats,
    mode: 'single',
    buyer: 'Agent',
    expiresAt: r.deadline_unix * 1000,
    preview: JSON.stringify(r.input_payload).slice(0, 120) + '…',
    request: r,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

const Sell = () => {
  const { requireMock, isLive, pick } = useMode();
  const [online, setOnline] = useState(true);
  const [inbox, setInbox] = useState<InboxTask[]>([]);
  const [inProgress, setInProgress] = useState<InboxTask[]>([]);
  const [completed, setCompleted] = useState<InboxTask[]>([]);
  const [now, setNow] = useState(Date.now());
  const [liveLoading, setLiveLoading] = useState(false);
  const [sellerPubkey] = useState(getIdentityPubkey);
  // Track result text per task (live mode)
  const resultTexts = useRef<Record<string, string>>({});

  // ── Reset on mode switch ──────────────────────────────────────────────────
  useEffect(() => {
    setInbox([]);
    setInProgress([]);
    setCompleted([]);
  }, [isLive]);

  // ── Live mode: fetch assigned requests ────────────────────────────────────
  const fetchLiveRequests = async () => {
    const pk = getIdentityPubkey();
    if (!pk) return;
    setLiveLoading(true);
    try {
      const [inProgressRes, completedRes] = await Promise.all([
        api.getRequests({ seller_pubkey: pk, status: 'in_progress' }),
        api.getRequests({ seller_pubkey: pk, status: 'completed' }),
      ]);
      setInProgress(inProgressRes.requests.map(requestToTask));
      setCompleted(completedRes.requests.map(requestToTask));
      // Note: "inbox" (shortlisted but unassigned requests) requires a backend
      // query that doesn't exist yet. The inbox shows a helpful message instead.
      setInbox([]);
    } catch (e) {
      console.error('[sell] fetch error:', e);
      toast({ title: 'Failed to load requests', variant: 'destructive' });
    } finally {
      setLiveLoading(false);
    }
  };

  useEffect(() => {
    if (isLive && sellerPubkey) fetchLiveRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, sellerPubkey]);

  // ── Mock mode: random task generator ─────────────────────────────────────
  useEffect(() => {
    if (!online || isLive) return;
    const id = setInterval(() => {
      const i = Math.floor(Math.random() * TASK_TYPES.length);
      setInbox(prev => [
        {
          id: `tsk_${Math.random().toString(36).slice(2, 8)}`,
          type: TASK_TYPES[i],
          offered: [25, 50, 80, 120, 200][Math.floor(Math.random() * 5)],
          mode: (Math.random() > 0.6 ? 'competitive' : 'single') as 'competitive' | 'single',
          buyer: (Math.random() > 0.5 ? 'Agent' : 'Human') as 'Agent' | 'Human',
          expiresAt: Date.now() + 30000,
          preview: PREVIEWS[i],
        },
        ...prev,
      ].slice(0, 6));
    }, 9000);
    return () => clearInterval(id);
  }, [online, isLive]);

  // Tick + expire mock tasks
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (!isLive) setInbox(prev => prev.filter(t => t.expiresAt > Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [isLive]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const accept = (t: InboxTask) => {
    if (!requireMock('Accepting tasks')) return;
    setInbox(p => p.filter(x => x.id !== t.id));
    setInProgress(p => [t, ...p]);
    toast({ title: 'Task accepted', description: t.id });
  };

  const submit = async (t: InboxTask) => {
    if (isLive) {
      const pk = getIdentityPubkey();
      if (!pk) { toast({ title: 'No identity set', variant: 'destructive' }); return; }
      const raw = resultTexts.current[t.id] ?? '';
      let outputPayload: Record<string, unknown>;
      try {
        outputPayload = raw ? JSON.parse(raw) : { result: raw };
      } catch {
        outputPayload = { result: raw };
      }
      try {
        await api.submitResult(t.id, { seller_pubkey: pk, output_payload: outputPayload });
        setInProgress(p => p.filter(x => x.id !== t.id));
        setCompleted(p => [t, ...p]);
        toast({ title: `✅ Result submitted`, description: `Request ${t.id.slice(0, 12)}…` });
      } catch (e: unknown) {
        toast({
          title: 'Submission failed',
          description: e instanceof Error ? e.message : 'Unknown error',
          variant: 'destructive',
        });
      }
      return;
    }
    if (!requireMock('Submitting work')) return;
    setInProgress(p => p.filter(x => x.id !== t.id));
    setCompleted(p => [t, ...p]);
    toast({ title: `⚡ ${t.offered} sats received`, description: 'Payment settled' });
  };

  // ── Earnings ──────────────────────────────────────────────────────────────
  const baselineEarnings = pick(2340, 0);
  const todayEarnings = completed.reduce((s, t) => s + t.offered, 0) + baselineEarnings;
  const weekEarnings = pick(14200, 0);
  const allTimeEarnings = pick(847500, 0);
  const hourlyBars = pick(
    [3, 7, 4, 9, 6, 11, 8, 12, 10, 14, 9, 13],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );

  return (
    <Layout>
      <div className="container py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              <Inbox className="h-6 w-6 text-primary" />Task Inbox
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isLive
                ? sellerPubkey
                  ? `Showing tasks assigned to ${sellerPubkey.slice(0, 16)}…`
                  : 'Enter your pubkey in Dashboard → Settings to see your tasks.'
                : 'Live tasks broadcast to your agent.'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="px-3 py-1.5 rounded-full border border-warning/30 bg-warning/10">
              <span className="text-xs text-muted-foreground mr-2">Earned today</span>
              <Sats amount={todayEarnings} />
            </div>
            {isLive ? (
              <Button
                size="sm"
                variant="outline"
                onClick={fetchLiveRequests}
                disabled={liveLoading || !sellerPubkey}
              >
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', liveLoading && 'animate-spin')} />
                Refresh
              </Button>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <span className={online ? 'text-success' : 'text-muted-foreground'}>{online ? 'Online' : 'Offline'}</span>
                <Switch checked={online} onCheckedChange={setOnline} />
              </label>
            )}
          </div>
        </header>

        {/* Live — no identity */}
        {isLive && !sellerPubkey && (
          <div className="p-10 rounded-xl border border-dashed border-border text-center space-y-3">
            <KeyRound className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-semibold">No identity set</p>
            <p className="text-xs text-muted-foreground">Go to Dashboard → Settings to connect your pubkey.</p>
          </div>
        )}

        {(!isLive || sellerPubkey) && (
          <div className="grid lg:grid-cols-[1fr_1fr_1fr_280px] gap-4">
            {/* INBOX */}
            <Column title="Inbox" count={inbox.length}>
              {inbox.length === 0 && (
                <Empty msg={
                  isLive
                    ? 'Shortlisted requests require a backend query that is not yet available. Accepted tasks appear in "In Progress".'
                    : online ? 'Listening for tasks…' : 'Go online to receive tasks'
                } />
              )}
              {inbox.map(t => {
                const sec = Math.max(0, Math.floor((t.expiresAt - now) / 1000));
                return (
                  <article key={t.id} className="p-4 rounded-lg bg-surface border border-border space-y-2 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{t.type}</span>
                      <Sats amount={t.offered} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.mode === 'competitive' ? 'Competitive — 3 bidding' : 'Single agent'} · {t.buyer}
                    </div>
                    <p className="text-xs line-clamp-2">{t.preview}</p>
                    <div className="text-[10px] font-mono text-warning">Expires in {sec}s</div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" className="flex-1" onClick={() => accept(t)}>Accept</Button>
                      <Button size="sm" variant="ghost" onClick={() => setInbox(p => p.filter(x => x.id !== t.id))}>Skip</Button>
                    </div>
                  </article>
                );
              })}
            </Column>

            {/* IN PROGRESS */}
            <Column title="In progress" count={inProgress.length}>
              {inProgress.length === 0 && <Empty msg="No active tasks" />}
              {inProgress.map(t => (
                <article key={t.id} className="p-4 rounded-lg bg-surface border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{t.type}</span>
                    <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                  </div>
                  {isLive && (
                    <div className="text-[11px] font-mono text-muted-foreground">
                      {t.id.slice(0, 20)}…
                    </div>
                  )}
                  <p className="text-xs">{t.preview}</p>
                  <Textarea
                    placeholder={isLive ? 'Paste your JSON result or plain text…' : 'Result output…'}
                    defaultValue={resultTexts.current[t.id] ?? ''}
                    onChange={e => { resultTexts.current[t.id] = e.target.value; }}
                    className="w-full text-xs bg-surface-2 border border-border rounded-md p-2 h-20 font-mono"
                  />
                  {isLive && (
                    <p className="text-[10px] text-muted-foreground">
                      Deadline: {new Date(t.expiresAt).toLocaleTimeString()}
                    </p>
                  )}
                  <Button size="sm" className="w-full" onClick={() => submit(t)}>
                    Submit & collect <Sats amount={t.offered} className="ml-2" />
                  </Button>
                </article>
              ))}
            </Column>

            {/* COMPLETED */}
            <Column title="Completed" count={completed.length}>
              {completed.length === 0 && <Empty msg="No completed yet" />}
              {completed.map(t => (
                <article key={t.id} className="p-4 rounded-lg bg-surface border border-border opacity-80">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.type}</span>
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]">
                      {isLive ? t.id.slice(0, 12) + '…' : t.id}
                    </span>
                    <Sats amount={t.offered} />
                  </div>
                  {isLive && t.request && (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {relativeTime(t.request.created_at)}
                    </div>
                  )}
                </article>
              ))}
            </Column>

            {/* EARNINGS SIDEBAR */}
            <aside className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Earnings</h3>
              <Stat label="Today" value={todayEarnings} />
              <Stat label="This week" value={weekEarnings} />
              <Stat label="All-time" value={allTimeEarnings} />
              <div className="rounded-lg bg-surface border border-border p-4">
                <div className="text-xs text-muted-foreground mb-2">Hourly</div>
                <div className="flex items-end gap-1 h-12">
                  {hourlyBars.map((v, i) => (
                    <div key={i} className="flex-1 rounded-t bg-primary"
                      style={{ height: `${(v / 14) * 100}%`, minHeight: v === 0 ? '2px' : undefined, opacity: v === 0 ? 0.15 : 1 }} />
                  ))}
                </div>
              </div>
              {isLive && liveLoading && (
                <div className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </Layout>
  );
};

function Column({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold mb-3 flex items-center justify-between">
        <span>{title}</span>
        <span className="text-xs font-mono text-muted-foreground">{count}</span>
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="p-6 text-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
      {msg}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface border border-border p-4 flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Sats amount={value} />
    </div>
  );
}

export default Sell;
