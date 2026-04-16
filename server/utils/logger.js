/**
 * Structured JSON logger.
 * In production outputs newline-delimited JSON.
 * In development outputs human-readable colored output.
 *
 * Log level can be changed at runtime via logger.setLevel(level).
 */
import config from '../config.js';

const isProd = process.env.NODE_ENV === 'production';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = LEVELS[config.logLevel] ?? 1;

function log(level, message, meta = {}) {
  if (LEVELS[level] < currentLevel) return;

  if (isProd) {
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...meta,
    }) + '\n');
  } else {
    const color = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' }[level] || '';
    const reset = '\x1b[0m';
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    console.log(`${color}[${level.toUpperCase()}]${reset} ${message}${metaStr}`);
  }
}

const logger = {
  info:  (msg, meta) => log('info',  msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),

  /** Change the active log level at runtime (applies to this pod immediately). */
  setLevel(level) {
    if (LEVELS[level] !== undefined) {
      currentLevel = LEVELS[level];
      log('info', `[logger] Log level changed to ${level}`);
    }
  },

  getLevel() {
    return Object.keys(LEVELS).find(k => LEVELS[k] === currentLevel) || 'info';
  },

  /** Express request logger middleware */
  requestMiddleware() {
    return (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        if (req.path === '/health' || req.path === '/metrics') return; // skip noise
        log('info', `${req.method} ${req.path}`, {
          status: res.statusCode,
          ms: Date.now() - start,
          ip: req.ip,
        });
      });
      next();
    };
  },
};

export default logger;
