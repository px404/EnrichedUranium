/**
 * 4-level result validator.
 *
 * Validates a seller's output_payload against the capability's output_schema.
 *
 * Level 1 — Structure
 *   Required fields present; every field has the correct type.
 *   Uses AJV with a constraint-stripped copy of the schema so type/required
 *   errors are clearly separated from constraint errors.
 *
 * Level 2 — Constraints
 *   minimum / maximum / minLength / maxLength / minItems / maxItems / enum / pattern.
 *   Uses AJV with the full schema. Only reached if Level 1 passes.
 *
 * Level 3 — Internal consistency (x-consistency-rules)
 *   Rules are human-readable cross-field declarations (per architecture).
 *   Platform logs them as checked but does NOT auto-enforce them.
 *   Always passes programmatically; violations are surfaced in a warning field.
 *
 * Level 4 — Completeness (x-min-content-length, x-min-items)
 *   Custom extension keywords on output_schema properties.
 *   x-min-content-length: minimum string length for non-empty text fields
 *   x-min-items: minimum array length for list fields
 *
 * Returns:
 *   { valid: boolean, level: 1|2|3|4|null, error: string|null, warnings: string[] }
 */

const Ajv = require('ajv')

const ajv = new Ajv({ strict: false, allErrors: true })

// Keywords AJV should NOT evaluate for the Level 1 (structure) pass
const CONSTRAINT_KEYWORDS = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength',
  'minItems',  'maxItems',
  'enum',
  'pattern',
  'format',
  'multipleOf'
]

/**
 * Strip constraint keywords from a schema so that only type/required checks remain.
 * Operates on a deep-ish clone (one level into properties).
 */
function stripConstraints(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const stripped = Object.assign({}, schema)

  if (stripped.properties) {
    stripped.properties = {}
    for (const [key, propDef] of Object.entries(schema.properties)) {
      const clean = Object.assign({}, propDef)
      CONSTRAINT_KEYWORDS.forEach(kw => delete clean[kw])
      // Recurse one level for nested objects
      if (clean.properties) clean = stripConstraints(clean)
      stripped.properties[key] = clean
    }
  }

  return stripped
}

/**
 * Check x-min-content-length and x-min-items custom keywords on all properties.
 * Returns the first error string found, or null if all pass.
 */
function checkCompleteness(payload, schema) {
  if (!schema || !schema.properties || typeof payload !== 'object' || payload === null) {
    return null
  }

  for (const [key, propDef] of Object.entries(schema.properties)) {
    const value = payload[key]
    if (value === undefined || value === null) continue

    const minContentLen = propDef['x-min-content-length']
    if (minContentLen !== undefined && typeof value === 'string') {
      if (value.trim().length < minContentLen) {
        return `Field "${key}" must have at least ${minContentLen} non-whitespace characters (got ${value.trim().length})`
      }
    }

    const minItems = propDef['x-min-items']
    if (minItems !== undefined && Array.isArray(value)) {
      if (value.length < minItems) {
        return `Field "${key}" must contain at least ${minItems} item(s) (got ${value.length})`
      }
    }
  }

  return null
}

/**
 * Collect x-consistency-rules from the output schema and return them as warnings.
 * Rules are not enforced — they are human-readable declarations for reviewers.
 */
function collectConsistencyWarnings(schema) {
  const rules = schema['x-consistency-rules']
  if (!Array.isArray(rules) || rules.length === 0) return []
  return rules.map(r => `[consistency-rule] ${typeof r === 'string' ? r : JSON.stringify(r)}`)
}

/**
 * Validate output_payload against output_schema using the 4-level protocol.
 *
 * @param {any}    outputPayload  The parsed output object from the seller
 * @param {object} outputSchema   The JSON Schema from the capability registry
 * @returns {{ valid: boolean, level: number|null, error: string|null, warnings: string[] }}
 */
function validateResult(outputPayload, outputSchema) {
  const warnings = []

  // ── Level 1: Structure (required fields + types) ──────────────────────────
  const structureSchema   = stripConstraints(outputSchema)
  const validateStructure = ajv.compile(structureSchema)

  if (!validateStructure(outputPayload)) {
    return {
      valid:    false,
      level:    1,
      error:    ajv.errorsText(validateStructure.errors, { separator: '; ' }),
      warnings
    }
  }

  // ── Level 2: Constraints (min/max, enum, pattern, etc.) ───────────────────
  const validateFull = ajv.compile(outputSchema)

  if (!validateFull(outputPayload)) {
    return {
      valid:    false,
      level:    2,
      error:    ajv.errorsText(validateFull.errors, { separator: '; ' }),
      warnings
    }
  }

  // ── Level 3: Internal consistency (logged only, never auto-enforced) ───────
  const consistencyWarnings = collectConsistencyWarnings(outputSchema)
  warnings.push(...consistencyWarnings)
  // Always passes at Level 3 — warnings are informational

  // ── Level 4: Completeness (x-min-content-length, x-min-items) ────────────
  const completenessError = checkCompleteness(outputPayload, outputSchema)
  if (completenessError) {
    return {
      valid:    false,
      level:    4,
      error:    completenessError,
      warnings
    }
  }

  return { valid: true, level: null, error: null, warnings }
}

module.exports = { validateResult }
