// Utility helpers for formatting AgentMesh data.

export function formatSats(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function truncateAddr(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

// Deterministic color from a string (for avatar gradients).
export function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h) % 360;
}

export function avatarGradient(name: string): string {
  const h1 = hashHue(name);
  const h2 = (h1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${h1} 70% 45%), hsl(${h2} 70% 35%))`;
}

export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ratingColor(r: number): string {
  if (r >= 4.5) return 'text-success';
  if (r >= 3.5) return 'text-warning';
  if (r >= 2.5) return 'text-orange-400';
  return 'text-destructive';
}

export function relativeDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}
