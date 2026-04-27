/**
 * adapters.ts — converts backend API shapes into the frontend Agent/Session/Task types.
 *
 * Backend fields that have no equivalent (reviews, tagline, methods, specializations)
 * are derived where possible or left as sensible empty defaults.
 */

import type { Actor, BackendSession, BackendRequest, CertTierValue } from './api';
import type { Agent, CertTier, Session, Task } from './types';

// ── Actor → Agent ────────────────────────────────────────────────────────────

const TIER_ORDER: CertTierValue[] = ['Unverified', 'Basic', 'Verified', 'Elite'];

/** Pick the highest certification tier across all capabilities. */
function highestTier(
  certTiers: Record<string, CertTierValue>,
  caps: string[],
): CertTier {
  const indices = caps
    .map(c => TIER_ORDER.indexOf(certTiers[c] ?? 'Unverified'))
    .filter(i => i >= 0);
  const best = indices.length > 0 ? Math.max(...indices) : 0;
  return TIER_ORDER[best] as CertTier;
}

/**
 * Map reliability_score (0–100) to a 0–5 star rating.
 * New actors start at 50 → 2.5 stars.
 * 100 → 5 stars.
 */
function reliabilityToRating(score: number): number {
  return Math.round((score / 20) * 10) / 10; // one decimal place
}

export function actorToAgent(actor: Actor): Agent {
  const caps = actor.capabilities;
  const prices = actor.price_per_call_sats;

  const primaryCertTier = highestTier(actor.certification_tier, caps);

  const priceValues = Object.values(prices).filter(
    v => typeof v === 'number',
  ) as number[];
  const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : 0;

  const pricing =
    caps.length > 0
      ? caps.map(cap => ({
          tier: cap,
          description: `Single call — ${cap}`,
          sats: prices[cap] ?? 0,
        }))
      : [{ tier: 'Single Call', description: 'Pay per task', sats: minPrice }];

  return {
    id: actor.pubkey,
    name: actor.display_name,
    tagline:
      caps.length > 0
        ? `Capabilities: ${caps.join(', ')}`
        : 'No capabilities listed',
    description:
      `${actor.display_name} is an agent registered on AgentMesh.\n\n` +
      (caps.length > 0 ? `Capabilities: ${caps.join(', ')}.\n` : '') +
      `Reliability score: ${actor.reliability_score.toFixed(1)} / 100.` +
      (actor.lightning_address ? `\nLightning: ${actor.lightning_address}` : ''),
    certTier: primaryCertTier,
    // Rating derived from reliability score (no review system in backend yet)
    rating: reliabilityToRating(actor.reliability_score),
    reviewCount: 0,
    tasksCompleted: 0,
    avgResponseTime: 'N/A',
    successRate: actor.reliability_score,
    reliabilityScore: actor.reliability_score,
    pricePerTask: minPrice,
    skills: caps,
    serves: ['humans', 'agents'],
    isOnline: actor.status === 'active',
    taskModes: ['single'],
    methods: [],
    specializations: caps.map(c => ({
      tag: c,
      description: `Capability tag: ${c}`,
    })),
    guarantees: [],
    limitations:
      actor.status !== 'active'
        ? `This agent is currently ${actor.status}.`
        : '',
    pricing,
    inputSchema: {},
    outputSchema: {},
    category: caps[0] ?? 'general',
  };
}

// ── BackendSession → Session ─────────────────────────────────────────────────

/**
 * Convert a backend session row into the frontend `Session` shape.
 *
 * Optional context (seller name, cert tier) can be passed in by callers that
 * have already resolved the seller actor — that's how we avoid an N+1 lookup
 * and stop hard-coding `certTier='Unverified'` for live sessions.
 */
export function backendSessionToFrontend(
  s: BackendSession,
  ctx?: { sellerName?: string; certTier?: CertTier },
): Session {
  const maxCalls =
    s.price_per_call_sats > 0
      ? Math.floor(s.budget_sats / s.price_per_call_sats)
      : 0;

  const status: Session['status'] =
    s.status === 'active' || s.status === 'exhausted'
      ? 'active'
      : 'expired';

  return {
    id: s.id,
    agentId: s.seller_pubkey,
    agentName: ctx?.sellerName ?? s.seller_pubkey,
    certTier: ctx?.certTier ?? 'Unverified',
    type: 'verified',
    callsUsed: s.calls_made,
    callLimit: maxCalls,
    spendUsed: s.sats_used,
    spendCap: s.budget_sats,
    expiresAt: new Date(s.expires_unix * 1000).toISOString(),
    status,
  };
}

// ── BackendRequest → Task ─────────────────────────────────────────────────────

export function relativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function backendRequestToTask(
  r: BackendRequest,
  agentName?: string,
): Task {
  const taskStatus: Task['status'] =
    r.status === 'completed'
      ? 'completed'
      : r.status === 'in_progress'
      ? 'processing'
      : r.status === 'timeout' || r.status === 'cancelled'
      ? 'failed'
      : 'pending';

  return {
    id: r.id,
    agentId: r.selected_seller ?? '',
    agentName: agentName ?? (r.selected_seller ?? 'Unassigned'),
    taskType: r.capability_tag,
    status: taskStatus,
    cost: r.budget_sats,
    time: relativeTime(r.created_at),
    input: r.input_payload,
  };
}
