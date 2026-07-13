/**
 * Character-based token estimation fallback.
 * Uses chars ÷ 4 as a conservative universal estimate.
 * Always overestimates relative to exact tokenizers.
 */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
