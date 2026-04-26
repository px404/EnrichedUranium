const express = require('express')
const cors    = require('cors')
const { getDb } = require('./db/database')

const app  = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use((req, _res, next) => { console.log(new Date().toISOString() + '  ' + req.method + '  ' + req.path); next() })

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: Math.floor(Date.now() / 1000) }))

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'internal_error', message: err.message }) })

;(async () => {
  await getDb()
  console.log('Database ready.')

  const sessionsRouter = require('./routes/sessions')
  const reliability    = require('./lib/reliabilityScore')

  app.use('/auth',     require('./routes/auth'))
  app.use('/schemas',  require('./routes/schemas'))
  app.use('/actors',   require('./routes/actors'))
  app.use('/requests', require('./routes/requests'))
  app.use('/results',  require('./routes/results'))
  app.use('/sessions', sessionsRouter)
  app.use('/market',   require('./routes/market'))
  app.use('/wallets',  require('./routes/wallets'))
  app.use('/monitor',  require('./routes/monitor'))
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }))

  // Auto-expire sessions every 60 seconds
  setInterval(() => {
    try { sessionsRouter.checkExpiredSessions() } catch (e) { console.error('Session expiry error:', e) }
  }, 60000)

  // Phase 3: warm reliability cache at boot, then recompute every 15 minutes
  try {
    const r = reliability.recomputeAll()
    console.log('[reliability] boot recompute: ' + r.sellers_updated + ' actor(s) updated')
  } catch (e) { console.error('[reliability] boot recompute failed:', e) }

  setInterval(() => {
    try {
      const r = reliability.recomputeAll()
      console.log('[reliability] periodic recompute: ' + r.sellers_updated + ' actor(s) updated')
    } catch (e) { console.error('[reliability] periodic recompute failed:', e) }
  }, 15 * 60 * 1000)

  app.listen(PORT, () => {
    console.log('\nAgentMarket API  ->  http://localhost:' + PORT)
    console.log('  GET  /health')
    console.log('  GET/POST/DELETE  /schemas')
    console.log('  GET              /schemas/:capability_tag')
    console.log('  GET/POST/PATCH   /actors')
    console.log('  GET/PATCH        /actors/:pubkey')
    console.log('  GET              /actors/:pubkey/history')
    console.log('  POST/GET         /requests')
    console.log('  GET              /requests/:id')
    console.log('  POST             /requests/:id/select')
    console.log('  POST             /results/:request_id')
    console.log('  POST/GET         /sessions')
    console.log('  GET              /sessions/:id')
    console.log('  POST             /sessions/:id/call')
    console.log('  POST             /sessions/:id/close')
    console.log('  POST             /sessions/:id/topup')
    console.log('  GET              /market/pricing/:capability_tag')
    console.log('  GET              /market/quality/:capability_tag')
    console.log('  GET              /market/compare/:capability_tag')
    console.log('  GET              /market/trust/:capability_tag\n')
  })
})()
