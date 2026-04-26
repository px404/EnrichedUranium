const path = require('path')
const fs   = require('fs')
const initSqlJs = require('sql.js')

const DB_PATH = path.join(__dirname, 'agentmarket.db')

let db = null

async function getDb() {
  if (db) return db
  const SQL = await initSqlJs()
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }
  db.pragma = (s) => db.run('PRAGMA ' + s)
  db.pragma('foreign_keys = ON')
  initSchema()
  return db
}

function save() {
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

function initSchema() {
  db.run("CREATE TABLE IF NOT EXISTS schemas (capability_tag TEXT PRIMARY KEY, display_name TEXT NOT NULL, description TEXT NOT NULL, input_schema TEXT NOT NULL, output_schema TEXT NOT NULL, strength_score INTEGER NOT NULL DEFAULT 0, is_platform_template INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)")

  db.run("CREATE TABLE IF NOT EXISTS actors (pubkey TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('agent','human')), owner_pubkey TEXT, display_name TEXT NOT NULL, registered_at INTEGER NOT NULL, capabilities TEXT NOT NULL DEFAULT '[]', price_per_call_sats TEXT NOT NULL DEFAULT '{}', spend_cap_per_call TEXT NOT NULL DEFAULT '{}', spend_cap_per_session INTEGER NOT NULL DEFAULT 10000, spend_cap_daily_sats INTEGER NOT NULL DEFAULT 100000, daily_spend_used INTEGER NOT NULL DEFAULT 0, daily_spend_reset_at INTEGER NOT NULL DEFAULT 0, endpoint_url TEXT, status TEXT NOT NULL DEFAULT 'active', webhook_url TEXT, reliability_score REAL NOT NULL DEFAULT 50.0, certification_tier TEXT NOT NULL DEFAULT '{}', cert_expiry TEXT NOT NULL DEFAULT '{}', chain_depth_max INTEGER NOT NULL DEFAULT 5, lightning_address TEXT)")
  try { db.run("ALTER TABLE actors ADD COLUMN lightning_address TEXT") } catch (_) {}

  db.run("CREATE INDEX IF NOT EXISTS idx_actors_type   ON actors(type)")
  db.run("CREATE INDEX IF NOT EXISTS idx_actors_status ON actors(status)")
  db.run("CREATE INDEX IF NOT EXISTS idx_actors_owner  ON actors(owner_pubkey)")

  db.run("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, buyer_pubkey TEXT NOT NULL, capability_tag TEXT NOT NULL, input_payload TEXT NOT NULL, budget_sats INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending_payment', shortlist TEXT, selected_seller TEXT, deadline_unix INTEGER NOT NULL, created_at INTEGER NOT NULL, funded_at INTEGER, matched_at INTEGER, completed_at INTEGER, retry_count INTEGER NOT NULL DEFAULT 0, platform_fee_sats INTEGER, seller_payout_sats INTEGER, chain_parent_id TEXT, chain_depth INTEGER NOT NULL DEFAULT 0, subtasks TEXT, subtasks_completed INTEGER NOT NULL DEFAULT 0, payment_hash TEXT)")

  try { db.run("ALTER TABLE requests ADD COLUMN chain_parent_id TEXT") }                          catch (_) {}
  try { db.run("ALTER TABLE requests ADD COLUMN chain_depth INTEGER NOT NULL DEFAULT 0") }        catch (_) {}
  try { db.run("ALTER TABLE requests ADD COLUMN subtasks TEXT") }                                 catch (_) {}
  try { db.run("ALTER TABLE requests ADD COLUMN subtasks_completed INTEGER NOT NULL DEFAULT 0") } catch (_) {}
  try { db.run("ALTER TABLE requests ADD COLUMN payment_hash TEXT") }                             catch (_) {}

  db.run("CREATE INDEX IF NOT EXISTS idx_requests_buyer    ON requests(buyer_pubkey)")
  db.run("CREATE INDEX IF NOT EXISTS idx_requests_seller   ON requests(selected_seller)")
  db.run("CREATE INDEX IF NOT EXISTS idx_requests_status   ON requests(status)")
  db.run("CREATE INDEX IF NOT EXISTS idx_requests_cap      ON requests(capability_tag)")
  db.run("CREATE INDEX IF NOT EXISTS idx_requests_deadline ON requests(deadline_unix)")
  db.run("CREATE INDEX IF NOT EXISTS idx_requests_created  ON requests(created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_requests_chain    ON requests(chain_parent_id)")

  db.run("CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, seller_pubkey TEXT NOT NULL, output_payload TEXT NOT NULL, validation_status TEXT NOT NULL, validation_level INTEGER, validation_error TEXT, submitted_at INTEGER NOT NULL)")

  db.run("CREATE INDEX IF NOT EXISTS idx_results_request ON results(request_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_results_seller  ON results(seller_pubkey)")

  db.run("CREATE TABLE IF NOT EXISTS transaction_log (id TEXT PRIMARY KEY, request_id TEXT, event TEXT NOT NULL, actor_pubkey TEXT, detail TEXT, created_at INTEGER NOT NULL)")

  db.run("CREATE INDEX IF NOT EXISTS idx_txlog_request ON transaction_log(request_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_txlog_actor   ON transaction_log(actor_pubkey)")
  db.run("CREATE INDEX IF NOT EXISTS idx_txlog_event   ON transaction_log(event)")
  db.run("CREATE INDEX IF NOT EXISTS idx_txlog_created ON transaction_log(created_at)")

  db.run("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, buyer_pubkey TEXT NOT NULL, seller_pubkey TEXT NOT NULL, capability_tag TEXT NOT NULL, price_per_call_sats INTEGER NOT NULL, budget_sats INTEGER NOT NULL, sats_used INTEGER NOT NULL DEFAULT 0, calls_made INTEGER NOT NULL DEFAULT 0, session_token TEXT NOT NULL, parent_session_id TEXT, chain_depth INTEGER NOT NULL DEFAULT 0, expires_unix INTEGER NOT NULL, opened_at INTEGER NOT NULL, closed_at INTEGER, seller_payout_sats INTEGER, buyer_refund_sats INTEGER, platform_fee_sats INTEGER, status TEXT NOT NULL DEFAULT 'active')")

  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_buyer   ON sessions(buyer_pubkey)")
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_seller  ON sessions(seller_pubkey)")
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_status  ON sessions(status)")
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_unix)")
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_parent  ON sessions(parent_session_id)")

  db.run("CREATE TABLE IF NOT EXISTS reliability_score_cache (actor_pubkey TEXT NOT NULL, capability_tag TEXT NOT NULL DEFAULT '*', score REAL NOT NULL, delivery_rate REAL NOT NULL DEFAULT 0, schema_pass_rate REAL NOT NULL DEFAULT 0, acceptance_rate REAL NOT NULL DEFAULT 0, response_time_score REAL NOT NULL DEFAULT 0, tasks_in_window INTEGER NOT NULL DEFAULT 0, computed_at INTEGER NOT NULL, PRIMARY KEY (actor_pubkey, capability_tag))")

  db.run("CREATE INDEX IF NOT EXISTS idx_relcache_cap ON reliability_score_cache(capability_tag)")

  db.run("CREATE TABLE IF NOT EXISTS bad_faith_flags (buyer_pubkey TEXT NOT NULL, seller_pubkey TEXT NOT NULL, flagged_at INTEGER NOT NULL, detail TEXT, PRIMARY KEY (buyer_pubkey, seller_pubkey))")

  db.run("CREATE INDEX IF NOT EXISTS idx_badfaith_buyer  ON bad_faith_flags(buyer_pubkey)")
  db.run("CREATE INDEX IF NOT EXISTS idx_badfaith_seller ON bad_faith_flags(seller_pubkey)")

  const TEST_PREFIXES = ['p3-', 'p4-', 'sess-']
  const testActors = query(
    "SELECT pubkey FROM actors WHERE " +
    TEST_PREFIXES.map(() => "pubkey LIKE ?").join(' OR '),
    TEST_PREFIXES.map(p => p + '%')
  )
  if (testActors.length > 0) {
    const pks = testActors.map(r => r.pubkey)
    const ph  = pks.map(() => '?').join(',')
    db.run("DELETE FROM reliability_score_cache WHERE actor_pubkey IN (" + ph + ")", pks)
    db.run("DELETE FROM bad_faith_flags WHERE buyer_pubkey IN (" + ph + ") OR seller_pubkey IN (" + ph + ")", [...pks, ...pks])
    db.run("DELETE FROM results WHERE seller_pubkey IN (" + ph + ")", pks)
    db.run("DELETE FROM transaction_log WHERE actor_pubkey IN (" + ph + ")", pks)
    db.run("DELETE FROM requests WHERE buyer_pubkey IN (" + ph + ") OR selected_seller IN (" + ph + ")", [...pks, ...pks])
    db.run("DELETE FROM sessions WHERE buyer_pubkey IN (" + ph + ") OR seller_pubkey IN (" + ph + ")", [...pks, ...pks])
    db.run("DELETE FROM actors WHERE pubkey IN (" + ph + ")", pks)
    console.log('[db] cleaned up', pks.length, 'test-fixture actor(s):', pks.join(', '))
  }

  save()
}

function prepare(sql) {
  return {
    get(...params)  { return query(sql, params)[0] || null },
    all(...params)  { return query(sql, params) },
    run(...params)  {
      db.run(sql, params)
      save()
      return { changes: db.getRowsModified() }
    }
  }
}

function query(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

module.exports = { getDb, prepare, save }
