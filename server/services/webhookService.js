import crypto from 'node:crypto';
import Webhook from '../models/Webhook.js';
import WebhookLog from '../models/WebhookLog.js';

/**
 * Sign a payload string with HMAC-SHA256.
 * @param {string} body - Serialized JSON body.
 * @param {string} secret - Webhook secret key.
 * @returns {string} Hex-encoded HMAC signature.
 */
function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Sleep for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Emit a webhook event. Finds all enabled webhooks that subscribe to the given
 * event (global + tenant-specific) and delivers to each asynchronously.
 * @param {string} event - One of the supported event types.
 * @param {object} payload - Arbitrary event payload.
 * @param {string|null} [tenantId=null] - Tenant ObjectId, or null for global-only.
 */
export async function emit(event, payload, tenantId = null) {
  const filter = { enabled: true, events: event };

  // Match global webhooks (tenantId is null) plus tenant-specific ones
  const tenantFilter = [{ tenantId: null }];
  if (tenantId) tenantFilter.push({ tenantId });
  filter.$or = tenantFilter;

  const webhooks = await Webhook.find(filter).lean();

  for (const webhook of webhooks) {
    setImmediate(() => {
      deliver(webhook, event, payload).catch(() => {
        // fire-and-forget — errors are persisted in WebhookLog
      });
    });
  }
}

/**
 * Deliver a webhook event to a single endpoint with retries and logging.
 * @param {object} webhook - Webhook document (plain object or Mongoose doc).
 * @param {string} event - Event type string.
 * @param {object} payload - Event payload.
 */
export async function deliver(webhook, event, payload) {
  const { maxRetries = 3, backoffMs = 1000 } = webhook.retryPolicy || {};

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    tenantId: webhook.tenantId || null,
    payload,
  });

  const signature = sign(body, webhook.secret);

  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Event': event,
  };

  // Merge custom headers from the webhook definition
  if (webhook.headers) {
    const custom = webhook.headers instanceof Map
      ? Object.fromEntries(webhook.headers)
      : webhook.headers;
    Object.assign(headers, custom);
  }

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(webhook.url, { method: 'POST', headers, body });
      const responseTimeMs = Date.now() - start;
      const success = res.ok;

      await WebhookLog.create({
        webhookId: webhook._id,
        event,
        payload,
        statusCode: res.status,
        responseTimeMs,
        attempt,
        success,
        errorMessage: success ? undefined : `HTTP ${res.status}`,
      });

      if (success) return;
    } catch (err) {
      const responseTimeMs = Date.now() - start;

      await WebhookLog.create({
        webhookId: webhook._id,
        event,
        payload,
        statusCode: null,
        responseTimeMs,
        attempt,
        success: false,
        errorMessage: err.message,
      });
    }

    // Exponential backoff before next retry (skip after final attempt)
    if (attempt <= maxRetries) {
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
}

/**
 * Retrieve recent delivery logs for a webhook.
 * @param {string} webhookId - Webhook ObjectId.
 * @param {number} [limit=50] - Maximum number of log entries to return.
 * @returns {Promise<Array>} Array of WebhookLog documents, newest first.
 */
export async function getDeliveryLog(webhookId, limit = 50) {
  return WebhookLog.find({ webhookId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}
