import type { DisplayRule } from './displayRules';

type Request = { source: string; current: string; role: string; anchors: number[]; sourceAnchors?: number[]; rules: DisplayRule[]; validateOnly?: boolean };
const channel = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (value: unknown) => void };

/** Native replacement-string semantics, including named captures and context. */
function substitution(template: string, matched: string, captures: (string | undefined)[], groups: Record<string, string> | undefined, offset: number, source: string): string {
  return template.replace(/\$([$&`']|[0-9]{1,2}|<[^>]*>)/g, (whole, key: string) => {
    if (key === '$') return '$';
    if (key === '&') return matched;
    if (key === '`') return source.slice(0, offset);
    if (key === "'") return source.slice(offset + matched.length);
    if (key.startsWith('<')) return groups ? groups[key.slice(1, -1)] ?? '' : whole;
    const number = Number(key);
    if (number > 0 && number <= captures.length) return captures[number - 1] ?? '';
    if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) <= captures.length) return (captures[Number(key[0]) - 1] ?? '') + key[1];
    return whole;
  });
}

channel.onmessage = ({ data }) => {
  try {
    const compiled = data.rules.map((rule, index) => {
      try { return { rule, regex: new RegExp(rule.pattern, rule.flags) }; }
      catch (cause) { throw new Error(`${index + 1}번째 정규식이 올바르지 않습니다: ${cause instanceof Error ? cause.message : String(cause)}`); }
    });
    if (data.validateOnly) { channel.postMessage({ ok: true, content: '', anchors: [] }); return; }
    let content = data.source;
    let map = [{ source: 0, output: 0 }, { source: content.length, output: content.length }];
    // If previous display rules/preprocessing changed source, retain anchors by
    // an order-preserving map across the changed span, exact in common margins.
    let prefix = 0, suffix = 0;
    while (prefix < data.current.length && prefix < content.length && data.current[prefix] === content[prefix]) prefix++;
    while (suffix < data.current.length - prefix && suffix < content.length - prefix && data.current[data.current.length - 1 - suffix] === content[content.length - 1 - suffix]) suffix++;
    let anchors = data.sourceAnchors ?? data.anchors.map(position => {
      const point = Math.max(0, Math.min(data.current.length, position));
      if (point <= prefix) return point;
      if (point >= data.current.length - suffix) return content.length - (data.current.length - point);
      return prefix + Math.round((point - prefix) * (content.length - prefix - suffix) / Math.max(1, data.current.length - prefix - suffix));
    });
    for (const { rule, regex } of compiled) {
      if (rule.type === 'editinput' && !['user', 'human'].includes(data.role)) continue;
      if (rule.type === 'editoutput' && !['assistant', 'char', 'character', 'bot', 'ai', 'model'].includes(data.role)) continue;
      const source = content;
      const changes: { start: number; end: number; length: number }[] = [];
      content = source.replace(regex, (matched: string, ...args: unknown[]) => {
        const groups = typeof args[args.length - 1] === 'object' ? args.pop() as Record<string, string> : undefined;
        const offset = args[args.length - 2] as number;
        const captures = args.slice(0, -2) as (string | undefined)[];
        const replacement = substitution(rule.replacement, matched, captures, groups, offset, source);
        changes.push({ start: offset, end: offset + matched.length, length: replacement.length });
        return replacement;
      });
      const transform = (point: number) => {
        let delta = 0;
        for (const change of changes) {
          if (point < change.start) break;
          if (point <= change.end) return change.start + delta + (change.end === change.start ? change.length : Math.round((point - change.start) * change.length / (change.end - change.start)));
          delta += change.length - (change.end - change.start);
        }
        return point + delta;
      };
      const inverse = (output: number) => {
        if (output <= 0) return 0;
        for (let i = 1; i < map.length; i++) {
          const left = map[i - 1]!, right = map[i]!;
          if (output <= right.output) return left.source + Math.round((output - left.output) * (right.source - left.source) / Math.max(1, right.output - left.output));
        }
        return data.source.length;
      };
      const points = [...map, ...changes.flatMap(change => [{ source: inverse(change.start), output: change.start }, { source: inverse(change.end), output: change.end }])];
      map = points.map(point => ({ source: point.source, output: transform(point.output) })).sort((a, b) => a.source - b.source || a.output - b.output);
      map = map.filter((point, index) => index === 0 || point.source !== map[index - 1]!.source || point.output !== map[index - 1]!.output);
      anchors = anchors.map(transform);
    }
    channel.postMessage({ ok: true, content, anchors, map });
  } catch (cause) { channel.postMessage({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }); }
};
