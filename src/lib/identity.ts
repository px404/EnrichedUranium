/**
 * identity.ts — lightweight pubkey identity store backed by localStorage.
 *
 * The backend is pubkey-based (no auth, no login). This module lets the
 * frontend "be" a pubkey. Users enter their pubkey in Dashboard → Settings.
 *
 * We also keep a local registry of session IDs and request IDs we created
 * during this browser session, because the backend has no
 * `GET /sessions?buyer=...` or `GET /requests?creator=...` endpoint.
 */

import { useEffect, useState } from 'react';

const PUBKEY_KEY = 'agentmesh:pubkey';
const SESSION_IDS_KEY = 'agentmesh:session_ids';
const REQUEST_IDS_KEY = 'agentmesh:request_ids';
const MAX_STORED_IDS = 50;

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
    localStorage.removeItem(REQUEST_IDS_KEY);
    window.dispatchEvent(new Event('storage'));
  } catch {
    // ignore
  }
}

export function hasIdentity(): boolean {
  return getIdentityPubkey().length > 0;
}

/**
 * React hook that returns the current identity pubkey and updates whenever
 * `setIdentityPubkey`/`clearIdentityPubkey` fire. Use this instead of a
 * `useState(getIdentityPubkey)` snapshot so screens react to sign-in/out
 * without a manual refresh.
 */
export function useIdentityPubkey(): string {
  const [pk, setPk] = useState<string>(() => getIdentityPubkey());
  useEffect(() => {
    const handler = () => setPk(getIdentityPubkey());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  return pk;
}

// ── Stored ID registries ──────────────────────────────────────────────────────

function readIds(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(0, MAX_STORED_IDS)));
  } catch {
    // ignore
  }
}

// Sessions

export function getStoredSessionIds(): string[] {
  return readIds(SESSION_IDS_KEY);
}

export function addStoredSessionId(id: string): void {
  const ids = getStoredSessionIds();
  if (ids.includes(id)) return;
  writeIds(SESSION_IDS_KEY, [id, ...ids]);
}

export function removeStoredSessionId(id: string): void {
  writeIds(
    SESSION_IDS_KEY,
    getStoredSessionIds().filter(x => x !== id),
  );
}

// Requests

export function getStoredRequestIds(): string[] {
  return readIds(REQUEST_IDS_KEY);
}

export function addStoredRequestId(id: string): void {
  const ids = getStoredRequestIds();
  if (ids.includes(id)) return;
  writeIds(REQUEST_IDS_KEY, [id, ...ids]);
}

export function removeStoredRequestId(id: string): void {
  writeIds(
    REQUEST_IDS_KEY,
    getStoredRequestIds().filter(x => x !== id),
  );
}
