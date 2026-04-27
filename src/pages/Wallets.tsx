import { useEffect, useState, useCallback } from 'react';
import { Zap, RefreshCw, Wifi, WifiOff, ArrowDownLeft, ArrowUpRight, Clock } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Sats } from '@/components/Sats';
import { cn } from '@/lib/utils';
import { useMode } from '@/lib/mode';
import { API_BASE } from '@/lib/api';

const API = API_BASE;

interface WalletStatus {
  name: string;
  port: number;
  role: string;
  online: boolean;
  balance_sats: number | null;
}

interface Payment {
  payment_id?: string;
  id?: string;
  wallet: string;
  status: 'completed' | 'failed' | 'pending';
  amount_sats?: number;
  amount?: number;
  direction?: 'inbound' | 'outbound';
  description?: string;
  created_at?: number;
  timestamp?: number;
}

const WALLET_META: Record<string, { label: string; agent: string; color: string }> = {
  platform:   { label: 'Platform',         agent: 'Escrow wallet',               color: 'text-primary' },
  pm:         { label: 'Project Manager',  agent: 'agent-pm-001',                color: 'text-purple-400' },
  researcher: { label: 'Market Researcher',agent: 'agent-researcher-001',        color: 'text-green-400' },
  copywriter: { label: 'Copywriter',       agent: 'agent-copywriter-001',        color: 'text-yellow-400' },
  strategist: { label: 'Social Strategist',agent: 'agent-strategist-001',        color: 'text-pink-400' },
};

function fmtTime(ts?: number) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Wallets() {
  const { isLive } = useMode();
  const [wallets, setWallets]         = useState<WalletStatus[]>([]);
  const [payments, setPayments]       = useState<Payment[]>([]);
  const [loading, setLoading]         = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selected, setSelected]       = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/wallets/status`);
      if (r.ok) {
        const d = await r.json();
        setWallets(d.wallets ?? []);
      }
    } catch { /* backend offline */ }
  }, []);

  const fetchPayments = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/wallets/${name}/payments`);
      if (r.ok) {
        const d = await r.json();
        setPayments(d.payments ?? []);
      }
    } catch { setPayments([]); }
    finally { setLoading(false); }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchStatus();
    if (selected) await fetchPayments(selected);
    setLastRefresh(new Date());
    setLoading(false);
  }, [fetchStatus, fetchPayments, selected]);

  // Initial load + auto-refresh every 5 s
  useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      // Don't burn through battery while the tab isn't visible.
      if (!document.hidden) refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  useEffect(() => {
    if (selected) fetchPayments(selected);
  }, [selected, fetchPayments]);

  // The /wallets/:name/payments endpoint already returns wallet-scoped data,
  // so the table iterates `payments` directly. No client-side filter needed.

  const totalOnline  = wallets.filter(w => w.online).length;
  const totalBalance = wallets.reduce((s, w) => s + (w.balance_sats ?? 0), 0);

  if (!isLive) {
    return (
      <Layout>
        <div className="container py-20 text-center space-y-3">
          <Zap className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-lg font-semibold">Wallet Dashboard requires Live mode</p>
          <p className="text-sm text-muted-foreground">Switch to Live in the navbar to see real wallet data.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Wallet Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalOnline}/5 daemons online
              {lastRefresh && <span className="ml-2">· refreshed {lastRefresh.toLocaleTimeString()}</span>}
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
              Auto-refresh {autoRefresh ? 'on' : 'off'}
            </button>
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden bg-border">
          {[
            ['Total balance', <Sats key="s" amount={totalBalance} size="lg" />],
            ['Daemons online', `${totalOnline} / 5`],
            ['Buyer wallets', wallets.filter(w => w.role === 'buyer').length],
            ['Seller wallets', wallets.filter(w => w.role === 'seller').length],
          ].map(([label, value], i) => (
            <div key={i} className="bg-surface px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className="mt-1 text-lg font-bold font-mono">{value}</div>
            </div>
          ))}
        </div>

        {/* Wallet cards */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {wallets.map(w => {
            const meta = WALLET_META[w.name] ?? { label: w.name, agent: '', color: 'text-foreground' };
            const isSelected = selected === w.name;
            return (
              <button
                key={w.name}
                onClick={() => setSelected(isSelected ? null : w.name)}
                className={cn(
                  'panel p-4 text-left transition motion-lift',
                  isSelected && 'ring-2 ring-primary/60',
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-semibold', meta.color)}>{meta.label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">:{w.port}</span>
                  </div>
                  {w.online
                    ? <Wifi className="h-3.5 w-3.5 text-success" />
                    : <WifiOff className="h-3.5 w-3.5 text-destructive" />}
                </div>
                <div className="text-[10px] text-muted-foreground mb-1">{meta.agent}</div>
                {w.online
                  ? <Sats amount={w.balance_sats ?? 0} size="xl" />
                  : <span className="text-sm text-muted-foreground">offline</span>}
                <div className={cn(
                  'mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5',
                  w.role === 'buyer'
                    ? 'bg-primary/10 text-primary'
                    : w.role === 'escrow'
                    ? 'bg-warning/10 text-warning'
                    : 'bg-success/10 text-success',
                )}>
                  {w.role}
                </div>
              </button>
            );
          })}
        </div>

        {/* Payment history */}
        {selected && (
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-sm">
                {WALLET_META[selected]?.label ?? selected} — Payment History
              </h2>
              <span className="text-xs text-muted-foreground">{payments.length} records</span>
            </div>
            {payments.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {loading ? 'Loading...' : 'No payments yet.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      {['Direction', 'Amount', 'Status', 'Description', 'Time'].map(h => (
                        <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {payments.map((p, i) => {
                      const inbound  = p.direction === 'inbound';
                      const amount   = p.amount_sats ?? p.amount ?? 0;
                      const ts       = p.created_at ?? p.timestamp;
                      return (
                        <tr key={p.payment_id ?? p.id ?? i} className="hover:bg-surface-2/50">
                          <td className="px-4 py-2.5">
                            {inbound
                              ? <span className="inline-flex items-center gap-1 text-success text-xs"><ArrowDownLeft className="h-3 w-3" />In</span>
                              : <span className="inline-flex items-center gap-1 text-primary text-xs"><ArrowUpRight className="h-3 w-3" />Out</span>}
                          </td>
                          <td className="px-4 py-2.5"><Sats amount={amount} size="sm" /></td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              'text-[10px] uppercase font-medium px-2 py-0.5 rounded-full border',
                              p.status === 'completed' ? 'bg-success/10 text-success border-success/30'
                              : p.status === 'failed'  ? 'bg-destructive/10 text-destructive border-destructive/30'
                              : 'bg-muted text-muted-foreground border-border',
                            )}>{p.status}</span>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground max-w-[220px] truncate">
                            {p.description ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />{fmtTime(ts)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!selected && wallets.some(w => w.online) && (
          <p className="text-center text-xs text-muted-foreground">
            Click a wallet card to view its payment history.
          </p>
        )}
      </div>
    </Layout>
  );
}
