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
async function postRequest(buyerPubkey, capabilityTag, inputPayload, budgetSats, chainParentId) {
  const body = {
    buyer_pubkey:   buyerPubkey,
    capability_tag: capabilityTag,
    input_payload:  inputPayload,
    budget_sats:    budgetSats
  }
  if (chainParentId) body.chain_parent_id = chainParentId
  return api('POST', '/requests', body)
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

/**
 * Discover the input/output schema for a capability.
 * Agents call this before hiring another agent to know exactly what fields to send.
 * Returns { capability_tag, display_name, input_schema, output_schema } or null on error.
 */
async function discoverSchema(capabilityTag) {
  try {
    const schema = await api('GET', '/schemas/' + capabilityTag)
    return {
      capability_tag: schema.capability_tag,
      display_name:   schema.display_name,
      description:    schema.description,
      input_schema:   typeof schema.input_schema  === 'string' ? JSON.parse(schema.input_schema)  : schema.input_schema,
      output_schema:  typeof schema.output_schema === 'string' ? JSON.parse(schema.output_schema) : schema.output_schema,
    }
  } catch (e) {
    console.warn('[platform] Could not discover schema for ' + capabilityTag + ':', e.message)
    return null
  }
}

/**
 * Discover all capabilities for a given agent pubkey.
 * Agents call this to learn what another agent accepts before deciding to hire them.
 */
async function discoverAgentCapabilities(agentPubkey) {
  try {
    return await api('GET', '/actors/' + agentPubkey + '/schemas')
  } catch (e) {
    console.warn('[platform] Could not discover capabilities for ' + agentPubkey + ':', e.message)
    return null
  }
}

/**
 * Log an "agent thought" event against a request — fire-and-forget.
 * The platform stores it in transaction_log so the UI can stream what each
 * agent is doing in real time (LLM start/finish, accepting tasks, errors…).
 *
 * @param {string} requestId    — the request the agent is currently working on
 * @param {string} actorPubkey  — the agent's pubkey
 * @param {string} event        — short slug, e.g. 'agent_thinking'
 * @param {object} detail       — arbitrary JSON payload (kept small)
 */
function logAgentEvent(requestId, actorPubkey, event, detail = {}) {
  if (!requestId || !event) return
  return api('POST', '/monitor/agent-events', {
    request_id:   requestId,
    actor_pubkey: actorPubkey,
    event,
    detail,
  }).catch(() => { /* best-effort, never throw */ })
}

module.exports = { postRequest, pollRequest, selectSeller, getResult, submitResult, discoverSchema, discoverAgentCapabilities, logAgentEvent }
