/**
 * Signal Extractor — derives routing signals from a raw chat request
 * without making any LLM calls. All operations are synchronous and cheap (~1ms).
 *
 * Signals:
 *   totalTokens         — character-based estimate of full payload size
 *   hasImages           — true if any message content includes image_url / image parts
 *   hasToolCalls        — true if tools/tool_choice are present in the request
 *   conversationTurns   — number of user messages in history
 *   detectedDomains     — ['security', 'legal', 'medical', 'finance'] based on keyword scan
 *   detectedLanguages   — ['python', 'sql', 'solidity', ...] based on pattern scan
 *   systemPromptText    — first 1000 chars of system message (for role detection)
 *   lastUserMessage     — first 800 chars of last user message
 *   metadataSummary     — compact string injected into classifier prompt
 */

// ── Domain keyword lists ───────────────────────────────────────────────────────

const SECURITY_KEYWORDS = [
  'private key', 'secret key', 'api key', 'password', 'credential',
  'jwt', 'token', 'bearer', 'oauth', 'vulnerability', 'exploit',
  'cve-', 'sql injection', 'xss', 'csrf', 'buffer overflow',
  'cryptograph', 'encrypt', 'decrypt', 'certificate', '-----begin',
  'authorization', 'privilege escalation', 'rce', 'sandbox escape',
];

const LEGAL_KEYWORDS = [
  'gdpr', 'ccpa', 'compliance', 'regulation', 'nda', 'non-disclosure',
  'liability', 'indemnif', 'intellectual property', 'copyright', 'trademark',
  'jurisdiction', 'contract clause', 'article ', 'governing law',
  'data processing agreement', 'dpa', 'legal entity',
];

const MEDICAL_KEYWORDS = [
  'diagnosis', 'icd-', 'treatment', 'medication', 'symptoms', 'clinical trial',
  'patient', 'disease', 'syndrome', 'dosage', 'prescription', 'pathology',
  'differential diagnosis', 'adverse effect', 'contraindication',
];

const FINANCE_KEYWORDS = [
  'balance sheet', 'income statement', 'cash flow', 'ebitda', 'p&l',
  'audit', 'tax return', 'valuation', 'roi', 'hedge fund', 'derivative',
  'quarterly earnings', 'fiscal year', 'amortization', 'depreciation',
];

// ── FIM / Autocomplete detection ──────────────────────────────────────────────
// Patterns sourced from Continue.dev AutocompleteTemplate.ts and common FIM model formats.
// System-prompt patterns (any → autocomplete)
const FIM_SYSTEM_PROMPT_PATTERNS = [
  /\bhole\s+filler\b/i,
  /\bfill.{0,20}middle\b/i,
  /\bfim\b/i,
  /\bcode\s+completion\b/i,
  /\bautocomplete\b/i,
  /\bfill\s+in\s+the\s+blank/i,
  /\bfill\s+the\s+hole\b/i,
  /completion\s+(AI|assistant|model)/i,
  /\binline\s+(completion|suggestion)\b/i,
  /\{\{HOLE\}\}/,            // Continue.dev HoleFiller template literal
];
// Message-content FIM tokens (any → autocomplete)
const FIM_CONTENT_TOKENS = [
  '<fim_prefix>', '<fim_suffix>', '<fim_middle>',        // StarCoder / Qwen / Starcoder2
  '<|fim_begin|>', '<|fim_hole|>', '<|fim_end|>',        // SantaCoder
  '<fim▁prefix>', '<fim▁suffix>', '<fim▁middle>',        // DeepSeek
  '<|fim▁begin|>', '<|fim▁hole|>', '<|fim▁end|>',
  '<PRE>', '<SUF>', '<MID>',                              // CodeLlama
  '[PREFIX]', '[SUFFIX]', '[MIDDLE]',                    // Mistral / Codestral
  '<|prefix|>', '<|suffix|>', '<|middle|>',              // some Ollama models
  '<FILL_ME>', '<FILL>',                                 // generic
  '// END', '<｜fim▁begin｜>', '<｜fim▁hole｜>',         // DeepSeek alt encoding
  '{{HOLE}}', '◊',                                       // Continue.dev HoleFiller
  '<CURSOR>', '<cursor>',                                 // cursor-style completions
];

// Detect bare code-block-only messages (e.g. ```JAVA\ncode...```) — typically
// IDE autocomplete / inline-edit requests that don't use FIM tokens.
const BARE_CODE_BLOCK_RE = /^```[A-Za-z]*\s*\n[\s\S]+$/;

function detectFimRequest(systemText, messages) {
  if (FIM_SYSTEM_PROMPT_PATTERNS.some(rx => rx.test(systemText))) return true;
  // Some clients (e.g. OpenCode) embed the instruction in the first user turn
  // rather than a dedicated system message — check that too.
  const firstUser = messages.find(m => m.role === 'user');
  const firstUserText = firstUser ? extractText(firstUser.content) : '';
  if (firstUserText && FIM_SYSTEM_PROMPT_PATTERNS.some(rx => rx.test(firstUserText))) return true;
  const allContent = messages.map(m => extractText(m.content)).join('\n');
  if (FIM_CONTENT_TOKENS.some(tok => allContent.includes(tok))) return true;

  // Heuristic: single-turn request where the ONLY user message is a raw code block
  // (no natural language), indicating an inline code completion / edit request.
  const userMsgs = messages.filter(m => m.role === 'user');
  if (userMsgs.length === 1 && firstUserText && BARE_CODE_BLOCK_RE.test(firstUserText.trimStart())) {
    // Must have very little prose outside the code block — check no sentences
    const outsideCode = firstUserText.replace(/```[\s\S]*?```/g, '').trim();
    if (outsideCode.length < 20) return true;
  }
  return false;
}

// ── Tool-agent / agentic system prompt detection ──────────────────────────────
// These are coding tool agents (file search, code edit, etc.) that use tools heavily.
// Detected by their system prompt role description.
const TOOL_AGENT_SYSTEM_PROMPT_PATTERNS = [
  /\bfile\s+search\s+specialist\b/i,
  /\bcode\s+(editor|editing)\s+(AI|assistant|agent)\b/i,
  /\bsoftware\s+engineer(ing)?\s+(AI|assistant|agent)\b/i,
  /\bagentic\s+(coding|development)\b/i,
  /\bexpert\s+software\s+engineer\b/i,
  /you\s+(are|excel)\s+at\s+.*\b(glob|grep|search|navigate)\b.*codebase/i,
  /\bthoroughly\s+navigating\s+and\s+exploring\s+codebases\b/i,
  // Generic agent-mode frameworks (Cursor, Windsurf, OpenCode custom agents, etc.)
  /\bin\s+agent\s+mode\b/i,                        // "You are in agent mode"
  /\bagent\s+mode\b.*\btool/i,                      // "agent mode" + "tool"
  /<tool_use_instructions>/i,                        // XML tool block
  /TOOL_NAME:\s*(read_file|create_new_file|run_terminal_command)/,  // tool codec syntax
  /\byou\s+have\s+access\s+to\s+.*\btools\b/i,      // "You have access to several tools"
];

function detectToolAgentRequest(systemText, messages) {
  // Check system prompt for known agent patterns
  if (TOOL_AGENT_SYSTEM_PROMPT_PATTERNS.some(rx => rx.test(systemText))) return true;
  // Check first user message for agent patterns
  const firstUser = messages.find(m => m.role === 'user');
  const firstUserText = firstUser ? extractText(firstUser.content) : '';
  if (firstUserText && TOOL_AGENT_SYSTEM_PROMPT_PATTERNS.some(rx => rx.test(firstUserText))) return true;
  // Structural detection: any tool role, tool_calls, or tool_result content blocks → agentic
  for (const m of messages) {
    if (m.role === 'tool') return true;
    if (m.tool_calls?.length > 0) return true;
    if (Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' || b.type === 'tool_use' || b.type === 'tool_use_result')) return true;
  }
  return false;
}

// ── Code language patterns ─────────────────────────────────────────────────────

const CODE_LANGUAGE_PATTERNS = {
  python:     [/\bdef \w+\s*\(/, /\bimport \w+/, /from \w+ import/, /\.py\b/],
  javascript: [/\bfunction \w+\s*\(/, /const \w+ =/, /=>\s*[{(]/, /require\(/],
  typescript: [/interface \w+\s*\{/, /type \w+ =/, /: \w+\[\]/, /\.ts\b/],
  sql:        [/\bSELECT\b.*\bFROM\b/i, /\bCREATE TABLE\b/i, /\bINSERT INTO\b/i, /\bALTER TABLE\b/i],
  go:         [/\bfunc \w+\s*\(/, /\bpackage \w+/, /:=/, /\.go\b/],
  rust:       [/\bfn \w+\s*\(/, /\blet mut\b/, /\bimpl\b/, /\.rs\b/],
  solidity:   [/pragma solidity/, /contract \w+\s*\{/, /\bmapping\s*\(/, /\.sol\b/],
  bash:       [/#!\/bin\/(bash|sh)/, /\$\{?\w+\}?/, /\|\s*(grep|awk|sed)/],
  docker:     [/^FROM \w+/m, /^RUN \w+/m, /^EXPOSE \d+/m, /^WORKDIR/m],
  yaml:       [/^---\s*$/m, /^\w[\w-]*:\s*$/m, /^  - \w/m],
  terraform:  [/\bresource "\w+" "\w+"/, /\bprovider "\w+"/, /\.tf\b/],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(p => p.type === 'text')
      .map(p => p.text || '')
      .join(' ');
  }
  return String(content);
}

function estimateTokens(text) {
  if (!text) return 0;
  // Code blocks are denser — ~1 char per token; prose ~3.5 chars per token
  const codeChars  = (text.match(/```[\s\S]*?```/g) || []).join('').length;
  const proseChars = text.length - codeChars;
  return Math.ceil(proseChars / 3.5) + Math.ceil(codeChars / 1.5);
}

function countKeywordMatches(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter(k => lower.includes(k.toLowerCase())).length;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} chatRequest — raw OpenAI-format request body
 * @returns {object} signals
 */
export function extractSignals(chatRequest) {
  const messages = chatRequest.messages || [];

  const systemMsg     = messages.find(m => m.role === 'system');
  const userMessages  = messages.filter(m => m.role === 'user');
  const lastUserMsg   = userMessages[userMessages.length - 1];

  const systemText   = systemMsg ? extractText(systemMsg.content) : '';
  const lastUserText = lastUserMsg ? extractText(lastUserMsg.content) : '';
  const allText      = messages.map(m => extractText(m.content)).join('\n');

  // Token estimation across all messages
  let totalTokens = 0;
  for (const m of messages) {
    totalTokens += estimateTokens(extractText(m.content)) + 4; // role overhead
  }

  // Multimodal
  const hasImages = messages.some(m =>
    Array.isArray(m.content) &&
    m.content.some(c => c.type === 'image_url' || c.type === 'image')
  );

  // Tool use
  const hasToolCalls = !!(chatRequest.tools?.length || chatRequest.tool_choice);

  // Conversation depth — count only genuine user messages, not tool results
  // Tool results often arrive as role:"user" (e.g. "[Tool result for ...]") or role:"tool"
  const genuineUserMessages = userMessages.filter(m => {
    const text = extractText(m.content);
    return !(/^\[?tool (result|output) for\s/i.test(text.trimStart()))
        && !(/^tool_call_result/i.test(text.trimStart()));
  });
  const conversationTurns = genuineUserMessages.length;

  // Domain + language detection: use ONLY the latest user message (+ system prompt for context).
  // Using allText would bleed previous turns' topics into the current classification — e.g.
  // a prior "test" (→ smalltalk) would prevent "write hello world in java" from being coded correctly.
  const classifyText = lastUserText + (systemText ? '\n' + systemText : '');

  // Domain keyword detection
  const detectedDomains = [];
  if (countKeywordMatches(classifyText, SECURITY_KEYWORDS) >= 2) detectedDomains.push('security');
  if (countKeywordMatches(classifyText, LEGAL_KEYWORDS) >= 1)    detectedDomains.push('legal');
  if (countKeywordMatches(classifyText, MEDICAL_KEYWORDS) >= 1)  detectedDomains.push('medical');
  if (countKeywordMatches(classifyText, FINANCE_KEYWORDS) >= 1)  detectedDomains.push('finance');

  // Code language detection
  const detectedLanguages = [];
  for (const [lang, patterns] of Object.entries(CODE_LANGUAGE_PATTERNS)) {
    if (patterns.some(p => p.test(classifyText))) detectedLanguages.push(lang);
  }

  // FIM / autocomplete detection — checked before domain/language for early exit
  const isFimRequest = detectFimRequest(systemText, messages);

  // Tool-agent detection (file search, code editor agents, etc.)
  const isToolAgentRequest = !isFimRequest && detectToolAgentRequest(systemText, messages);

  // Tool-output continuation: last user message is NOT a new human intent.
  // Detects tool results, code-fence file dumps from agents, IDE context injections.
  const lastTrimmed = lastUserText.trimStart();
  const isToolOutputContinuation = (() => {
    // Tool result prefixes (Anthropic, OpenAI, generic)
    if (/^(Tool output for|tool_result|tool_call_result|Result of|Output of)/i.test(lastTrimmed)) return true;
    // XML tool result blocks
    if (/^(<tool_result|<function_results|<result>)/i.test(lastTrimmed)) return true;
    // Code-fence file dump from agent (```filename or ```lang\n followed by file content)
    if (/^```[\w./\\]/.test(lastTrimmed)) return true;
    // IDE launch command (Java, Node, Python classpath)
    if (/^"?[A-Z]:\\.*\\(java|javaw|node|python)\.exe/i.test(lastTrimmed)) return true;
    // IDE context injection
    if (/^(This is the currently open file:|Use the above (code|context|file))/i.test(lastTrimmed)) return true;
    // Shell prompt: (env) |git:branch|date|path:$ command
    if (/^\([\w.-]+\)\s*\|git:/.test(lastTrimmed)) return true;
    // Shell output / path listing: /repos/... or /home/... or /usr/...
    if (/^\/[\w/.-]+\.(py|js|ts|yaml|yml|json|sh|go|rs|java|c|cpp|h|rb|log|cfg|conf|toml|xml|csv)/.test(lastTrimmed)) return true;
    if (/^\/repos\//.test(lastTrimmed)) return true;
    // "Output:" followed by shell content
    if (/^Output:\s*\(/i.test(lastTrimmed)) return true;
    // Content blocks with tool_result type (already checked structurally)
    const lastUser = messages.filter(m => m.role === 'user').pop();
    if (lastUser && Array.isArray(lastUser.content)) {
      if (lastUser.content.some(b => b.type === 'tool_result' || b.type === 'tool_use_result')) return true;
    }
    if (lastUser?.tool_call_id) return true;
    return false;
  })();

  // Compact metadata summary for classifier prompt injection
  const metadataSummary = [
    `tokens≈${totalTokens}`,
    isFimRequest              ? 'fim_autocomplete'          : null,
    isToolAgentRequest        ? 'tool_agent'                : null,
    isToolOutputContinuation  ? 'tool_output_continuation'  : null,
    hasImages                 ? 'has_images'                : null,
    hasToolCalls              ? 'has_tools'                 : null,
    conversationTurns > 1     ? `turns=${conversationTurns}` : null,
    detectedDomains.length    ? `domains=[${detectedDomains.join(',')}]` : null,
    detectedLanguages.length  ? `langs=[${detectedLanguages.join(',')}]` : null,
  ].filter(Boolean).join(', ');

  return {
    totalTokens,
    hasImages,
    hasToolCalls,
    conversationTurns,
    detectedDomains,
    detectedLanguages,
    isFimRequest,
    isToolAgentRequest,
    isToolOutputContinuation,
    systemPromptText: systemText.slice(0, 1000),
    lastUserMessage: lastUserText.slice(0, 800),
    metadataSummary,
  };
}

/**
 * Apply a RoutingRuleSet's pre-routing rules to extracted signals.
 * Returns { tier, category, domain, confidence, source } or null if
 * confidence is below the classifier threshold.
 *
 * @param {object} signals — from extractSignals()
 * @param {object} ruleSet — RoutingRuleSet document (plain object)
 * @returns {{ tier, category, domain, confidence, source, preRouted: bool }}
 */
export function applyRuleSet(signals, ruleSet) {
  const result = {
    tier: null,
    category: null,
    domain: null,
    confidence: 0,
    source: null,
    preRouted: false,
  };

  const thr = ruleSet.tokenThresholds || {};
  const weights = ruleSet.signalWeights || {};
  const confThreshold = ruleSet.classifier?.confidenceThreshold ?? 0.65;

  // ── Content type signals (highest confidence) ─────────────────────────────
  if (signals.hasImages) {
    result.confidence = Math.max(result.confidence, 0.95 * (weights.codeLanguage ?? 0.7));
    // Tier upgrade is handled by existing visionUpgrade override — just flag it
  }

  // ── Always-high token threshold (hint only — never bypasses classifier) ──
  if (thr.alwaysHigh && signals.totalTokens >= thr.alwaysHigh) {
    result.tier       = 'high';
    result.confidence = Math.max(result.confidence, 0.4); // hint only
    result.source     = 'token_threshold_high';
  }

  // ── System prompt role matching ───────────────────────────────────────────
  // System prompt roles are HINTS — they inform the classifier but never bypass it.
  // Confidence is capped at 0.5 (below confThreshold 0.65) so preRouted stays false.
  if (signals.systemPromptText && ruleSet.systemPromptRoles?.length) {
    for (const role of ruleSet.systemPromptRoles) {
      if (!role.enabled) continue;
      try {
        const rx = new RegExp(role.pattern, 'i');
        if (rx.test(signals.systemPromptText)) {
          const conf = Math.min(weights.systemPromptRole ?? 0.9, 0.5);
          if (conf > result.confidence) {
            result.confidence = conf;
            result.source = `system_prompt_role:${role.name}`;
            if (role.effect.category) result.category = role.effect.category;
            if (role.effect.tierMin)  result.tier = applyTierMin(result.tier, role.effect.tierMin);
            if (role.effect.tierMax)  result.tier = applyTierMax(result.tier, role.effect.tierMax);
            if (role.effect.domain)   result.domain = role.effect.domain;
          }
        }
      } catch { /* invalid regex — skip */ }
    }
  }

  // ── Keyword rules ─────────────────────────────────────────────────────────
  if (ruleSet.keywordRules?.length) {
    const textMap = {
      all:    signals.lastUserMessage + ' ' + signals.systemPromptText,
      user:   signals.lastUserMessage,
      system: signals.systemPromptText,
    };

    for (const rule of ruleSet.keywordRules) {
      if (!rule.enabled || !rule.keywords?.length) continue;
      const text = (textMap[rule.searchIn] || textMap.all).toLowerCase();
      const hits = rule.keywords.filter(k => text.includes(k.toLowerCase()));
      const required = rule.match === 'all' ? rule.keywords.length : (rule.minMatches ?? 1);
      if (hits.length >= required) {
        const conf = (weights.contentKeywords ?? 0.85);
        if (conf > result.confidence) {
          result.confidence = conf;
          result.source = `keyword_rule:${rule.name}`;
          if (rule.effect.category) result.category = rule.effect.category;
          if (rule.effect.tierMin)  result.tier = applyTierMin(result.tier, rule.effect.tierMin);
          if (rule.effect.tierMax)  result.tier = applyTierMax(result.tier, rule.effect.tierMax);
          if (rule.effect.domain)   result.domain = rule.effect.domain;
        }
      }
    }
  }

  // ── Token tier thresholds (hint only — classifier is the primary decision maker)
  if (!result.tier) {
    const tokenConf = (weights.tokenCount ?? 0.8) * 0.35; // low confidence — never bypasses classifier alone
    if (thr.micro != null && signals.totalTokens <= thr.micro) {
      if (tokenConf > result.confidence) { result.tier = 'micro'; result.confidence = tokenConf; result.source = 'token_threshold'; }
    } else if (thr.minimal != null && signals.totalTokens <= thr.minimal) {
      if (tokenConf > result.confidence) { result.tier = 'minimal'; result.confidence = tokenConf; result.source = 'token_threshold'; }
    } else if (thr.low != null && signals.totalTokens <= thr.low) {
      if (tokenConf > result.confidence) { result.tier = 'low'; result.confidence = tokenConf; result.source = 'token_threshold'; }
    } else if (thr.medium != null && signals.totalTokens <= thr.medium) {
      if (tokenConf > result.confidence) { result.tier = 'medium'; result.confidence = tokenConf; result.source = 'token_threshold'; }
    } else if (signals.totalTokens > (thr.medium ?? 15000)) {
      // Large context: advanced tier (token count alone never escalates to high/ultra/critical)
      if (tokenConf > result.confidence) { result.tier = 'advanced'; result.confidence = tokenConf; result.source = 'token_threshold'; }
    }
  }

  // ── Detected domain as a signal ───────────────────────────────────────────
  if (!result.domain && signals.detectedDomains.length) {
    result.domain = signals.detectedDomains[0];
  }

  // ── Turn upgrade modifier ─────────────────────────────────────────────────
  if (ruleSet.turnUpgrade?.enabled && signals.conversationTurns >= (ruleSet.turnUpgrade.threshold ?? 4)) {
    result.tier = upgradeTier(result.tier);
  }

  result.preRouted = result.confidence >= confThreshold;
  return result;
}

// ── Tier helpers ──────────────────────────────────────────────────────────────

const TIERS = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];

function applyTierMin(current, minimum) {
  const ci = TIERS.indexOf(current);
  const mi = TIERS.indexOf(minimum);
  if (mi < 0) return current;
  if (ci < 0) return minimum;
  return TIERS[Math.max(ci, mi)];
}

function applyTierMax(current, maximum) {
  const ci = TIERS.indexOf(current);
  const mi = TIERS.indexOf(maximum);
  if (mi < 0) return current;
  if (ci < 0) return maximum;
  return TIERS[Math.min(ci, mi)];
}

function upgradeTier(tier) {
  const i = TIERS.indexOf(tier);
  if (i < 0 || i >= TIERS.length - 1) return tier;
  return TIERS[i + 1];
}

/**
 * Build a classifier prompt context string respecting a context limit.
 * strategy:
 *   'metadata_only' — inject only the metadata summary, no message content
 *   'truncate'      — include last user message + system prompt up to limit
 *   'summary'       — falls back to truncate (summary needs extra model call)
 */
export function buildClassifierContext(chatRequest, signals, strategy, limitTokens) {
  const metaLine = `[CONTEXT_SIGNALS: ${signals.metadataSummary}]`;

  if (strategy === 'metadata_only') {
    return metaLine;
  }

  // truncate / summary (summary falls back to truncate)
  const limit = limitTokens ?? 4000;
  const parts = [];

  if (signals.systemPromptText) {
    const maxSys = Math.floor(limit * 0.3);
    const sysSlice = signals.systemPromptText.slice(0, maxSys * 3.5);
    parts.push(`[System]: ${sysSlice}${sysSlice.length < signals.systemPromptText.length ? '…' : ''}`);
  }

  // Include up to last 3 non-system messages
  const nonSystem = (chatRequest.messages || []).filter(m => m.role !== 'system').slice(-3);
  let usedTokens = estimateTokens(parts.join('\n'));
  for (const m of nonSystem) {
    const text = extractText(m.content);
    const remaining = (limit - usedTokens) * 3.5;
    if (remaining < 50) break;
    const slice = text.slice(0, remaining);
    parts.push(`[${m.role}]: ${slice}${slice.length < text.length ? '…' : ''}`);
    usedTokens += estimateTokens(slice);
  }

  parts.push(metaLine);
  return parts.join('\n');
}
