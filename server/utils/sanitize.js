/**
 * Input sanitization utilities — prevents NoSQL injection and validates
 * common input types before they reach MongoDB queries.
 */
import mongoose from 'mongoose';

/**
 * Ensure a value is a plain string (not an object/array that could be a MongoDB operator).
 * Returns the string or null if invalid.
 */
export function sanitizeString(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') return val;
  return null; // reject objects like { $gt: '' }
}

/**
 * Validate and parse a MongoDB ObjectId string.
 * Returns the ObjectId or null if invalid.
 */
export function sanitizeObjectId(val) {
  if (!val) return null;
  const s = typeof val === 'string' ? val : String(val);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

/**
 * Sanitize a numeric query parameter.
 * Returns the parsed number, clamped to [min, max], or the default.
 */
export function sanitizeInt(val, defaultVal, min = 0, max = Infinity) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

/**
 * Sanitize an enum string — returns val only if it's in the allowed set.
 */
export function sanitizeEnum(val, allowed, defaultVal = null) {
  if (allowed.includes(val)) return val;
  return defaultVal;
}

/**
 * Strip MongoDB operator keys ($gt, $where, etc.) from an object recursively.
 * Useful as a last-resort sanitizer for free-form input objects.
 */
export function stripOperators(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(stripOperators);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$')) continue; // drop operator keys
    clean[k] = stripOperators(v);
  }
  return clean;
}
