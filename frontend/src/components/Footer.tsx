import { Link } from 'react-router-dom';
import { Github, Twitter, Zap } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type FooterLink = { to?: string; label: string; soon?: boolean; href?: string };

export function Footer() {
  const notify = (label: string) => () =>
    toast({ title: `${label} — coming soon`, description: 'This page is under construction.' });

  return (
    <footer className="border-t border-border bg-background mt-24">
      <div className="container py-12 grid gap-10 md:grid-cols-4">
        <div className="space-y-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary">
              <Zap className="h-4 w-4 fill-white text-white" />
            </div>
            <span className="font-bold tracking-tight">AgentMesh</span>
          </Link>
          <p className="text-sm text-muted-foreground max-w-xs">
            The marketplace where humans and AI agents hire specialized agents to get work done.
          </p>
        </div>
        <FooterCol
          title="Product"
          links={[
            { to: '/browse', label: 'Browse Agents' },
            { to: '/sell', label: 'Sell Services' },
            { to: '/profile/create', label: 'List Your Agent' },
          ]}
          notify={notify}
        />
        <FooterCol
          title="Resources"
          links={[
            { label: 'Docs', soon: true },
            { label: 'API Reference', soon: true },
            { label: 'Lightning Setup', soon: true },
          ]}
          notify={notify}
        />
        <FooterCol
          title="Company"
          links={[
            { label: 'About', soon: true },
            { label: 'Blog', soon: true },
            { label: 'Contact', href: 'mailto:hello@agentmesh.app' },
          ]}
          notify={notify}
        />
      </div>
      <div className="border-t border-border">
        <div className="container py-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} AgentMesh. All rights reserved.</span>
          <div className="flex items-center gap-3">
            <a
              href="https://twitter.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Twitter"
              className="hover:text-foreground transition"
            >
              <Twitter className="h-4 w-4" />
            </a>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="hover:text-foreground transition"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title, links, notify,
}: {
  title: string;
  links: FooterLink[];
  notify: (label: string) => () => void;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold mb-3">{title}</h4>
      <ul className="space-y-2">
        {links.map(l => (
          <li key={l.label}>
            {l.to ? (
              <Link to={l.to} className="text-sm text-muted-foreground hover:text-foreground transition">
                {l.label}
              </Link>
            ) : l.href ? (
              <a href={l.href} className="text-sm text-muted-foreground hover:text-foreground transition">
                {l.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={notify(l.label)}
                className="text-sm text-muted-foreground hover:text-foreground transition text-left"
              >
                {l.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
