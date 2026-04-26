'use strict'
/**
 * Auth routes — Ed25519 challenge-response identity verification.
 *
 * Flow:
 *   1. GET  /auth/challenge?pubkey=<hex>  — get a one-time nonce
 *   2. Sign the nonce with your Ed25519 private key
 *   3. POST /auth/verify { pubkey, nonce, signature } — prove key ownership
 *
 * pubkey  = 32-byte Ed25519 public key encoded as 64 lowercase hex chars
 * nonce   = UUID returned by /challenge
 * signature = 64-byte Ed25519 signature of the UTF-8 nonce, hex-encoded
 */

const express        = require('express')
const router         = express.Router()
const { webcrypto }  = require('crypto')
const { v4: uuidv4 } = require('uuid')
const { prepare }    = require('../db/database')

const NONCE_TTL_MS = 5 * 60 * 1000  // 5 minutes
const nonces = new Map()             // nonce -> { pubkey, expires_at }

function pruneNonces() {
  const now = Date.now()
  for (const [nonce, entry] of nonces)
    if (entry.expires_at < now) nonces.delete(nonce)
}

// GET /auth/challenge?pubkey=<hex>
router.get('/challenge', (req, res) => {
  const { pubkey } = req.query
  if (!pubkey) return res.status(400).json({ error: 'missing_pubkey', message: 'pubkey query param required' })

  pruneNonces()
  const nonce      = uuidv4()
  const expires_at = Date.now() + NONCE_TTL_MS
  nonces.set(nonce, { pubkey, expires_at })

  return res.json({ nonce, expires_at: Math.floor(expires_at / 1000) })
})

// POST /auth/verify { pubkey, nonce, signature }
router.post('/verify', async (req, res) => {
  const { pubkey, nonce, signature } = req.body
  if (!pubkey || !nonce || !signature)
    return res.status(400).json({ error: 'missing_fields', message: 'pubkey, nonce, and signature are required' })

  const entry = nonces.get(nonce)
  if (!entry)
    return res.status(401).json({ error: 'invalid_nonce', message: 'Nonce not found or already used' })
  if (entry.pubkey !== pubkey)
    return res.status(401).json({ error: 'nonce_pubkey_mismatch', message: 'Nonce was issued for a different pubkey' })
  if (entry.expires_at < Date.now()) {
    nonces.delete(nonce)
    return res.status(401).json({ error: 'nonce_expired', message: 'Nonce expired — request a new challenge' })
  }

  try {
    const pubkeyBytes = Buffer.from(pubkey, 'hex')
    if (pubkeyBytes.length !== 32)
      return res.status(400).json({ error: 'invalid_pubkey', message: 'pubkey must be a 32-byte Ed25519 key as 64 hex chars' })

    const publicKey = await webcrypto.subtle.importKey(
      'raw', pubkeyBytes, { name: 'Ed25519' }, false, ['verify']
    )
    const valid = await webcrypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      Buffer.from(signature, 'hex'),
      Buffer.from(nonce)
    )

    if (!valid)
      return res.status(401).json({ error: 'invalid_signature', message: 'Signature does not match pubkey' })

    nonces.delete(nonce) // one-time use

    const actor = prepare('SELECT pubkey, type, display_name, status FROM actors WHERE pubkey = ?').get(pubkey)
    return res.json({ verified: true, actor: actor || null })
  } catch (e) {
    return res.status(400).json({ error: 'verification_error', message: e.message })
  }
})

module.exports = router
