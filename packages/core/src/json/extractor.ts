export type JsonObject = Record<string, unknown>;
export type JsonObjectPredicate<T extends JsonObject = JsonObject> = (value: JsonObject) => value is T;

export function extractJsonObject<T extends JsonObject = JsonObject>(
  content: string,
  predicate?: JsonObjectPredicate<T>,
): T | null {
  for (const candidate of fencedJsonCandidates(content)) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed && matchesPredicate(parsed, predicate)) return parsed;
  }

  for (const candidate of balancedJsonCandidates(content)) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed && matchesPredicate(parsed, predicate)) return parsed;
  }

  return null;
}

function* fencedJsonCandidates(content: string): Iterable<string> {
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content)) !== null) {
    yield match[1].trim();
  }
}

function* balancedJsonCandidates(content: string): Iterable<string> {
  for (let start = 0; start < content.length; start += 1) {
    if (content[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < content.length; index += 1) {
      const char = content[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          yield content.slice(start, index + 1);
          break;
        }
      }
    }
  }
}

function tryParseJsonObject(candidate: string): JsonObject | null {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as JsonObject;
  } catch {
    return null;
  }
}

function matchesPredicate<T extends JsonObject>(value: JsonObject, predicate?: JsonObjectPredicate<T>): value is T {
  return predicate ? predicate(value) : true;
}