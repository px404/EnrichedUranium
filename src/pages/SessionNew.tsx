import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Check, Zap, Loader2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Sats } from '@/components/Sats';
import { CertificationBadge } from '@/components/CertificationBadge';
import { AgentAvatar } from '@/components/AgentAvatar';
import { MOCK_AGENTS } from '@/lib/mockData';
import { toast } from '@/hooks/use-toast';
import { useMode } from '@/lib/mode';
import { cn } from '@/lib/utils';
import type { Agent } from '@/lib/types';
import { api } from '@/lib/api';
import { actorToAgent } from '@/lib/adapters';
import { getIdentityPubkey, addStoredSessionId } from '@/lib/identity';

const SessionNew = () => {
  const [params] = useSearchParams();
  const { isLive, requireMock } = useMode();
  const agentParam = params.get('agent') ?? '';

  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sessionType, setType] = useState<'pay-per-call' | 'verified' | 'daily-pass'>('verified');
  const [selectedCap, setSelectedCap] = useState('');
  const [callLimit, setCallLimit] = useState(100);
  const [spendCap, setSpendCap] = useState(5000);
  const [autoRenew, setAutoRenew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState('');

  // ── Load agent ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setAgentLoading(true);
    if (isLive) {
      if (!agentParam) { setAgent(null); setAgentLoading(false); return; }
      api.getActor(agentParam)
        .then(a => { setAgent(actorToAgent(a)); setAgentLoading(false); })
        .catch(() => { setAgent(null); setAgentLoading(false); });
    } else {
      const found = MOCK_AGENTS.find(a => a.id === agentParam) ?? MOCK_AGENTS[0];
      setAgent(found ?? null);
      setAgentLoading(false);
    }
  }, [agentParam, isLive]);

  // Pre-select first capability
  useEffect(() => {
    if (agent?.skills.length && !selectedCap) setSelectedCap(agent.skills[0]);
  }, [agent, selectedCap]);

  // In live mode `pricing` is keyed by capability tag; in mock mode it's
  // keyed by tier name ('Single Call', 'Daily Pass', …). Try the capability
  // first, fall back to the per-call tier, then to the agent's flat rate.
  const priceForCap =
    agent?.pricing.find(p => p.tier === selectedCap)?.sats ??
    agent?.pricing.find(p => /single call|per call|per-call/i.test(p.tier))?.sats ??
    agent?.pricePerTask ??
    0;

  const totalCost =
    sessionType === 'pay-per-call' ? priceForCap
    : sessionType === 'verified' ? Math.min(spendCap, callLimit * priceForCap)
    : 8000;

  // ── Confirm / submit ───────────────────────────────────────────────────────
  const confirm = async () => {
    if (!agent) return;

    if (isLive) {
      const buyerPubkey = getIdentityPubkey();
      if (!buyerPubkey) {
        toast({
          title: 'No identity set',
          description: 'Go to Dashboard → Settings and enter your pubkey first.',
          variant: 'destructive',
        });
        return;
      }
      if (!selectedCap) { toast({ title: 'Select a capability', variant: 'destructive' }); return; }
      setSubmitting(true);
      try {
        const budget = Math.max(
          sessionType === 'pay-per-call' ? priceForCap
          : sessionType === 'verified' ? Math.min(spendCap, callLimit * priceForCap)
          : 8000,
          priceForCap, // budget must be >= price_per_call_sats
        );
        const s = await api.createSession({
          buyer_pubkey: buyerPubkey,
          seller_pubkey: agent.id,
          capability_tag: selectedCap,
          budget_sats: budget,
        });
        addStoredSessionId(s.id);
        setSessionId(s.id);
        toast({ title: '✅ Session created', description: s.id });
        setStep(3);
      } catch (e: unknown) {
        toast({
          title: 'Failed to create session',
          description: e instanceof Error ? e.message : 'Unknown error',
          variant: 'destructive',
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Mock mode — simulate payment
    if (!requireMock('Session creation')) return;
    setStep(2);
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 2000));
    const id = `sess_${Math.random().toString(36).slice(2, 10)}`;
    setSessionId(id);
    setSubmitting(false);
    toast({ title: '⚡ Payment detected', description: `Session ${id} is now active.` });
    setStep(3);
  };

  // ── Loading / not-found ────────────────────────────────────────────────────
  if (agentLoading) {
    return (
      <Layout>
        <div className="container py-20 max-w-xl text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!agent) {
    return (
      <Layout>
        <div className="container py-20 max-w-xl text-center">
          <h1 className="text-2xl font-bold">No agent selected</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isLive && agentParam
              ? `Agent "${agentParam}" was not found in the backend.`
              : 'Pick an agent from the marketplace first.'}
          </p>
          <Button asChild className="mt-6"><Link to="/browse">Browse agents</Link></Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-10 max-w-3xl">
        {/* Step indicator */}
        <div className="mb-8 flex items-center gap-2">
          {[1, 2].map(n => (
            <div key={n} className="flex items-center gap-2">
              <div className={cn(
                'h-8 w-8 rounded-full grid place-items-center text-sm font-bold font-mono',
                step >= n ? 'bg-primary text-primary-foreground' : 'bg-surface-2 text-muted-foreground border border-border',
              )}>
                {step > n ? <Check className="h-4 w-4" /> : n}
              </div>
              {n < 2 && <div className={cn('h-px w-12', step > n ? 'bg-primary' : 'bg-border')} />}
            </div>
          ))}
          <span className="ml-4 text-sm text-muted-foreground">
            {step === 1 ? 'Configure session' : step === 2 ? 'Processing…' : 'Session active'}
          </span>
        </div>

        <div className="rounded-xl bg-surface border border-border p-6 shadow-card">
          {/* Agent header */}
          <div className="flex items-center gap-3 pb-5 mb-5 border-b border-border">
            <AgentAvatar name={agent.name} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{agent.name}</h2>
                <CertificationBadge tier={agent.certTier} size="sm" />
              </div>
              <p className="text-xs text-muted-foreground truncate">{agent.tagline}</p>
            </div>
            <Sats amount={agent.pricePerTask} suffix="/call" />
          </div>

          {/* ── STEP 1: Configure ── */}
          {step === 1 && (
            <div className="space-y-5">
              {/* Capability picker (shown when agent has multiple capabilities) */}
              {agent.skills.length > 0 && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Capability</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {agent.skills.map(cap => (
                      <button key={cap} onClick={() => setSelectedCap(cap)}
                        className={cn(
                          'px-3 py-1.5 text-xs rounded-full border transition font-mono',
                          selectedCap === cap
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/40 text-muted-foreground',
                        )}>
                        {cap}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Session type */}
              <div className="space-y-3">
                <h3 className="font-semibold">How do you want to pay?</h3>
                {([
                  ['pay-per-call', 'Pay-Per-Call', 'Budget for a single call.'],
                  ['verified', 'Verified Session', 'Pre-authorise sats. Call freely within limits.'],
                  ['daily-pass', 'Daily Pass', 'Flat rate for 24 hours of unlimited calls.'],
                ] as const).map(([v, t, d]) => (
                  <label key={v} className={cn(
                    'flex gap-3 p-4 rounded-lg border cursor-pointer transition',
                    sessionType === v ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                  )}>
                    <input type="radio" checked={sessionType === v} onChange={() => setType(v)} className="mt-1 accent-primary" />
                    <div>
                      <div className="font-semibold text-sm">{t}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{d}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Verified session limits */}
              {sessionType === 'verified' && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Call limit</Label>
                    <input type="number" value={callLimit} min={1}
                      onChange={e => setCallLimit(Math.max(1, +e.target.value))}
                      className="w-full mt-2 h-10 px-3 bg-surface-2 border border-border rounded-md font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Spend cap (sats)</Label>
                    <input type="number" value={spendCap} min={priceForCap}
                      onChange={e => setSpendCap(Math.max(priceForCap, +e.target.value))}
                      className="w-full mt-2 h-10 px-3 bg-surface-2 border border-border rounded-md font-mono" />
                  </div>
                  <label className="sm:col-span-2 flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
                    <div>
                      <div className="text-sm font-medium">Auto-renew</div>
                      <div className="text-xs text-muted-foreground">Extend when limit is reached</div>
                    </div>
                    <Switch checked={autoRenew} onCheckedChange={setAutoRenew} />
                  </label>
                </div>
              )}

              {/* Cost summary */}
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Budget to authorise</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {isLive ? 'Session funded via backend mock (Lightning stalled)' : 'Simulated in mock mode'}
                  </div>
                </div>
                <Sats amount={totalCost} size="lg" />
              </div>

              <Button
                className="w-full bg-primary hover:bg-primary/90"
                onClick={confirm}
                disabled={submitting || (isLive && !selectedCap)}
              >
                {submitting
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Creating…</>
                  : <><Zap className="h-4 w-4 mr-1.5" />{isLive ? 'Create session' : 'Pay & start session'}</>}
              </Button>
            </div>
          )}

          {/* ── STEP 2: Processing (mock mode) ── */}
          {step === 2 && (
            <div className="space-y-5 text-center py-8">
              <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
              <h3 className="font-semibold">Creating session…</h3>
              <p className="text-sm text-muted-foreground">Simulating payment confirmation.</p>
            </div>
          )}

          {/* ── STEP 3: Confirmed ── */}
          {step === 3 && (
            <div className="space-y-5 text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-success/15 grid place-items-center">
                <Check className="h-8 w-8 text-success" />
              </div>
              <h3 className="text-xl font-bold">Session Active</h3>
              <div className="font-mono text-sm text-muted-foreground break-all">{sessionId}</div>
              {isLive && selectedCap && (
                <p className="text-xs text-muted-foreground">
                  Capability: <span className="font-mono">{selectedCap}</span>
                </p>
              )}
              <p className="text-sm text-muted-foreground">Your session is live and ready to receive calls.</p>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="flex-1"><Link to="/browse">Browse more</Link></Button>
                <Button asChild className="flex-1 bg-primary hover:bg-primary/90"><Link to="/dashboard">Go to dashboard</Link></Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SessionNew;
