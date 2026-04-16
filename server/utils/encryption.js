import crypto from 'crypto';
import config from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey() {
  // Ensure key is exactly 32 bytes
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

export function encrypt(text) {
  if (!text) return text;
  // Don't re-encrypt
  if (text.startsWith('enc:')) return text;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decrypt(text) {
  if (!text) return text;
  if (!text.startsWith('enc:')) return text; // Not encrypted, return as-is

  const parts = text.split(':');
  if (parts.length !== 4) return text;

  const [, ivHex, tagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
