import RoutingCategory from '../models/RoutingCategory.js';

const BUILT_IN_CATEGORIES = [
  // ── MICRO TIER — purely mechanical, sub-second tasks ─────────────────────────
  { key: 'coding_autocomplete',    name: 'Code Autocomplete / FIM',      costTier: 'micro',    description: 'Fill-in-the-middle (FIM) code completions, inline suggestions, autocomplete. Purely mechanical — no reasoning required.', examples: ['Complete the function body', 'Fill in the missing code', 'Inline suggestion'], order: 1, targetSystemPrompt: '' },
  { key: 'chat_title_generation',  name: 'Chat Title Generation',         costTier: 'micro',    description: 'Generate a short title or label for a conversation (2–5 words). Trivial regardless of conversation content.', examples: ['Generate a title for this chat', 'Reply with a 3-word title', 'What should I call this conversation?'], order: 2, targetSystemPrompt: '' },

  // ── MINIMAL TIER — simple, fast tasks ────────────────────────────────────────
  { key: 'smalltalk_simple',       name: 'Smalltalk & Simple Questions',  costTier: 'minimal',  examples: ['Hallo!', "Wie geht's?", 'Danke'], order: 10 },
  { key: 'translation',            name: 'Translation',                   costTier: 'minimal',  examples: ['Translate to English', 'Was heißt bonjour?'], order: 11 },
  { key: 'summarization_short',    name: 'Short Summarization',           costTier: 'minimal',  examples: ['Summarize this paragraph', 'Key points (< 2000 chars)'], order: 12 },
  { key: 'classification_extraction', name: 'Classification & Extraction', costTier: 'minimal', examples: ['Extract all names', 'Is this positive or negative?'], order: 13 },
  { key: 'creative_writing_short', name: 'Short Creative Writing',        costTier: 'minimal',  examples: ['Write a tweet', 'Product tagline'], order: 14 },
  { key: 'vision_simple',          name: 'Simple Vision',                 costTier: 'minimal',  examples: ['What does this image show?', 'Read text on screenshot'], requiresVision: true, order: 15 },
  { key: 'email_professional',     name: 'Professional Email',            costTier: 'minimal',  examples: ['Rewrite email', 'Reply to customer'], order: 16 },
  { key: 'brainstorming',          name: 'Brainstorming & Ideation',      costTier: 'minimal',  description: 'Creative brainstorming, idea generation, quick suggestions', examples: ['10 startup ideas', 'Blog topics for DevOps', 'Names for a product'], order: 17 },
  { key: 'proofreading',           name: 'Proofreading & Grammar',        costTier: 'minimal',  description: 'Spelling, grammar, punctuation, and style correction', examples: ['Fix grammar errors', 'Improve sentence flow', 'Correct typos'], order: 18 },
  { key: 'format_convert',         name: 'Format & Convert',              costTier: 'minimal',  description: 'Format conversion between structured data formats', examples: ['JSON to YAML', 'Markdown to HTML', 'XML to CSV'], order: 19 },

  // ── LOW TIER — standard structured tasks ─────────────────────────────────────
  { key: 'summarization_long',     name: 'Long Summarization',            costTier: 'low',      examples: ['Summarize 10-page report', 'Meeting minutes (text >= 2000)'], order: 20 },
  { key: 'analysis_simple',        name: 'Simple Analysis',               costTier: 'low',      examples: ['Pro/con comparison', 'Compare two options'], order: 21 },
  { key: 'math_simple',            name: 'Simple Math',                   costTier: 'low',      examples: ['Calculate compound interest', 'Solve equation'], order: 22 },
  { key: 'fact_check_verification',name: 'Fact Check & Verification',     costTier: 'low',      examples: ['Is this claim correct?', 'Verify this information'], order: 23 },
  { key: 'conversation_roleplay',  name: 'Conversation & Roleplay',       costTier: 'low',      examples: ['Play customer advisor', 'Simulate interview'], order: 24 },
  { key: 'coding_simple',          name: 'Simple Coding',                 costTier: 'low',      examples: ['Python sort function', 'RegEx for email (< 30 lines)'], order: 25, targetSystemPrompt: 'You are an expert software engineer. Write clean, idiomatic code. Be concise — show the solution, not a lecture.' },
  { key: 'coding_medium',          name: 'Medium Coding',                 costTier: 'medium',   examples: ['Code review', 'Write unit tests', 'Fix bug'], order: 26, targetSystemPrompt: 'You are an expert software engineer. Prefer idiomatic code, call out edge cases, and include minimal but complete examples. When reviewing code, focus on correctness and maintainability.' },
  { key: 'sql_generation',         name: 'SQL Generation',                costTier: 'low',      examples: ['Write SQL query', 'JOINs across 3 tables'], order: 27 },
  { key: 'data_transformation',    name: 'Data Transformation',           costTier: 'low',      examples: ['CSV to JSON', 'Normalize data'], order: 28 },
  { key: 'instruction_following',  name: 'Instruction Following',         costTier: 'low',      description: 'Tasks requiring precise multi-step instruction adherence', examples: ['Follow this exact format', 'Apply these 5 rules to each item', 'Fill in the template'], order: 29 },
  { key: 'function_calling',       name: 'Function Calling & Structured Output', costTier: 'low', description: 'Generate structured JSON/tool call outputs from natural language', examples: ['Extract fields as JSON', 'Call the search_web function', 'Return typed object'], order: 30 },
  { key: 'devops_infrastructure',  name: 'DevOps & Infrastructure',       costTier: 'medium',   description: 'CI/CD configs, Dockerfiles, Kubernetes manifests, shell scripts', examples: ['Write a Dockerfile', 'GitHub Actions workflow', 'Helm chart values'], order: 31 },
  { key: 'qa_testing',             name: 'QA & Test Writing',             costTier: 'medium',   description: 'Test cases, QA scripts, test plans, assertions', examples: ['Write Playwright test', 'Unit test for this function', 'Test plan for login flow'], order: 32 },
  { key: 'code_explanation',       name: 'Code Explanation',              costTier: 'low',      description: 'Explain what code does — reading/understanding only, no generation or modification', examples: ['What does this function do?', 'Explain this algorithm', 'Walk me through this class'], order: 33 },
  { key: 'error_debugging',        name: 'Error & Debug Analysis',        costTier: 'medium',   description: 'Analyzing error messages, stack traces, and runtime failures to identify root cause', examples: ['Why does this throw a NullPointerException?', 'Analyze this stack trace', 'What does this error mean?'], order: 34, targetSystemPrompt: 'You are a senior debugging specialist. Analyze the error systematically: identify root cause, explain why it happens, and provide a concrete fix. If the stack trace points to a library issue, say so.' },

  // ── MEDIUM TIER — real coding, debugging, multi-step tasks (qwen3-coder-30b class) ──
  { key: 'creative_writing_long',  name: 'Long Creative Writing',         costTier: 'medium',   examples: ['1000-word blog post', 'Product story', 'Whitepaper'], order: 40 },
  { key: 'tool_use_agentic',       name: 'Tool Use & Agentic',            costTier: 'medium',   examples: ['Orchestrate API calls', 'Autonomous research'], order: 41 },
  { key: 'vision_complex',         name: 'Complex Vision',                costTier: 'medium',   examples: ['Analyze chart trends', 'Evaluate architecture diagram'], requiresVision: true, order: 42 },
  { key: 'document_qa',            name: 'Document Q&A',                  costTier: 'medium',   examples: ['Question about PDF', 'Explain contract clause'], order: 43 },
  { key: 'planning_scheduling',    name: 'Planning & Scheduling',         costTier: 'medium',   examples: ['Create project plan', 'Sprint planning'], order: 44 },
  { key: 'prompt_engineering',     name: 'Prompt Engineering',            costTier: 'medium',   examples: ['Improve system prompt', 'Create few-shot examples'], order: 45 },
  { key: 'multilingual_complex',   name: 'Complex Multilingual',          costTier: 'medium',   examples: ['Localization with cultural context', 'Simultaneous translation'], order: 46 },
  { key: 'data_analysis',          name: 'Data Analysis & Statistics',    costTier: 'medium',   description: 'Statistical analysis, pattern detection, data interpretation', examples: ['Analyze sales trends', 'Find anomalies in dataset', 'Interpret A/B test results'], order: 47 },
  { key: 'stem_science',           name: 'STEM & Science',                costTier: 'medium',   description: 'Physics, chemistry, biology, engineering problem solving', examples: ['Explain quantum entanglement', 'Calculate reaction kinetics', 'Solve thermodynamics problem'], order: 48 },
  { key: 'api_integration',        name: 'API & Integration Design',      costTier: 'medium',   description: 'API design, OpenAPI specs, integration patterns, webhooks', examples: ['Design REST API for e-commerce', 'OpenAPI spec for auth service', 'Webhook integration guide'], order: 49 },

  // ── ADVANCED TIER — deep reasoning & complex coding (qwen3-235b class) ───────
  { key: 'analysis_complex',       name: 'Complex Analysis',              costTier: 'advanced', examples: ['Go-to-market strategy', 'Market analysis'], order: 60 },
  { key: 'coding_complex',         name: 'Complex Coding',                costTier: 'advanced', examples: ['Architecture design', 'Refactoring', 'Complex bug fix'], order: 61, targetSystemPrompt: 'You are a principal-level software engineer. Think through architecture trade-offs, consider scalability and maintainability, and write production-grade code. Call out potential pitfalls before they become problems.' },
  { key: 'math_complex',           name: 'Complex Math',                  costTier: 'advanced', examples: ['Optimization with constraints', 'Linear algebra proof'], order: 62 },
  { key: 'reasoning_deep',         name: 'Deep Reasoning',                costTier: 'advanced', examples: ['Multi-step logic puzzle', 'Complex ethical reasoning'], order: 63 },
  { key: 'long_context_processing',name: 'Long Context Processing',       costTier: 'advanced', description: 'Tasks requiring 50k+ token context windows (large codebases, long documents)', examples: ['Analyze this 200-page report', 'Review entire codebase', 'Summarize long meeting transcript'], order: 64 },
  { key: 'system_design',          name: 'System Design',                 costTier: 'advanced', examples: ['Architecture for 1M users', 'Tech stack decision'], order: 65, targetSystemPrompt: 'You are a systems architect. Consider scalability, reliability, cost, and operational complexity. Use diagrams or structured lists when they clarify trade-offs. Be opinionated — recommend a concrete path, not just options.' },
  { key: 'research_scientific',    name: 'Scientific Research',           costTier: 'advanced', examples: ['Analyze 3 papers for contradictions', 'Research design'], order: 66 },
  { key: 'legal_analysis',         name: 'Legal Analysis',                costTier: 'advanced', description: 'Legal questions, contract analysis, compliance, regulatory interpretation', examples: ['Review NDA clause', 'GDPR compliance check', 'Liability assessment'], order: 67, targetSystemPrompt: 'You are a careful legal analyst. Cite jurisdiction where relevant and explicitly flag when a question requires a licensed attorney. Distinguish between general legal information and specific legal advice.' },
  { key: 'financial_analysis',     name: 'Financial Analysis',            costTier: 'advanced', description: 'Financial modeling, investment analysis, portfolio evaluation, risk assessment', examples: ['DCF valuation', 'Portfolio risk', 'P&L interpretation'], order: 68 },

  // ── HIGH TIER — frontier intelligence (Sonnet 4.6 / GPT-5.2 class) ───────────
  { key: 'swe_agentic',            name: 'Agentic Software Engineering',  costTier: 'high',     description: 'Autonomous multi-step software engineering (entire features, refactors, bug triage)', examples: ['Implement full CRUD feature', 'Autonomous bug fix across files', 'Refactor module with tests'], order: 70, targetSystemPrompt: 'You are an autonomous software engineering agent. Plan before coding, break complex tasks into steps, write tests alongside implementation, and verify your own output. Prefer small, reviewable changes over monolithic rewrites.' },
  { key: 'code_security_review',   name: 'Security & Code Audit',         costTier: 'high',     description: 'Security vulnerability detection, threat modeling, SAST-style review', examples: ['Find SQL injection vulnerabilities', 'Threat model for auth system', 'OWASP audit of codebase'], order: 71 },
  { key: 'vision_critical',        name: 'Critical Vision',               costTier: 'high',     examples: ['Medical image analysis', 'Technical drawing review'], requiresVision: true, order: 72 },

  // ── ULTRA TIER — maximum reasoning (Opus 4.6 / GPT-5.3 Codex class) ──────────
  { key: 'reasoning_formal',       name: 'Formal Reasoning & Proofs',     costTier: 'ultra',    description: 'Formal logic, mathematical proofs, deductive reasoning chains', examples: ['Prove correctness of algorithm', 'Formal verification', 'Complex logic puzzle'], order: 80 },

  // ── CRITICAL TIER — highest stakes, no quality compromise ────────────────────
  { key: 'sensitive_critical',     name: 'Sensitive & Critical',          costTier: 'critical', examples: ['Legal contract review', 'Tax implications'], order: 90, targetSystemPrompt: 'This request has been classified as sensitive or critical. Prioritize accuracy over speed. State your confidence level, flag assumptions, and recommend human review for high-stakes decisions.' },
  { key: 'medical_analysis',       name: 'Medical & Clinical Analysis',   costTier: 'critical', description: 'Clinical analysis, medical literature, diagnoses, drug interactions — requires high accuracy', examples: ['Drug interaction check', 'Differential diagnosis', 'Clinical trial interpretation'], order: 91, targetSystemPrompt: 'You are a medical information assistant. Cite sources and evidence levels where possible. Always include the disclaimer that your output is informational, not a substitute for professional medical advice, and recommend consulting a qualified healthcare provider for clinical decisions.' },
];

/**
 * Seed built-in categories.
 * Uses upsert so tier assignments stay in sync with code when the system is upgraded.
 * Admin customisations on non-built-in fields (defaultModel, examples, etc.) are
 * preserved — only `costTier`, `name`, `description`, `order`, and `isBuiltIn` are
 * synced from the seed data.
 */
export async function seedCategories() {
  let created = 0;
  let updated = 0;

  for (const cat of BUILT_IN_CATEGORIES) {
    const existing = await RoutingCategory.findOne({ key: cat.key });
    if (existing) {
      // Sync tier + metadata but preserve any admin-set defaultModel / fallbackModel.
      // targetSystemPrompt is seeded ONCE (only when no admin value exists yet) so
      // an admin's customisation on an existing category is never overwritten.
      const changed = existing.costTier !== cat.costTier
        || existing.name !== cat.name
        || existing.order !== cat.order;
      if (changed) {
        await RoutingCategory.updateOne(
          { key: cat.key },
          { $set: { costTier: cat.costTier, name: cat.name, order: cat.order,
                    ...(cat.description ? { description: cat.description } : {}),
                    ...(!existing.targetSystemPrompt && cat.targetSystemPrompt ? { targetSystemPrompt: cat.targetSystemPrompt } : {}),
                    isBuiltIn: true } }
        );
        updated++;
      }
    } else {
      await RoutingCategory.create({ ...cat, isBuiltIn: true });
      created++;
    }
  }

  return { created, updated, total: BUILT_IN_CATEGORIES.length };
}
