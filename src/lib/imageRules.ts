export type ImageRule = { pattern: string; flags?: string; assetTemplates: string[] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Read literal image identifiers only; surrounding HTML/CBS is discarded. */
export function imageOutputTemplates(output: string): string[] {
  const names = Array.from(output.matchAll(/\{\{(?:raw|img|image)::([^{}\r\n]+)\}\}/gi), match => match[1]!);
  for (const tag of output.matchAll(/<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)) {
    const src = tag[0].match(/\bsrc\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s>]+))/i);
    const name = src?.[1] ?? src?.[2] ?? src?.[3];
    if (name) names.push(name);
  }
  return [...new Set(names.map(name => name.trim()).filter(name => {
    const literal = name.replace(/\$<[A-Za-z][A-Za-z0-9_]*>/g, 'capture');
    // Context/whole-match substitutions could smuggle markup into an identifier.
    return !!literal && !/[{}<>\r\n\u0000]/.test(literal) && !/\$[&`']/.test(literal);
  }))];
}

/** Restrict native regex to captures and literal-delimited character runs.
 * No alternatives, lookarounds, backreferences, quantified groups, wildcard
 * repetition or overlapping variable runs. Match only one <=2048-char token.
 */
function safePattern(pattern: string, flags: string): boolean {
  if (!pattern || pattern.length > 512 || !/img/i.test(pattern) || !/^[iu]*$/.test(flags) || new Set(flags).size !== flags.length) return false;
  let depth = 0, variables = 0;
  for (let index = 0; index < pattern.length;) {
    const char = pattern[index]!;
    if (char === '(') {
      depth++; index++;
      if (pattern[index] === '?') {
        const named = pattern.slice(index).match(/^\?<([A-Za-z][A-Za-z0-9_]*)>/);
        if (!named) return false;
        index += named[0].length;
      }
      continue;
    }
    if (char === ')') { if (--depth < 0) return false; index++; continue; }
    if ('|{}*+?'.includes(char)) return false;
    const start = index;
    if (char === '[') {
      index++;
      if (pattern[index] === '^') index++;
      let closed = false;
      for (; index < pattern.length; index++) {
        if (pattern[index] === '\\') { index++; continue; }
        if (pattern[index] === ']') { index++; closed = true; break; }
      }
      if (!closed) return false;
    } else if (char === '\\') {
      const escape = pattern[index + 1];
      if (!escape || /[0-9kpxuc]/i.test(escape)) return false;
      index += 2;
    } else index++;
    if (pattern[index] === '+' || pattern[index] === '*' || pattern[index] === '?') {
      if (char === '.' || char === '^' || char === '$' || char === ')') return false;
      if (++variables > 8) return false;
      const atom = pattern.slice(start, index); index++;
      // Quantified captures are forbidden; closing a capture then a literal is
      // fine. A separator must be excluded by the repeated atom, guaranteeing
      // one-way scanning even on a token that ultimately fails to match.
      let next = index;
      while (pattern[next] === ')') next++;
      if (next < pattern.length && pattern[next] !== '$') {
        let delimiter = pattern[next]!;
        if (delimiter === '\\' && pattern[next + 1] && !/[A-Za-z0-9]/.test(pattern[next + 1]!)) delimiter = pattern[next + 1]!;
        else if ('[.(|*+?{}^\\'.includes(delimiter)) return false;
        try { if (new RegExp(`^(?:${atom})$`, flags).test(delimiter)) return false; } catch { return false; }
      }
    }
  }
  if (depth) return false;
  try { new RegExp(`^(?:${pattern})$`, flags); return true; } catch { return false; }
}

export function normalizeImageRules(value: unknown): ImageRule[] {
  if (!Array.isArray(value)) return [];
  const rules: ImageRule[] = [], seen = new Set<string>();
  for (const entry of value.slice(0, 64)) {
    if (!record(entry) || typeof entry.pattern !== 'string' || !Array.isArray(entry.assetTemplates)) continue;
    const flags = typeof entry.flags === 'string' ? entry.flags : '';
    if (!safePattern(entry.pattern, flags)) continue;
    const assetTemplates = [...new Set(entry.assetTemplates.filter((item): item is string => typeof item === 'string' && !!item.trim() && item.length <= 512 && !/[{}<>\r\n\u0000]/.test(item)).map(item => item.trim()))].slice(0, 16);
    if (!assetTemplates.length) continue;
    const rule: ImageRule = { pattern: entry.pattern, ...(flags ? { flags } : {}), assetTemplates };
    const key = JSON.stringify(rule); if (seen.has(key)) continue; seen.add(key); rules.push(rule);
  }
  return rules;
}

/** Only visit known card/module script containers; never evaluate out/CBS. */
export function extractImageRules(value: unknown, warnings?: string[]): ImageRule[] {
  const found: unknown[] = [], visited = new Set<object>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 10 || !node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) { for (const entry of node.slice(0, 256)) visit(entry, depth + 1); return; }
    if (!record(node)) return;
    if (typeof node.pattern === 'string' && Array.isArray(node.assetTemplates)) found.push(node);
    if (typeof node.in === 'string' && typeof node.out === 'string' && (!node.type || node.type === 'editdisplay')) {
      const assetTemplates = imageOutputTemplates(node.out);
      // Read literal attribute text only. Do not parse/insert the output HTML
      // or evaluate any CBS expression surrounding an image reference.
      // ableFlag toggles CUSTOM FLAGS, not rule activation.
      const customFlags = node.ableFlag === true ? (typeof node.flag === 'string' ? node.flag : typeof node.flags === 'string' ? node.flags : '') : '';
      const flags = customFlags.replace(/[gy]/g, '');
      found.push({ pattern: node.in, flags, assetTemplates });
    }
    for (const key of ['data', 'extensions', 'risuai', 'module', 'modules', 'regex', 'customscript', 'customScripts', 'scripts', 'imageRules']) if (key in node) visit(node[key], depth + 1);
  };
  visit(value, 0);
  // Complex patterns use the isolated image-only worker path (displayRules).
  void warnings;
  return normalizeImageRules(found);
}

export function imageRuleCandidates(token: string, rules: ImageRule[]): string[] {
  if (token.length > 2048 || !/^(?:<img|\[img)/i.test(token)) return [];
  const result: string[] = [];
  for (const rule of normalizeImageRules(rules)) {
    const match = new RegExp(`^(?:${rule.pattern})$`, rule.flags ?? '').exec(token);
    if (!match) continue;
    for (const template of rule.assetTemplates) {
      const name = template.replace(/\$(?:([1-9][0-9]?)|<([A-Za-z][A-Za-z0-9_]*)>)/g, (_, index: string, key: string) => index ? match[Number(index)] ?? '' : match.groups?.[key] ?? '').trim();
      if (name && name.length <= 2048 && !/[{}<>\r\n\u0000]/.test(name) && !result.includes(name)) result.push(name);
    }
  }
  return result;
}
