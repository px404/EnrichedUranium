/**
 * AgentMarket — End-to-End Lightning Demo
 *
 * Prerequisites:
 *   - Platform wallet running:  npx @moneydevkit/agent-wallet start            (port 3456)
 *   - Buyer wallet running:     MDK_WALLET_PORT=3457 ... start                 (port 3457)
 *   - Seller wallet running:    MDK_WALLET_PORT=3458 ... start                 (port 3458)
 *   - Platform wallet funded with at least 500 sats
 *
 * Run: node demo_lightning.js
 */

'use strict'

const http = require('http')

// ── Helpers ────────────────────────────────────────────────────────────────

function mdkClient(port) {
  async function req(method, path, body) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null
      const opts = {
        hostname: '127.0.0.1', port,
        path, method,
        headers: { 'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
      }
      const r = http.request(opts, res => {
        let buf = ''
        res.on('data', c => buf += c)
        res.on('end', () => { try { resolve(JSON.parse(buf)) } catch { resolve(buf) } })
      })
      r.on('error', reject)
      if (data) r.write(data)
      r.end()
    })
  }
  return {
    balance:     ()          => req('GET',  '/balance'),
    receive:     (sats, desc)=> req('POST', '/receive', { amount_sats: sats, description: desc }),
    receiveBolt12: ()        => req('POST', '/receive-bolt12', {}),
    send:        (dest, sats)=> req('POST', '/send', { destination: dest, amount_sats: sats }),
    payment:     (id)        => req('GET',  `/payment/${id}`),
    payments:    ()          => req('GET',  '/payments'),
  }
}

async function waitPaid(client, paymentHash, label, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  process.stdout.write('  Waiting for ' + label + ' payment')
  while (Date.now() < deadline) {
    const p = await client.payment(paymentHash).catch(() => null)
    if (p && p.status === 'completed') { console.log(' PAID!'); return p }
    if (p && p.status === 'failed')    { console.log(' FAILED'); throw new Error('Payment failed') }
    process.stdout.write('.')
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error('Timed out waiting for ' + label)
}

function sep(label) { console.log('\n' + '─'.repeat(50)); console.log(' ' + label); console.log('─'.repeat(50)) }
function money(n)   { return n + ' sats' }

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const platform = mdkClient(3456)
  const buyer    = mdkClient(3457)
  const seller   = mdkClient(3458)

  sep('1. WALLET BALANCES (before)')
  const pb0 = await platform.balance()
  const bb0 = await buyer.balance()
  const sb0 = await seller.balance()
  console.log('  Platform : ' + money(pb0.balance_sats))
  console.log('  Buyer    : ' + money(bb0.balance_sats))
  console.log('  Seller   : ' + money(sb0.balance_sats))

  if (pb0.balance_sats < 200) {
    console.log('\n  ERROR: Platform wallet needs at least 200 sats to run the demo.')
    console.log('  Fund it: npx @moneydevkit/agent-wallet@latest receive 1000')
    console.log('  Then pay that invoice from your Lexe wallet.')
    process.exit(1)
  }

  // ── Get seller Lightning address (BOLT12 offer) ──────────────────────────
  sep('2. SELLER REGISTERS LIGHTNING ADDRESS')
  const sellerOffer = await seller.receiveBolt12()
  console.log('  Seller offer (BOLT12): ' + sellerOffer.offer.slice(0, 40) + '...')

  // ── Fund buyer from platform (simulates buyer having their own sats) ─────
  sep('3. PLATFORM SEEDS BUYER WALLET (demo setup)')
  if (bb0.balance_sats < 150) {
    const buyerInvoice = await buyer.receive(300, 'AgentMarket buyer seed')
    console.log('  Buyer invoice created — platform paying 300 sats to buyer...')
    const seedPay = await platform.send(buyerInvoice.invoice)
    await waitPaid(buyer, buyerInvoice.payment_hash, 'buyer seed', 60000)
    console.log('  Buyer funded with 300 sats  payment_id: ' + seedPay.payment_id)
  } else {
    console.log('  Buyer already has ' + money(bb0.balance_sats) + ' — skipping seed')
  }

  // ── Buyer posts a task — gets a Lightning invoice from AgentMarket ────────
  sep('4. BUYER POSTS TASK — RECEIVES INVOICE')
  const TASK_BUDGET = 100  // sats
  console.log('  Task: text-summarization, budget: ' + money(TASK_BUDGET))

  // Generate escrow invoice from platform wallet
  const escrowInv = await platform.receive(TASK_BUDGET,
    'AgentMarket escrow — text-summarization task')
  console.log('  Escrow invoice: ' + escrowInv.invoice.slice(0, 40) + '...')
  console.log('  Payment hash:   ' + escrowInv.payment_hash)

  // ── Buyer pays the escrow invoice ────────────────────────────────────────
  sep('5. BUYER AGENT PAYS INVOICE')
  console.log('  Buyer paying ' + money(TASK_BUDGET) + ' to platform escrow...')
  const buyerPay = await buyer.send(escrowInv.invoice)
  console.log('  Payment sent — payment_id: ' + buyerPay.payment_id)
  await waitPaid(platform, escrowInv.payment_hash, 'escrow', 60000)

  // ── Seller delivers work — platform pays seller ───────────────────────────
  sep('6. SELLER COMPLETES TASK — PLATFORM PAYS SELLER')
  const platformFee   = Math.floor(TASK_BUDGET * 0.05)
  const sellerPayout  = TASK_BUDGET - platformFee
  console.log('  Platform fee:   ' + money(platformFee))
  console.log('  Seller payout:  ' + money(sellerPayout))
  console.log('  Paying seller BOLT12 offer...')
  const sellerPayResult = await platform.send(sellerOffer.offer, sellerPayout)
  console.log('  Payment sent — payment_id: ' + sellerPayResult.payment_id)

  // Wait a moment for seller to receive
  await new Promise(r => setTimeout(r, 8000))

  // ── Final balances ────────────────────────────────────────────────────────
  sep('7. WALLET BALANCES (after)')
  const pb1 = await platform.balance()
  const bb1 = await buyer.balance()
  const sb1 = await seller.balance()
  console.log('  Platform : ' + money(pb1.balance_sats) + '  (kept ' + money(platformFee) + ' fee)')
  console.log('  Buyer    : ' + money(bb1.balance_sats) + '  (spent ' + money(bb0.balance_sats - bb1.balance_sats) + ')')
  console.log('  Seller   : ' + money(sb1.balance_sats) + '  (earned ' + money(sb1.balance_sats - sb0.balance_sats) + ')')
  console.log('')
  console.log('  MONEY MOVED: buyer -> platform escrow -> seller via Lightning')
  console.log('  All transactions on mainnet Bitcoin Lightning Network.')
  console.log('')
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1) })
