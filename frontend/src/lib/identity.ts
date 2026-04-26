/**
 * identity.ts — lightweight pubkey identity store backed by localStorage.
 *
 * The backend is pubkey-based (no auth, no login). This module lets the
 * frontend "be" a pubkey. Users enter their pubkey in Dashboard → Settings.
 *
 * Session IDs created in live mode are also stored here so the dashboard
 * can reload them across page visits (the backend has no GET /sessions?buyer=...).
 */

const PUBKEY_KEY = 'agentmesh:pubkey';
const SESSION_IDS_KEY = 'agentmesh:session_ids';
const MAX_STORED_SESSIONS = 50;

// ── Pubkey ────────────────────────────────────────────────────────────────────

export function getIdentityPubkey(): string {
  try {
    return localStorage.getItem(PUBKEY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setIdentityPubkey(pk: string): void {
  try {
    localStorage.setItem(PUBKEY_KEY, pk.trim());
    window.dispatchEvent(new Event('storage'));
  } catch {
    // ignore — storage may be unavailable
  }
}

export function clearIdentityPubkey(): void {
  try {
    localStorage.removeItem(PUBKEY_KEY);
    localStorage.removeItem(SESSION_IDS_KEY);
    window.dispatchEvent(new Event('storage'));
  } catch {
    // ignore
  }
}

export function hasIdentity(): boolean {
  return getIdentityPubkey().length > 0;
}

// ── Stored session IDs ────────────────────────────────────────────────────────
// The backend has no "list sessions by buyer" endpoint, so we keep a local
// registry of session IDs we created during this browser session.

export function getStoredSessionIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SESSION_IDS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function addStoredSessionId(id: string): void {
  const ids = getStoredSessionIds();
  if (!ids.includes(id)) {
    try {
      localStorage.setItem(
        SESSION_IDS_KEY,
        JSON.stringify([id, ...ids].slice(0, MAX_STORED_SESSIONS)),
      );
    } catch {
      // ignore
    }
  }
}

export function removeStoredSessionId(id: string): void {
  try {
    const ids = getStoredSessionIds().filter(x => x !== id);
    localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}
