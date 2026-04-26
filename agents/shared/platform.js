'use strict'
// AgentMarket platform API client
// Used by PM agent to post requests and poll for results

const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:3001'

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res  = await fetch(PLATFORM_URL + path, opts)
  const json = await res.json()
  if (!res.ok) throw new Error('Platform ' + method + ' ' + path + ' -> ' + res.status + ': ' + JSON.stringify(json))
  return json
}

/** Post a task request and return {id, invoice, payment_hash, shortlist} */
async function postRequest(buyerPubkey, capabilityTag, inputPayload, budgetSats) {
  return api('POST', '/requests', {
    buyer_pubkey:   buyerPubkey,
    capability_tag: capabilityTag,
    input_payload:  inputPayload,
    budget_sats:    budgetSats
  })
}

/** Poll until request reaches a terminal or target status */
async function pollRequest(requestId, targetStatus = 'completed', timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const req = await api('GET', '/requests/' + requestId)
    if (req.status === targetStatus)  return req
    if (['failed','refunded'].includes(req.status))
      throw new Error('Request ' + requestId + ' ended with status: ' + req.status)
    await new Promise(r => setTimeout(r, 4000))
  }
  throw new Error('Request ' + requestId + ' timed out waiting for status: ' + targetStatus)
}

/** Select a seller from the shortlist */
async function selectSeller(requestId, sellerPubkey) {
  return api('POST', '/requests/' + requestId + '/select', { seller_pubkey: sellerPubkey })
}

/** Fetch result output after completion */
async function getResult(requestId) {
  return api('GET', '/results/' + requestId)
}

/** Submit a result as a seller */
async function submitResult(requestId, sellerPubkey, outputPayload) {
  return api('POST', '/results/' + requestId, { seller_pubkey: sellerPubkey, output_payload: outputPayload })
}

module.exports = { postRequest, pollRequest, selectSeller, getResult, submitResult }
