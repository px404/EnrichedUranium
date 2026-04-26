/**
 * api.ts — typed HTTP client for the AgentMesh backend (http://localhost:3001).
 *
 * All backend types live here so every layer above can import from one place.
 * Lightning / MDK calls are intentionally omitted — those are stalled until
 * real sats infrastructure is ready.
 */

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

// ── Backend types ─────────────────────────────────────────────────────────────

export type ActorStatus = 'active' | 'paused' | 'suspended';
export type CertTierValue = 'Unverified' | 'Basic' | 'Verified' | 'Elite';

export interface Actor {
  pubkey: string;
  type: 'agent' | 'human';
  owner_pubkey: string | null;
  display_name: string;
  registered_at: number;
  capabilities: string[];
  price_per_call_sats: Record<string, number>;
  spend_cap_per_call: Record<string, number>;
  spend_cap_per_session: number;
  spend_cap_daily_sats: number;
  endpoint_url: string | null;
  status: ActorStatus;
  webhook_url: string | null;
  reliability_score: number;
  certification_tier: Record<string, CertTierValue>;
  cert_expiry: Record<string, unknown>;
  chain_depth_max: number;
  lightning_address: string | null;
}

export interface BackendSession {
  id: string;
  buyer_pubkey: string;
  seller_pubkey: string;
  capability_tag: string;
  price_per_call_sats: number;
  budget_sats: number;
  sats_used: number;
  remaining_budget: number;
  calls_made: number;
  session_token: string;
  parent_session_id: string | null;
  chain_depth: number;
  expires_unix: number;
  opened_at: number;
  closed_at: number | null;
  seller_payout_sats: number | null;
  buyer_refund_sats: number | null;
  platform_fee_sats: number | null;
  status: 'active' | 'exhausted' | 'closed' | 'expired';
}

export interface BackendRequest {
  id: string;
  buyer_pubkey: string;
  capability_tag: string;
  input_payload: Record<string, unknown>;
  budget_sats: number;
  status:
    | 'pending_payment'
    | 'funded'
    | 'matched'
    | 'in_progress'
    | 'completed'
    | 'timeout'
    | 'cancelled';
  shortlist: string[];
  selected_seller: string | null;
  deadline_unix: number;
  created_at: number;
  funded_at: number | null;
  matched_at: number | null;
  completed_at: number | null;
  retry_count: number;
  chain_parent_id: string | null;
  chain_depth: number;
  subtasks: unknown[] | null;
  subtasks_completed: number;
  payment_hash: string | null;
}

export interface BackendSchema {
  capability_tag: string;
  display_name: string;
  description: string;
  strength_score: number;
  is_platform_template: boolean | number;
  created_at: number;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

export interface TransactionEvent {
  log_id: number;
  event_type: string;
  timestamp: number;
  request_id: string | null;
  actor_pubkey: string | null;
  detail: Record<string, unknown> | null;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}

// ── API surface ───────────────────────────────────────────────────────────────

export const api = {
  // Health
  health: () => apiFetch<{ status: string; timestamp: number }>('/health'),

  // ── Actors ────────────────────────────────────────────────────────────────
  getActors: (
    params: Partial<{
      type: string;
      capability: string;
      status: string;
      owner_pubkey: string;
    }> = {},
  ) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return apiFetch<{ actors: Actor[]; count: number }>(`/actors?${qs}`);
  },

  getActor: (pubkey: string) => apiFetch<Actor>(`/actors/${pubkey}`),

  createActor: (body: {
    pubkey: string;
    type: 'agent' | 'human';
    display_name: string;
    owner_pubkey?: string;
    capabilities?: string[];
    price_per_call_sats?: Record<string, number>;
    spend_cap_per_session?: number;
    spend_cap_daily_sats?: number;
    endpoint_url?: string;
    webhook_url?: string;
    lightning_address?: string;
    chain_depth_max?: number;
  }) =>
    apiFetch<Actor>('/actors', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchActor: (pubkey: string, body: Record<string, unknown>) =>
    apiFetch<Actor>(`/actors/${pubkey}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  getActorHistory: (
    pubkey: string,
    params: Partial<{ limit: string; before: string; event_types: string }> = {},
  ) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return apiFetch<{ events: TransactionEvent[]; next_cursor: number | null }>(
      `/actors/${pubkey}/history?${qs}`,
    );
  },

  // ── Schemas ───────────────────────────────────────────────────────────────
  getSchemas: () =>
    apiFetch<{ schemas: BackendSchema[]; count: number }>('/schemas'),

  getSchema: (tag: string) => apiFetch<BackendSchema>(`/schemas/${tag}`),

  // ── Requests ──────────────────────────────────────────────────────────────
  getRequests: (
    params: Partial<{
      buyer_pubkey: string;
      seller_pubkey: string;
      status: string;
      chain_parent_id: string;
    }>,
  ) => {
    const qs = new URLSearchParams(
      params as Record<string, string>,
    ).toString();
    return apiFetch<{ requests: BackendRequest[]; count: number }>(
      `/requests?${qs}`,
    );
  },

  getRequest: (id: string) => apiFetch<BackendRequest>(`/requests/${id}`),

  createRequest: (body: {
    buyer_pubkey: string;
    capability_tag: string;
    input_payload: Record<string, unknown>;
    budget_sats: number;
    deadline_unix?: number;
  }) =>
    apiFetch<
      BackendRequest & {
        invoice?: string;
        payment_hash?: string;
        payment_instructions?: string;
      }
    >('/requests', { method: 'POST', body: JSON.stringify(body) }),

  // ── Results ───────────────────────────────────────────────────────────────
  submitResult: (
    request_id: string,
    body: {
      seller_pubkey: string;
      output_payload: Record<string, unknown>;
      subtasks_completed?: number;
    },
  ) =>
    apiFetch<unknown>(`/results/${request_id}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getResult: (request_id: string) =>
    apiFetch<unknown>(`/results/${request_id}`),

  // ── Sessions ──────────────────────────────────────────────────────────────
  // NOTE: Lightning / MDK payment stalled. The backend falls back to
  // mock-funding automatically when no Lightning node is available.
  createSession: (body: {
    buyer_pubkey: string;
    seller_pubkey: string;
    capability_tag: string;
    budget_sats: number;
    expires_unix?: number;
  }) =>
    apiFetch<BackendSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSession: (id: string) => apiFetch<BackendSession>(`/sessions/${id}`),

  callSession: (id: string) =>
    apiFetch<BackendSession>(`/sessions/${id}/call`, { method: 'POST' }),

  closeSession: (id: string) =>
    apiFetch<BackendSession & { settlement: unknown }>(
      `/sessions/${id}/close`,
      { method: 'POST' },
    ),

  topupSession: (id: string, amount_sats: number) =>
    apiFetch<BackendSession>(`/sessions/${id}/topup`, {
      method: 'POST',
      body: JSON.stringify({ amount_sats }),
    }),

  // ── Market intelligence ───────────────────────────────────────────────────
  getMarketPricing: (tag: string, window: '24h' | '7d' | '30d' = '7d') =>
    apiFetch<unknown>(`/market/pricing/${tag}?window=${window}`),

  getMarketQuality: (tag: string) =>
    apiFetch<unknown>(`/market/quality/${tag}`),

  getMarketCompare: (
    tag: string,
    params: Partial<{
      sort_by: string;
      limit: string;
      min_cert_tier: string;
    }> = {},
  ) => {
    const qs = new URLSearchParams(
      params as Record<string, string>,
    ).toString();
    return apiFetch<unknown>(`/market/compare/${tag}?${qs}`);
  },

  getMarketTrust: (tag: string) =>
    apiFetch<unknown>(`/market/trust/${tag}`),
};
