/**
 * Prompt Retention Service
 *
 * Runs hourly. Strips promptSnapshot, responseSnapshot, and capturedPaths
 * from RequestLog documents older than the configured retention window.
 * The log entry itself (metadata, tokens, cost, routing) is kept forever —
 * only the captured text content is removed.
 */
import RequestLog from '../models/RequestLog.js';
import LogConfig from '../models/LogConfig.js';
import logger from '../utils/logger.js';

let retentionTimer = null;

export function startRetentionService() {
  // Run immediately 30s after startup, then every hour
  setTimeout(runRetention, 30_000);
  retentionTimer = setInterval(runRetention, 60 * 60 * 1000);
}

export function stopRetentionService() {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}

export async function runRetention() {
  try {
    const cfg = await LogConfig.findOne({ singleton: 'default' }).lean();
    if (!cfg?.promptRetentionEnabled) return;

    const hours = cfg.promptRetentionHours ?? 48;
    if (!hours || hours <= 0) return;

    const cutoff = new Date(Date.now() - hours * 3_600_000);

    const result = await RequestLog.updateMany(
      {
        timestamp: { $lt: cutoff },
        // Only touch documents that still have prompt data — avoids full-collection scans
        $or: [
          { 'promptSnapshot.systemPrompt':    { $exists: true } },
          { 'promptSnapshot.lastUserMessage': { $exists: true } },
          { 'promptSnapshot.messages':        { $not: { $size: 0 }, $exists: true } },
          { 'responseSnapshot.content':       { $exists: true } },
          { capturedPaths:                    { $not: { $size: 0 }, $exists: true } },
        ],
      },
      {
        $unset: {
          promptSnapshot:   '',
          responseSnapshot: '',
          capturedPaths:    '',
        },
      },
    );

    if (result.modifiedCount > 0) {
      logger.info(`[retention] Stripped prompt data from ${result.modifiedCount} logs older than ${hours}h`);
    }
  } catch (err) {
    logger.warn('[retention] Cleanup error:', err.message);
  }
}
