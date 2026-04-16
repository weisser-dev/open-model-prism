import { BaseProvider } from './base.js';
import { decrypt } from '../utils/encryption.js';

/**
 * OpenAI-compatible Provider Adapter.
 * Works with: OpenAI, OpenRouter, vLLM, LitServe, Groq, Together, etc.
 *
 * API path probing order (when config.options.apiPath is not yet set):
 *   1. /v1   — standard OpenAI / most providers
 *   2. /api/v1 — LitServe, some Azure proxies, internal deployments
 *
 * Once discovered, the working path is stored in config.options.apiPath and
 * used for all subsequent calls without re-probing.
 */
export class OpenAIProvider extends BaseProvider {
  getBaseUrl() {
    return (this.config.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
  }

  /** Returns the API mount path, e.g. '/v1' or '/api/v1'. */
  getApiPath() {
    return (this.config.options?.apiPath || '/v1').replace(/\/$/, '');
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const auth = this.config.auth || {};
    if (auth.type === 'api_key' && auth.apiKey) {
      headers['Authorization'] = `Bearer ${decrypt(auth.apiKey)}`;
    } else if (auth.type === 'bearer' && auth.apiKey) {
      headers['Authorization'] = `Bearer ${decrypt(auth.apiKey)}`;
    }
    return headers;
  }

  /**
   * List models. If config.options.apiPath is not set, probes known paths in
   * order and sets this._effectivePath so the caller can persist it.
   */
  async listModels() {
    const pathsToTry = this.config.options?.apiPath
      ? [this.config.options.apiPath]
      : ['/v1', '/api/v1'];

    let lastError;
    for (const path of pathsToTry) {
      const url = `${this.getBaseUrl()}${path}/models`;
      try {
        const resp = await fetch(url, { headers: this.getHeaders() });
        if (!resp.ok) {
          lastError = new Error(`${url} → ${resp.status} ${await resp.text()}`);
          continue;
        }
        const data = await resp.json();
        // Expose the working path so discover endpoint can persist it
        this._effectivePath = path;
        return (data.data || []).map(m => ({
          id: m.id,
          name: m.id,
          ownedBy: m.owned_by || this.provider.name,
          capabilities: ['chat'],
        }));
      } catch (err) {
        lastError = new Error(`${url} → ${err.message}`);
      }
    }
    throw new Error(
      `Failed to list models (tried: ${pathsToTry.join(', ')}): ${lastError?.message}`
    );
  }

  async chat(request) {
    const resp = await fetch(`${this.getBaseUrl()}${this.getApiPath()}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...request, stream: false }),
      ...this.fetchOptions(),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Chat error ${resp.status}: ${err}`);
    }
    return resp.json();
  }

  async *chatStream(request) {
    const resp = await fetch(`${this.getBaseUrl()}${this.getApiPath()}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...request, stream: true, stream_options: { include_usage: true } }),
      ...this.fetchOptions(),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Stream error ${resp.status}: ${err}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            // Detect provider error events embedded in the stream
            if (data.error) {
              const errMsg = typeof data.error === 'string' ? data.error
                : data.error.message || JSON.stringify(data.error);
              const err = new Error(errMsg);
              err.status = data.error.code || data.error.status || 400;
              throw err;
            }
            yield data;
          } catch (e) {
            // Re-throw if it's our provider error detection, skip if parse error
            if (e.status) throw e;
          }
        }
        // Detect raw error lines (some proxies send non-SSE error text)
        if (!trimmed.startsWith('data: ') && trimmed.includes('error') && trimmed.includes('400')) {
          const err = new Error(trimmed);
          err.status = 400;
          throw err;
        }
      }
    }
  }

  async embeddings(request) {
    const resp = await fetch(`${this.getBaseUrl()}${this.getApiPath()}/embeddings`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Embeddings error ${resp.status}: ${err}`);
    }
    return resp.json();
  }
}
