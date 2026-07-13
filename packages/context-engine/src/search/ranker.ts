import type { ContextChunkKind, ContextIntent, ParsedContextQuery } from '../types.js';

export interface RankCandidateInput {
  ftsRank: number;
  file: string;
  title: string;
  content: string;
  chunkKind: ContextChunkKind;
  symbolName?: string;
  symbolKind?: string;
}

export interface RankScore {
  score: number;
  scoreBreakdown: Record<string, number>;
  why: string[];
}

export function rankCandidate(candidate: RankCandidateInput, parsed: ParsedContextQuery, ftsIndex: number, ftsCount: number): RankScore {
  const lowerFile = candidate.file.toLowerCase();
  const lowerTitle = candidate.title.toLowerCase();
  const lowerSymbol = candidate.symbolName?.toLowerCase() ?? '';
  const terms = parsed.terms;
  const ftsScore = ftsCount > 0 ? Math.max(0, 1 - ftsIndex / Math.max(1, ftsCount)) : 0.1;
  const exactIdentifierScore = exactIdentifier(candidate, parsed);
  const pathScore = pathMatch(lowerFile, parsed);
  const intentScore = intentBoost(candidate.chunkKind, candidate.symbolKind, parsed.intent, lowerFile, lowerTitle);
  const graphScore = parsed.intent === 'flow' || parsed.intent === 'impact' || parsed.intent === 'debug' ? 0.2 : 0;
  const score = 0.35 * ftsScore + 0.25 * exactIdentifierScore + 0.15 * pathScore + 0.15 * intentScore + 0.1 * graphScore;
  const why: string[] = [];
  if (ftsScore > 0.5 && terms.length > 0) why.push('text match');
  if (exactIdentifierScore > 0) why.push('identifier match');
  if (pathScore > 0) why.push('path match');
  if (intentScore > 0.35) why.push(`${parsed.intent} intent`);
  return {
    score: Number(score.toFixed(4)),
    scoreBreakdown: { ftsScore, exactIdentifierScore, pathScore, intentScore, graphScore },
    why,
  };
}

function exactIdentifier(candidate: RankCandidateInput, parsed: ParsedContextQuery): number {
  const requested = (parsed.filters.symbol ?? parsed.filters.def ?? '').toLowerCase();
  const symbol = candidate.symbolName?.toLowerCase() ?? '';
  const title = candidate.title.toLowerCase();
  if (requested && (symbol === requested || title === requested)) return 1;
  if (requested && (symbol.includes(requested) || title.includes(requested))) return 0.7;
  if (parsed.terms.some((term) => symbol === term || title === term)) return 0.8;
  if (parsed.terms.some((term) => symbol.includes(term) || title.includes(term))) return 0.4;
  return 0;
}

function pathMatch(lowerFile: string, parsed: ParsedContextQuery): number {
  const requested = (parsed.filters.file ?? parsed.filters.path ?? parsed.filters.package ?? '').toLowerCase();
  if (requested && lowerFile.includes(requested.replace(/\\/g, '/'))) return 1;
  if (parsed.terms.some((term) => lowerFile.includes(term))) return 0.45;
  return 0;
}

function intentBoost(chunkKind: ContextChunkKind, symbolKind: string | undefined, intent: ContextIntent, file: string, title: string): number {
  if (intent === 'definition') return chunkKind === 'symbol' ? 1 : 0.25;
  if (intent === 'locate') return chunkKind === 'file_summary' || chunkKind === 'symbol' ? 0.7 : 0.35;
  if (intent === 'flow') return chunkKind === 'symbol' || symbolKind === 'command' ? 0.75 : 0.35;
  if (intent === 'impact') return file.includes('test') ? 0.75 : 0.45;
  if (intent === 'debug') return /healer|sentinel|retry|status|doctor|lock/.test(`${file} ${title}`) ? 0.9 : 0.35;
  if (intent === 'test') return file.includes('test') || symbolKind === 'test_case' || symbolKind === 'test_suite' ? 1 : 0.1;
  if (intent === 'docs') return chunkKind === 'markdown_section' ? 1 : 0.15;
  if (intent === 'run-ops') return /doctor|summon|sentinel|status|config|lock/.test(`${file} ${title}`) ? 0.9 : 0.25;
  return 0.3;
}
