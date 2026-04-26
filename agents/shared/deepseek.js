'use strict'
// DeepSeek API client — OpenAI-compatible format
// Model: deepseek-chat (DeepSeek-V3, their mid-tier capable model)

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const BASE_URL         = 'https://api.deepseek.com'

async function chat(systemPrompt, userContent, temperature = 0.7, maxTokens) {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY env var not set')

  const body = {
    model:       'deepseek-chat',
    temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  }
    ]
  }
  if (maxTokens) body.max_tokens = maxTokens

  const res = await fetch(BASE_URL + '/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + DEEPSEEK_API_KEY,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error('DeepSeek API error ' + res.status + ': ' + err.slice(0, 200))
  }

  const data = await res.json()
  const text = data.choices[0].message.content.trim()

  // Strip markdown code fences if model wraps JSON in them
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    throw new Error('DeepSeek returned non-JSON: ' + clean.slice(0, 300))
  }
}

module.exports = { chat }
