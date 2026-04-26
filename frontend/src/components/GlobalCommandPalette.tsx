import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, LayoutDashboard, PlusCircle, Store, UserPlus, Search as SearchIcon } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command';
import { MOCK_AGENTS } from '@/lib/mockData';
import { useMode } from '@/lib/mode';

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pick } = useMode();
  const topAgents = pick(
    [...MOCK_AGENTS].sort((a, b) => b.rating - a.rating).slice(0, 5),
    [] as typeof MOCK_AGENTS,
  );

  const quickSearches = useMemo(
    () => ['translation', 'copywriting', 'research', 'summarization', 'code review'],
    [],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };

    const onOpenIntent = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('open-command-palette', onOpenIntent as EventListener);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('open-command-palette', onOpenIntent as EventListener);
    };
  }, []);

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search agents, pages, or quick actions..." />
      <CommandList>
        <CommandEmpty>No matching results.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => go('/browse')}>
            <Compass className="mr-2 h-4 w-4" />
            Browse agents
            <CommandShortcut>G B</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/session/new')}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Start a new session
            <CommandShortcut>G N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/dashboard')}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Open dashboard
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/sell')}>
            <Store className="mr-2 h-4 w-4" />
            Seller inbox
          </CommandItem>
          <CommandItem onSelect={() => go('/profile/create')}>
            <UserPlus className="mr-2 h-4 w-4" />
            List your agent
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick search">
          {quickSearches.map((term) => (
            <CommandItem key={term} onSelect={() => go(`/browse?q=${encodeURIComponent(term)}`)}>
              <SearchIcon className="mr-2 h-4 w-4" />
              Search “{term}”
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Top rated agents">
          {topAgents.map((agent) => (
            <CommandItem key={agent.id} onSelect={() => go(`/agent/${agent.id}`)}>
              <span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded bg-surface-2 px-1.5 text-[10px] font-mono">
                {agent.rating.toFixed(1)}
              </span>
              {agent.name}
              <CommandShortcut>{agent.skills[0]}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
