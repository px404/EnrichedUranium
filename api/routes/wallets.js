'use strict'
/**
 * GET /wallets/status          — balances for all 6 MDK wallet daemons
 * GET /wallets/:name/payments  — payment history for one wallet
 * GET /wallets/:name/receive   — generate a BOLT11 receive invoice
 *
 * Wallet roles:
 *   platform : platform-side escrow (holds budgets, releases payouts, keeps fees)
 *   user     : the human end-user — pays parent invoices to escrow
 *   pm       : the orchestrating PM agent — earns from parent jobs, pays specialists
 *   sellers  : researcher / copywriter / strategist — earn from sub-tasks
 */

const express = require('express')
const router  = express.Router()

const WALLETS = [
  { name: 'platform',   port: 3456, role: 'escrow'  },
  { name: 'user',       port: 3461, role: 'buyer'   },
  { name: 'pm',         port: 3457, role: 'agent'   },
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
    const rawPayments = raw.payments ?? (Array.isArray(raw) ? raw : [])

    // Normalise MDK payment shape → consistent snake_case for the frontend.
    // MDK daemon uses camelCase (amountSats, paymentId, createdAt, etc.)
    const payments = rawPayments.map(p => ({
      wallet:      wallet.name,
      payment_id:  p.paymentId  ?? p.payment_id  ?? p.id,
      status:      p.status     ?? 'completed',
      // Amount: daemon uses amountSats (camelCase) — normalise to amount_sats
      amount_sats: p.amountSats ?? p.amount_sats ?? p.amount ?? 0,
      // Direction: daemon may return type='inbound'/'outbound' or direction field
      direction:   p.direction  ?? (p.type === 'receive' || p.type === 'inbound' ? 'inbound' : 'outbound'),
      description: p.description ?? p.memo ?? '',
      created_at:  p.createdAt  ?? p.created_at  ?? p.timestamp ?? null,
    }))

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

// POST /wallets/:name/pay  { invoice }   — pay a bolt11 invoice from the named wallet
// Used by the UI's dev "Pay from your wallet" button (name='user') so a human
// can settle platform-issued invoices without leaving the app. Also used by
// agents/PM internally when paying for sub-tasks they hire.
router.post('/:name/pay', express.json(), async (req, res) => {
  const wallet = WALLETS.find(w => w.name === req.params.name)
  if (!wallet) return res.status(404).json({ error: 'not_found', message: 'Unknown wallet name' })
  const invoice = req.body && req.body.invoice
  if (!invoice || typeof invoice !== 'string')
    return res.status(400).json({ error: 'invalid_invoice', message: 'invoice (bolt11 string) is required' })

  try {
    const { ok, status, data } = await walletFetch(wallet.port, '/send', 'POST',
      { destination: invoice })
    const raw = data.data ?? data
    if (!ok) return res.status(status || 500).json({ error: 'wallet_error', detail: raw })
    return res.json({
      wallet:      wallet.name,
      payment_id:  raw.paymentId  ?? raw.payment_id  ?? null,
      status:      raw.status     ?? 'submitted',
      amount_sats: raw.amountSats ?? raw.amount_sats ?? null,
    })
  } catch (e) {
    return res.status(503).json({ error: 'wallet_offline',
      message: `Wallet "${wallet.name}" is not running (${e.message})` })
  }
})

module.exports = router
