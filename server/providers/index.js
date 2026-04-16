import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { BedrockProvider } from './bedrock.js';
import { AzureProvider } from './azure.js';

const providerMap = {
  openai: OpenAIProvider,
  openrouter: OpenAIProvider,
  vllm: OpenAIProvider,
  custom: OpenAIProvider,
  ollama: OllamaProvider,
  bedrock: BedrockProvider,           // Native AWS Bedrock via Converse API
  'bedrock-proxy': OpenAIProvider,    // OpenAI-compatible Bedrock proxy (legacy)
  azure: AzureProvider,               // Native Azure OpenAI (deployment-based)
  'azure-proxy': OpenAIProvider,      // OpenAI-compatible Azure proxy (legacy)
};

export function getProviderAdapter(providerDoc) {
  const ProviderClass = providerMap[providerDoc.type] || OpenAIProvider;
  return new ProviderClass(providerDoc);
}
