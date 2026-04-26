'use strict'
/**
 * GET /wallets/status          — balances for all 5 MDK wallet daemons
 * GET /wallets/:name/payments  — payment history for one wallet
 * GET /wallets/:name/receive   — generate a BOLT11 receive invoice
 */

const express = require('express')
const router  = express.Router()

const WALLETS = [
  { name: 'platform',   port: 3456, role: 'escrow'  },
  { name: 'pm',         port: 3457, role: 'buyer'   },
  { name: 'researcher', port: 3458, role: 'seller'  },
  { name: 'copywriter', port: 3459, role: 'seller'  },
  { name: 'strategist', port: 3460, role: 'seller'  },
]

async function walletFetch(port, path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' },
                 signal: AbortSignal.timeout(3000) }
  if (body) opts.body = JSON.stringify(body)
  const res  = await fetch(`http://127.0.0.1:${port}${path}`, opts)
  const text = await res.text()
  return { ok: res.ok, status: res.status, data: JSON.parse(text) }
}

// GET /wallets/status
router.get('/status', async (_req, res) => {
  const results = await Promise.all(
    WALLETS.map(async w => {
      try {
        const { data } = await walletFetch(w.port, '/balance')
        const raw = data.data ?? data
        return { ...w, online: true, balance_sats: raw.balanceSats ?? raw.balance_sats ?? 0 }
      } catch {
        return { ...w, online: false, balance_sats: null }
      }
    })
  )
  return res.json({ wallets: results })
})

// GET /wallets/:name/payments
router.get('/:name/payments', async (req, res) => {
  const wallet = WALLETS.find(w => w.name === req.params.name)
  if (!wallet) return res.status(404).json({ error: 'not_found', message: 'Unknown wallet name' })

  try {
    const { data } = await walletFetch(wallet.port, '/payments')
    const raw = data.data ?? data
    const payments = (raw.payments ?? (Array.isArray(raw) ? raw : [])).map(p => ({ ...p, wallet: wallet.name }))
    return res.json({ wallet: wallet.name, payments })
  } catch {
    return res.status(503).json({ error: 'wallet_offline',
      message: `Wallet "${wallet.name}" (port ${wallet.port}) is not running` })
  }
})

// GET /wallets/:name/receive?amount=<sats>&description=<text>
router.get('/:name/receive', async (req, res) => {
  const wallet = WALLETS.find(w => w.name === req.params.name)
  if (!wallet) return res.status(404).json({ error: 'not_found' })

  const amount = parseInt(req.query.amount || '0', 10)
  const desc   = req.query.description || 'AgentMarket top-up'
  if (!amount || amount <= 0)
    return res.status(400).json({ error: 'invalid_amount', message: 'amount must be a positive integer (sats)' })

  try {
    const { data } = await walletFetch(wallet.port, '/receive', 'POST',
      { amount_sats: amount, description: desc })
    const raw = data.data ?? data
    return res.json({ wallet: wallet.name, invoice: raw.invoice, payment_hash: raw.paymentHash ?? raw.payment_hash })
  } catch {
    return res.status(503).json({ error: 'wallet_offline',
      message: `Wallet "${wallet.name}" is not running` })
  }
})

module.exports = router
