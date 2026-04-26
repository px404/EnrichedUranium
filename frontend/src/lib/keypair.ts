/**
 * Ed25519 keypair management using the browser's built-in Web Crypto API.
 *
 * The public key (hex) is used as the actor pubkey on the platform.
 * The private key is stored as a JWK in localStorage — never leaves the browser.
 *
 * Security note: localStorage is accessible to JS on the same origin.
 * For higher security, migrate to IndexedDB with non-extractable keys.
 */

const STORAGE_KEY = 'agentmesh:keypair'

export interface StoredKeypair {
  pubkeyHex: string
  privateKeyJwk: JsonWebKey
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function generateKeypair(): Promise<StoredKeypair> {
  const keypair = await crypto.subtle.generateKey(
    { name: 'Ed25519' } as EcKeyGenParams,
    true,
    ['sign', 'verify'],
  )
  const pubkeyHex    = bytesToHex(await crypto.subtle.exportKey('raw', keypair.publicKey))
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keypair.privateKey)
  const stored: StoredKeypair = { pubkeyHex, privateKeyJwk }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  return stored
}

export function getStoredKeypair(): StoredKeypair | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredKeypair) : null
  } catch {
    return null
  }
}

export function clearKeypair(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** Sign a nonce string — returns hex-encoded 64-byte Ed25519 signature. */
export async function signChallenge(nonce: string, privateKeyJwk: JsonWebKey): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'Ed25519' } as EcKeyImportParams,
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(nonce),
  )
  return bytesToHex(sig)
}

/**
 * Full challenge-response: fetch a nonce, sign it, verify with the platform.
 * Returns { verified, actor } or throws on failure.
 */
export async function verifyIdentity(
  pubkeyHex: string,
  privateKeyJwk: JsonWebKey,
  apiBase: string,
): Promise<{ verified: boolean; actor: unknown }> {
  const challengeRes = await fetch(`${apiBase}/auth/challenge?pubkey=${pubkeyHex}`)
  if (!challengeRes.ok) throw new Error('Failed to get challenge')
  const { nonce } = await challengeRes.json() as { nonce: string }

  const signature = await signChallenge(nonce, privateKeyJwk)

  const verifyRes = await fetch(`${apiBase}/auth/verify`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ pubkey: pubkeyHex, nonce, signature }),
  })
  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({})) as { message?: string }
    throw new Error(err.message || 'Verification failed')
  }
  return verifyRes.json()
}
