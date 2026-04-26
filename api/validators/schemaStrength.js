/**
 * Computes a strength score for a capability schema.
 * Score must reach 40 for the schema to be accepted.
 *
 * Scoring rubric (matches the architecture docs):
 *   Input schema has ≥ 3 typed fields        +20
 *   Output schema has ≥ 3 typed fields        +20
 *   At least one range constraint (min/max)   +15
 *   At least one enum or pattern constraint   +15
 *   Internal consistency rules defined        +15
 *   Completeness rules defined                +15
 */

function countTypedFields(schema) {
  if (!schema || typeof schema !== 'object') return 0
  const props = schema.properties || {}
  return Object.values(props).filter(p => p && p.type).length
}

function hasRangeConstraint(schema) {
  if (!schema || typeof schema !== 'object') return false
  const props = schema.properties || {}
  return Object.values(props).some(p =>
    p && (p.minimum !== undefined || p.maximum !== undefined ||
          p.minLength !== undefined || p.maxLength !== undefined ||
          p.minItems !== undefined || p.maxItems !== undefined)
  )
}

function hasEnumOrPattern(schema) {
  if (!schema || typeof schema !== 'object') return false
  const props = schema.properties || {}
  return Object.values(props).some(p => p && (p.enum || p.pattern))
}

function hasConsistencyRules(schema) {
  if (!schema || typeof schema !== 'object') return false
  return Array.isArray(schema['x-consistency-rules']) && schema['x-consistency-rules'].length > 0
}

function hasCompletenessRules(schema) {
  if (!schema || typeof schema !== 'object') return false
  const props = schema.properties || {}
  return Object.values(props).some(p =>
    p && (p['x-min-content-length'] !== undefined || p['x-min-items'] !== undefined)
  )
}

function computeStrengthScore(inputSchema, outputSchema) {
  let score = 0
  const breakdown = {}

  if (countTypedFields(inputSchema) >= 3) {
    score += 20
    breakdown.input_typed_fields = 20
  } else {
    breakdown.input_typed_fields = 0
  }

  if (countTypedFields(outputSchema) >= 3) {
    score += 20
    breakdown.output_typed_fields = 20
  } else {
    breakdown.output_typed_fields = 0
  }

  const rangeCheck = hasRangeConstraint(inputSchema) || hasRangeConstraint(outputSchema)
  if (rangeCheck) {
    score += 15
    breakdown.range_constraint = 15
  } else {
    breakdown.range_constraint = 0
  }

  const enumCheck = hasEnumOrPattern(inputSchema) || hasEnumOrPattern(outputSchema)
  if (enumCheck) {
    score += 15
    breakdown.enum_or_pattern = 15
  } else {
    breakdown.enum_or_pattern = 0
  }

  if (hasConsistencyRules(outputSchema)) {
    score += 15
    breakdown.consistency_rules = 15
  } else {
    breakdown.consistency_rules = 0
  }

  if (hasCompletenessRules(outputSchema)) {
    score += 15
    breakdown.completeness_rules = 15
  } else {
    breakdown.completeness_rules = 0
  }

  return { score, breakdown }
}

module.exports = { computeStrengthScore }
