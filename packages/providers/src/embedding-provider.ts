import type { EmbeddingProvider } from '@kingdomos/core';
import { createAbortSignal } from './abort.js';

/**
 * PHASE4 (P4.2): pluggable embedding backends for relevance-ranked lesson
 * injection. Both speak the OpenAI-compatible `/v1/embeddings` shape, so the
 * OpenAI cloud endpoint and a local llama.cpp / LM Studio embedding server are
 * the same code path with a different base URL + auth.
 *
 * The injector degrades gracefully when no provider is configured, so wiring
 * one in is purely additive — nothing breaks if the endpoint is down (the
 * provider throws, the injector falls back to frequency ordering).
 */

export interface OpenAIEmbeddingConfig {
  api_key: string;
  model?: string;
  endpoint?: string;
  timeout_ms?: number;
}

const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com';
const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
const DEFAULT_TIMEOUT = 30_000;

interface OpenAICompatEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
}

async function postEmbeddings(
  url: string,
  headers: Record<string, string>,
  model: string,
  texts: string[],
  timeoutMs: number,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const abort = createAbortSignal(timeoutMs);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, input: texts }),
    signal: abort.signal,
  });
  if (!res.ok) {
    throw new Error(`embedding request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as OpenAICompatEmbeddingResponse;
  const data = json.data ?? [];
  // Sort by index so output order matches input order regardless of server.
  const sorted = [...data].sort((a, b) => a.index - b.index);
  if (sorted.length !== texts.length) {
    throw new Error(`embedding count mismatch: got ${sorted.length}, expected ${texts.length}`);
  }
  return sorted.map((d) => d.embedding);
}

/** OpenAI text-embedding-3-small (default) embedding provider. */
export function createOpenAIEmbeddingProvider(config: OpenAIEmbeddingConfig): EmbeddingProvider {
  const {
    api_key,
    model = DEFAULT_OPENAI_MODEL,
    endpoint = OPENAI_DEFAULT_ENDPOINT,
    timeout_ms = DEFAULT_TIMEOUT,
  } = config;
  return {
    model,
    embed(texts: string[]): Promise<number[][]> {
      return postEmbeddings(
        `${endpoint}/v1/embeddings`,
        { Authorization: `Bearer ${api_key}` },
        model,
        texts,
        timeout_ms,
      );
    },
  };
}

export interface LocalEmbeddingConfig {
  /** Base URL of the OpenAI-compatible embedding server (llama.cpp / LM Studio). */
  endpoint?: string;
  /** Model id the local server expects. */
  model?: string;
  timeout_ms?: number;
}

const LOCAL_DEFAULT_ENDPOINT = 'http://localhost:8080';
const DEFAULT_LOCAL_MODEL = 'nomic-embed-text';

/**
 * Local embedding provider (llama.cpp `/v1/embeddings` or LM Studio). No API
 * key. Use this to keep the relevance-ranking loop fully offline.
 */
export function createLocalEmbeddingProvider(config: LocalEmbeddingConfig = {}): EmbeddingProvider {
  const {
    endpoint = LOCAL_DEFAULT_ENDPOINT,
    model = DEFAULT_LOCAL_MODEL,
    timeout_ms = DEFAULT_TIMEOUT,
  } = config;
  return {
    model,
    embed(texts: string[]): Promise<number[][]> {
      return postEmbeddings(`${endpoint}/v1/embeddings`, {}, model, texts, timeout_ms);
    },
  };
}
