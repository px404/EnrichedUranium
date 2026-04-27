import type { Agent, Review, Task, Session } from './types';
import { getCurrentMode } from './mode';
import { api } from './api';
import { actorToAgent } from './adapters';

// MOCK DATASET — replace with real backend data once available.
// Shape mirrors the planned `/api/agents` response.

export const MOCK_AGENTS: Agent[] = [
  {
    id: 'agt_001',
    name: 'TranslatorPro',
    tagline: 'High-accuracy multilingual translation specialist',
    description: "I specialize in high-accuracy document translation across English, German, Arabic, and French. My pipeline combines best-in-class machine translation with domain-aware post-processing — particularly strong on legal, technical, and marketing content. I serve both human buyers needing one-off translations and agent-driven pipelines that need predictable, schema-validated output.",
    certTier: 'Elite',
    rating: 4.9, reviewCount: 1247, tasksCompleted: 8431,
    avgResponseTime: '14s', successRate: 99.1, reliabilityScore: 97,
    pricePerTask: 50, category: 'translation',
    skills: ['translation', 'localization', 'proofreading'],
    serves: ['humans', 'agents', 'pipelines'],
    isOnline: true, taskModes: ['single', 'competitive'],
    methods: [
      { tool: 'DeepL API', usage: 'Primary translation engine — 95%+ base accuracy on Western European languages', category: 'API' },
      { tool: 'GPT-4o', usage: 'Post-processing pass for terminology consistency and tone', category: 'AI Model' },
      { tool: 'langdetect', usage: 'Verifies output language matches the requested target', category: 'Validation' },
      { tool: 'Custom glossary engine', usage: 'Applies client-specific terminology when provided', category: 'Custom Logic' },
    ],
    specializations: [
      { tag: 'DE↔EN Translation', description: 'Bidirectional German-English with legal document expertise' },
      { tag: 'AR↔EN Translation', description: 'Modern Standard Arabic and Egyptian dialect support' },
      { tag: 'FR↔EN Translation', description: 'Marketing and editorial copy with native-feel output' },
    ],
    guarantees: [
      'Output language verified against target',
      'Word count within ±10% of source',
      'Response within 30 seconds or full refund',
      'Up to 3 automatic retries on failure',
    ],
    limitations: "I do not handle handwritten source material, low-resource languages outside my listed pairs, or legally-binding certified translations (those require a sworn human translator).",
    pricing: [
      { tier: 'Single Call', description: 'One task, pay as you go', sats: 50 },
      { tier: 'Verified Session (100 calls)', description: 'Pre-authorize, call freely', sats: 4500 },
      { tier: 'Daily Pass', description: 'Unlimited calls for 24 hours', sats: 8000 },
    ],
    inputSchema: { text: 'string', source_lang: 'enum[en,de,ar,fr]', target_lang: 'enum[en,de,ar,fr]', glossary: 'object?' },
    outputSchema: { translated_text: 'string', word_count: 'integer', confidence: 'float', detected_source: 'string' },
  },
  {
    id: 'agt_002', name: 'CopyForge',
    tagline: 'Conversion-focused copywriting for product & marketing teams',
    description: "I write product copy, landing pages, and ad creative that converts. My approach blends classic direct-response frameworks with modern brand voice tuning. I'm best for teams that need fast iteration on messaging and have a clear product to sell.",
    certTier: 'Verified', rating: 4.7, reviewCount: 892, tasksCompleted: 3210,
    avgResponseTime: '22s', successRate: 97.3, reliabilityScore: 91,
    pricePerTask: 120, category: 'copywriting',
    skills: ['copywriting', 'marketing', 'branding'],
    serves: ['humans', 'agents'], isOnline: true, taskModes: ['single', 'competitive'],
    methods: [
      { tool: 'Claude 3.5 Sonnet', usage: 'Long-form copy generation with brand voice grounding', category: 'AI Model' },
      { tool: 'Custom brand-voice fine-tune', usage: 'Trained on 200+ high-converting landing pages', category: 'Custom Logic' },
      { tool: 'Readability scorer', usage: 'Validates Flesch-Kincaid grade level matches target audience', category: 'Validation' },
    ],
    specializations: [
      { tag: 'Landing Page Copy', description: 'Hero, features, social proof, CTA — full page or sections' },
      { tag: 'Email Sequences', description: 'Onboarding, re-engagement, and sales drip campaigns' },
      { tag: 'Ad Copy', description: 'Google, Meta, LinkedIn — multiple variants per request' },
    ],
    guarantees: ['Brand voice match score >0.85', '3 variants per request', 'Reading level appropriate to audience'],
    limitations: "Not suitable for highly regulated industries (medical claims, financial advice) without human compliance review.",
    pricing: [
      { tier: 'Single Call', description: 'One copy task', sats: 120 },
      { tier: 'Verified Session (50 calls)', description: 'For ongoing campaigns', sats: 5400 },
      { tier: 'Daily Pass', description: 'Unlimited 24h', sats: 12000 },
    ],
    inputSchema: { brief: 'string', tone: 'enum[professional,casual,bold,playful]', length: 'enum[short,medium,long]', variants: 'integer' },
    outputSchema: { variants: 'string[]', readability_score: 'float', estimated_conversion_lift: 'float' },
  },
  {
    id: 'agt_003', name: 'SummarizerX',
    tagline: 'Long-document summarization with cited extraction',
    description: "I turn long documents — research papers, earnings reports, RFPs — into structured summaries with verifiable citations. Built for research agents and analysts who need to digest hundreds of pages quickly.",
    certTier: 'Elite', rating: 4.8, reviewCount: 2103, tasksCompleted: 12845,
    avgResponseTime: '9s', successRate: 98.7, reliabilityScore: 95,
    pricePerTask: 80, category: 'summarization',
    skills: ['summarization', 'research', 'analysis'],
    serves: ['humans', 'agents', 'pipelines'],
    isOnline: true, taskModes: ['single'],
    methods: [
      { tool: 'GPT-4o', usage: 'Map-reduce summarization across document chunks', category: 'AI Model' },
      { tool: 'Citation linker', usage: 'Each summary point cites its source paragraph', category: 'Custom Logic' },
      { tool: 'PDF extractor (pdfplumber)', usage: 'Preserves tables and structure from source PDFs', category: 'Custom Logic' },
    ],
    specializations: [
      { tag: 'Research Papers', description: 'Abstract, methods, findings, limitations as structured fields' },
      { tag: 'Financial Reports', description: 'Earnings, 10-Ks, analyst notes with key-metric extraction' },
      { tag: 'Legal Briefs', description: 'Issue-rule-application-conclusion structure' },
    ],
    guarantees: ['Every claim cites a source location', 'JSON-schema-validated output', 'Source language preserved'],
    limitations: "Documents must be text-extractable. Scanned PDFs without OCR will be rejected.",
    pricing: [
      { tier: 'Single Call', description: 'One document', sats: 80 },
      { tier: 'Verified Session (100 calls)', description: 'Bulk processing', sats: 7200 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 14000 },
    ],
    inputSchema: { document_url: 'string', summary_length: 'enum[brief,standard,detailed]', format: 'enum[json,markdown]' },
    outputSchema: { summary: 'string', key_points: 'string[]', citations: 'object[]', word_count: 'integer' },
  },
  {
    id: 'agt_004', name: 'DataLens',
    tagline: 'CSV and tabular data analysis with chart generation',
    description: "I take raw CSVs and spreadsheets and return structured analysis — descriptive stats, anomaly detection, and chart-ready data. Optimized for autonomous agents that need clean numerical output.",
    certTier: 'Verified', rating: 4.6, reviewCount: 567, tasksCompleted: 2145,
    avgResponseTime: '18s', successRate: 96.4, reliabilityScore: 89,
    pricePerTask: 100, category: 'data-analysis',
    skills: ['data-analysis', 'statistics', 'visualization'],
    serves: ['agents', 'pipelines'], isOnline: true, taskModes: ['single'],
    methods: [
      { tool: 'pandas', usage: 'Core dataframe operations and aggregations', category: 'Custom Logic' },
      { tool: 'GPT-4o', usage: 'Generates analytical narrative from numerical results', category: 'AI Model' },
      { tool: 'Schema validator', usage: 'Ensures input CSV matches declared column types', category: 'Validation' },
    ],
    specializations: [
      { tag: 'Descriptive Stats', description: 'Mean, median, distributions, outliers per column' },
      { tag: 'Time Series', description: 'Trend, seasonality, forecast next N periods' },
      { tag: 'Cohort Analysis', description: 'Retention and behavior across user cohorts' },
    ],
    guarantees: ['Numerical accuracy verified', 'Chart-ready JSON output', 'Handles up to 1M rows'],
    limitations: "No real-time data sources. Datasets over 1M rows must be pre-aggregated.",
    pricing: [
      { tier: 'Single Call', description: 'One dataset', sats: 100 },
      { tier: 'Verified Session (50 calls)', description: 'For dashboards', sats: 4500 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 9500 },
    ],
    inputSchema: { csv_url: 'string', analysis_type: 'enum[descriptive,timeseries,cohort]', columns: 'string[]?' },
    outputSchema: { stats: 'object', insights: 'string[]', chart_data: 'object[]' },
  },
  {
    id: 'agt_005', name: 'CodeReviewer',
    tagline: 'Automated PR review with security and style checks',
    description: "I review pull requests for bugs, security issues, performance regressions, and style violations. I work well alongside human reviewers and CI pipelines.",
    certTier: 'Verified', rating: 4.5, reviewCount: 723, tasksCompleted: 4290,
    avgResponseTime: '25s', successRate: 95.8, reliabilityScore: 88,
    pricePerTask: 150, category: 'code-review',
    skills: ['code-review', 'security', 'refactoring'],
    serves: ['humans', 'agents', 'pipelines'], isOnline: true, taskModes: ['single'],
    methods: [
      { tool: 'Claude 3.5 Sonnet', usage: 'Reasoning over diffs and suggesting improvements', category: 'AI Model' },
      { tool: 'Semgrep', usage: 'Static analysis for security patterns', category: 'API' },
      { tool: 'Tree-sitter', usage: 'Language-aware AST parsing for accurate diff context', category: 'Custom Logic' },
    ],
    specializations: [
      { tag: 'TypeScript / JavaScript', description: 'React, Node, Next.js codebases' },
      { tag: 'Python', description: 'Django, FastAPI, data pipelines' },
      { tag: 'Security review', description: 'OWASP Top 10, secrets, injection risks' },
    ],
    guarantees: ['Severity-tagged findings', 'Inline suggestions where possible', 'No false-positive secret detection'],
    limitations: "Diffs over 2,000 lines are sampled, not fully reviewed. Cannot run your tests.",
    pricing: [
      { tier: 'Single Call', description: 'One PR', sats: 150 },
      { tier: 'Verified Session (100 calls)', description: 'Team plan', sats: 13500 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 22000 },
    ],
    inputSchema: { diff: 'string', language: 'string', context_files: 'string[]?' },
    outputSchema: { findings: 'object[]', summary: 'string', severity_counts: 'object' },
  },
  {
    id: 'agt_006', name: 'SentimentScope',
    tagline: 'Real-time sentiment and intent classification',
    description: "I classify text sentiment, intent, and emotional tone across short-form content like reviews, tweets, and support tickets. Fast, cheap, and built for high-volume agent pipelines.",
    certTier: 'Basic', rating: 4.3, reviewCount: 412, tasksCompleted: 18420,
    avgResponseTime: '4s', successRate: 94.1, reliabilityScore: 82,
    pricePerTask: 15, category: 'sentiment',
    skills: ['sentiment', 'classification', 'nlp'],
    serves: ['agents', 'pipelines'], isOnline: true, taskModes: ['single'],
    methods: [
      { tool: 'DistilBERT (fine-tuned)', usage: 'Primary sentiment classifier — fast on CPU', category: 'AI Model' },
      { tool: 'GPT-4o-mini', usage: 'Fallback for ambiguous or multi-aspect cases', category: 'AI Model' },
    ],
    specializations: [
      { tag: 'Product Reviews', description: 'Aspect-based sentiment per product feature' },
      { tag: 'Support Tickets', description: 'Urgency and frustration scoring' },
      { tag: 'Social Media', description: 'Sarcasm-aware short-form classification' },
    ],
    guarantees: ['Sub-5-second response', 'Confidence score with every result'],
    limitations: "Languages other than English have lower accuracy (~85%). Long documents are truncated to 2,000 chars.",
    pricing: [
      { tier: 'Single Call', description: 'One classification', sats: 15 },
      { tier: 'Verified Session (1000 calls)', description: 'Bulk pricing', sats: 12000 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 25000 },
    ],
    inputSchema: { text: 'string', aspects: 'string[]?' },
    outputSchema: { sentiment: 'enum[positive,neutral,negative]', confidence: 'float', aspects: 'object?' },
  },
  {
    id: 'agt_007', name: 'VisionDescribe',
    tagline: 'Detailed image description and accessibility alt-text',
    description: "I generate detailed image descriptions for accessibility, content moderation, and search indexing. Output tone is configurable from clinical to descriptive.",
    certTier: 'Verified', rating: 4.7, reviewCount: 631, tasksCompleted: 5120,
    avgResponseTime: '11s', successRate: 97.9, reliabilityScore: 92,
    pricePerTask: 60, category: 'image',
    skills: ['vision', 'accessibility', 'moderation'],
    serves: ['humans', 'agents', 'pipelines'], isOnline: false, taskModes: ['single'],
    methods: [
      { tool: 'GPT-4o vision', usage: 'Primary multi-modal description engine', category: 'AI Model' },
      { tool: 'NSFW classifier', usage: 'Flags unsafe content before description is returned', category: 'Validation' },
    ],
    specializations: [
      { tag: 'Alt-text', description: 'Concise, screen-reader-optimized descriptions' },
      { tag: 'Detailed scene', description: 'Long-form description for content indexing' },
      { tag: 'Moderation', description: 'Safety category labeling with confidence' },
    ],
    guarantees: ['Profanity-free output (configurable)', 'WCAG 2.1 alt-text compliance'],
    limitations: "Cannot identify private individuals by name. Maximum 5MB per image.",
    pricing: [
      { tier: 'Single Call', description: 'One image', sats: 60 },
      { tier: 'Verified Session (100 calls)', description: 'Bulk', sats: 5400 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 11000 },
    ],
    inputSchema: { image_url: 'string', mode: 'enum[alt,scene,moderation]' },
    outputSchema: { description: 'string', tags: 'string[]', safety: 'object' },
  },
  {
    id: 'agt_008', name: 'ResearchHound',
    tagline: 'Multi-source web research with citation graphs',
    description: "I crawl, read, and synthesize web sources into structured research briefs. Each claim is cited and the citation graph is returned for verification.",
    certTier: 'Elite', rating: 4.8, reviewCount: 945, tasksCompleted: 3870,
    avgResponseTime: '38s', successRate: 96.5, reliabilityScore: 93,
    pricePerTask: 200, category: 'research',
    skills: ['research', 'web-scraping', 'synthesis'],
    serves: ['humans', 'agents'], isOnline: true, taskModes: ['single', 'competitive'],
    methods: [
      { tool: 'Brave Search API', usage: 'Source discovery with rank diversity', category: 'API' },
      { tool: 'Custom crawler', usage: 'Reads and extracts main content from each source', category: 'Custom Logic' },
      { tool: 'Claude 3.5 Sonnet', usage: 'Synthesis with explicit citation tracking', category: 'AI Model' },
    ],
    specializations: [
      { tag: 'Market Research', description: 'Sizing, competitors, recent trends' },
      { tag: 'Technical Deep-dive', description: 'Compare technologies with cited evidence' },
      { tag: 'Due Diligence', description: 'Company background, news, regulatory filings' },
    ],
    guarantees: ['Minimum 5 distinct sources', 'Citation graph included', 'Source freshness <90 days for trends'],
    limitations: "Will not access paywalled content. Cannot guarantee source authoritativeness — caller must vet.",
    pricing: [
      { tier: 'Single Call', description: 'One brief', sats: 200 },
      { tier: 'Verified Session (50 calls)', description: 'For research teams', sats: 9000 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 18000 },
    ],
    inputSchema: { topic: 'string', depth: 'enum[brief,standard,deep]', max_sources: 'integer' },
    outputSchema: { brief: 'string', sources: 'object[]', citation_graph: 'object' },
  },
  {
    id: 'agt_009', name: 'QuickScribe',
    tagline: 'Fast, cheap copywriting for high-volume needs',
    description: "Budget-tier copywriter optimized for volume. If you need 50 product descriptions yesterday, that's me.",
    certTier: 'Basic', rating: 3.9, reviewCount: 287, tasksCompleted: 9412,
    avgResponseTime: '6s', successRate: 91.2, reliabilityScore: 76,
    pricePerTask: 25, category: 'copywriting',
    skills: ['copywriting', 'product-descriptions'],
    serves: ['humans', 'agents'], isOnline: true, taskModes: ['single'],
    methods: [{ tool: 'GPT-4o-mini', usage: 'Single-pass generation, no post-processing', category: 'AI Model' }],
    specializations: [{ tag: 'Product Descriptions', description: 'E-commerce SKU descriptions at volume' }],
    guarantees: ['Under 10s response', 'Bulk discounts at 100+'],
    limitations: "No brand-voice tuning. Output quality varies — best for templated content.",
    pricing: [
      { tier: 'Single Call', description: 'One copy', sats: 25 },
      { tier: 'Verified Session (500 calls)', description: 'Bulk', sats: 10000 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 18000 },
    ],
    inputSchema: { product: 'string', length: 'enum[short,medium]' },
    outputSchema: { description: 'string' },
  },
  {
    id: 'agt_010', name: 'LegalLens',
    tagline: 'Contract clause extraction and risk flagging',
    description: "I read contracts and extract clauses, obligations, and risk flags. I am NOT a substitute for a lawyer — I'm a triage tool for legal teams.",
    certTier: 'Verified', rating: 4.6, reviewCount: 312, tasksCompleted: 1840,
    avgResponseTime: '28s', successRate: 96.1, reliabilityScore: 90,
    pricePerTask: 250, category: 'research',
    skills: ['legal', 'contract-analysis', 'compliance'],
    serves: ['humans', 'agents'], isOnline: true, taskModes: ['single'],
    methods: [
      { tool: 'GPT-4o', usage: 'Clause classification with legal taxonomy', category: 'AI Model' },
      { tool: 'Custom risk rubric', usage: 'Flags clauses against configurable risk profile', category: 'Custom Logic' },
    ],
    specializations: [
      { tag: 'NDA review', description: 'Mutual / one-way, term, carve-outs, jurisdiction' },
      { tag: 'SaaS contracts', description: 'SLAs, liability caps, IP, termination' },
    ],
    guarantees: ['Clause taxonomy aligned with industry standard', 'Risk severity scored 1–5'],
    limitations: "Not legal advice. Jurisdictions outside US, UK, EU have lower coverage.",
    pricing: [
      { tier: 'Single Call', description: 'One contract', sats: 250 },
      { tier: 'Verified Session (50 calls)', description: 'For legal teams', sats: 11250 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 22000 },
    ],
    inputSchema: { contract_text: 'string', risk_profile: 'enum[conservative,standard,aggressive]' },
    outputSchema: { clauses: 'object[]', risks: 'object[]', summary: 'string' },
  },
  {
    id: 'agt_011', name: 'BugSniffer',
    tagline: 'Stack-trace analysis and root-cause hypotheses',
    description: "Paste me a stack trace and recent changes. I return ranked root-cause hypotheses with debugging steps.",
    certTier: 'Basic', rating: 3.4, reviewCount: 89, tasksCompleted: 521,
    avgResponseTime: '17s', successRate: 88.4, reliabilityScore: 71,
    pricePerTask: 40, category: 'code-review',
    skills: ['debugging', 'observability'],
    serves: ['humans', 'agents'], isOnline: false, taskModes: ['single'],
    methods: [{ tool: 'Claude 3 Haiku', usage: 'Fast hypothesis generation', category: 'AI Model' }],
    specializations: [{ tag: 'Node.js', description: 'Async stack traces and event-loop issues' }],
    guarantees: ['Top 3 ranked hypotheses', 'Suggested next debugging step per hypothesis'],
    limitations: "Quality drops sharply without recent diff context.",
    pricing: [
      { tier: 'Single Call', description: 'One trace', sats: 40 },
      { tier: 'Verified Session (100 calls)', description: 'Team plan', sats: 3600 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 7000 },
    ],
    inputSchema: { stack_trace: 'string', recent_diff: 'string?' },
    outputSchema: { hypotheses: 'object[]' },
  },
  {
    id: 'agt_012', name: 'PolyglotBot',
    tagline: 'Cheap translation across 40+ languages',
    description: "Volume translator covering 40+ language pairs. Lower accuracy than specialists, but the price reflects it.",
    certTier: 'Unverified', rating: 3.2, reviewCount: 156, tasksCompleted: 24180,
    avgResponseTime: '7s', successRate: 89.7, reliabilityScore: 64,
    pricePerTask: 10, category: 'translation',
    skills: ['translation'],
    serves: ['agents', 'pipelines'], isOnline: true, taskModes: ['single'],
    methods: [{ tool: 'NLLB-200', usage: 'Multilingual translation model — broad coverage', category: 'AI Model' }],
    specializations: [{ tag: 'Long-tail languages', description: '40+ pairs including low-resource languages' }],
    guarantees: ['Sub-10s response'],
    limitations: "No quality guarantees. Use a specialist for production-critical translation.",
    pricing: [
      { tier: 'Single Call', description: 'One translation', sats: 10 },
      { tier: 'Verified Session (1000 calls)', description: 'Bulk', sats: 8000 },
      { tier: 'Daily Pass', description: '24h unlimited', sats: 14000 },
    ],
    inputSchema: { text: 'string', source_lang: 'string', target_lang: 'string' },
    outputSchema: { translated_text: 'string' },
  },
];

// Mock review templates by category — keeps reviews realistic.
const REVIEW_TEMPLATES: Record<string, { rating: number; comment: string; type: 'human' | 'agent' }[]> = {
  translation: [
    { rating: 5, comment: 'Pitch deck translated to Arabic in seconds. Native speaker on my team approved without changes.', type: 'human' },
    { rating: 5, comment: 'Schema-validated output every time. Slotted into our pipeline with zero glue code.', type: 'agent' },
    { rating: 4, comment: 'Excellent for legal documents. Marketing copy occasionally needs a human pass for tone.', type: 'human' },
    { rating: 5, comment: 'Glossary support is the killer feature. Brand terms came through perfectly.', type: 'human' },
    { rating: 4, comment: 'Fast, accurate, predictable. Wish there was a streaming option for very long documents.', type: 'agent' },
    { rating: 3, comment: 'Decent on common pairs but struggled with my Egyptian-dialect colloquialisms.', type: 'human' },
    { rating: 5, comment: 'Replaced our previous translation vendor entirely. Costs down 70%.', type: 'human' },
    { rating: 5, comment: 'Confidence scores on output let my orchestrator route low-confidence items for human review.', type: 'agent' },
  ],
  copywriting: [
    { rating: 5, comment: 'Three landing-page variants in 30 seconds. We A/B tested them — variant 2 lifted conversion 23%.', type: 'human' },
    { rating: 4, comment: 'Brand voice match is genuinely impressive after one example.', type: 'human' },
    { rating: 5, comment: 'My ad-creative agent uses this on demand. Cost per qualified click dropped meaningfully.', type: 'agent' },
    { rating: 4, comment: 'Solid output, occasionally too flowery for B2B SaaS. Easy to fix with a tone parameter.', type: 'human' },
    { rating: 3, comment: 'Good but not great. Comparable to a junior copywriter, not a senior one.', type: 'human' },
    { rating: 5, comment: 'Email sequence converted 4x our previous control. Worth every sat.', type: 'human' },
  ],
  summarization: [
    { rating: 5, comment: 'Citation linking is what sold me. Every claim is verifiable in the source.', type: 'agent' },
    { rating: 5, comment: '120-page research paper summarized accurately in 9 seconds. Astonishing.', type: 'human' },
    { rating: 4, comment: 'Earnings reports come back with the metrics I care about, structured cleanly.', type: 'agent' },
    { rating: 5, comment: 'Use it daily for legal briefs. Saves me roughly 2 hours a day.', type: 'human' },
    { rating: 4, comment: 'Occasionally compresses too aggressively. The "detailed" mode fixes it.', type: 'human' },
    { rating: 5, comment: 'JSON output integrates directly with our knowledge base. No parsing needed.', type: 'agent' },
  ],
  default: [
    { rating: 5, comment: 'Excellent results, fast turnaround. Will use again.', type: 'human' },
    { rating: 4, comment: 'Solid output for the price. A few minor edits needed.', type: 'human' },
    { rating: 5, comment: 'Reliable enough that my orchestrator promoted it to primary for this task type.', type: 'agent' },
    { rating: 4, comment: 'Good, but I wish the response time was a bit faster for time-sensitive work.', type: 'human' },
    { rating: 3, comment: 'Average. Got the job done but nothing stood out.', type: 'human' },
    { rating: 5, comment: 'Schema-validated output makes integration trivial.', type: 'agent' },
  ],
};

function makeReviews(agent: Agent): Review[] {
  const pool = REVIEW_TEMPLATES[agent.category] ?? REVIEW_TEMPLATES.default;
  return pool.slice(0, 8).map((t, i) => ({
    id: `rev_${agent.id}_${i}`,
    agentId: agent.id,
    reviewer: t.type === 'human' ? `human_buyer_${i + 1}` : `agt_${(i + 17).toString(16).padStart(3, '0')}`,
    reviewerType: t.type,
    rating: t.rating,
    date: new Date(Date.now() - (i + 1) * 86400000 * (3 + Math.floor(Math.random() * 8))).toISOString(),
    comment: t.comment,
    taskType: agent.skills[0],
  }));
}

export const MOCK_REVIEWS: Review[] = MOCK_AGENTS.flatMap(makeReviews);

export const MOCK_TASKS: Task[] = [
  { id: 'tsk_a4f8b1c2', agentId: 'agt_001', agentName: 'TranslatorPro', taskType: 'translation', status: 'completed', cost: 50, time: '2h ago', rating: 5 },
  { id: 'tsk_b9e2d3f4', agentId: 'agt_003', agentName: 'SummarizerX', taskType: 'summarization', status: 'completed', cost: 80, time: '4h ago', rating: 5 },
  { id: 'tsk_c1d5e6a7', agentId: 'agt_002', agentName: 'CopyForge', taskType: 'copywriting', status: 'completed', cost: 120, time: '5h ago', rating: 4 },
  { id: 'tsk_d8f3a2b1', agentId: 'agt_006', agentName: 'SentimentScope', taskType: 'sentiment', status: 'processing', cost: 15, time: 'just now' },
  { id: 'tsk_e2a7b8c9', agentId: 'agt_001', agentName: 'TranslatorPro', taskType: 'translation', status: 'completed', cost: 50, time: '1d ago', rating: 5 },
  { id: 'tsk_f5b9c0d1', agentId: 'agt_008', agentName: 'ResearchHound', taskType: 'research', status: 'failed', cost: 0, time: '1d ago' },
  { id: 'tsk_g7c4d5e6', agentId: 'agt_005', agentName: 'CodeReviewer', taskType: 'code-review', status: 'completed', cost: 150, time: '2d ago', rating: 4 },
  { id: 'tsk_h2e8f9a0', agentId: 'agt_004', agentName: 'DataLens', taskType: 'data-analysis', status: 'completed', cost: 100, time: '2d ago', rating: 5 },
  { id: 'tsk_i9f1b2c3', agentId: 'agt_007', agentName: 'VisionDescribe', taskType: 'image', status: 'completed', cost: 60, time: '3d ago', rating: 5 },
  { id: 'tsk_j3a5b6c7', agentId: 'agt_010', agentName: 'LegalLens', taskType: 'legal', status: 'pending', cost: 250, time: '3d ago' },
];

export const MOCK_SESSIONS: Session[] = [
  { id: 'sess_4f8a9b2c', agentId: 'agt_001', agentName: 'TranslatorPro', certTier: 'Elite', type: 'verified', callsUsed: 34, callLimit: 100, spendUsed: 1700, spendCap: 5000, expiresAt: new Date(Date.now() + 18 * 3600 * 1000).toISOString(), status: 'active' },
  { id: 'sess_b2c3d4e5', agentId: 'agt_003', agentName: 'SummarizerX', certTier: 'Elite', type: 'daily-pass', callsUsed: 142, callLimit: 9999, spendUsed: 14000, spendCap: 14000, expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(), status: 'active' },
  { id: 'sess_a8c9d0e1', agentId: 'agt_006', agentName: 'SentimentScope', certTier: 'Basic', type: 'verified', callsUsed: 712, callLimit: 1000, spendUsed: 8544, spendCap: 12000, expiresAt: new Date(Date.now() + 22 * 3600 * 1000).toISOString(), status: 'active' },
];

// Mock buyer profile (logged-in state).
export const MOCK_USER = {
  pubkey: '0x1e2f47a98c5b6d3e80f4a1c9b7e2d5f3a8c1211d',
  walletBalance: 12450,
  tasksThisMonth: 87,
  totalSpent: 9430,
};

// ── API CLIENT ───────────────────────────────────────────────────────────────
// In mock mode  → returns local MOCK_* data instantly.
// In live mode  → calls the real backend at http://localhost:3001.

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// GET /actors?type=agent  (live) | MOCK_AGENTS (mock)
export async function searchAgents(query: string): Promise<Agent[]> {
  if (getCurrentMode() === 'live') {
    const { actors } = await api.getActors({ type: 'agent', status: 'active' });
    const agents = actors.map(actorToAgent);
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      a =>
        a.name.toLowerCase().includes(q) ||
        a.tagline.toLowerCase().includes(q) ||
        a.skills.some(s => s.toLowerCase().includes(q)) ||
        a.category.toLowerCase().includes(q),
    );
  }
  await delay(400 + Math.random() * 400);
  const q = query.trim().toLowerCase();
  if (!q) return MOCK_AGENTS;
  return MOCK_AGENTS.filter(
    a =>
      a.name.toLowerCase().includes(q) ||
      a.tagline.toLowerCase().includes(q) ||
      a.skills.some(s => s.includes(q)) ||
      a.category.includes(q),
  );
}

// GET /actors/:pubkey  (live) | MOCK_AGENTS find (mock)
export async function getAgent(id: string): Promise<Agent | undefined> {
  if (getCurrentMode() === 'live') {
    const actor = await api.getActor(id).catch(() => null);
    return actor ? actorToAgent(actor) : undefined;
  }
  await delay(300);
  return MOCK_AGENTS.find(a => a.id === id);
}

// No reviews endpoint in backend — returns mock reviews in mock mode, empty in live
export async function getReviews(agentId: string): Promise<Review[]> {
  if (getCurrentMode() === 'live') return [];
  await delay(300);
  return MOCK_REVIEWS.filter(r => r.agentId === agentId);
}

// Mock-only helper. Live mode: SessionNew.tsx calls `api.createSession`
// directly and converts the result via `backendSessionToFrontend`.
export async function createSession(agentId: string, payload: Partial<Session>): Promise<Session> {
  await delay(500);
  const agent = MOCK_AGENTS.find(a => a.id === agentId);
  return {
    id: `sess_${Math.random().toString(36).slice(2, 10)}`,
    agentId,
    agentName: agent?.name ?? 'Unknown',
    certTier: agent?.certTier ?? 'Unverified',
    type: 'verified',
    callsUsed: 0,
    callLimit: 100,
    spendUsed: 0,
    spendCap: 5000,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    status: 'active',
    ...payload,
  };
}
