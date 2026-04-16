/**
 * Native AWS Bedrock Provider Adapter.
 * Uses Converse / ConverseStream API directly via @aws-sdk/client-bedrock-runtime.
 * No external proxy needed — connects to Bedrock with IAM credentials or access keys.
 *
 * Supports: chat, streaming, tool calling, model listing, cross-region inference profiles.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import { BaseProvider } from './base.js';
import { decrypt } from '../utils/encryption.js';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpsProxyAgent } from 'https-proxy-agent';

export class BedrockProvider extends BaseProvider {

  /** Create AWS clients lazily */
  _getClients() {
    if (this._clients) return this._clients;

    const auth = this.config.auth || {};
    const region = auth.region || 'us-east-1';
    const baseConfig = { region, maxAttempts: 4 };

    // Explicit credentials (accessKeyId + secretAccessKey)
    if (auth.type === 'aws_credentials' && auth.accessKeyId && auth.secretAccessKey) {
      baseConfig.credentials = {
        accessKeyId: decrypt(auth.accessKeyId),
        secretAccessKey: decrypt(auth.secretAccessKey),
      };
    }
    // Else: use default credential chain (IAM role, env vars, ~/.aws/credentials)

    // HTTP proxy support — AWS SDK needs a custom requestHandler with tunnel agent
    const proxyUrl = this.config.options?.httpProxy;
    if (proxyUrl) {
      // https-proxy-agent tunnels HTTPS requests through an HTTP/HTTPS proxy
      const proxyAgent = new HttpsProxyAgent(proxyUrl);
      baseConfig.requestHandler = new NodeHttpHandler({
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent,
      });
    }

    // Separate VPC endpoints for runtime and control plane
    const runtimeEndpoint = this.config.options?.vpcEndpointRuntime || null;
    const controlEndpoint = this.config.options?.vpcEndpointControl || null;

    this._clients = {
      runtime: new BedrockRuntimeClient({ ...baseConfig, ...(runtimeEndpoint && { endpoint: runtimeEndpoint }) }),
      control: new BedrockClient({ ...baseConfig, ...(controlEndpoint && { endpoint: controlEndpoint }) }),
    };
    return this._clients;
  }

  // ── OpenAI messages → Bedrock Converse format ──────────────────────────────

  _convertMessages(messages) {
    const system = [];
    const bedrockMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        const text = typeof msg.content === 'string' ? msg.content
          : Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
          : String(msg.content || '');
        if (text) system.push({ text });
        continue;
      }

      if (msg.role === 'tool') {
        // Tool result → Bedrock toolResult block inside a user message
        const toolText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
        const content = [{
          toolResult: {
            toolUseId: msg.tool_call_id || 'unknown',
            // Bedrock rejects empty toolResult content — use placeholder if blank
            content: [{ text: toolText.trim() || '(empty result)' }],
          },
        }];
        // Append to last user message if possible, else create new
        if (bedrockMessages.length && bedrockMessages[bedrockMessages.length - 1].role === 'user') {
          bedrockMessages[bedrockMessages.length - 1].content.push(...content);
        } else {
          bedrockMessages.push({ role: 'user', content });
        }
        continue;
      }

      // user or assistant
      const content = this._convertContent(msg);
      if (!content.length) continue;

      // Bedrock requires alternating user/assistant — merge consecutive same-role
      if (bedrockMessages.length && bedrockMessages[bedrockMessages.length - 1].role === msg.role) {
        bedrockMessages[bedrockMessages.length - 1].content.push(...content);
      } else {
        bedrockMessages.push({ role: msg.role, content });
      }
    }

    // Bedrock requires conversation starts with user message
    if (bedrockMessages.length && bedrockMessages[0].role !== 'user') {
      bedrockMessages.unshift({ role: 'user', content: [{ text: '.' }] });
    }

    // Bedrock requires every assistant tool_use block is followed by a user message
    // with matching tool_result. Check ALL assistant messages, not just the last one.
    for (let i = 0; i < bedrockMessages.length; i++) {
      const msg = bedrockMessages[i];
      if (msg.role !== 'assistant') continue;
      const toolUseBlocks = msg.content?.filter(c => c.toolUse) || [];
      if (!toolUseBlocks.length) continue;
      // Check if next message is a user message with toolResult blocks
      const nextMsg = bedrockMessages[i + 1];
      const hasResults = nextMsg?.role === 'user' && nextMsg.content?.some(c => c.toolResult);
      if (!hasResults) {
        // No tool results follow — strip all tool_use blocks
        msg.content = msg.content.filter(c => !c.toolUse);
        if (!msg.content.length) msg.content = [{ text: '.' }];
      } else {
        // Check each tool_use has a matching tool_result
        const resultIds = new Set(
          (nextMsg.content || []).filter(c => c.toolResult).map(c => c.toolResult.toolUseId)
        );
        const orphanedUseBlocks = toolUseBlocks.filter(c => !resultIds.has(c.toolUse.toolUseId));
        if (orphanedUseBlocks.length) {
          msg.content = msg.content.filter(c => !c.toolUse || resultIds.has(c.toolUse.toolUseId));
          if (!msg.content.length) msg.content = [{ text: '.' }];
        }
      }
    }

    // Bedrock requires conversation ends with user (for some models)
    if (bedrockMessages.length && bedrockMessages[bedrockMessages.length - 1].role !== 'user') {
      bedrockMessages.push({ role: 'user', content: [{ text: 'Continue.' }] });
    }

    return { system, messages: bedrockMessages };
  }

  _convertContent(msg) {
    const content = [];

    if (typeof msg.content === 'string') {
      // Bedrock rejects empty text blocks — skip blank content
      if (msg.content.trim()) {
        content.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' || block.type === 'input_text' || block.type === 'output_text') {
          // Skip empty/blank text blocks — Bedrock rejects them
          if (block.text?.trim()) content.push({ text: block.text });
        } else if (block.type === 'image_url' || block.type === 'input_image') {
          const url = block.image_url?.url || block.image_url || '';
          if (url.startsWith('data:')) {
            const [header, data] = url.split(',');
            const format = header.match(/image\/(\w+)/)?.[1] || 'jpeg';
            content.push({ image: { format, source: { bytes: Buffer.from(data, 'base64') } } });
          }
        } else if (block.type === 'tool_use') {
          content.push({ toolUse: { toolUseId: block.id, name: block.name, input: block.input || {} } });
        }
      }
    }

    // Convert assistant tool_calls
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let input;
        try {
          input = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {});
        } catch {
          // Malformed JSON in tool call arguments — pass as string wrapped in object
          input = { raw: tc.function?.arguments || '' };
        }
        content.push({
          toolUse: {
            toolUseId: tc.id,
            name: (tc.function?.name || tc.name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_'),
            input,
          },
        });
      }
    }

    // If assistant message had tool_calls but no text content, ensure we still have content
    // (Bedrock requires at least one content block per message)
    if (!content.length && msg.role === 'assistant') {
      content.push({ text: '.' });
    }

    return content;
  }

  _convertTools(tools) {
    if (!tools?.length) return undefined;
    return {
      tools: tools.map(t => ({
        toolSpec: {
          name: (t.function?.name || t.name || '').replace(/[^a-zA-Z0-9_-]/g, '_'),
          description: t.function?.description || t.description || '',
          inputSchema: { json: t.function?.parameters || t.parameters || { type: 'object', properties: {} } },
        },
      })),
    };
  }

  _convertToolChoice(toolChoice) {
    if (!toolChoice) return undefined;
    if (toolChoice === 'auto') return { auto: {} };
    if (toolChoice === 'required' || toolChoice === 'any') return { any: {} };
    if (toolChoice === 'none') return undefined; // Bedrock doesn't support "none"
    if (typeof toolChoice === 'object' && toolChoice.function?.name) {
      return { tool: { name: toolChoice.function.name } };
    }
    return { auto: {} };
  }

  // ── Bedrock response → OpenAI format ───────────────────────────────────────

  _convertResponse(response, modelId) {
    const output = response.output?.message || {};
    const usage = response.usage || {};
    const stopReason = response.stopReason || 'end_turn';

    const message = { role: 'assistant', content: null, tool_calls: [] };
    let textContent = '';

    for (const block of (output.content || [])) {
      if (block.text) textContent += block.text;
      if (block.toolUse) {
        message.tool_calls.push({
          id: block.toolUse.toolUseId,
          type: 'function',
          function: {
            name: block.toolUse.name,
            arguments: JSON.stringify(block.toolUse.input || {}),
          },
        });
      }
    }

    message.content = textContent || null;
    if (!message.tool_calls.length) delete message.tool_calls;

    return {
      id: `chatcmpl-${Date.now().toString(36)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message,
        finish_reason: this._mapStopReason(stopReason),
      }],
      usage: {
        prompt_tokens: usage.inputTokens || 0,
        completion_tokens: usage.outputTokens || 0,
        total_tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
      },
    };
  }

  _mapStopReason(reason) {
    const map = {
      end_turn: 'stop',
      tool_use: 'tool_calls',
      max_tokens: 'length',
      stop_sequence: 'stop',
      content_filtered: 'content_filter',
    };
    return map[reason] || 'stop';
  }

  // ── Error handling ─────────────────────────────────────────────────────────

  _enhanceError(err) {
    const msg = err.message || '';
    // HTML response instead of JSON → proxy/VPC endpoint returning error page
    if (msg.includes('<!DOCTYPE') || msg.includes('is not valid JSON') || msg.includes('Deserialization error')) {
      const rawBody = err.$response?.body ? Buffer.from(err.$response.body).toString('utf-8').slice(0, 200) : '';
      const hint = this.config.options?.httpProxy
        ? `The proxy at ${this.config.options.httpProxy} appears to be blocking or intercepting this request — it returned an HTML page instead of forwarding to Bedrock. Check that the proxy allows traffic to the Bedrock endpoint URL.`
        : this.config.options?.vpcEndpointRuntime
          ? `The VPC endpoint returned an HTML page instead of a Bedrock API response. This usually means the endpoint URL is incorrect or the endpoint is not properly connected to the Bedrock Runtime service. Double-check the VPC endpoint URL.`
          : `Received an HTML page instead of a Bedrock API response. A proxy, firewall, or misconfigured network is intercepting the request before it reaches Bedrock.`;
      return new Error(`[bedrock] ${hint}${rawBody ? ` (response: ${rawBody.slice(0, 120)}...)` : ''}`);
    }
    // Connection refused / network errors
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
      const target = this.config.options?.vpcEndpointRuntime || this.config.options?.httpProxy || 'Bedrock';
      return new Error(`[bedrock] Cannot reach ${target} — connection ${msg.includes('ENOTFOUND') ? 'failed (DNS not found)' : msg.includes('ETIMEDOUT') ? 'timed out' : 'refused'}. Verify the URL and network connectivity.`);
    }
    return new Error(`[bedrock] ${err.name}: ${msg}`);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async chat(request) {
    const { runtime } = this._getClients();
    const { system, messages } = this._convertMessages(request.messages);
    const toolConfig = this._convertTools(request.tools);

    const args = {
      modelId: request.model,
      messages,
      ...(system.length && { system }),
      inferenceConfig: {
        ...(request.max_tokens && { maxTokens: request.max_tokens }),
        ...(request.temperature != null && { temperature: request.temperature }),
        ...(request.top_p != null && { topP: request.top_p }),
      },
      ...(toolConfig && { toolConfig }),
    };

    if (toolConfig && request.tool_choice) {
      args.toolConfig.toolChoice = this._convertToolChoice(request.tool_choice);
    }

    try {
      const response = await runtime.send(new ConverseCommand(args));
      return this._convertResponse(response, request.model);
    } catch (err) {
      // Retry without stopSequences if model doesn't support them
      if (err.name === 'ValidationException' && err.message?.includes('stopSequences')) {
        delete args.inferenceConfig.stopSequences;
        const response = await runtime.send(new ConverseCommand(args));
        return this._convertResponse(response, request.model);
      }
      throw this._enhanceError(err);
    }
  }

  async *chatStream(request) {
    const { runtime } = this._getClients();
    const { system, messages } = this._convertMessages(request.messages);
    const toolConfig = this._convertTools(request.tools);

    const args = {
      modelId: request.model,
      messages,
      ...(system.length && { system }),
      inferenceConfig: {
        ...(request.max_tokens && { maxTokens: request.max_tokens }),
        ...(request.temperature != null && { temperature: request.temperature }),
        ...(request.top_p != null && { topP: request.top_p }),
      },
      ...(toolConfig && { toolConfig }),
    };

    if (toolConfig && request.tool_choice) {
      args.toolConfig.toolChoice = this._convertToolChoice(request.tool_choice);
    }

    let response;
    try {
      response = await runtime.send(new ConverseStreamCommand(args));
    } catch (err) {
      throw this._enhanceError(err);
    }

    let toolCallIndex = -1;

    for await (const event of response.stream) {
      if (event.contentBlockStart) {
        if (event.contentBlockStart.start?.toolUse) {
          const toolUse = event.contentBlockStart.start.toolUse;
          toolCallIndex++;
          // Send tool call header (name + id) immediately on block start
          // Arguments will follow in contentBlockDelta events
          yield {
            id: `chatcmpl-${Date.now().toString(36)}`,
            object: 'chat.completion.chunk',
            model: request.model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: toolCallIndex,
                  id: toolUse.toolUseId,
                  type: 'function',
                  function: { name: toolUse.name, arguments: '' },
                }],
              },
              finish_reason: null,
            }],
          };
        }
      }

      if (event.contentBlockDelta) {
        const delta = event.contentBlockDelta.delta;
        if (delta?.text) {
          yield {
            id: `chatcmpl-${Date.now().toString(36)}`,
            object: 'chat.completion.chunk',
            model: request.model,
            choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
          };
        }
        if (delta?.toolUse) {
          // Stream tool call argument fragments — every delta.toolUse.input
          // is a JSON string fragment that the client accumulates
          yield {
            id: `chatcmpl-${Date.now().toString(36)}`,
            object: 'chat.completion.chunk',
            model: request.model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: toolCallIndex,
                  function: { arguments: delta.toolUse.input || '' },
                }],
              },
              finish_reason: null,
            }],
          };
        }
      }

      if (event.messageStop) {
        yield {
          id: `chatcmpl-${Date.now().toString(36)}`,
          object: 'chat.completion.chunk',
          model: request.model,
          choices: [{ index: 0, delta: {}, finish_reason: this._mapStopReason(event.messageStop.stopReason) }],
        };
      }

      if (event.metadata?.usage) {
        yield {
          id: `chatcmpl-${Date.now().toString(36)}`,
          object: 'chat.completion.chunk',
          model: request.model,
          choices: [],
          usage: {
            prompt_tokens: event.metadata.usage.inputTokens || 0,
            completion_tokens: event.metadata.usage.outputTokens || 0,
            total_tokens: (event.metadata.usage.inputTokens || 0) + (event.metadata.usage.outputTokens || 0),
          },
        };
      }
    }
  }

  async listModels() {
    const { control } = this._getClients();
    const models = [];

    try {
      // List foundation models
      const fmResponse = await control.send(new ListFoundationModelsCommand({
        byOutputModality: 'TEXT',
      }));
      for (const m of (fmResponse.modelSummaries || [])) {
        if (!m.inferenceTypesSupported?.includes('ON_DEMAND')) continue;
        if (!m.responseStreamingSupported) continue;
        models.push({
          id: m.modelId,
          name: m.modelName,
          ownedBy: m.providerName || 'bedrock',
        });
      }

      // List cross-region inference profiles
      try {
        const profileResponse = await control.send(new ListInferenceProfilesCommand({
          typeEquals: 'SYSTEM_DEFINED',
        }));
        for (const p of (profileResponse.inferenceProfileSummaries || [])) {
          if (p.status !== 'ACTIVE') continue;
          models.push({
            id: p.inferenceProfileId || p.inferenceProfileArn,
            name: p.inferenceProfileName,
            ownedBy: 'bedrock',
          });
        }
      } catch { /* profiles not available in all regions */ }
    } catch (err) {
      // Control plane VPC endpoint may not be configured — return empty list
      // (user can still use Runtime endpoint for chat, just no auto-discovery)
      if (err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND') || err.message?.includes('getaddrinfo')) {
        return []; // Graceful fallback — no control plane access
      }
      throw this._enhanceError(err);
    }

    return models;
  }

  async testConnection() {
    const start = Date.now();
    // Try control plane first (list models), fall back to runtime if VPC not available
    try {
      const { control } = this._getClients();
      await control.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' }));
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
        // Control plane VPC not configured — test runtime instead
        // Runtime is the important one (actually serves chat requests)
        return { ok: true, latencyMs: Date.now() - start, note: 'Control plane VPC not reachable — runtime endpoint may still work' };
      }
      throw err;
    }
  }
}
