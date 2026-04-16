/**
 * Role-Based Access Control middleware.
 * Must be used AFTER adminAuth (which populates req.user).
 *
 * Role hierarchy (highest → lowest):
 *   admin > maintainer > finops > auditor > tenant-maintainer > tenant-admin > tenant-viewer > chat-user
 *
 * Middleware quick-reference:
 *   adminOnly       — destructive / user-management ops (delete tenant, manage users)
 *   adminOrMaint    — config writes (create/update providers, tenants, routing, webhooks, experiments)
 *   canReadConfig   — sensitive read access for auditor compliance (providers, tenants, users list, experiments, webhooks)
 *   canViewCosts    — financial/analytics reads (costs, quotas, categories, routing rules)
 *   anyUser         — dashboard, request logs, tokenizer (tenant-scoped where applicable)
 *   canChat         — chat endpoint access
 */

export function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}`,
      });
    }
    next();
  };
}

// ── Convenience shorthands ────────────────────────────────────────────────────

// Full system access — user management and destructive ops
export const adminOnly       = requireRole('admin');

// Config writes — providers, tenants, routing rules, categories, webhooks, experiments
export const adminOrMaint    = requireRole('admin', 'maintainer');

// Sensitive read access — auditor compliance: provider list, tenant details, user list,
// experiments, webhooks, prompt engineer/optimizer settings (read-only for auditor)
export const canReadConfig   = requireRole('admin', 'maintainer', 'auditor');

// Financial & analytics reads — costs, savings, quotas, routing config
export const canViewCosts    = requireRole('admin', 'maintainer', 'finops', 'auditor');

// Any admin-panel user — dashboard, request logs, tokenizer (tenant-scoped where applicable)
export const anyUser         = requireRole('admin', 'maintainer', 'finops', 'auditor', 'tenant-maintainer', 'tenant-admin', 'tenant-viewer');

// Chat access (chat-user + all higher roles)
export const canChat         = requireRole('admin', 'maintainer', 'finops', 'auditor', 'tenant-maintainer', 'tenant-admin', 'tenant-viewer', 'chat-user');

// ── Tenant-scoped access ──────────────────────────────────────────────────────

/**
 * tenantScopedWrite — allows tenant-maintainer and tenant-admin to operate on
 * their own assigned tenants. Admin/maintainer pass through unrestricted.
 */
export function tenantScopedWrite(req, res, next) {
  const { role, tenants: userTenants } = req.user || {};
  if (['admin', 'maintainer'].includes(role)) return next();
  if (!['tenant-maintainer', 'tenant-admin'].includes(role)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const requestedId = String(req.params.id || req.params.tenantId || '');
  const owned = (Array.isArray(userTenants) ? userTenants : []).map(String);
  if (!owned.includes(requestedId)) {
    return res.status(403).json({ error: 'Access denied — not your tenant' });
  }
  next();
}

// Legacy alias
export const tenantAdminSelf = tenantScopedWrite;

/**
 * Check if user's role has access to prompt/response snapshots.
 * finops, auditor, tenant-viewer, tenant-admin, chat-user → NO prompt access.
 */
export function canViewPrompts(role) {
  return ['admin', 'maintainer', 'tenant-maintainer'].includes(role);
}
