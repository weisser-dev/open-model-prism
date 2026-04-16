/**
 * Quality Service — scores LLM response quality using lightweight heuristics.
 * No external dependencies; all checks run synchronously in-process.
 *
 * @module qualityService
 */

// ── Refusal patterns (case-insensitive) ───────────────────────────────────────

const REFUSAL_PATTERNS = [
  "i can't",
  "i'm unable",
  "i cannot",
  "i'm not able",
  "as an ai",
  "i don't have the ability",
  "i apologize, but i",
  "i'm sorry, but i can't",
];

// ── Error indicator patterns (case-insensitive) ──────────────────────────────

const ERROR_PATTERNS = [
  'error occurred',
  'something went wrong',
  'internal server error',
  'failed to',
  'undefined',
  'null',
];

// ── Language word sets ────────────────────────────────────────────────────────

const LANGUAGE_WORDS = {
  de: ['der', 'die', 'das', 'und', 'ist', 'ein'],
  en: ['the', 'is', 'are', 'and', 'for', 'with'],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip code blocks (triple-backtick fenced) from content so that
 * error-pattern detection only fires on prose.
 *
 * @param {string} text
 * @returns {string}
 */
function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

/**
 * Extract the last user message text from a chat request.
 *
 * @param {object} chatRequest
 * @returns {string}
 */
function getLastUserMessage(chatRequest) {
  const messages = chatRequest?.messages;
  if (!Array.isArray(messages)) return '';

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content;
      if (typeof content === 'string') return content;
      // Handle multi-part content arrays (text parts)
      if (Array.isArray(content)) {
        return content
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join(' ');
      }
      return '';
    }
  }
  return '';
}

/**
 * Try to locate and parse a JSON value inside a string.
 * Looks for the first `{` or `[` and attempts a balanced parse.
 *
 * @param {string} text
 * @returns {boolean} true if valid JSON was found
 */
function containsValidJson(text) {
  const startIdx = text.search(/[{[]/);
  if (startIdx === -1) return false;

  // Walk forward looking for balanced braces / brackets
  const opener = text[startIdx];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;

  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer) depth--;

    if (depth === 0) {
      try {
        JSON.parse(text.slice(startIdx, i + 1));
        return true;
      } catch {
        // Not valid — keep scanning for another candidate
        return false;
      }
    }
  }
  return false;
}

// ── Signal scorers ──────────────────────────────────────────────────────────

/**
 * Score completeness based on finish reason.
 * @param {string|undefined} finishReason
 * @returns {{ score: number, detail: string }}
 */
function scoreCompleteness(finishReason) {
  if (finishReason === 'stop') return { score: 25, detail: 'normal completion' };
  if (finishReason === 'length') return { score: 10, detail: 'truncated (length)' };
  return { score: 15, detail: `unknown finish reason: ${finishReason ?? 'none'}` };
}

/**
 * Score response length adequacy against the routing estimate.
 * @param {string} responseContent
 * @param {object|undefined} routingResult
 * @returns {{ score: number, detail: string }}
 */
function scoreLengthAdequacy(responseContent, routingResult) {
  const estimated = routingResult?.estimatedOutputLength;
  if (!estimated) return { score: 15, detail: 'no estimate available' };

  const len = responseContent.length;

  const ranges = {
    short:  { min: 0,   max: 500  },
    medium: { min: 200, max: 2000 },
    long:   { min: 500, max: Infinity },
  };

  const range = ranges[estimated];
  if (!range) return { score: 15, detail: `unrecognised estimate: ${estimated}` };

  if (len >= range.min && len <= range.max) {
    return { score: 20, detail: `length ${len} within ${estimated} range` };
  }

  // Too short — proportional scoring
  if (len < range.min) {
    const ratio = range.min === 0 ? 1 : len / range.min;
    return {
      score: Math.round(20 * ratio),
      detail: `length ${len} below ${estimated} minimum (${range.min})`,
    };
  }

  // Too long — only penalise for 'short' expectation
  if (estimated === 'short' && len > range.max) {
    const overshoot = len / range.max;
    const penalty = Math.min(15, Math.round((overshoot - 1) * 10));
    return {
      score: Math.max(5, 20 - penalty),
      detail: `length ${len} exceeds short maximum (${range.max})`,
    };
  }

  return { score: 20, detail: `length ${len} acceptable for ${estimated}` };
}

/**
 * Detect refusal language in the response.
 * @param {string} responseContent
 * @returns {{ score: number, detail: string }}
 */
function scoreRefusal(responseContent) {
  const lower = responseContent.toLowerCase();
  const found = REFUSAL_PATTERNS.find((p) => lower.includes(p));
  if (found) return { score: 5, detail: `refusal pattern detected: "${found}"` };
  return { score: 20, detail: 'no refusal detected' };
}

/**
 * Detect error indicators outside code blocks.
 * @param {string} responseContent
 * @returns {{ score: number, detail: string }}
 */
function scoreErrorIndicators(responseContent) {
  const prose = stripCodeBlocks(responseContent).toLowerCase();
  const found = ERROR_PATTERNS.find((p) => prose.includes(p));
  if (found) return { score: 5, detail: `error indicator detected: "${found}"` };
  return { score: 15, detail: 'no error indicators' };
}

/**
 * Check whether the response language matches the expected language.
 * @param {string} responseContent
 * @param {object|undefined} routingResult
 * @returns {{ score: number, detail: string }}
 */
function scoreLanguageConsistency(responseContent, routingResult) {
  const lang = routingResult?.language;
  if (!lang) return { score: 8, detail: 'language unknown' };

  const words = LANGUAGE_WORDS[lang];
  if (!words) return { score: 8, detail: `no word list for language: ${lang}` };

  // Tokenise response into lowercase words for whole-word matching
  const responseWords = new Set(responseContent.toLowerCase().match(/\b[a-zäöüß]+\b/g) || []);
  const matches = words.filter((w) => responseWords.has(w));

  if (matches.length >= 2) {
    return { score: 10, detail: `language ${lang} confirmed (${matches.length} marker words)` };
  }
  return { score: 3, detail: `language ${lang} not confirmed (${matches.length} marker words)` };
}

/**
 * Check format compliance (currently: JSON detection when requested).
 * @param {string} responseContent
 * @param {object|undefined} chatRequest
 * @returns {{ score: number, detail: string }}
 */
function scoreFormatCompliance(responseContent, chatRequest) {
  const lastMsg = getLastUserMessage(chatRequest);
  const jsonExpected = /json/i.test(lastMsg);

  if (!jsonExpected) return { score: 10, detail: 'no format requirement detected' };

  if (containsValidJson(responseContent)) {
    return { score: 10, detail: 'JSON expected and found' };
  }
  return { score: 3, detail: 'JSON expected but not found' };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Score the quality of an LLM response using lightweight heuristics.
 *
 * @param {object} params
 * @param {string} params.responseContent   - The raw text response from the model.
 * @param {string} [params.finishReason]     - The finish_reason from the provider (stop, length, etc.).
 * @param {object} [params.chatRequest]      - The original chat completion request body.
 * @param {object} [params.routingResult]    - Routing metadata (estimatedOutputLength, language, etc.).
 * @returns {{ score: number, signals: object, breakdown: object }}
 */
export function scoreResponse({ responseContent = '', finishReason, chatRequest, routingResult } = {}) {
  const completeness       = scoreCompleteness(finishReason);
  const lengthAdequacy     = scoreLengthAdequacy(responseContent, routingResult);
  const refusal            = scoreRefusal(responseContent);
  const errorIndicators    = scoreErrorIndicators(responseContent);
  const languageConsistency = scoreLanguageConsistency(responseContent, routingResult);
  const formatCompliance   = scoreFormatCompliance(responseContent, chatRequest);

  const score =
    completeness.score +
    lengthAdequacy.score +
    refusal.score +
    errorIndicators.score +
    languageConsistency.score +
    formatCompliance.score;

  return {
    score,
    signals: {
      completeness:        completeness.score,
      lengthAdequacy:      lengthAdequacy.score,
      noRefusal:           refusal.score,
      noErrorIndicators:   errorIndicators.score,
      languageConsistency: languageConsistency.score,
      formatCompliance:    formatCompliance.score,
    },
    breakdown: {
      completeness:        completeness.detail,
      lengthAdequacy:      lengthAdequacy.detail,
      noRefusal:           refusal.detail,
      noErrorIndicators:   errorIndicators.detail,
      languageConsistency: languageConsistency.detail,
      formatCompliance:    formatCompliance.detail,
    },
  };
}

/**
 * Retrieve quality trend data for a model over a time window.
 * Placeholder — will be implemented when the DB query layer is available.
 *
 * @param {string} _modelId - The model identifier.
 * @param {number} [_days=7] - Number of days to look back.
 * @returns {null}
 */
export function getQualityTrend(_modelId, _days = 7) {
  return null;
}
