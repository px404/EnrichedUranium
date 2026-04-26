import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Search, Menu, Zap, Command, Plus } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Sats } from '@/components/Sats';
import { AgentAvatar } from '@/components/AgentAvatar';
import { MOCK_USER } from '@/lib/mockData';
import { truncateAddr } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ModeToggle } from '@/components/ModeToggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMode } from '@/lib/mode';
import { getIdentityPubkey, clearIdentityPubkey } from '@/lib/identity';

const navLinks = [
  { to: '/browse',   label: 'Browse Agents' },
  { to: '/session/new', label: 'New Session' },
  { to: '/sell',     label: 'Sell Services' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/monitor',  label: 'Monitor' },
  { to: '/wallets',  label: 'Wallets' },
];

export function Navbar() {
  const navigate = useNavigate();
  const { isLive } = useMode();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [identityPubkey, setIdentityPubkeyState] = useState(getIdentityPubkey);

  useEffect(() => {
    const onStorage = () => setIdentityPubkeyState(getIdentityPubkey());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Re-read identity whenever mode changes to live
  useEffect(() => {
    if (isLive) setIdentityPubkeyState(getIdentityPubkey());
  }, [isLive]);

  const displayName = isLive
    ? (identityPubkey ? truncateAddr(identityPubkey) : 'Not signed in')
    : 'Buyer One';
  const walletBalance = isLive ? null : MOCK_USER.walletBalance;
  const pubkeyDisplay = isLive ? identityPubkey : MOCK_USER.pubkey;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/browse?q=${encodeURIComponent(q)}`);
  };

  const handleSignOut = () => {
    if (isLive) {
      clearIdentityPubkey();
      setIdentityPubkeyState('');
      toast({ title: 'Signed out' });
    } else {
      toast({ title: 'Signed out', description: 'You have been signed out.' });
    }
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center gap-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary">
            <Zap className="h-4 w-4 fill-white text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">AgentMesh</span>
        </Link>

        {/* Compact search (desktop) */}
        <form onSubmit={submit} className="hidden md:flex relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search agents, tasks, skills..."
            className="w-full h-9 pl-9 pr-20 text-sm bg-surface border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring/40 transition"
          />
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition"
            aria-label="Open command palette"
          >
            <Command className="h-2.5 w-2.5" />K
          </button>
        </form>

        <nav className="ml-auto hidden lg:flex items-center gap-1">
          {navLinks.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                cn(
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  isActive ? 'text-foreground bg-surface-2' : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/70',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <Button
          asChild
          size="sm"
          className="hidden lg:inline-flex h-9 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link to="/browse">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Start
          </Link>
        </Button>

        {/* Mode toggle */}
        <ModeToggle className="hidden md:inline-flex" />

        {/* Wallet pill — hidden in live mode (no balance endpoint yet) */}
        {walletBalance !== null && (
          <Link
            to="/dashboard"
            className="hidden sm:inline-flex items-center gap-2 px-3 h-9 rounded-md border border-border bg-surface hover:bg-surface-2 transition"
            aria-label="Wallet balance"
          >
            <Sats amount={walletBalance} size="md" />
          </Link>
        )}

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="hidden sm:block focus:outline-none focus:ring-2 focus:ring-ring rounded-lg">
            <AgentAvatar name={displayName} size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{displayName}</span>
                {pubkeyDisplay
                  ? <span className="text-xs font-mono text-muted-foreground">{truncateAddr(pubkeyDisplay)}</span>
                  : <span className="text-xs text-muted-foreground">Set pubkey in Dashboard → Settings</span>
                }
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link to="/dashboard">Dashboard</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/profile/create">My Agent Profile</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/sell">Seller Inbox</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-muted-foreground cursor-pointer"
              onClick={handleSignOut}
            >
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Mobile */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-surface hover:bg-surface-2" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 bg-surface border-border">
            <div className="mt-6 space-y-1">
              <form onSubmit={(e) => { submit(e); setOpen(false); }} className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Search agents…"
                  className="w-full h-10 pl-9 pr-3 text-sm bg-surface-2 border border-border rounded-md"
                />
              </form>
              {navLinks.map(l => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => cn(
                    'block px-3 py-2 text-sm font-medium rounded-md',
                    isActive ? 'bg-surface-2 text-foreground' : 'text-muted-foreground hover:bg-surface-2',
                  )}
                >
                  {l.label}
                </NavLink>
              ))}
              <div className="pt-4 mt-4 border-t border-border space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Mode</span>
                  <ModeToggle />
                </div>
                {walletBalance !== null && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-md bg-warning/10 border border-warning/30">
                    <span className="text-xs text-muted-foreground">Wallet</span>
                    <Sats amount={walletBalance} />
                  </div>
                )}
                <div className="flex items-center gap-2 px-3 py-2">
                  <AgentAvatar name={displayName} size="sm" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold">{displayName}</span>
                    {pubkeyDisplay
                      ? <span className="text-[11px] font-mono text-muted-foreground truncate">{truncateAddr(pubkeyDisplay)}</span>
                      : <span className="text-[11px] text-muted-foreground">Set pubkey in Dashboard</span>
                    }
                  </div>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
