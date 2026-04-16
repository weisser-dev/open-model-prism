/**
 * Base Provider Adapter — all providers must implement these methods.
 */
import { ProxyAgent } from 'undici';

export class BaseProvider {
  constructor(providerDoc) {
    this.provider = providerDoc;
    this.config = providerDoc.config || {};
  }

  /**
   * Get fetch options for proxy support.
   * If the provider has httpProxy configured, returns a dispatcher.
   * Use: `fetch(url, { ...this.fetchOptions(), headers, body })`
   */
  fetchOptions() {
    const proxy = this.config.options?.httpProxy;
    if (!proxy) return {};
    return { dispatcher: new ProxyAgent(proxy) };
  }

  /** List available models */
  async listModels() {
    throw new Error('listModels() not implemented');
  }

  /** Non-streaming chat completion */
  async chat(request) {
    throw new Error('chat() not implemented');
  }

  /** Streaming chat completion — yields chunks */
  async *chatStream(request) {
    throw new Error('chatStream() not implemented');
  }

  /** Embeddings */
  async embeddings(request) {
    throw new Error('embeddings() not implemented');
  }

  /** Test if connection works */
  async testConnection() {
    const models = await this.listModels();
    return { success: true, modelCount: models.length };
  }
}
