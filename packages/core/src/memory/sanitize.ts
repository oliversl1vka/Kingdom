/**
 * Prompt-injection hygiene for lesson content.
 *
 * Lessons are distilled from run artifacts (incidents, review feedback) that
 * could contain attacker-controlled text (e.g. an acceptance_criteria pulled
 * from a repo README). Before we render a lesson into a *system-adjacent* slot
 * in another agent's prompt, strip tokens a model might interpret as a
 * privileged-role delimiter and clamp size.
 *
 * The goal is defense-in-depth, not perfection: the distiller is rule-based
 * (R1–R5 in lesson-distiller.ts) and the fields are short, so attacker
 * surface is small. We still sanitize so a weird rejection feedback can't
 * inject a fake `<|im_start|>system` boundary.
 */

const ROLE_TOKEN_PATTERNS: RegExp[] = [
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|start_header_id\|>/gi,
  /<\|end_header_id\|>/gi,
  /<\|eot_id\|>/gi,
  /<\|endoftext\|>/gi,
  /<\/?system>/gi,
  /<\/?user>/gi,
  /<\/?assistant>/gi,
  /<\/?tool_call>/gi,
  /<\/?function_call>/gi,
  /\[INST\]/g,
  /\[\/INST\]/g,
  // PHASE4 (P4.1): lessons now ingest more model/attacker-influenced text
  // (LLM-proposed candidate lessons + free-form review feedback). Broaden the
  // role-delimiter strip set so a crafted candidate can't smuggle a boundary.
  /<\|.*?\|>/g, // any remaining <|...|> sentinel
  /<\/?(?:tool|tools|tool_result|developer|human|ai)\b[^>]*>/gi,
  /\bsystem\s*:/gi, // leading "System:" role labels
  /\bassistant\s*:/gi,
  /\bdeveloper\s*:/gi,
  /```+\s*system/gi, // fenced "system" blocks
  /<<\s*SYS\s*>>/gi,
  /<<\/?\s*SYS\s*>>/gi,
];

// PHASE4 (P4.1): heuristic prompt-injection phrases. Used only to GATE a
// *generated* lesson out of injection (we don't mutate the text on this path —
// strip is separate). Conservative: short, high-precision imperatives that an
// attacker would use to hijack a downstream agent's instructions.
const INJECTION_PHRASE_PATTERNS: RegExp[] = [
  /\bignore (?:all |the )?(?:previous|prior|above) (?:instructions?|prompts?|rules?)\b/i,
  /\bdisregard (?:all |the )?(?:previous|prior|above)\b/i,
  /\byou are now\b/i,
  /\bnew (?:system )?(?:prompt|instructions?)\b/i,
  /\boverride (?:the )?(?:system|safety|previous)\b/i,
  /\bact as (?:an? )?(?:unrestricted|jailbroken|dan)\b/i,
  /\breveal (?:your )?(?:system prompt|hidden instructions?)\b/i,
  /\bexfiltrate\b/i,
  /\bcurl\s+https?:\/\//i,
  /\bsend (?:the |your )?(?:api[_ ]?key|secret|token|credential)/i,
];

export const LESSON_TITLE_MAX_CHARS = 200;
export const LESSON_BODY_MAX_CHARS = 1024;

function stripRoleTokens(s: string): string {
  let out = s;
  for (const re of ROLE_TOKEN_PATTERNS) {
    out = out.replace(re, '');
  }
  return out;
}

/**
 * PHASE4 (P4.1): returns true when text looks like a prompt-injection attempt.
 * Generated lessons that trip this are rejected outright (not just sanitized),
 * because an injected lesson is rendered into a system-adjacent slot in another
 * agent's prompt — strip is defense-in-depth, this is the gate.
 */
export function isLikelyInjection(s: string): boolean {
  if (!s) return false;
  return INJECTION_PHRASE_PATTERNS.some((re) => re.test(s));
}

/** One-line, clamped, role-token-free title. */
export function sanitizeLessonTitle(s: string): string {
  const single = stripRoleTokens(s)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return single.slice(0, LESSON_TITLE_MAX_CHARS);
}

/** Multi-line body, role-token-free, clamped to LESSON_BODY_MAX_CHARS. */
export function sanitizeLessonBody(s: string): string {
  const cleaned = stripRoleTokens(s).replace(/\r\n/g, '\n').trim();
  return cleaned.slice(0, LESSON_BODY_MAX_CHARS);
}
