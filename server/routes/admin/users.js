import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { adminOnly, canReadConfig } from '../../middleware/rbac.js';
import User, { ROLES } from '../../models/User.js';

const router = Router();
router.use(adminAuth);

// List all users — readable by auditor for compliance
router.get('/', canReadConfig, async (_req, res) => {
  const users = await User.find().select('-passwordHash').populate('tenants', 'name slug').sort({ createdAt: 1 });
  res.json(users);
});

// Create local user
router.post('/', async (req, res) => {
  const { username, password, role, tenants } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, and role are required' });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be: ${ROLES.join(', ')}` });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = await User.findOne({ username: username.toLowerCase() });
  if (existing) return res.status(400).json({ error: 'Username already exists' });

  const passwordHash = await User.hashPassword(password);
  const user = await User.create({
    username: username.toLowerCase(),
    passwordHash,
    role,
    tenants: tenants || [],
    source: 'local',
  });

  const obj = user.toObject();
  delete obj.passwordHash;
  res.status(201).json(obj);
});

// Update role / tenants / active / password
router.put('/:id', async (req, res) => {
  const { role, tenants, active, password } = req.body;
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Guard: cannot remove the last admin
  if (role && role !== 'admin' && target.role === 'admin') {
    const adminCount = await User.countDocuments({ role: 'admin', active: true });
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last active admin' });
    }
  }

  // Guard: cannot change your own role
  if (req.user.id === String(target._id) && role && role !== req.user.role) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  if (role !== undefined) target.role = role;
  if (tenants !== undefined) target.tenants = tenants;
  if (active !== undefined) {
    // Cannot deactivate the last admin
    if (!active && target.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin', active: true });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot deactivate the last active admin' });
      }
    }
    target.active = active;
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    target.passwordHash = await User.hashPassword(password);
  }

  await target.save();
  const obj = target.toObject();
  delete obj.passwordHash;
  res.json(obj);
});

// Delete user
router.delete('/:id', async (req, res) => {
  // Cannot delete yourself
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Cannot delete last admin
  if (target.role === 'admin') {
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin' });
    }
  }

  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

export default router;
