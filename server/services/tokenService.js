/**
 * Token Service — offline token estimation
 *
 * Provides a purely local, dependency-free token count estimate for any model.
 * Used to pre-check context window limits before sending requests and to
 * pick the right fallback model when a request would overflow.
 *
 * Accuracy:
 *   - English prose:    ~4 chars/token  (tiktoken cl100k compatible)
 *   - Code:             ~3 chars/token  (more tokens due to symbols/whitespace)
 *   - Mixed / default:  ~3.5 chars/token
 *
 * For a safety margin we deliberately over-estimate slightly.
 */

/** Characters per token — conservative estimates */
const CHARS_PER_TOKEN = 3.5;

/** Overhead tokens per message in the OpenAI message format */
const MESSAGE_OVERHEAD = 4; // <role>\n + content + \n\n (approx)

/** Base overhead per request */
const REQUEST_OVERHEAD = 3;

/**
 * Estimate the number of tokens in a single string.
 */
export function estimateStringTokens(text) {
  if (!text) return 0;
  // Count code-heavy content by detecting common code markers
  const codeChars = (text.match(/[{}()[\]<>=+\-*/\\|^~;:,.@#$%&]/g) || []).length;
  const codeRatio = codeChars / Math.max(text.length, 1);
  const effectiveCharsPerToken = codeRatio > 0.15 ? 3.0 : CHARS_PER_TOKEN;
  return Math.ceil(text.length / effectiveCharsPerToken);
}

/**
 * Extract plain text from an OpenAI message content field.
 * Handles both string content and multi-part content arrays.
 */
function extractMessageText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part.type === 'text') return part.text || '';
        if (part.type === 'image_url') return '[IMAGE]'; // rough placeholder
        // tool_result: content may be string or nested array of text parts
        if (part.type === 'tool_result') {
          const c = part.content;
          if (!c) return '';
          if (typeof c === 'string') return c;
          if (Array.isArray(c)) return c.map(p => (p.type === 'text' ? p.text || '' : '')).join(' ');
          return JSON.stringify(c);
        }
        // tool_use: count the serialized input object (can be large JSON payloads)
        if (part.type === 'tool_use') {
          return (part.name || '') + ' ' + (part.input != null ? JSON.stringify(part.input) : '');
        }
        return '';
      })
      .join(' ');
  }
  return JSON.stringify(content);
}

/**
 * Estimate total input tokens for a chat request (messages array).
 * Matches OpenAI's token counting methodology closely enough for safety checks.
 *
 * @param {Array}  messages   - OpenAI messages array
 * @param {number} maxTokens  - Requested max_tokens (for output reservation)
 * @returns {{ inputTokens: number, outputReserved: number, total: number }}
 */
export function estimateChatTokens(messages, maxTokens = 0) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { inputTokens: 0, outputReserved: maxTokens, total: maxTokens };
  }

  let inputTokens = REQUEST_OVERHEAD;

  for (const msg of messages) {
    const roleTokens = estimateStringTokens(msg.role || '');
    const contentTokens = estimateStringTokens(extractMessageText(msg.content));
    inputTokens += MESSAGE_OVERHEAD + roleTokens + contentTokens;
  }

  return {
    inputTokens,
    outputReserved: maxTokens,
    total: inputTokens + maxTokens,
  };
}

/**
 * Check whether a request would exceed a model's context window.
 *
 * @param {Array}   messages     - Chat messages
 * @param {number}  maxTokens    - Requested output tokens (max_tokens)
 * @param {number}  contextWindow - Model context window in tokens
 * @returns {{ fits: boolean, inputTokens: number, headroom: number }}
 */
export function checkContextFits(messages, maxTokens, contextWindow) {
  if (!contextWindow) return { fits: true, inputTokens: 0, headroom: Infinity };

  const { inputTokens, total } = estimateChatTokens(messages, maxTokens);
  const headroom = contextWindow - total;

  return {
    fits: headroom >= 0,
    inputTokens,
    headroom,
  };
}

/**
 * Detect whether an error from a provider is a context-length overflow.
 * Covers OpenAI, Anthropic, AWS Bedrock, Azure, and generic messages.
 */
export function isContextOverflowError(err) {
  const msg = (err?.message || err?.toString() || '').toLowerCase();
  // Exclude max_tokens errors (handled separately)
  if (isMaxTokensError(err)) return false;
  return (
    msg.includes('context_length_exceeded') ||
    msg.includes('context length') ||
    msg.includes('maximum context') ||
    msg.includes('context window') ||
    (msg.includes('input tokens') && msg.includes('context')) ||
    // Bedrock Nova / Titan: "Input Tokens Exceeded: Number of input tokens exceeds maximum length"
    msg.includes('input tokens exceeded') ||
    (msg.includes('input tokens') && msg.includes('exceeds') && msg.includes('maximum')) ||
    // Bedrock ValidationException patterns
    (msg.includes('validationexception') && (msg.includes('context') || msg.includes('mantle') || msg.includes('input'))) ||
    msg.includes('request too large') ||
    msg.includes('prompt is too long') ||
    msg.includes('input is too long') ||
    // Bedrock Mantle streaming error pattern (only if about context/input, not max_tokens)
    (msg.includes('mantle streaming error') && msg.includes('badrequesterror') && (msg.includes('input') || msg.includes('context')))
  );
}

/**
 * Detect whether an error is about max_tokens exceeding the model's output token limit.
 * Examples:
 *   - "The maximum tokens you requested exceeds the model limit of 10000"
 *   - "max_tokens is too large"
 *   - "output token limit"
 */
export function isMaxTokensError(err) {
  const msg = (err?.message || err?.toString() || '').toLowerCase();
  return (
    (msg.includes('maximum tokens') && msg.includes('exceeds')) ||
    (msg.includes('max_tokens') && (msg.includes('too large') || msg.includes('exceeds') || msg.includes('invalid'))) ||
    (msg.includes('maximum tokens') && msg.includes('model limit')) ||
    (msg.includes('output token') && msg.includes('limit'))
  );
}

/**
 * Truncate a messages array to fit within a context window.
 *
 * Strategy:
 *  1. Always keep the system message (first message if role=system).
 *  2. Always keep the most recent user message (last message in array).
 *  3. Drop the oldest non-system messages until the payload fits within
 *     (contextWindow - maxTokens) * TARGET_FILL_RATIO.
 *  4. If a truncation summary note was added in a previous pass (role=system,
 *     includes the sentinel), replace it rather than accumulating duplicates.
 *
 * Returns { messages: truncatedArray, dropped: number }.
 */
const TRUNCATION_NOTE_SENTINEL = '[CONTEXT_TRUNCATED]';
const TARGET_FILL_RATIO = 0.85; // leave 15% headroom after truncation

export function truncateMessages(messages, contextWindow, maxTokens = 0) {
  if (!Array.isArray(messages) || messages.length === 0) return { messages, dropped: 0 };
  if (!contextWindow) return { messages, dropped: 0 };

  const budget = Math.floor(contextWindow * TARGET_FILL_RATIO) - maxTokens;

  // Already fits — nothing to do
  const { inputTokens } = estimateChatTokens(messages, 0);
  if (inputTokens <= budget) return { messages, dropped: 0 };

  // Separate system message(s) and conversation turns
  const systemMsgs = messages.filter(m => m.role === 'system' && !m._truncationNote);
  const turns = messages.filter(m => m.role !== 'system' || m._truncationNote);

  // Remove any previously injected truncation note
  const cleanTurns = turns.filter(m => !m._truncationNote);

  // Always keep the last (most recent) message; drop from the front
  let kept = [...cleanTurns];
  let dropped = 0;

  while (kept.length > 1) {
    const combined = [...systemMsgs, ...kept];
    const { inputTokens: est } = estimateChatTokens(combined, 0);
    if (est <= budget) break;
    kept.shift(); // drop oldest turn
    dropped++;
  }

  // Prepend a truncation note so the model knows history was cut
  const note = {
    role: 'system',
    content: `${TRUNCATION_NOTE_SENTINEL} Earlier conversation history was truncated to fit the model's context window. ${dropped} message(s) were removed. Only the most recent turns are shown below.`,
    _truncationNote: true,
  };

  return {
    messages: dropped > 0 ? [...systemMsgs, note, ...kept] : [...systemMsgs, ...kept],
    dropped,
  };
}

/**
 * Try to extract the model's max output token limit from a max_tokens error message.
 * Returns the number or null.
 */
export function extractMaxTokensLimit(err) {
  const msg = err?.message || err?.toString() || '';
  // "model limit of 10000", "limit is 10000", "maximum of 10000"
  const match = msg.match(/(?:limit|maximum)\s+(?:of|is)\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}
