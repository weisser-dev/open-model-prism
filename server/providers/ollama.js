import { OpenAIProvider } from './openai.js';

/**
 * Ollama Provider — uses OpenAI-compatible API with Ollama-specific model discovery.
 */
export class OllamaProvider extends OpenAIProvider {
  getBaseUrl() {
    return (this.config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  }

  getHeaders() {
    // Ollama typically doesn't need auth
    return { 'Content-Type': 'application/json' };
  }

  async listModels() {
    // Try Ollama native API first
    try {
      const resp = await fetch(`${this.getBaseUrl()}/api/tags`);
      if (resp.ok) {
        const data = await resp.json();
        return (data.models || []).map(m => ({
          id: m.name || m.model,
          name: m.name || m.model,
          ownedBy: 'ollama',
          capabilities: ['chat'],
          contextWindow: m.details?.context_length,
        }));
      }
    } catch {
      // Fall through to OpenAI-compat endpoint
    }

    // Fallback: OpenAI-compatible /v1/models
    return super.listModels();
  }
}
