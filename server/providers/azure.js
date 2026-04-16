/**
 * Native Azure OpenAI Provider Adapter.
 * Calls Azure OpenAI directly — no external proxy needed.
 *
 * Supports:
 * - Chat Completions API (classic deployments)
 * - Deployment-based model routing (/openai/deployments/{name}/...)
 * - API Key authentication (api-key header)
 * - Custom API versions
 * - Streaming via SSE
 * - Tool/function calling (passthrough — Azure uses OpenAI format)
 *
 * Config:
 *   baseUrl:  Azure endpoint (https://{resource}.openai.azure.com)
 *   auth.apiKey: Azure OpenAI API key
 *   options.apiVersion: API version (default: 2025-04-01-preview)
 *   options.deployments: comma-separated deployment names (model → deployment mapping)
 */
import { BaseProvider } from './base.js';
import { decrypt } from '../utils/encryption.js';

export class AzureProvider extends BaseProvider {

  getEndpoint() {
    return (this.config.baseUrl || '').replace(/\/$/, '');
  }

  getApiVersion() {
    return this.config.options?.apiVersion || '2025-04-01-preview';
  }

  getHeaders() {
    const auth = this.config.auth || {};
    return {
      'Content-Type': 'application/json',
      'api-key': auth.apiKey ? decrypt(auth.apiKey) : '',
    };
  }

  /**
   * Map model name to Azure deployment name.
   * If deployments are configured, the model must match one.
   * Otherwise, use the model name as-is (deployment = model).
   */
  _resolveDeployment(modelId) {
    const deployments = (this.config.options?.deployments || '').split(',').map(s => s.trim()).filter(Boolean);
    if (deployments.length && deployments.includes(modelId)) return modelId;
    if (deployments.length && !deployments.includes(modelId)) {
      // Try partial match (e.g. "gpt-5.2" matches deployment "gpt-5.2")
      const match = deployments.find(d => d === modelId || d.includes(modelId) || modelId.includes(d));
      if (match) return match;
    }
    return modelId; // Use as-is
  }

  /**
   * Check if a model uses the Responses API (e.g. gpt-5.3-codex).
   */
  _isResponsesModel(modelId) {
    const responsesModels = (this.config.options?.responsesModels || '').split(',').map(s => s.trim()).filter(Boolean);
    return responsesModels.some(m => m === modelId || modelId.includes(m) || m.includes(modelId));
  }

  _buildUrl(deployment, isResponses = false) {
    const endpoint = this.getEndpoint();
    const apiVersion = this.getApiVersion();
    if (isResponses) {
      return `${endpoint}/openai/responses?api-version=${apiVersion}`;
    }
    return `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${apiVersion}`;
  }

  // ── v2.1.2: universal Azure request sanitization ──────────────────────────
  // Runs BEFORE both Chat Completions and Responses API paths so that cross-
  // provider incompatibilities are fixed regardless of which API is used.
  //
  // 1. Strip `tool_calls` from assistant messages in the conversation history.
  //    Azure's Responses API rejects them outright, and Azure's Chat Completions
  //    API may also reject them when internally using the Responses API for
  //    newer models (gpt-5.2, gpt-5.3-codex, etc.). Stripping them here avoids
  //    the 400 "Unknown parameter: 'input[N].tool_calls'" error that occurs
  //    when a conversation starts on Bedrock/Anthropic (which embeds tool_calls
  //    in assistant messages) and then gets routed to Azure.
  //
  // 2. Clamp/remove `temperature` for reasoning models (o1, o3, gpt-5.2, …).
  //    These models only accept temperature=1 or no temperature at all. Any
  //    other value produces 400 "Unsupported value: 'temperature'".
  //
  // 3. Strip `cache_control` from all messages (Anthropic-only feature).
  _sanitizeForAzure(body) {
    // ── WHITELIST approach: only keep params Azure actually accepts ────────
    // Any client-specific, Anthropic-specific, or future unknown param is
    // automatically stripped. This is more robust than blacklisting because
    // new IDEs/agents can't break Azure by sending novel parameters.
    //
    // Source: https://learn.microsoft.com/en-us/azure/foundry/openai/reference
    // (Chat Completions createChatCompletionRequest + Responses API)
    const AZURE_ALLOWED_PARAMS = new Set([
      // Chat Completions API
      'messages', 'temperature', 'top_p', 'stream', 'stop', 'max_tokens',
      'max_completion_tokens', 'presence_penalty', 'frequency_penalty',
      'logit_bias', 'user', 'data_sources', 'logprobs', 'top_logprobs',
      'n', 'parallel_tool_calls', 'response_format', 'seed', 'tools',
      'tool_choice', 'function_call', 'functions', 'stream_options',
      // Responses API
      'model', 'input', 'max_output_tokens', 'instructions',
      'reasoning', 'reasoning_effort',
      // Internal (set by our adapter)
      'stream',
    ]);

    for (const key of Object.keys(body)) {
      if (!AZURE_ALLOWED_PARAMS.has(key)) {
        delete body[key];
      }
    }

    // ── Reasoning-model adjustments ───────────────────────────────────────
    const model = (body.model || '').toLowerCase();
    const isReasoningModel = /\b(o1|o3|o4|gpt-5\.2|gpt-5\.3|codex)\b/.test(model)
      || !!body.reasoning_effort || !!body.reasoning;

    if (isReasoningModel) {
      // Reasoning models only accept temperature=1; any other value → 400
      if (body.temperature != null && body.temperature !== 1) delete body.temperature;
      // top_p only accepts 1
      if (body.top_p != null && body.top_p !== 1) delete body.top_p;
      // presence/frequency penalty not supported
      delete body.presence_penalty;
      delete body.frequency_penalty;
    }

    // ── Strip cross-provider fields from messages ─────────────────────────
    const messages = body.messages || body.input;
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg.tool_calls) delete msg.tool_calls;
        if (msg.cache_control) delete msg.cache_control;
        // Block-level cache_control + other Anthropic fields
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.cache_control) delete block.cache_control;
          }
        }
      }
    }

    return body;
  }

  async chat(request) {
    const deployment = this._resolveDeployment(request.model);
    const isResponses = this._isResponsesModel(request.model);
    const url = this._buildUrl(deployment, isResponses);

    const body = this._sanitizeForAzure({ ...request, stream: false });
    if (isResponses) {
      // Responses API: model in body, input instead of messages, max_output_tokens
      body.model = request.model;
      // Sanitize content block types for Responses API:
      // - user messages: text/input_text → input_text
      // - assistant messages: text/input_text → output_text
      body.input = (body.messages || []).map(msg => {
        const { cache_control: _cc, tool_calls: _tc, ...cleanMsg } = msg; // strip cache_control + tool_calls (unsupported in Responses API)
        if (!Array.isArray(cleanMsg.content)) return cleanMsg;
        return {
          ...cleanMsg,
          content: cleanMsg.content.map(block => {
            const { cache_control: _bc, ...cleanBlock } = block; // strip block-level cache_control
            if (cleanBlock.type === 'text' || cleanBlock.type === 'input_text' || cleanBlock.type === 'output_text') {
              const targetType = msg.role === 'assistant' ? 'output_text' : 'input_text';
              return { ...cleanBlock, type: targetType };
            }
            return cleanBlock;
          }),
        };
      });
      delete body.messages;
      // Convert tools from Chat Completions format to Responses API format
      // CC: { type: "function", function: { name, description, parameters } }
      // RA: { type: "function", name, description, parameters }
      if (body.tools?.length) {
        body.tools = body.tools.map(t => {
          if (t.function) {
            return { type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters };
          }
          return t;
        });
      }
      if (body.max_tokens) { body.max_output_tokens = body.max_tokens; delete body.max_tokens; }
      delete body.max_completion_tokens;
      // Convert reasoning_effort → reasoning.effort for Responses API
      if (body.reasoning_effort) {
        body.reasoning = { effort: body.reasoning_effort };
        delete body.reasoning_effort;
      }
      // Remove unsupported Chat Completions params
      delete body.stream_options;
      delete body.frequency_penalty;
      delete body.presence_penalty;
      delete body.logprobs;
      delete body.top_logprobs;
      delete body.n;
    } else {
      // Chat Completions: max_completion_tokens, model NOT in body
      if (body.max_tokens && !body.max_completion_tokens) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
      }
      delete body.model;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      ...this.fetchOptions(),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[azure] ${resp.status}: ${err}`);
    }

    const data = await resp.json();

    // Convert Responses API output → OpenAI Chat Completions format
    if (isResponses && data.output && !data.choices) {
      const textContent = data.output
        .filter(o => o.type === 'message' && o.role === 'assistant')
        .flatMap(o => (o.content || []).filter(c => c.type === 'output_text').map(c => c.text))
        .join('');
      return {
        id: data.id || `chatcmpl-${Date.now().toString(36)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [{ index: 0, message: { role: 'assistant', content: textContent || null }, finish_reason: data.status === 'completed' ? 'stop' : 'stop' }],
        usage: {
          prompt_tokens: data.usage?.input_tokens || 0,
          completion_tokens: data.usage?.output_tokens || 0,
          total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
      };
    }

    data.model = data.model || request.model;
    return data;
  }

  async *chatStream(request) {
    const deployment = this._resolveDeployment(request.model);
    const isResponses = this._isResponsesModel(request.model);
    const url = this._buildUrl(deployment, isResponses);

    const body = this._sanitizeForAzure({ ...request, stream: true });
    if (isResponses) {
      body.model = request.model;
      // Sanitize content block types + strip cache_control for Responses API
      body.input = (body.messages || []).map(msg => {
        const { cache_control: _cc, tool_calls: _tc, ...cleanMsg } = msg; // strip cache_control + tool_calls
        if (!Array.isArray(cleanMsg.content)) return cleanMsg;
        return {
          ...cleanMsg,
          content: cleanMsg.content.map(block => {
            const { cache_control: _bc, ...cleanBlock } = block;
            if (cleanBlock.type === 'text' || cleanBlock.type === 'input_text' || cleanBlock.type === 'output_text') {
              return { ...cleanBlock, type: msg.role === 'assistant' ? 'output_text' : 'input_text' };
            }
            return cleanBlock;
          }),
        };
      });
      delete body.messages;
      // Convert reasoning_effort → reasoning.effort for Responses API
      if (body.reasoning_effort) {
        body.reasoning = { effort: body.reasoning_effort };
        delete body.reasoning_effort;
      }
      // Convert tools from Chat Completions → Responses API format
      if (body.tools?.length) {
        body.tools = body.tools.map(t => {
          if (t.function) {
            return { type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters };
          }
          return t;
        });
      }
      if (body.max_tokens) { body.max_output_tokens = body.max_tokens; delete body.max_tokens; }
      delete body.max_completion_tokens;
      delete body.stream_options;
      delete body.frequency_penalty;
      delete body.presence_penalty;
    } else {
      body.stream_options = { include_usage: true };
      if (body.max_tokens && !body.max_completion_tokens) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
      }
      delete body.model;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      ...this.fetchOptions(),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[stream:azure] Azure OpenAI error (${resp.status}): ${err}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let responsesToolCallIndex = -1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);

          // Convert Responses API stream events → OpenAI chat.completion.chunk format
          if (isResponses && parsed.type) {
            const chunkId = parsed.response_id || `chatcmpl-${Date.now().toString(36)}`;

            // Text content delta
            if (parsed.type === 'response.output_text.delta' && parsed.delta) {
              yield {
                id: chunkId, object: 'chat.completion.chunk', model: request.model,
                choices: [{ index: 0, delta: { content: parsed.delta }, finish_reason: null }],
              };
            }
            // Tool call: new output item (contains function name + call_id)
            else if (parsed.type === 'response.output_item.added' && parsed.item?.type === 'function_call') {
              responsesToolCallIndex++;
              yield {
                id: chunkId, object: 'chat.completion.chunk', model: request.model,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: responsesToolCallIndex,
                      id: parsed.item.call_id || `call_${Date.now().toString(36)}`,
                      type: 'function',
                      function: { name: parsed.item.name || '', arguments: '' },
                    }],
                  },
                  finish_reason: null,
                }],
              };
            }
            // Tool call: argument chunks
            else if (parsed.type === 'response.function_call_arguments.delta' && parsed.delta) {
              yield {
                id: chunkId, object: 'chat.completion.chunk', model: request.model,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: responsesToolCallIndex,
                      function: { arguments: parsed.delta },
                    }],
                  },
                  finish_reason: null,
                }],
              };
            }
            // Tool call done — emit finish_reason: tool_calls when all items are done
            else if (parsed.type === 'response.output_item.done' && parsed.item?.type === 'function_call') {
              // Individual tool call done — don't emit finish_reason yet (wait for response.completed)
            }
            // Response completed — emit final chunk with usage
            else if (parsed.type === 'response.completed' && parsed.response?.usage) {
              const finishReason = responsesToolCallIndex >= 0 ? 'tool_calls' : 'stop';
              yield {
                id: parsed.response?.id || chunkId, object: 'chat.completion.chunk', model: request.model,
                choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
                usage: {
                  prompt_tokens: parsed.response.usage.input_tokens || 0,
                  completion_tokens: parsed.response.usage.output_tokens || 0,
                  total_tokens: (parsed.response.usage.input_tokens || 0) + (parsed.response.usage.output_tokens || 0),
                },
              };
            }
            // Skip other Responses API events (response.created, response.in_progress, etc.)
            continue;
          }

          // Standard Chat Completions chunk — pass through
          parsed.model = parsed.model || request.model;
          yield parsed;
        } catch { /* skip invalid JSON */ }
      }
    }
  }

  async listModels() {
    // Azure Data Plane API has NO /deployments list endpoint.
    // Return configured deployments. During discover, auto-detect which API each uses.
    const deployments = (this.config.options?.deployments || '').split(',').map(s => s.trim()).filter(Boolean);
    const responsesModels = (this.config.options?.responsesModels || '').split(',').map(s => s.trim()).filter(Boolean);
    const all = [...new Set([...deployments, ...responsesModels])];
    return all.map(d => ({
      id: d,
      name: d,
      ownedBy: 'azure',
      _isResponses: responsesModels.includes(d),
    }));
  }

  /**
   * Auto-detect which API each deployment supports.
   * Try Chat Completions first, if "unsupported" → try Responses API.
   * Updates config.options.responsesModels with detected models.
   */
  async autoDetectApiTypes() {
    const deployments = (this.config.options?.deployments || '').split(',').map(s => s.trim()).filter(Boolean);
    const responsesModels = (this.config.options?.responsesModels || '').split(',').map(s => s.trim()).filter(Boolean);
    const all = [...new Set([...deployments, ...responsesModels])];
    const detected = { chatCompletions: [], responses: [] };

    for (const model of all) {
      // Try Chat Completions first
      try {
        const url = this._buildUrl(model, false);
        const resp = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }], max_completion_tokens: 1 }),
          ...this.fetchOptions(),
        });
        if (resp.ok || resp.status === 400) {
          // 400 = request error but endpoint exists → Chat Completions works
          detected.chatCompletions.push(model);
          continue;
        }
        const errText = await resp.text();
        if (errText.includes('unsupported') || errText.includes('not found') || resp.status === 404) {
          // Chat Completions unsupported → try Responses API
          throw new Error('try responses');
        }
        // Other error (auth, rate limit) — assume Chat Completions
        detected.chatCompletions.push(model);
      } catch {
        // Try Responses API
        try {
          const url = this._buildUrl(model, true);
          const resp = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ model, input: [{ role: 'user', content: 'test' }], max_output_tokens: 1 }),
            ...this.fetchOptions(),
          });
          if (resp.ok || resp.status === 400) {
            detected.responses.push(model);
          } else {
            // Neither works — default to Chat Completions
            detected.chatCompletions.push(model);
          }
        } catch {
          detected.chatCompletions.push(model);
        }
      }
    }

    return detected;
  }

  async testConnection() {
    const start = Date.now();
    // Azure has no simple health check — test with the first configured deployment
    const deployments = (this.config.options?.deployments || '').split(',').map(s => s.trim()).filter(Boolean);
    const responsesModels = (this.config.options?.responsesModels || '').split(',').map(s => s.trim()).filter(Boolean);
    const testModel = deployments[0] || responsesModels[0];

    if (!testModel) {
      throw new Error('[azure] No deployments configured — add at least one deployment name');
    }

    // Send a minimal request to verify the endpoint + key work.
    // Use max_tokens=10 (not 1) because reasoning models (o1/o3/gpt-5.x)
    // need tokens for their internal CoT before producing visible output.
    try {
      await this.chat({ model: testModel, messages: [{ role: 'user', content: 'test' }], max_tokens: 10 });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      // "max_tokens or model output limit" errors mean the model IS reachable
      // — it responded but couldn't finish with the token budget. Treat as OK.
      if (/max_tokens|output.limit|length.*reached/i.test(err.message)) {
        return { ok: true, latencyMs: Date.now() - start };
      }
      throw new Error(`[azure] Connection test failed: ${err.message}`);
    }
  }
}
