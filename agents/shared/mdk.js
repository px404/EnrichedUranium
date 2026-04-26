'use strict'
// MDK agent-wallet HTTP client — configurable port per agent

function mdkClient(port) {
  const base = 'http://127.0.0.1:' + port

  async function req(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } }
    if (body) opts.body = JSON.stringify(body)
    try {
      const res  = await fetch(base + path, opts)
      const text = await res.text()
      return JSON.parse(text)
    } catch (e) {
      throw new Error('MDK daemon on port ' + port + ' unreachable: ' + e.message)
    }
  }

  return {
    balance:      ()            => req('GET',  '/balance'),
    receive:      (sats, desc)  => req('POST', '/receive', { amount_sats: sats, description: desc }),
    receiveBolt12:()            => req('POST', '/receive-bolt12', {}),
    send:         (dest, sats)  => req('POST', '/send', { destination: dest, amount_sats: sats }),
    payment:      (id)          => req('GET',  '/payment/' + id),
    payments:     ()            => req('GET',  '/payments')
  }
}

/** Pay a bolt11 invoice and wait for confirmation */
async function payAndWait(client, invoice, timeoutMs = 60000) {
  const result  = await client.send(invoice)
  const payId   = result.payment_id || result.paymentId
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const p = await client.payment(payId).catch(() => null)
    if (p && p.status === 'completed') return p
    if (p && p.status === 'failed') throw new Error('Payment failed: ' + JSON.stringify(p))
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Payment timed out')
}

module.exports = { mdkClient, payAndWait }
