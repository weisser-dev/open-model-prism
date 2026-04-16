/**
 * In-memory circuit breaker for provider failover.
 *
 * Tracks per-provider health and blocks requests to providers that are
 * consistently failing, allowing periodic recovery attempts.
 *
 * States:
 *   CLOSED    — normal operation, requests pass through
 *   OPEN      — provider is down, requests are blocked
 *   HALF_OPEN — testing whether provider has recovered
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Consecutive failures before opening the circuit. */
const MAX_FAILURES = 5;

/** How long (ms) a circuit stays OPEN before allowing a test request. */
const RESET_TIMEOUT_MS = 60_000;

/** Max test requests allowed while HALF_OPEN before re-opening. */
const HALF_OPEN_MAX = 2;

/** Rolling window size for error-rate calculation. */
const WINDOW_SIZE = 100;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const CLOSED = 'CLOSED';
const OPEN = 'OPEN';
const HALF_OPEN = 'HALF_OPEN';

/**
 * @typedef {Object} ProviderHealth
 * @property {number}  failures          - consecutive failure count
 * @property {number}  lastFailure       - timestamp of last failure (ms)
 * @property {string}  state             - CLOSED | OPEN | HALF_OPEN
 * @property {number}  halfOpenAttempts  - test requests issued in HALF_OPEN
 */

/** @type {Map<string, ProviderHealth>} */
const providers = new Map();

/**
 * Rolling window of recent results per provider.
 * Each entry: { ok: boolean, ts: number }
 * @type {Map<string, Array<{ok: boolean, ts: number}>>}
 */
const windows = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the health record for a provider, creating a default if absent.
 * @param {string} providerId
 * @returns {ProviderHealth}
 */
function ensure(providerId) {
  if (!providers.has(providerId)) {
    providers.set(providerId, {
      failures: 0,
      lastFailure: 0,
      state: CLOSED,
      halfOpenAttempts: 0,
    });
  }
  return providers.get(providerId);
}

/**
 * Push a result into the rolling window for a provider.
 * @param {string} providerId
 * @param {boolean} ok
 */
function pushResult(providerId, ok) {
  if (!windows.has(providerId)) {
    windows.set(providerId, []);
  }
  const win = windows.get(providerId);
  win.push({ ok, ts: Date.now() });
  if (win.length > WINDOW_SIZE) {
    win.shift();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a successful request to a provider.
 * Resets the circuit to CLOSED and clears the failure counter.
 * @param {string} providerId
 */
export function recordSuccess(providerId) {
  const h = ensure(providerId);
  h.failures = 0;
  h.state = CLOSED;
  h.halfOpenAttempts = 0;
  pushResult(providerId, true);
}

/**
 * Record a failed request to a provider.
 * Once consecutive failures reach MAX_FAILURES the circuit opens.
 * In HALF_OPEN state, any failure immediately re-opens the circuit.
 * @param {string} providerId
 */
export function recordFailure(providerId) {
  const h = ensure(providerId);
  h.failures += 1;
  h.lastFailure = Date.now();
  pushResult(providerId, false);

  if (h.state === HALF_OPEN) {
    // Recovery attempt failed — reopen.
    h.state = OPEN;
    h.halfOpenAttempts = 0;
    return;
  }

  if (h.failures >= MAX_FAILURES) {
    h.state = OPEN;
  }
}

/**
 * Check whether a provider is available for routing.
 *
 * - CLOSED → always available
 * - OPEN   → available only if resetTimeout has elapsed, in which case
 *            the circuit transitions to HALF_OPEN
 * - HALF_OPEN → available while halfOpenAttempts < HALF_OPEN_MAX
 *
 * @param {string} providerId
 * @returns {boolean}
 */
export function isAvailable(providerId) {
  const h = ensure(providerId);

  if (h.state === CLOSED) {
    return true;
  }

  if (h.state === OPEN) {
    const elapsed = Date.now() - h.lastFailure;
    if (elapsed >= RESET_TIMEOUT_MS) {
      h.state = HALF_OPEN;
      h.halfOpenAttempts = 0;
      // Fall through to HALF_OPEN check.
    } else {
      return false;
    }
  }

  // HALF_OPEN
  if (h.halfOpenAttempts < HALF_OPEN_MAX) {
    h.halfOpenAttempts += 1;
    return true;
  }

  return false;
}

/**
 * Return all provider health entries for admin inspection.
 * @returns {Array<{ providerId: string, failures: number, lastFailure: number, state: string, halfOpenAttempts: number }>}
 */
export function getHealthReport() {
  return Array.from(providers.entries()).map(([providerId, h]) => ({
    providerId,
    ...h,
  }));
}

/**
 * Calculate the error rate for a provider over a sliding time window.
 * Returns a value between 0 and 1, or 0 if there are no samples.
 *
 * @param {string} providerId
 * @param {number} [windowMs=300_000] - lookback window in milliseconds (default 5 min)
 * @returns {number}
 */
export function getErrorRate(providerId, windowMs = 300_000) {
  const win = windows.get(providerId);
  if (!win || win.length === 0) return 0;

  const cutoff = Date.now() - windowMs;
  const recent = win.filter((r) => r.ts >= cutoff);
  if (recent.length === 0) return 0;

  const failures = recent.filter((r) => !r.ok).length;
  return failures / recent.length;
}

// ---------------------------------------------------------------------------
// Stale-entry cleanup (runs every 5 minutes)
// ---------------------------------------------------------------------------

/**
 * Remove provider entries that have been CLOSED with zero failures and
 * whose rolling window is empty or fully outside the default 5-min window.
 * This prevents unbounded memory growth if many transient providers appear.
 */
function cleanup() {
  const cutoff = Date.now() - 300_000;

  for (const [id, h] of providers) {
    if (h.state !== CLOSED || h.failures > 0) continue;

    const win = windows.get(id);
    const hasRecent = win?.some((r) => r.ts >= cutoff);
    if (!hasRecent) {
      providers.delete(id);
      windows.delete(id);
    }
  }
}

const cleanupTimer = setInterval(cleanup, 300_000);
cleanupTimer.unref();
