import type { ContextIntent, ParsedContextQuery } from '../types.js';

const FILTER_KEYS = new Set(['symbol', 'def', 'type', 'file', 'path', 'package', 'uses', 'intent']);

export function parseContextQuery(query: string, explicitIntent: ContextIntent = 'auto'): ParsedContextQuery {
  const filters: ParsedContextQuery['filters'] = {};
  const remaining: string[] = [];
  for (const part of query.trim().split(/\s+/)) {
    const match = part.match(/^([a-z-]+):(.+)$/i);
    if (match && FILTER_KEYS.has(match[1].toLowerCase())) {
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      if (key === 'intent') continue;
      filters[key as keyof ParsedContextQuery['filters']] = value;
    } else {
      remaining.push(part);
    }
  }

  const intentToken = query.match(/(?:^|\s)intent:([a-z-]+)/i)?.[1] as ContextIntent | undefined;
  const textQuery = remaining.join(' ').trim();
  const intent = explicitIntent !== 'auto' ? explicitIntent : intentToken ?? inferIntent(query, filters);
  return {
    rawQuery: query,
    textQuery,
    intent,
    filters,
    terms: tokenizeForSearch(`${textQuery} ${Object.values(filters).join(' ')}`),
  };
}

export function tokenizeForSearch(value: string): string[] {
  const splitCamel = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const terms = splitCamel
    .toLowerCase()
    .match(/[a-z0-9_@.-]+/g);
  return Array.from(new Set((terms ?? []).filter((term) => term.length > 1)));
}

export function buildFtsQuery(terms: string[]): string | undefined {
  const safeTerms = terms
    .map((term) => term.replace(/"/g, ''))
    .filter((term) => /^[a-z0-9_@.-]+$/i.test(term))
    .slice(0, 12);
  if (safeTerms.length === 0) return undefined;
  return safeTerms.map((term) => `"${term}"`).join(' OR ');
}

function inferIntent(query: string, filters: ParsedContextQuery['filters']): ContextIntent {
  const text = query.toLowerCase();
  if (filters.def || text.startsWith('def:') || /\b(what is|define|where is function|where is class)\b/.test(text)) return 'definition';
  if (/\b(where is|which file|find|locate)\b/.test(text)) return 'locate';
  if (/\b(how does|what happens when|flow|pipeline|lifecycle)\b/.test(text)) return 'flow';
  if (/\b(what touches|references|uses|impact|affected)\b/.test(text)) return 'impact';
  if (/\b(why|stuck|failed|error|healer|retry)\b/.test(text)) return 'debug';
  if (/\b(test|spec|coverage)\b/.test(text)) return 'test';
  if (/\b(docs|instructions|runbook|prompt)\b/.test(text)) return 'docs';
  if (/\b(summon|doctor|locks|sentinel|lmstudio|openai_api_key)\b/.test(text)) return 'run-ops';
  return 'locate';
}
