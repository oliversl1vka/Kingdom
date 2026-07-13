import { encoding_for_model, get_encoding, type TiktokenEncoding } from 'tiktoken';

const encodingCache = new Map<string, ReturnType<typeof get_encoding>>();

function getEncoder(encoding: string): ReturnType<typeof get_encoding> {
  let enc = encodingCache.get(encoding);
  if (!enc) {
    enc = get_encoding(encoding as TiktokenEncoding);
    encodingCache.set(encoding, enc);
  }
  return enc;
}

export function countTokens(text: string, encoding: string = 'o200k_base'): number {
  const enc = getEncoder(encoding);
  const tokens = enc.encode(text);
  return tokens.length;
}

export function countTokensForModel(text: string, model: string): number {
  const enc = encoding_for_model(model as Parameters<typeof encoding_for_model>[0]);
  const tokens = enc.encode(text);
  const count = tokens.length;
  enc.free();
  return count;
}
