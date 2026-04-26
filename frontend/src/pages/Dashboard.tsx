import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Pause, Play, X, Star, Trash2, Settings as SettingsIcon, RefreshCw, KeyRound } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Sats } from '@/components/Sats';
import { AgentAvatar } from '@/components/AgentAvatar';
import { CertificationBadge } from '@/components/CertificationBadge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MOCK_USER, MOCK_SESSIONS, MOCK_TASKS, MOCK_AGENTS } from '@/lib/mockData';
import { truncateAddr } from '@/lib/format';
import { StatCounter } from '@/components/StatCounter';
import { toast } from '@/hooks/use-toast';
import { useMode } from '@/lib/mode';
import { cn } from '@/lib/utils';
import type { Session, Task } from '@/lib/types';
import { api } from '@/lib/api';
import { backendSessionToFrontend, backendRequestToTask } from '@/lib/adapters';
import {
  getIdentityPubkey,
  setIdentityPubkey,
  clearIdentityPubkey,
  getStoredSessionIds,
  removeStoredSessionId,
} from '@/lib/identity';

type View = 'overview' | 'sessions' | 'history' | 'favorites' | 'settings';
type SessionState = Session & { status: 'active' | 'paused' | 'expired' };

const VIEWS: { key: View; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sessions', label: 'Active Sessions' },
  { key: 'history', label: 'Task History' },
  { key: 'favorites', label: 'Favorite Agents' },
  { key: 'settings', label: 'Settings' },
];

const EMPTY_USER = {
  pubkey: '',
  walletBalance: 0,
  tasksThisMonth: 0,
  totalSpent: 0,
};

const Dashboard = () => {
  const { requireMock, isLive, pick } = useMode();
  const user = pick(MOCK_USER, EMPTY_USER);
  const [view, setView] = useState<View>('overview');
  const [balance, setBalance] = useState(user.walletBalance);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState(10000);
  const [sessions, setSessions] = useState<SessionState[]>(
    pick(MOCK_SESSIONS as SessionState[], [] as SessionState[]),
  );
  const [liveTasks, setLiveTasks] = useState<Task[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [favorites] = useState(() => pick(MOCK_AGENTS.slice(0, 4), [] as typeof MOCK_AGENTS));
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [autoTopup, setAutoTopup] = useState(false);
  const [displayName, setDisplayName] = useState(pick('Buyer One', ''));
  const [pubkeyInput, setPubkeyInput] = useState('');
  const [identityPubkey, setIdentityPubkeyState] = useState(getIdentityPubkey);

  const tasks = isLive ? liveTasks : MOCK_TASKS;

  // ── Live data fetch ─────────────────────────────────────────────────────────
  const fetchLiveData = useCallback(async (pk: string) => {
    if (!pk) return;
    setLiveLoading(true);
    try {
      // Reload sessions from stored IDs (no GET /sessions?buyer=... endpoint)
      const sessionIds = getStoredSessionIds();
      if (sessionIds.length > 0) {
        const results = await Promise.all(
          sessionIds.map(id => api.getSession(id).catch(() => null)),
        );
        const valid = results
          .filter(Boolean)
          .map(s => backendSessionToFrontend(s!) as SessionState);
        setSessions(valid);
        // Prune dead IDs
        results.forEach((s, i) => { if (!s) removeStoredSessionId(sessionIds[i]); });
      }

      // Fetch request history
      const { requests } = await api.getRequests({ buyer_pubkey: pk });
      setLiveTasks(requests.map(r => backendRequestToTask(r)));
      setDisplayName(truncateAddr(pk));
    } catch (e) {
      console.error('[dashboard] live fetch error:', e);
      toast({ title: 'Failed to load data', description: 'Check that the backend is running.', variant: 'destructive' });
    } finally {
      setLiveLoading(false);
    }
  }, []);

  // Reset / re-fetch when mode changes
  useEffect(() => {
    if (!isLive) {
      setBalance(user.walletBalance);
      setSessions(pick(MOCK_SESSIONS as SessionState[], [] as SessionState[]));
      setDisplayName(pick('Buyer One', ''));
      setLiveTasks([]);
      return;
    }
    const pk = getIdentityPubkey();
    setIdentityPubkeyState(pk);
    if (pk) fetchLiveData(pk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  const saveIdentity = () => {
    const pk = pubkeyInput.trim();
    if (!pk) { toast({ title: 'Enter a pubkey', variant: 'destructive' }); return; }
    setIdentityPubkey(pk);
    setIdentityPubkeyState(pk);
    setPubkeyInput('');
    toast({ title: 'Identity saved', description: truncateAddr(pk) });
    fetchLiveData(pk);
  };

  const signOut = () => {
    clearIdentityPubkey();
    setIdentityPubkeyState('');
    setSessions([]);
    setLiveTasks([]);
    setDisplayName('');
    toast({ title: 'Signed out' });
  };

  const statusStyle = {
    completed: 'bg-success/15 text-success border-success/30',
    processing: 'bg-primary/15 text-primary border-primary/30',
    failed: 'bg-destructive/15 text-destructive border-destructive/30',
    pending: 'bg-muted text-muted-foreground border-border',
  } as const;

  const togglePause = (id: string) => {
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, status: s.status === 'paused' ? 'active' : 'paused' } : s,
    ));
    const s = sessions.find(x => x.id === id);
    toast({ title: s?.status === 'paused' ? 'Session resumed' : 'Session paused', description: id });
  };

  const cancelSession = async (id: string) => {
    if (isLive) {
      try {
        await api.closeSession(id);
        removeStoredSessionId(id);
        setSessions(prev => prev.filter(s => s.id !== id));
        toast({ title: 'Session closed', description: id });
      } catch {
        toast({ title: 'Failed to close session', variant: 'destructive' });
      }
      return;
    }
    setSessions(prev => prev.filter(s => s.id !== id));
    toast({ title: 'Session cancelled', description: id });
  };

  const confirmTopup = () => {
    if (topupAmount <= 0) { toast({ title: 'Enter a positive amount', variant: 'destructive' }); return; }
    if (!requireMock('Wallet top-up')) return;
    setBalance(b => b + topupAmount);
    toast({ title: `⚡ ${topupAmount.toLocaleString()} sats added`, description: 'Wallet updated.' });
    setTopupOpen(false);
  };

  const activeCount = sessions.filter(s => s.status === 'active').length;
  const totalSpent = useMemo(() => {
    if (isLive) return liveTasks.reduce((acc, t) => acc + t.cost, 0) + sessions.reduce((acc, s) => acc + s.spendUsed, 0);
    return user.totalSpent + sessions.reduce((acc, s) => acc + s.spendUsed, 0);
  }, [sessions, user.totalSpent, isLive, liveTasks]);

  const currentPubkey = isLive ? identityPubkey : user.pubkey;
  const needsIdentity = isLive && !identityPubkey;

  return (
    <Layout>
      <div className="container py-8 grid lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="space-y-4 self-start lg:sticky lg:top-20">
          <div className="panel p-4">
            <div className="flex items-center gap-3">
              <AgentAvatar name={displayName || 'anon'} size="md" />
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">
                  {displayName || (isLive ? 'Not signed in' : 'Buyer One')}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground truncate">
                  {currentPubkey ? truncateAddr(currentPubkey) : '—'}
                </div>
              </div>
            </div>
            <div className="mt-5 p-4 rounded-xl border border-border bg-gradient-to-b from-surface to-surface/70 text-center">
              <div className="inline-flex items-center justify-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success pulse-dot text-success" />
                {isLive ? 'Protocol balance' : 'Lightning balance'}
              </div>
              <div className="mt-1"><Sats amount={balance} size="xl" /></div>
              {isLive ? (
                <p className="mt-3 text-xs text-muted-foreground">Lightning top-up — coming soon</p>
              ) : (
                <Button variant="outline" size="sm" className="mt-3 w-full motion-lift" onClick={() => setTopupOpen(true)}>
                  Top Up
                </Button>
              )}
            </div>
          </div>
          <nav className="panel p-2 text-sm">
            {VIEWS.map(v => (
              <button key={v.key} onClick={() => setView(v.key)}
                className={cn('w-full text-left px-3 py-2 rounded-md transition motion-lift',
                  view === v.key ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-surface-2/60')}>
                {v.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="space-y-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold capitalize">
              {view === 'overview' ? 'Overview'
                : view === 'sessions' ? 'Active Sessions'
                : view === 'history' ? 'Task History'
                : view === 'favorites' ? 'Favorite Agents'
                : 'Settings'}
            </h1>
            {isLive && identityPubkey && view !== 'settings' && (
              <Button size="sm" variant="ghost" onClick={() => fetchLiveData(identityPubkey)} disabled={liveLoading}>
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', liveLoading && 'animate-spin')} /> Refresh
              </Button>
            )}
          </div>

          {/* Prompt to set identity before showing live data */}
          {needsIdentity && view !== 'settings' && (
            <div className="p-8 rounded-xl border border-dashed border-border text-center space-y-3">
              <KeyRound className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm font-semibold">No identity set</p>
              <p className="text-xs text-muted-foreground">
                Enter your pubkey in{' '}
                <button onClick={() => setView('settings')} className="text-primary hover:underline">
                  Settings
                </button>{' '}
                to see your live sessions and tasks.
              </p>
            </div>
          )}

          {/* OVERVIEW */}
          {view === 'overview' && !needsIdentity && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden bg-border">
                {([
                  ['Active Sessions', activeCount, ''],
                  ['Tasks This Month', isLive ? liveTasks.length : user.tasksThisMonth, ''],
                  ['Total Spent', totalSpent, ' sats'],
                  ['Avg / Task', isLive
                    ? (liveTasks.length > 0 ? Math.floor(totalSpent / liveTasks.length) : 0)
                    : pick(108, 0), ' sats'],
                ] as [string, number, string][]).map(([l, v, sfx], i) => (
                  <div key={l} className={cn('bg-surface px-3 py-3 motion-fade-up', `motion-delay-${i + 1}`)}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
                    <div className="text-lg font-bold font-mono tabular-nums mt-1">
                      <StatCounter value={v} suffix={sfx} />
                    </div>
                  </div>
                ))}
              </div>
              <SessionsList sessions={sessions} onTogglePause={togglePause} onCancel={cancelSession} />
              <RecentTasks tasks={tasks} statusStyle={statusStyle} isLive={isLive} />
              <div className="panel p-4">
                <h2 className="font-semibold mb-4">Spend (last 7 days)</h2>
                {isLive ? (
                  <div className="h-32 grid place-items-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                    Spend chart coming soon
                  </div>
                ) : (
                  <div className="flex items-end gap-3 h-32">
                    {[120, 280, 90, 410, 180, 340, 220].map((v, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                        <div className="w-full rounded-t bg-primary" style={{ height: `${(v / 410) * 100}%` }} />
                        <span className="text-[10px] font-mono text-muted-foreground">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'sessions' && !needsIdentity && (
            <SessionsList sessions={sessions} onTogglePause={togglePause} onCancel={cancelSession} fullWidth />
          )}

          {view === 'history' && !needsIdentity && (
            <RecentTasks tasks={tasks} statusStyle={statusStyle} expanded isLive={isLive} />
          )}

          {view === 'favorites' && (
            favorites.length === 0 ? (
              <div className="p-10 rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">
                {isLive ? 'Favourites not stored on-chain yet.' : 'No favorites yet. '}
                {!isLive && <Link to="/browse" className="text-primary hover:underline">Browse agents →</Link>}
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {favorites.map(a => (
                  <div key={a.id} className="p-4 rounded-xl bg-surface border border-border flex items-center gap-3 motion-lift">
                    <AgentAvatar name={a.name} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link to={`/agent/${a.id}`} className="font-semibold text-sm hover:text-primary truncate">{a.name}</Link>
                        <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{a.tagline}</p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/session/new?agent=${a.id}`}>Hire</Link>
                    </Button>
                  </div>
                ))}
              </div>
            )
          )}

          {view === 'settings' && (
            <div className="space-y-4 max-w-xl">
              {/* Live-mode identity */}
              {isLive && (
                <div className="panel p-4 space-y-4">
                  <h3 className="font-semibold inline-flex items-center gap-2">
                    <KeyRound className="h-4 w-4" />Identity
                  </h3>
                  {identityPubkey ? (
                    <>
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Current pubkey</Label>
                        <Input value={identityPubkey} readOnly className="mt-2 font-mono text-xs" />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => fetchLiveData(identityPubkey)} disabled={liveLoading}>
                          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', liveLoading && 'animate-spin')} />
                          Refresh data
                        </Button>
                        <Button size="sm" variant="destructive" onClick={signOut}>Sign out</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Enter your actor pubkey to load your sessions and task history from the backend.
                      </p>
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Your pubkey</Label>
                        <div className="flex gap-2 mt-2">
                          <Input
                            value={pubkeyInput}
                            onChange={e => setPubkeyInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveIdentity(); }}
                            placeholder="e.g. hex pubkey used when registering"
                            className="font-mono text-xs"
                          />
                          <Button onClick={saveIdentity}>Connect</Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="panel p-4 space-y-4">
                <h3 className="font-semibold inline-flex items-center gap-2">
                  <SettingsIcon className="h-4 w-4" />Profile
                </h3>
                {!isLive && (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Display name</Label>
                    <Input value={displayName} onChange={e => setDisplayName(e.target.value)} className="mt-2" />
                  </div>
                )}
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Public key</Label>
                  <Input value={currentPubkey || '—'} readOnly className="mt-2 font-mono text-xs" />
                </div>
              </div>

              <div className="panel p-4 space-y-3">
                <h3 className="font-semibold">Preferences</h3>
                <label className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-border">
                  <div>
                    <div className="text-sm font-medium">Email notifications</div>
                    <div className="text-xs text-muted-foreground">Get notified when sessions hit their cap</div>
                  </div>
                  <Switch checked={emailNotifs} onCheckedChange={setEmailNotifs} />
                </label>
                <label className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-border">
                  <div>
                    <div className="text-sm font-medium">Auto top-up wallet</div>
                    <div className="text-xs text-muted-foreground">Refill 10k sats when balance drops below 1k</div>
                  </div>
                  <Switch checked={autoTopup} onCheckedChange={setAutoTopup} />
                </label>
              </div>

              <div className="rounded-xl bg-destructive/5 border border-destructive/30 p-4 space-y-3">
                <h3 className="font-semibold text-destructive inline-flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />Danger zone
                </h3>
                <p className="text-xs text-muted-foreground">Delete your account and all associated sessions.</p>
                <Button variant="destructive" size="sm"
                  onClick={() => toast({ title: 'Account deletion requested', description: 'Confirmation email sent (mock).' })}>
                  Delete account
                </Button>
              </div>

              {!isLive && (
                <div className="flex justify-end">
                  <Button onClick={() => toast({ title: 'Settings saved' })} className="bg-primary hover:bg-primary/90">
                    Save changes
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Top Up dialog — mock mode only */}
      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent className="bg-surface border-border rounded-xl">
          <DialogHeader>
            <DialogTitle>Top Up Wallet</DialogTitle>
            <DialogDescription>Add sats to your Lightning balance. Mock — no real invoice generated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Amount (sats)</Label>
            <Input type="number" value={topupAmount} onChange={e => setTopupAmount(+e.target.value)} className="font-mono" />
            <div className="flex gap-2">
              {[5000, 10000, 50000, 100000].map(v => (
                <button key={v} onClick={() => setTopupAmount(v)}
                  className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-surface-2 hover:border-primary/40 hover:text-primary transition tabular-nums motion-lift">
                  {v.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopupOpen(false)}>Cancel</Button>
            <Button onClick={confirmTopup} className="bg-primary hover:bg-primary/90">Confirm top-up</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SessionsList({ sessions, onTogglePause, onCancel, fullWidth }: {
  sessions: SessionState[];
  onTogglePause: (id: string) => void;
  onCancel: (id: string) => void;
  fullWidth?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold inline-flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />Active Sessions
        </h2>
        <Button asChild size="sm" variant="outline"><Link to="/browse">+ New session</Link></Button>
      </div>
      {sessions.length === 0 ? (
        <div className="p-10 rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">
          No active sessions. <Link to="/browse" className="text-primary hover:underline">Find an agent →</Link>
        </div>
      ) : (
        <div className={cn('space-y-3', fullWidth && 'max-w-none')}>
          {sessions.map(s => (
            <div key={s.id} className="p-4 rounded-xl bg-surface border border-border motion-lift">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <AgentAvatar name={s.agentName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/agent/${s.agentId}`} className="font-semibold text-sm hover:text-primary">{s.agentName}</Link>
                    <CertificationBadge tier={s.certTier} size="sm" />
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground">{s.id}</div>
                </div>
                <span className={cn('inline-flex items-center gap-1.5 text-xs',
                  s.status === 'active' ? 'text-success' : 'text-warning')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full pulse-dot',
                    s.status === 'active' ? 'bg-success text-success' : 'bg-warning text-warning')} />
                  {s.status === 'active' ? 'Active' : 'Paused'}
                </span>
                <Button size="sm" variant="ghost" onClick={() => onTogglePause(s.id)}>
                  {s.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onCancel(s.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Calls</span>
                    <span className="font-mono">{s.callsUsed}/{s.callLimit || '∞'}</span>
                  </div>
                  <Progress value={s.callLimit ? (s.callsUsed / s.callLimit) * 100 : 0} className="h-1.5" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Spend</span>
                    <Sats amount={s.spendUsed} suffix={`/${s.spendCap}`} size="sm" />
                  </div>
                  <Progress value={(s.spendUsed / s.spendCap) * 100} className="h-1.5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentTasks({ tasks, statusStyle, expanded, isLive }: {
  tasks: Task[];
  statusStyle: Record<string, string>;
  expanded?: boolean;
  isLive?: boolean;
}) {
  return (
    <div>
      <h2 className="font-semibold mb-3">{expanded ? 'All Tasks' : 'Recent Tasks'}</h2>
      {tasks.length === 0 ? (
        <div className="p-10 rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground bg-surface/40">
          {isLive ? 'No task history found for this pubkey.' : 'No tasks yet.'}
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className={cn('bg-surface-2 text-[10px] uppercase tracking-wider text-muted-foreground',
              expanded && 'sticky top-0 z-10')}>
              <tr>
                {['Task ID', 'Agent', 'Type', 'Status', 'Cost', 'Time'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tasks.map(t => (
                <tr key={t.id} className="hover:bg-surface-2/50 transition">
                  <td className="px-4 py-3 font-mono text-xs max-w-[140px] truncate">{t.id}</td>
                  <td className="px-4 py-3">
                    {t.agentId
                      ? <Link to={`/agent/${t.agentId}`} className="hover:text-primary">{t.agentName}</Link>
                      : <span className="text-muted-foreground">{t.agentName}</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.taskType}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide border', statusStyle[t.status])}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3"><Sats amount={t.cost} size="sm" /></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{t.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
