/**
 * LLM Client — thin wrapper around the Anthropic SDK.
 *
 * Handles: API calls, JSON parsing, Zod validation, token tracking.
 * Supports multimodal messages (text + screenshot images).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { AgentResponse } from './types.js';

export interface LLMClientConfig {
  model?: string;
  apiKey?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Base64-encoded screenshot image (user messages only) */
  screenshot?: string;
}

interface TokenUsage {
  input: number;
  output: number;
  estimatedCost: number;
}

// Cost per 1M tokens (approximate, Claude Sonnet 4)
const COST_PER_1M_INPUT = 3.0;
const COST_PER_1M_OUTPUT = 15.0;

export class LLMClient {
  private client: Anthropic;
  private model: string;
  private _totalTokens: TokenUsage = { input: 0, output: 0, estimatedCost: 0 };

  constructor(config: LLMClientConfig = {}) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    const baseURL = process.env.ANTHROPIC_BASE_URL ?? undefined;
    this.client = new Anthropic({ apiKey, baseURL });
    this.model = config.model ?? 'claude-sonnet-4-20250514';
  }

  async chat(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<AgentResponse> {
    const apiMessages: MessageParam[] = messages.map(m => {
      if (m.role === 'user' && m.screenshot) {
        // Multimodal: text + image
        const content: ContentBlockParam[] = [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: m.screenshot,
            },
          },
          { type: 'text', text: m.content },
        ];
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: apiMessages,
    });

    // Track tokens
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    this._totalTokens.input += inputTokens;
    this._totalTokens.output += outputTokens;
    this._totalTokens.estimatedCost =
      (this._totalTokens.input / 1_000_000) * COST_PER_1M_INPUT +
      (this._totalTokens.output / 1_000_000) * COST_PER_1M_OUTPUT;

    // Extract text content
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content in LLM response');
    }

    // Parse JSON from the response
    const jsonText = extractJson(textBlock.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      throw new Error(`Failed to parse LLM response as JSON: ${(e as Error).message}\nResponse: ${textBlock.text.slice(0, 500)}`);
    }

    // Validate with Zod
    const result = AgentResponse.safeParse(parsed);
    if (!result.success) {
      throw new Error(`LLM response validation failed: ${result.error.message}\nParsed: ${JSON.stringify(parsed).slice(0, 500)}`);
    }

    return result.data;
  }

  getTokenUsage(): TokenUsage {
    return { ...this._totalTokens };
  }
}

/**
 * Extract JSON from text that may contain markdown code fences or other wrapping.
 */
function extractJson(text: string): string {
  // Try to find JSON within markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Try to find a JSON object directly
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  // Return as-is and let JSON.parse handle the error
  return text.trim();
}
