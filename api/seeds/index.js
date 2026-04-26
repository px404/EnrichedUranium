const { getDb, prepare, save } = require('../db/database')
const now = Math.floor(Date.now() / 1000)

const TEMPLATES = [
  {
    capability_tag: 'weather-data', display_name: 'Weather Data',
    description: 'Returns current weather conditions for a given location.',
    input_schema: { type:'object', required:['location','units'], properties: {
      location: { type:'string', minLength:2, maxLength:100 },
      units:    { type:'string', enum:['metric','imperial'] },
      fields:   { type:'array', items:{ type:'string', enum:['temperature','humidity','wind_speed','conditions'] } }
    }, additionalProperties:false },
    output_schema: { type:'object', required:['location_resolved','temperature','timestamp_unix'], properties: {
      location_resolved: { type:'string', minLength:2 },
      temperature:       { type:'number', minimum:-90, maximum:60 },
      humidity:          { type:'number', minimum:0, maximum:100 },
      wind_speed:        { type:'number', minimum:0 },
      conditions:        { type:'string', enum:['clear','cloudy','rain','snow','fog','storm'] },
      units:             { type:'string', enum:['metric','imperial'] },
      timestamp_unix:    { type:'integer' }
    }, additionalProperties:false,
    'x-consistency-rules': ['timestamp_unix MUST BE within 300s of request time'],
    'x-min-content-length': { location_resolved: 2 } }
  },
  {
    capability_tag: 'text-summarization', display_name: 'Text Summarization',
    description: 'Summarizes a body of text to a target word count.',
    input_schema: { type:'object', required:['text','max_words'], properties: {
      text:      { type:'string', minLength:50, maxLength:50000 },
      max_words: { type:'integer', minimum:10, maximum:1000 },
      language:  { type:'string', enum:['en','de','fr','es','it','pt'] },
      style:     { type:'string', enum:['bullet','paragraph','headline'] }
    }, additionalProperties:false },
    output_schema: { type:'object', required:['summary','word_count','reduction_ratio'], properties: {
      summary:         { type:'string', minLength:10, 'x-min-content-length':10 },
      word_count:      { type:'integer', minimum:1, maximum:1000 },
      reduction_ratio: { type:'number', minimum:0, maximum:1 },
      language:        { type:'string', enum:['en','de','fr','es','it','pt'] }
    }, additionalProperties:false,
    'x-consistency-rules':['word_count MUST equal word count of summary','word_count MUST be <= max_words'] }
  },
  {
    capability_tag: 'translation', display_name: 'Translation',
    description: 'Translates text from one language to another.',
    input_schema: { type:'object', required:['text','source_lang','target_lang'], properties: {
      text:        { type:'string', minLength:1, maxLength:10000 },
      source_lang: { type:'string', enum:['en','de','fr','es','it','pt','auto'] },
      target_lang: { type:'string', enum:['en','de','fr','es','it','pt'] },
      formality:   { type:'string', enum:['formal','informal'] }
    }, additionalProperties:false },
    output_schema: { type:'object', required:['translated_text','source_lang_detected','target_lang'], properties: {
      translated_text:      { type:'string', minLength:1, 'x-min-content-length':1 },
      source_lang_detected: { type:'string', enum:['en','de','fr','es','it','pt'] },
      target_lang:          { type:'string', enum:['en','de','fr','es','it','pt'] },
      confidence:           { type:'number', minimum:0, maximum:1 }
    }, additionalProperties:false,
    'x-consistency-rules':['target_lang in output MUST match target_lang in input'] }
  }
]

;(async () => {
  await getDb()
  console.log('Seeding platform templates...\n')
  for (const t of TEMPLATES) {
    const exists = prepare('SELECT capability_tag FROM schemas WHERE capability_tag = ?').get(t.capability_tag)
    if (exists) { console.log(`  SKIP   ${t.capability_tag}`); continue }
    prepare('INSERT INTO schemas (capability_tag, display_name, description, input_schema, output_schema, strength_score, is_platform_template, created_at) VALUES (?,?,?,?,?,100,1,?)')
      .run(t.capability_tag, t.display_name, t.description, JSON.stringify(t.input_schema), JSON.stringify(t.output_schema), now)
    console.log(`  SEEDED ${t.capability_tag}`)
  }
  console.log('\nDone.')
  process.exit(0)
})()
