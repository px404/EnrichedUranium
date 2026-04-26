const express = require('express')
const router  = express.Router()
const Ajv     = require('ajv')
const { v4: uuidv4 } = require('uuid')
const { prepare } = require('../db/database')
const { computeStrengthScore } = require('../validators/schemaStrength')

const ajv = new Ajv({ strict: false, allErrors: false })

// POST /schemas
router.post('/', (req, res) => {
  const { capability_tag, display_name, description, input_schema, output_schema } = req.body

  if (!capability_tag || !display_name || !description || !input_schema || !output_schema) {
    return res.status(400).json({ error: 'missing_fields', message: 'capability_tag, display_name, description, input_schema, output_schema are all required' })
  }
  if (!/^[a-z0-9-]+$/.test(capability_tag)) {
    return res.status(400).json({ error: 'invalid_tag', message: 'capability_tag must be lowercase letters, numbers, and hyphens only' })
  }

  try { ajv.compile(input_schema) }  catch(e) { return res.status(400).json({ error: 'invalid_input_schema',  message: e.message }) }
  try { ajv.compile(output_schema) } catch(e) { return res.status(400).json({ error: 'invalid_output_schema', message: e.message }) }

  const { score, breakdown } = computeStrengthScore(input_schema, output_schema)
  if (score < 40) {
    return res.status(422).json({ error: 'schema_too_weak', message: `Score ${score}/100 — minimum is 40.`, score, breakdown, hints: buildHints(breakdown) })
  }

  const existing = prepare('SELECT capability_tag FROM schemas WHERE capability_tag = ?').get(capability_tag)
  if (existing) {
    return res.status(409).json({ error: 'duplicate_tag', message: `"${capability_tag}" already exists` })
  }

  const now = Math.floor(Date.now() / 1000)
  prepare('INSERT INTO schemas (capability_tag, display_name, description, input_schema, output_schema, strength_score, is_platform_template, created_at) VALUES (?,?,?,?,?,?,0,?)')
    .run(capability_tag, display_name, description, JSON.stringify(input_schema), JSON.stringify(output_schema), score, now)

  return res.status(201).json({ capability_tag, display_name, description, strength_score: score, breakdown, created_at: now })
})

// GET /schemas
router.get('/', (req, res) => {
  const { platform_only } = req.query
  let sql = 'SELECT capability_tag, display_name, description, strength_score, is_platform_template, created_at FROM schemas'
  if (platform_only === 'true') sql += ' WHERE is_platform_template = 1'
  sql += ' ORDER BY created_at ASC'
  const rows = prepare(sql).all()
  return res.json({ schemas: rows, count: rows.length })
})

// GET /schemas/:capability_tag
router.get('/:capability_tag', (req, res) => {
  const row = prepare('SELECT * FROM schemas WHERE capability_tag = ?').get(req.params.capability_tag)
  if (!row) return res.status(404).json({ error: 'not_found', message: `Schema "${req.params.capability_tag}" not found` })
  return res.json({ ...row, input_schema: JSON.parse(row.input_schema), output_schema: JSON.parse(row.output_schema), is_platform_template: row.is_platform_template === 1 })
})

// DELETE /schemas/:capability_tag
router.delete('/:capability_tag', (req, res) => {
  const { capability_tag } = req.params
  const schema = prepare('SELECT capability_tag, is_platform_template FROM schemas WHERE capability_tag = ?').get(capability_tag)
  if (!schema) return res.status(404).json({ error: 'not_found', message: `Schema "${capability_tag}" not found` })
  if (schema.is_platform_template) return res.status(403).json({ error: 'forbidden', message: 'Platform templates cannot be deleted' })

  const actors = prepare('SELECT pubkey FROM actors WHERE capabilities LIKE ?').all(`%"${capability_tag}"%`)
  if (actors.length > 0) return res.status(409).json({ error: 'capability_in_use', message: `${actors.length} actor(s) use this capability` })

  prepare('DELETE FROM schemas WHERE capability_tag = ?').run(capability_tag)
  return res.json({ deleted: capability_tag })
})

function buildHints(b) {
  const h = []
  if (!b.input_typed_fields)  h.push('Add ≥3 typed fields to input_schema.properties')
  if (!b.output_typed_fields) h.push('Add ≥3 typed fields to output_schema.properties')
  if (!b.range_constraint)    h.push('Add minimum/maximum or minLength/maxLength to a field')
  if (!b.enum_or_pattern)     h.push('Add an enum or pattern constraint to a field')
  if (!b.consistency_rules)   h.push('Add x-consistency-rules array to output_schema')
  if (!b.completeness_rules)  h.push('Add x-min-content-length or x-min-items to an output field')
  return h
}

module.exports = router
