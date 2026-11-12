// SPDX-License-Identifier: AGPL-3.0-only
/** Minimal, safe Markdown subset (no HTML injection): headings, lists, tables, quotes, **bold**, *em*, `code`. */
import type { ReactNode } from 'react';

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={`${key}-${i++}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ md }: { md: string }) {
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1]!.length + 1, 5);
      const Tag = `h${level}` as 'h2';
      blocks.push(<Tag key={k++}>{inline(h[2]!)}</Tag>);
      i++;
    } else if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*]\s+/, ''));
      blocks.push(<ul key={k++}>{items.map((x, j) => <li key={j}>{inline(x, j)}</li>)}</ul>);
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*\d+\.\s+/, ''));
      blocks.push(<ol key={k++}>{items.map((x, j) => <li key={j}>{inline(x, j)}</li>)}</ol>);
    } else if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ''));
      blocks.push(<blockquote key={k++}>{inline(q.join(' '))}</blockquote>);
    } else if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        const cells = lines[i++]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      blocks.push(
        <div className="table-wrap" key={k++}>
          <table>
            <thead><tr>{head?.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead>
            <tbody>{body.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}>{inline(c, n)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else {
      const p: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*[-*]\s|\s*\d+\.\s|>|\|)/.test(lines[i]!)) p.push(lines[i++]!);
      blocks.push(<p key={k++}>{inline(p.join(' '))}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}
