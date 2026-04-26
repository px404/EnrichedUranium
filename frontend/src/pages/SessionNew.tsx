import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Check, Zap, Loader2, ChevronRight, ClipboardList, Settings2, Sparkles } from 'lucide-react';
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

const API = 'http://localhost:3001';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fieldLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function isLongField(key: string): boolean {
  return key.includes('description') || key.includes('content') ||
    key.includes('pitch') || key.includes('copy') || key.includes('audience');
}

// ── Dynamic form renderer from JSON Schema ────────────────────────────────────

interface SchemaField {
  key: string;
  type: string;
  required: boolean;
  description?: string;
}

function schemaToFields(schema: Record<string, unknown>): SchemaField[] {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(props).map(([key, def]) => ({
    key,
    type: def.type ?? 'string',
    required: required.has(key),
    description: def.description,
  }));
}

interface TaskFormProps {
  fields: SchemaField[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
}

interface MonitorEvent {
  id: string;
  event: string;
  actor_pubkey: string | null;
  detail: Record<string, unknown> | null;
  created_at: number;
  request_id?: string;
}

interface SubRequestRow {
  id: string;
  capability_tag: string;
  status: string;
  selected_seller: string | null;
  input_payload: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
}

const AGENT_TAG: Record<string, string> = {
  'agent-pm-001':         'PM',
  'agent-researcher-001': 'researcher',
  'agent-copywriter-001': 'copywriter',
  'agent-strategist-001': 'strategist',
};

function actorTag(pubkey: string | null): string {
  if (!pubkey) return 'system';
  return AGENT_TAG[pubkey] ?? pubkey.slice(0, 10) + '…';
}

function eventLine(e: MonitorEvent): string {
  const actor = actorTag(e.actor_pubkey);
  switch (e.event) {
    case 'request_posted': return `📝 Request posted by ${actor}`;
    case 'request_funded': return '⚡ Invoice paid — request funded';
    case 'request_matched': return '✅ Seller matched';
    case 'seller_selected': return `👤 Seller selected: ${actorTag(String(e.detail?.seller_pubkey ?? '')) || actor}`;
    case 'task_dispatched': return '📤 Task dispatched to agent endpoint';
    case 'task_dispatch_failed': return `⚠ Dispatch failed — ${String(e.detail?.error ?? e.detail?.http_status ?? 'see monitor')}`;
    case 'result_submitted': return `📥 Result submitted by ${actor}`;
    case 'schema_validated': return '✅ Result passed schema validation';
    case 'schema_failed': return `❌ Validation failed${e.detail?.validation_level ? ` (L${String(e.detail.validation_level)})` : ''}`;
    case 'payment_released': return `💸 Seller payout released${e.detail?.payment_error ? ` (payment issue: ${String(e.detail.payment_error)})` : ''}`;
    case 'refund_issued': return `↩ Refund issued${e.detail?.payment_error ? ` (payment issue: ${String(e.detail.payment_error)})` : ''}`;
    case 'timeout': return '⏱ Request timed out';
    case 'agent_task_accepted': return `🤝 ${actor} accepted task`;
    case 'agent_thinking': return `🧠 ${actor} → DeepSeek: ${String(e.detail?.prompt_summary ?? 'thinking…')}`;
    case 'agent_responded': return `💬 ${actor} replied (${e.detail?.took_ms ? `${e.detail.took_ms}ms` : 'ok'})`;
    case 'agent_error': return `❌ ${actor} error — ${String(e.detail?.error ?? '')}`;
    case 'pm_step': return `🎬 PM step ${String(e.detail?.step ?? '')}: ${String(e.detail?.action ?? '')}`;
    case 'pm_step_done': return `✔ PM step ${String(e.detail?.step ?? '')} done`;
    default: return `• ${e.event.replace(/_/g, ' ')}`;
  }
}

/** Terminal-style line: tag + colour + raw detail preview. */
interface ThoughtLine {
  id: string;
  ts: number;
  agent: string;        // 'PM' | 'researcher' | …
  kind: 'accept' | 'think' | 'reply' | 'step' | 'error' | 'info';
  text: string;
}

function eventToThought(e: MonitorEvent): ThoughtLine | null {
  const agent = actorTag(e.actor_pubkey);
  const detail = e.detail ?? {};
  switch (e.event) {
    case 'agent_task_accepted':
      return { id: e.id, ts: e.created_at, agent, kind: 'accept',
        text: `accepted task` + (detail.product ? ` — "${String(detail.product)}"` : '') };
    case 'agent_thinking':
      return { id: e.id, ts: e.created_at, agent, kind: 'think',
        text: `→ deepseek (max ${String(detail.max_tokens ?? '?')} tok): ${String(detail.prompt_summary ?? '')}` };
    case 'agent_responded':
      return { id: e.id, ts: e.created_at, agent, kind: 'reply',
        text: `← ${detail.took_ms ? `${detail.took_ms}ms ` : ''}${String(detail.preview ?? '')}` };
    case 'agent_error':
      return { id: e.id, ts: e.created_at, agent, kind: 'error',
        text: `error: ${String(detail.error ?? 'unknown')}` };
    case 'pm_step':
      return { id: e.id, ts: e.created_at, agent: 'PM', kind: 'step',
        text: `step ${String(detail.step ?? '')} — ${String(detail.action ?? '')}` +
          (detail.budget_sats ? ` (${String(detail.budget_sats)} sats)` : '') };
    case 'pm_step_done':
      return { id: e.id, ts: e.created_at, agent: 'PM', kind: 'step',
        text: `step ${String(detail.step ?? '')} ✓` +
          (detail.preview ? ` — ${String(detail.preview).slice(0, 100)}` : '') };
    default:
      return null;
  }
}

function TaskForm({ fields, values, onChange }: TaskFormProps) {
  if (fields.length === 0) {
    return (
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Task description <span className="text-destructive">*</span>
        </Label>
        <textarea
          value={values['__description'] ?? ''}
          onChange={e => onChange('__description', e.target.value)}
          rows={5}
          placeholder="Describe what you want this agent to do…"
          className="mt-2 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map(f => (
        <div key={f.key}>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {fieldLabel(f.key)}
            {f.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          {isLongField(f.key) ? (
            <textarea
              value={values[f.key] ?? ''}
              onChange={e => onChange(f.key, e.target.value)}
              rows={4}
              placeholder={f.description ?? `Enter ${fieldLabel(f.key).toLowerCase()}…`}
              className="mt-2 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          ) : (
            <input
              type="text"
              value={values[f.key] ?? ''}
              onChange={e => onChange(f.key, e.target.value)}
              placeholder={f.description ?? `Enter ${fieldLabel(f.key).toLowerCase()}…`}
              className="mt-2 w-full h-10 rounded-md border border-border bg-surface-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Result renderer ───────────────────────────────────────────────────────────

function ResultDisplay({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') {
    return <pre className="text-xs font-mono whitespace-pre-wrap break-all">{JSON.stringify(result, null, 2)}</pre>;
  }

  const entries = Object.entries(result as Record<string, unknown>);

  return (
    <div className="space-y-4">
      {entries.map(([key, val]) => (
        <div key={key} className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{fieldLabel(key)}</p>
          {Array.isArray(val) ? (
            <ul className="space-y-1">
              {val.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>{typeof item === 'object' ? JSON.stringify(item) : String(item)}</span>
                </li>
              ))}
            </ul>
          ) : typeof val === 'object' && val !== null ? (
            <ResultDisplay result={val} />
          ) : (
            <p className="text-sm leading-relaxed">{String(val)}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, icon: ClipboardList, label: 'Describe task' },
  { n: 2, icon: Settings2,     label: 'Payment'       },
  { n: 3, icon: Sparkles,      label: 'Working…'      },
];

const SessionNew = () => {
  const [params] = useSearchParams();
  const { isLive, requireMock } = useMode();
  const agentParam = params.get('agent') ?? '';

  const [agent, setAgent]           = useState<Agent | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [capSchema, setCapSchema]   = useState<Record<string, unknown>>({});
  const [fields, setFields]         = useState<SchemaField[]>([]);

  const [step, setStep]             = useState<1 | 2 | 3>(1);
  const [selectedCap, setSelectedCap] = useState('');
  const [taskValues, setTaskValues] = useState<Record<string, string>>({});

  const [sessionType, setType]      = useState<'pay-per-call' | 'verified' | 'daily-pass'>('pay-per-call');
  const [callLimit, setCallLimit]   = useState(10);
  const [spendCap, setSpendCap]     = useState(5000);
  const [autoRenew, setAutoRenew]   = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [sessionId, setSessionId]   = useState('');
  const [requestId, setRequestId]   = useState('');

  // Result polling
  const [pollStatus, setPollStatus] = useState<'waiting' | 'done' | 'failed'>('waiting');
  const [pollResult, setPollResult] = useState<unknown>(null);
  const [pollLog, setPollLog]       = useState<string[]>([]);
  const [thoughts, setThoughts]     = useState<ThoughtLine[]>([]);
  const [submittedInput, setSubmittedInput] = useState<Record<string, unknown> | null>(null);
  const [subRequests, setSubRequests] = useState<SubRequestRow[]>([]);
  const [invoice, setInvoice]       = useState<string | null>(null);
  const [paying, setPaying]         = useState(false);
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenEventIds                = useRef<Set<string>>(new Set());
  const targetSellerRef             = useRef<string | null>(null);
  const autoSelectedRef             = useRef(false);

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

  // Load capability schema when capability changes
  useEffect(() => {
    if (!selectedCap || !isLive) return;
    fetch(`${API}/schemas/${selectedCap}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setCapSchema(d.input_schema ?? {});
        setFields(schemaToFields(d.input_schema ?? {}));
        setTaskValues({});
      })
      .catch(() => {});
  }, [selectedCap, isLive]);

  const priceForCap = agent?.pricing.find(p => p.tier === selectedCap)?.sats ?? agent?.pricePerTask ?? 0;

  const budget = Math.max(
    sessionType === 'pay-per-call' ? priceForCap
    : sessionType === 'verified'   ? Math.min(spendCap, callLimit * priceForCap)
    : 8000,
    priceForCap,
  );

  // ── Validation ─────────────────────────────────────────────────────────────
  const taskValid = fields.every(f => !f.required || (taskValues[f.key] ?? '').trim().length > 0)
    || (!fields.length && (taskValues['__description'] ?? '').trim().length > 0);

  // ── Registration helper ────────────────────────────────────────────────────
  const ensureBuyerRegistered = async (pubkey: string) => {
    try {
      const check = await fetch(`${API}/actors/${pubkey}`);
      if (check.ok) return;
      await fetch(`${API}/actors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey, type: 'human', display_name: `User ${pubkey.slice(0, 8)}` }),
      });
    } catch { /* non-fatal */ }
  };

  // ── Build input payload ────────────────────────────────────────────────────
  const buildPayload = (): Record<string, unknown> => {
    if (fields.length === 0) return { description: taskValues['__description'] ?? '' };
    return Object.fromEntries(
      fields.map(f => [f.key, (taskValues[f.key] ?? '').trim() || undefined]).filter(([, v]) => v !== undefined)
    );
  };

  // ── Poll for result ────────────────────────────────────────────────────────
  const startPolling = useCallback((reqId: string) => {
    let attempts = 0;
    let lastStatus = '';
    seenEventIds.current = new Set();
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        // Always refresh sub-requests (chain children) so the user can see
        // each agent's input + output as the orchestration proceeds.
        await refreshSubRequests(reqId);

        // Check for final result first
        const r = await fetch(`${API}/results/${reqId}`);
        if (r.ok) {
          const d = await r.json();
          clearInterval(pollRef.current!);
          setPollStatus('done');
          const payload = d.output_payload;
          setPollResult(typeof payload === 'string' ? JSON.parse(payload) : payload);
          setPollLog(l => [...l, `✅ Result received after ~${attempts * 3}s`]);
          return;
        }

        // Check request status for progress hints
        const rq = await fetch(`${API}/requests/${reqId}`).then(x => x.json()).catch(() => null);
        const status: string = rq?.status ?? '';

        // Pull backend event trail (including child agent events) so users can
        // see what is happening internally.
        const eventsRes = await fetch(`${API}/monitor/requests/${reqId}/events?include_chain=true`).catch(() => null);
        if (eventsRes?.ok) {
          const payload = await eventsRes.json().catch(() => null) as { events?: MonitorEvent[] } | null;
          for (const ev of payload?.events ?? []) {
            if (seenEventIds.current.has(ev.id)) continue;
            seenEventIds.current.add(ev.id);
            setPollLog(l => [...l, eventLine(ev)]);
            const t = eventToThought(ev);
            if (t) setThoughts(prev => [...prev, t]);
          }
        }

        if (['timeout', 'cancelled', 'failed', 'refunded'].includes(status)) {
          clearInterval(pollRef.current!);
          setPollStatus('failed');
          setPollLog(l => [...l, `❌ Request ${status}`]);
          return;
        }

        // Auto-select the target seller as soon as the request is matched or
        // funded. The platform produces a shortlist after payment reconciles
        // — we pick the agent the user originally chose so dispatch happens
        // automatically (no manual "select seller" step).
        if (
          (status === 'matched' || status === 'funded') &&
          !rq?.selected_seller &&
          !autoSelectedRef.current &&
          targetSellerRef.current &&
          Array.isArray(rq?.shortlist) && rq.shortlist.includes(targetSellerRef.current)
        ) {
          autoSelectedRef.current = true;
          setPollLog(l => [...l, `👤 Assigning to ${targetSellerRef.current}…`]);
          fetch(`${API}/requests/${reqId}/select`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ seller_pubkey: targetSellerRef.current }),
          }).then(async sel => {
            if (!sel.ok) {
              const err = await sel.json().catch(() => ({}));
              setPollLog(l => [...l, `❌ Auto-select failed: ${err.message ?? err.error ?? sel.status}`]);
              autoSelectedRef.current = false; // allow retry
            } else {
              setPollLog(l => [...l, '📤 Dispatched — agent is starting…']);
            }
          }).catch(() => { autoSelectedRef.current = false; });
        }

        // Show status transitions as new log lines; animate last line otherwise
        if (status && status !== lastStatus) {
          lastStatus = status;
          const msg =
            status === 'in_progress' ? '⏳ Agent working on your task…' :
            status === 'matched'     ? '⏳ Matched — waiting for agent to start…' :
            status === 'funded'      ? '⏳ Funded — finding best agent…' :
            `⏳ Status: ${status}`;
          setPollLog(l => [...l, msg]);
        } else {
          setPollLog(l => {
            const last = l[l.length - 1];
            const dotCount = (last?.match(/\.+$/)?.[0].length ?? 0);
            const base = last?.replace(/\.+$/, '') ?? '⏳ Agent working';
            return [...l.slice(0, -1), dotCount < 6 ? base + '.' : base];
          });
        }
      } catch {
        setPollLog(l => [...l, '⚠ Network hiccup — retrying…']);
      }
    }, 3000);
  }, []);

  /** Fetch sub-requests (chain children) of the given parent and their outputs. */
  const refreshSubRequests = async (parentId: string) => {
    try {
      const r = await fetch(`${API}/requests?chain_parent_id=${parentId}`);
      if (!r.ok) return;
      const d = await r.json() as { requests?: SubRequestRow[] };
      const rows = d.requests ?? [];
      // Pull output for any child whose request just completed but we haven't fetched yet.
      const enriched = await Promise.all(rows.map(async row => {
        if (row.status !== 'completed') return row;
        try {
          const rr = await fetch(`${API}/results/${row.id}`);
          if (!rr.ok) return row;
          const rd = await rr.json();
          const op = rd.output_payload;
          return { ...row, output_payload: typeof op === 'string' ? JSON.parse(op) : op };
        } catch { return row; }
      }));
      setSubRequests(enriched);
    } catch { /* ignore */ }
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  /**
   * Dev helper: pay the platform invoice from the **user** wallet.
   *
   * Money flow per campaign:
   *   user wallet  →  platform escrow   (the user pays for the parent job)
   *   PM wallet    →  platform escrow   (PM pays for each sub-task it hires)
   *   escrow       →  PM wallet         (PM gets the parent budget minus fee)
   *   escrow       →  specialist wallets (each specialist gets paid)
   *
   * Net: PM keeps `parent_budget − sum(child_budgets) − fees` per campaign.
   * This used to be paid from the PM wallet, which made PM lose money on every
   * campaign instead of earning a fee.
   *
   * Called automatically when an invoice arrives; also wired to the manual
   * "Pay from user wallet" button as a fallback if auto-pay fails.
   */
  const payFromUserWallet = async (invoiceArg?: string) => {
    const target = invoiceArg ?? invoice;
    if (!target) return;
    setPaying(true);
    setPollLog(l => [...l, '⚡ Auto-paying invoice from your wallet…']);
    try {
      const r = await fetch(`${API}/wallets/user/pay`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ invoice: target }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ?? d.error ?? 'pay failed');
      setPollLog(l => [...l, `✅ Payment submitted (${d.payment_id ?? '…'}). Reconciling…`]);
      setInvoice(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      setPollLog(l => [...l, `❌ Auto-pay failed: ${msg} — top up the user wallet on the Wallets page, or pay manually below.`]);
      toast({ title: 'Auto-pay failed', description: msg, variant: 'destructive' });
    } finally {
      setPaying(false);
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!agent) return;

    if (!isLive) {
      // Mock mode
      if (!requireMock('Session + task')) return;
      setStep(3);
      setPollLog(['Simulating agent work…']);
      await new Promise(r => setTimeout(r, 2000));
      setPollStatus('done');
      setPollResult({ message: 'Mock task completed successfully! In live mode this would be a real response from the agent.' });
      setPollLog(l => [...l, '✅ Done (mock)']);
      return;
    }

    const buyerPubkey = getIdentityPubkey();
    if (!buyerPubkey) {
      toast({ title: 'No identity set', description: 'Go to Dashboard → Settings and create your account first.', variant: 'destructive' });
      return;
    }
    if (!selectedCap) { toast({ title: 'Select a capability', variant: 'destructive' }); return; }
    if (!taskValid)   { toast({ title: 'Fill in required fields', variant: 'destructive' }); return; }

    setSubmitting(true);
    setStep(3);
    setPollStatus('waiting');
    setPollLog(['Registering buyer…']);

    try {
      await ensureBuyerRegistered(buyerPubkey);

      // Session is optional — tracks billing, but don't block on failure
      try {
        setPollLog(l => [...l, 'Opening session…']);
        const s = await api.createSession({
          buyer_pubkey:   buyerPubkey,
          seller_pubkey:  agent.id,
          capability_tag: selectedCap,
          budget_sats:    budget,
        });
        addStoredSessionId(s.id);
        setSessionId(s.id);
      } catch {
        // Non-fatal — proceed to request submission
      }

      // Submit the task request
      setPollLog(l => [...l, 'Submitting task to agent…']);
      const builtInput = buildPayload();
      setSubmittedInput(builtInput);
      setSubRequests([]);
      setThoughts([]);
      setInvoice(null);
      // Reset orchestration refs for this run
      targetSellerRef.current = agent.id;
      autoSelectedRef.current = false;

      const req = await api.createRequest({
        buyer_pubkey:   buyerPubkey,
        capability_tag: selectedCap,
        input_payload:  builtInput,
        budget_sats:    budget,
      });
      setRequestId(req.id);

      if (req.status === 'in_progress') {
        setPollLog(l => [...l, 'Agent dispatched — working…']);
        autoSelectedRef.current = true;
        startPolling(req.id);
      } else if ((req.status === 'matched' || req.status === 'funded') && req.shortlist?.length > 0) {
        // Already paid + matched (no invoice needed) — let the polling loop
        // auto-select on next tick. Kick polling immediately.
        setPollLog(l => [...l, '⏳ Matched — dispatching to agent…']);
        startPolling(req.id);
      } else if (req.invoice) {
        // Real Lightning payment required — auto-pay from the user wallet so
        // the user never has to leave the app. The reconcile loop in the API
        // then advances pending_payment → matched, and the polling loop will
        // auto-select the seller below.
        // NB: we deliberately do *not* pay from the PM wallet here — the PM
        // is the agent doing the work and should be paid by the user, not pay
        // for the user's request out of its own pocket.
        setInvoice(req.invoice);
        setPollLog(l => [...l, `⚡ Lightning invoice issued (${budget} sats)`]);
        setPollLog(l => [...l, req.invoice!.slice(0, 60) + '…']);
        startPolling(req.id);
        payFromUserWallet(req.invoice).catch(() => { /* error already surfaced */ });
      } else {
        startPolling(req.id);
      }
    } catch (e: unknown) {
      setPollStatus('failed');
      setPollLog(l => [...l, `❌ ${e instanceof Error ? e.message : 'Error'}`]);
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
      setStep(2); // go back
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading / not-found ────────────────────────────────────────────────────
  if (agentLoading) return (
    <Layout>
      <div className="container py-20 max-w-xl text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
      </div>
    </Layout>
  );

  if (!agent) return (
    <Layout>
      <div className="container py-20 max-w-xl text-center">
        <h1 className="text-2xl font-bold">No agent selected</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isLive && agentParam ? `Agent "${agentParam}" was not found.` : 'Pick an agent from the marketplace first.'}
        </p>
        <Button asChild className="mt-6"><Link to="/browse">Browse agents</Link></Button>
      </div>
    </Layout>
  );

  return (
    <Layout>
      <div className="container py-10 max-w-2xl">

        {/* Step indicator */}
        <div className="mb-8 flex items-center gap-3">
          {STEPS.map(({ n, label }, i) => (
            <div key={n} className="flex items-center gap-2">
              <div className={cn(
                'h-8 w-8 rounded-full grid place-items-center text-sm font-bold transition-colors',
                step > n  ? 'bg-success text-white'
                : step === n ? 'bg-primary text-primary-foreground'
                : 'bg-surface-2 text-muted-foreground border border-border',
              )}>
                {step > n ? <Check className="h-4 w-4" /> : n}
              </div>
              <span className={cn('text-sm hidden sm:block', step === n ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 ml-1" />
              )}
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
          {/* Agent header */}
          <div className="flex items-center gap-3 p-5 border-b border-border bg-surface-2/40">
            <AgentAvatar name={agent.name} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{agent.name}</h2>
                <CertificationBadge tier={agent.certTier} size="sm" />
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.tagline}</p>
            </div>
            <Sats amount={priceForCap} suffix="/call" />
          </div>

          <div className="p-6">

            {/* ── STEP 1: Describe task ── */}
            {step === 1 && (
              <div className="space-y-6">
                {/* Capability picker */}
                {agent.skills.length > 1 && (
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

                {/* Task input */}
                <div>
                  <h3 className="font-semibold mb-1">What do you need?</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    The agent will reason through your request and act autonomously.
                  </p>
                  <TaskForm
                    fields={fields}
                    values={taskValues}
                    onChange={(k, v) => setTaskValues(prev => ({ ...prev, [k]: v }))}
                  />
                </div>

                <Button
                  className="w-full bg-primary hover:bg-primary/90"
                  onClick={() => setStep(2)}
                  disabled={!taskValid}
                >
                  Next — Configure payment
                  <ChevronRight className="h-4 w-4 ml-1.5" />
                </Button>
              </div>
            )}

            {/* ── STEP 2: Payment ── */}
            {step === 2 && (
              <div className="space-y-5">
                <h3 className="font-semibold">How do you want to pay?</h3>

                {([
                  ['pay-per-call', 'Pay-Per-Call',     'Budget for a single call.'],
                  ['verified',     'Verified Session',  'Pre-authorise sats, call freely within limits.'],
                  ['daily-pass',   'Daily Pass',        'Flat rate for 24 hours of unlimited calls.'],
                ] as const).map(([v, t, d]) => (
                  <label key={v} className={cn(
                    'flex gap-3 p-4 rounded-lg border cursor-pointer transition',
                    sessionType === v ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30',
                  )}>
                    <input type="radio" checked={sessionType === v} onChange={() => setType(v)} className="mt-1 accent-primary" />
                    <div>
                      <div className="font-semibold text-sm">{t}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{d}</div>
                    </div>
                  </label>
                ))}

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

                {/* Budget summary */}
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Budget to authorise</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {isLive ? 'Paid from your user wallet · PM uses it to hire specialists & keeps the rest' : 'Simulated in mock mode'}
                    </div>
                  </div>
                  <Sats amount={budget} size="lg" />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>← Back</Button>
                  <Button className="flex-1 bg-primary hover:bg-primary/90" onClick={submit} disabled={submitting}>
                    {submitting
                      ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Submitting…</>
                      : <><Zap className="h-4 w-4 mr-1.5" />Submit task</>}
                  </Button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Working + Results ── */}
            {step === 3 && (
              <div className="space-y-5">
                {/* Invoice + dev pay-from-user action while pending payment */}
                {invoice && (
                  <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-warning">
                          Awaiting Lightning payment
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Auto-paying from your in-app user wallet. The PM agent will then use part of this to hire specialists and keep the rest as its fee.
                        </div>
                      </div>
                      <Sats amount={budget} />
                    </div>
                    <pre className="text-[10px] font-mono break-all whitespace-pre-wrap bg-surface-2 rounded p-2 max-h-24 overflow-auto">
{invoice}
                    </pre>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1"
                        onClick={() => { navigator.clipboard.writeText(invoice); toast({ title: 'Invoice copied' }); }}>
                        Copy invoice
                      </Button>
                      <Button size="sm" className="flex-1 bg-primary hover:bg-primary/90"
                        onClick={() => payFromUserWallet()} disabled={paying}>
                        {paying
                          ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Paying…</>
                          : <><Zap className="h-3.5 w-3.5 mr-1.5" />Pay from your wallet (dev)</>}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Your input */}
                {submittedInput && (
                  <div className="rounded-lg border border-border bg-surface-2/40 p-4">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                      Your input → {selectedCap}
                    </div>
                    <pre className="text-[11px] font-mono text-foreground/90 whitespace-pre-wrap break-words max-h-40 overflow-auto">
{JSON.stringify(submittedInput, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Live agent thoughts — terminal style */}
                {thoughts.length > 0 && (
                  <div className="rounded-lg border border-emerald-500/30 bg-black/80 text-emerald-200 p-3 font-mono text-[11px] max-h-72 overflow-auto">
                    <div className="flex items-center justify-between mb-2 text-emerald-400/80">
                      <span>● agent terminal · live</span>
                      <span className="text-[10px]">{thoughts.length} lines</span>
                    </div>
                    {thoughts.map(t => (
                      <div key={t.id} className="leading-relaxed">
                        <span className="text-emerald-500/70">
                          [{new Date(t.ts * 1000).toLocaleTimeString()}]
                        </span>{' '}
                        <span className={cn(
                          'font-semibold',
                          t.agent === 'PM' ? 'text-amber-300'
                          : t.agent === 'researcher' ? 'text-cyan-300'
                          : t.agent === 'copywriter' ? 'text-pink-300'
                          : t.agent === 'strategist' ? 'text-violet-300'
                          : 'text-emerald-200',
                        )}>{t.agent}</span>
                        <span className={cn(
                          'ml-2',
                          t.kind === 'think' ? 'text-emerald-100/90'
                          : t.kind === 'reply' ? 'text-emerald-200'
                          : t.kind === 'error' ? 'text-red-300'
                          : t.kind === 'step'  ? 'text-amber-200/90'
                          : 'text-emerald-200/80',
                        )}>{t.text}</span>
                      </div>
                    ))}
                    {pollStatus === 'waiting' && (
                      <div className="text-emerald-500/70 mt-1">▍</div>
                    )}
                  </div>
                )}

                {/* Sub-agent activity (PM orchestration) */}
                {subRequests.length > 0 && (
                  <div className="rounded-lg border border-border bg-surface-2/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        Sub-agents hired ({subRequests.length})
                      </div>
                      <span className="text-[10px] text-muted-foreground">live</span>
                    </div>
                    {subRequests.map(sr => (
                      <details key={sr.id} className="rounded-md border border-border bg-surface p-3" open={sr.status !== 'completed'}>
                        <summary className="cursor-pointer flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono">
                            <span className="text-foreground/80">{sr.capability_tag}</span>
                            {sr.selected_seller && <span className="text-muted-foreground"> · {sr.selected_seller}</span>}
                          </span>
                          <span className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-medium',
                            sr.status === 'completed'   ? 'bg-success/15 text-success'
                            : sr.status === 'in_progress' ? 'bg-primary/15 text-primary'
                            : sr.status === 'failed' || sr.status === 'timeout' ? 'bg-destructive/15 text-destructive'
                            : 'bg-muted text-muted-foreground',
                          )}>
                            {sr.status}
                          </span>
                        </summary>
                        <div className="mt-3 grid gap-2 text-[11px] font-mono">
                          {sr.input_payload && (
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Input</div>
                              <pre className="whitespace-pre-wrap break-words bg-surface-2 rounded p-2 max-h-40 overflow-auto">
{JSON.stringify(sr.input_payload, null, 2)}
                              </pre>
                            </div>
                          )}
                          {sr.output_payload ? (
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Output</div>
                              <pre className="whitespace-pre-wrap break-words bg-surface-2 rounded p-2 max-h-60 overflow-auto">
{JSON.stringify(sr.output_payload, null, 2)}
                              </pre>
                            </div>
                          ) : (
                            <div className="text-muted-foreground italic">Waiting for agent output…</div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                )}

                {/* Progress log */}
                <div className="rounded-lg border border-border bg-surface-2 p-4 font-mono text-xs space-y-1.5 max-h-72 overflow-auto">
                  {pollLog.map((line, i) => (
                    <p key={i} className={cn(
                      line.startsWith('✅') ? 'text-success'
                      : line.startsWith('❌') ? 'text-destructive'
                      : line.startsWith('⚠') ? 'text-warning'
                      : 'text-muted-foreground',
                    )}>
                      {line}
                    </p>
                  ))}
                  {pollStatus === 'waiting' && (
                    <span className="inline-flex items-center gap-1.5 text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Polling for result…
                    </span>
                  )}
                </div>

                {/* Result */}
                {pollStatus === 'done' && pollResult && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-success/15 grid place-items-center shrink-0">
                        <Check className="h-3.5 w-3.5 text-success" />
                      </div>
                      <h3 className="font-semibold">Task complete</h3>
                    </div>
                    <ResultDisplay result={pollResult} />
                  </div>
                )}

                {pollStatus === 'failed' && (
                  <div className="text-center py-6 space-y-3">
                    <p className="text-sm text-muted-foreground">The task did not complete. Try again or check agent logs.</p>
                    <Button variant="outline" onClick={() => { setStep(1); setPollStatus('waiting'); setPollLog([]); }}>
                      Start over
                    </Button>
                  </div>
                )}

                {sessionId && (
                  <p className="text-[10px] font-mono text-muted-foreground text-center">
                    Session: {sessionId}{requestId && <> · Request: {requestId}</>}
                  </p>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </Layout>
  );
};

export default SessionNew;
