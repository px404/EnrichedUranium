import { useEffect, useState, useCallback } from 'react';
import { Activity, RefreshCw, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Sats } from '@/components/Sats';
import { cn } from '@/lib/utils';
import { useMode } from '@/lib/mode';
import { API_BASE } from '@/lib/api';

const API = API_BASE;

interface AgentStats {
  pubkey: string;
  display_name: string;
  wallet: string;
  port: number;
  role: string;
  as_buyer:  { completed: number; sats_spent: number };
  as_seller: { completed: number; sats_earned: number };
  in_flight: number;
  recent_tasks: RequestRow[];
}

interface RequestRow {
  id: string;
  capability_tag: string;
  status: string;
  budget_sats: number;
  buyer_pubkey: string;
  selected_seller: string | null;
  created_at: number;
  completed_at: number | null;
  chain_depth: number;
  input_payload:  Record<string, unknown> | null;
  output_payload: Record<string, unknown> | null;
  validation_status: string | null;
  validation_score:  number | null;
}

const STATUS_STYLE: Record<string, string> = {
  completed:       'bg-success/15 text-success border-success/30',
  in_progress:     'bg-primary/15 text-primary border-primary/30',
  failed:          'bg-destructive/15 text-destructive border-destructive/30',
  pending_payment: 'bg-muted text-muted-foreground border-border',
  funded:          'bg-warning/15 text-warning border-warning/30',
  matched:         'bg-warning/15 text-warning border-warning/30',
};

function fmtTime(ts?: number | null) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function shortId(id: string) { return id.slice(0, 8) + '…'; }

function PayloadCell({ data }: { data: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!data) return <span className="text-muted-foreground text-xs">—</span>;
  const preview = Object.keys(data).slice(0, 2).join(', ');
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
      >
        {preview}{open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <pre className="mt-1 text-[10px] bg-surface-2 rounded p-2 max-w-xs overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function Monitor() {
  const { isLive } = useMode();
  const [agents, setAgents]           = useState<AgentStats[]>([]);
  const [requests, setRequests]       = useState<RequestRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [capFilter, setCapFilter]     = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [agRes, reqRes] = await Promise.all([
        fetch(`${API}/monitor/agents`),
        fetch(`${API}/monitor/requests?limit=100`),
      ]);
      if (agRes.ok)  { const d = await agRes.json();  setAgents(d.agents ?? []); }
      if (reqRes.ok) { const d = await reqRes.json(); setRequests(d.requests ?? []); }
      setLastRefresh(new Date());
    } catch { /* backend offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  const filteredRequests = capFilter
    ? requests.filter(r => r.capability_tag === capFilter)
    : requests;

  const capabilities = [...new Set(requests.map(r => r.capability_tag))];

  if (!isLive) {
    return (
      <Layout>
        <div className="container py-20 text-center space-y-3">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-lg font-semibold">Agent Monitor requires Live mode</p>
          <p className="text-sm text-muted-foreground">Switch to Live in the navbar to see real agent activity.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Agent Monitor</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Delegation, inputs/outputs, spending — live view
              {lastRefresh && <span className="ml-2">· {lastRefresh.toLocaleTimeString()}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(a => !a)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-md border transition',
                autoRefresh
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              Auto {autoRefresh ? 'on' : 'off'}
            </button>
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Agent cards */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {agents.length === 0 && (
            <p className="col-span-4 text-center text-sm text-muted-foreground py-10">
              No agent data yet — start the stack and run a campaign.
            </p>
          )}
          {agents.map(agent => (
            <div key={agent.pubkey} className="panel p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AgentAvatar name={agent.display_name} size="sm" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{agent.display_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">:{agent.port}</div>
                </div>
                {agent.in_flight > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] bg-primary/15 text-primary rounded-full px-2 py-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    {agent.in_flight} active
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-px rounded-lg overflow-hidden bg-border text-center">
                <div className="bg-surface px-2 py-2">
                  <div className="text-[10px] text-muted-foreground">Tasks hired</div>
                  <div className="font-bold font-mono">{agent.as_buyer.completed}</div>
                  <Sats amount={agent.as_buyer.sats_spent} size="sm" />
                </div>
                <div className="bg-surface px-2 py-2">
                  <div className="text-[10px] text-muted-foreground">Tasks done</div>
                  <div className="font-bold font-mono">{agent.as_seller.completed}</div>
                  <Sats amount={agent.as_seller.sats_earned} size="sm" />
                </div>
              </div>

              {/* Recent mini-list */}
              {agent.recent_tasks.length > 0 && (
                <div className="space-y-1">
                  {agent.recent_tasks.slice(0, 4).map(t => (
                    <div key={t.id} className="flex items-center justify-between text-[11px] gap-2">
                      <span className="font-mono text-muted-foreground truncate">{shortId(t.id)}</span>
                      <span className="text-muted-foreground truncate">{t.capability_tag}</span>
                      <span className={cn(
                        'shrink-0 px-1.5 py-0.5 rounded text-[9px] uppercase font-medium border',
                        STATUS_STYLE[t.status] ?? 'bg-muted text-muted-foreground border-border',
                      )}>{t.status.replace('_', ' ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Full request log */}
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Request Log
            </h2>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-muted-foreground">{filteredRequests.length} requests</span>
              <select
                value={capFilter}
                onChange={e => setCapFilter(e.target.value)}
                className="text-xs bg-surface border border-border rounded px-2 py-1 text-foreground"
              >
                <option value="">All capabilities</option>
                {capabilities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {filteredRequests.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No requests yet. Run a campaign to see data here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {['ID', 'Capability', 'Status', 'Budget', 'Buyer', 'Seller', 'Depth', 'Input', 'Output', 'Score', 'Time'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRequests.map(r => (
                    <tr key={r.id} className="hover:bg-surface-2/50 transition">
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{shortId(r.id)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.capability_tag}</td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-[9px] uppercase font-medium border',
                          STATUS_STYLE[r.status] ?? 'bg-muted text-muted-foreground border-border',
                        )}>{r.status.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap"><Sats amount={r.budget_sats} size="sm" /></td>
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{r.buyer_pubkey.slice(0, 10)}…</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                        {r.selected_seller ? r.selected_seller.slice(0, 10) + '…' : <span className="opacity-40">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.chain_depth > 0
                          ? <span className="inline-flex items-center gap-0.5 text-muted-foreground"><ArrowRight className="h-2.5 w-2.5" />{r.chain_depth}</span>
                          : <span className="opacity-30">0</span>}
                      </td>
                      <td className="px-3 py-2"><PayloadCell data={r.input_payload} /></td>
                      <td className="px-3 py-2"><PayloadCell data={r.output_payload} /></td>
                      <td className="px-3 py-2 text-center text-muted-foreground">
                        {r.validation_score != null ? r.validation_score.toFixed(0) : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{fmtTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
