let tokenizerInstance: { encode: (text: string) => { length: number } } | null = null;
let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (tokenizerInstance) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Dynamic import for @huggingface/tokenizers
    const { Tokenizer } = await import('@huggingface/tokenizers');
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const tokenizerPath = join(__dirname, '..', 'data', 'qwen2.5-coder-tokenizer.json');
    const tokenizerJson = readFileSync(tokenizerPath, 'utf-8');
    tokenizerInstance = Tokenizer.fromString(tokenizerJson);
  })();

  return initPromise;
}

export async function countTokens(text: string): Promise<number> {
  await ensureInitialized();
  if (!tokenizerInstance) throw new Error('HuggingFace tokenizer not initialized');
  const encoded = tokenizerInstance.encode(text);
  return encoded.length;
}
