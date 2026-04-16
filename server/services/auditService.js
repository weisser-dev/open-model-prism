import ConfigChange from '../models/ConfigChange.js';
import logger from '../utils/logger.js';

/**
 * Compute a shallow diff between two plain objects.
 * Returns an array of { field, before, after } for changed fields.
 * Nested objects are compared using dot-notation paths.
 * Arrays are compared as JSON strings (not element-by-element).
 */
function diffObjects(before, after, prefix = '') {
  const changes = [];
  if (!before || !after) return changes;

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    // Skip internal fields
    if (key.startsWith('_') || key === 'updatedAt' || key === 'createdAt' || key === '__v') continue;

    const path = prefix ? `${prefix}.${key}` : key;
    const bVal = before[key];
    const aVal = after[key];

    // Both null/undefined → no change
    if (bVal == null && aVal == null) continue;

    // Arrays → compare as JSON
    if (Array.isArray(bVal) || Array.isArray(aVal)) {
      const bJson = JSON.stringify(bVal ?? []);
      const aJson = JSON.stringify(aVal ?? []);
      if (bJson !== aJson) {
        // For small arrays, show the values; for large arrays, show count
        const bLen = Array.isArray(bVal) ? bVal.length : 0;
        const aLen = Array.isArray(aVal) ? aVal.length : 0;
        if (bLen + aLen > 10) {
          changes.push({ field: path, before: `[${bLen} items]`, after: `[${aLen} items]` });
        } else {
          changes.push({ field: path, before: bVal, after: aVal });
        }
      }
      continue;
    }

    // Nested objects → recurse
    if (typeof bVal === 'object' && bVal !== null && typeof aVal === 'object' && aVal !== null && !Array.isArray(bVal)) {
      changes.push(...diffObjects(bVal, aVal, path));
      continue;
    }

    // Primitives → direct compare
    if (String(bVal ?? '') !== String(aVal ?? '')) {
      changes.push({ field: path, before: bVal ?? null, after: aVal ?? null });
    }
  }

  return changes;
}

/**
 * Generate a human-readable summary from a list of changes.
 * E.g. "costMode: balanced → quality, tierBoost: 0 → 1"
 */
function generateSummary(changes, maxItems = 3) {
  if (!changes.length) return 'No changes detected';
  const items = changes.slice(0, maxItems).map(c => {
    const field = c.field.split('.').pop(); // last segment
    const before = typeof c.before === 'object' ? JSON.stringify(c.before) : String(c.before ?? '(none)');
    const after = typeof c.after === 'object' ? JSON.stringify(c.after) : String(c.after ?? '(none)');
    return `${field}: ${before} → ${after}`;
  });
  if (changes.length > maxItems) items.push(`+${changes.length - maxItems} more`);
  return items.join(', ');
}

/**
 * Log a configuration change to the audit trail.
 *
 * @param {object} opts
 * @param {string} opts.user       - Username who made the change
 * @param {string} opts.action     - 'create' | 'update' | 'delete'
 * @param {string} opts.target     - 'rule-set' | 'tenant' | 'category' | 'model'
 * @param {string} opts.targetId   - MongoDB document ID
 * @param {string} opts.targetName - Human-readable name
 * @param {object} opts.before     - State before change (plain object / .lean())
 * @param {object} opts.after      - State after change (plain object / .lean())
 */
export async function logConfigChange({ user, action, target, targetId, targetName, before, after }) {
  try {
    const changes = action === 'create'
      ? [{ field: '(created)', before: null, after: targetName }]
      : action === 'delete'
        ? [{ field: '(deleted)', before: targetName, after: null }]
        : diffObjects(before || {}, after || {});

    if (action === 'update' && !changes.length) return; // No actual changes

    const summary = action === 'create' ? `Created ${target}: ${targetName}`
      : action === 'delete' ? `Deleted ${target}: ${targetName}`
      : generateSummary(changes);

    await ConfigChange.create({
      user: user || 'system',
      action,
      target,
      targetId,
      targetName: targetName || String(targetId),
      summary,
      changes,
    });

    logger.info(`[audit] ${user} ${action} ${target} "${targetName}": ${summary}`);
  } catch (err) {
    // Audit logging must never break the operation
    logger.error('[audit] Failed to log config change:', { error: err.message });
  }
}
