import jwt from 'jsonwebtoken';
import config from '../config.js';

export function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;   // { id, username, role, tenants }
    req.admin = decoded;  // backward-compat alias
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
