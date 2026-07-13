import { extname } from 'node:path';
import type { ContextLanguage } from './types.js';

const EXTENSION_LANGUAGE = new Map<string, ContextLanguage>([
  ['.ts', 'typescript'],
  ['.tsx', 'tsx'],
  ['.js', 'javascript'],
  ['.jsx', 'jsx'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.md', 'markdown'],
  ['.json', 'json'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.sql', 'sql'],
  ['.ps1', 'powershell'],
  ['.bat', 'batch'],
  ['.sh', 'shell'],
  ['.py', 'python'],
]);

export function detectLanguage(filePath: string): ContextLanguage {
  return EXTENSION_LANGUAGE.get(extname(filePath).toLowerCase()) ?? 'text';
}

export function isSupportedTextPath(filePath: string): boolean {
  return EXTENSION_LANGUAGE.has(extname(filePath).toLowerCase());
}

export function isTypeScriptLike(language: ContextLanguage): boolean {
  return language === 'typescript' || language === 'tsx' || language === 'javascript' || language === 'jsx';
}
