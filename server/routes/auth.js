import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { ldapAuthenticate } from '../services/ldapAuth.js';
import config from '../config.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  let userId, userUsername, userRole, userTenants;

  // 1. Try local user first
  const user = await User.findOne({ username: username.toLowerCase(), source: 'local', active: true });
  if (user && await user.verifyPassword(password)) {
    userId = user._id;
    userUsername = user.username;
    userRole = user.role;
    userTenants = user.tenants;
    user.lastLogin = new Date();
    await user.save();
  }

  // 2. LDAP fallback (if local auth didn't succeed)
  if (!userId) {
    try {
      const ldapUser = await ldapAuthenticate(username, password);
      if (ldapUser) {
        // Upsert LDAP user — role is refreshed from LDAP groups on every login
        const existing = await User.findOneAndUpdate(
          { username: ldapUser.username, source: 'ldap' },
          { role: ldapUser.role, lastLogin: new Date(), active: true },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        userId = existing._id;
        userUsername = existing.username;
        userRole = existing.role;
        userTenants = existing.tenants;
      }
    } catch (ldapErr) {
      // LDAP errors are logged but don't override the "invalid credentials" response
      console.warn('[auth] LDAP error:', ldapErr.message);
    }
  }

  if (!userId) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: String(userId), username: userUsername, role: userRole, tenants: userTenants },
    config.jwtSecret,
    { expiresIn: '24h' },
  );

  res.json({ token, username: userUsername, role: userRole });
});

router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  try {
    const decoded = jwt.verify(authHeader.slice(7), config.jwtSecret);
    res.json({ id: decoded.id, username: decoded.username, role: decoded.role });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
