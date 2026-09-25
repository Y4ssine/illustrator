/**
 * Command palette search. Deterministic scoring, no dependencies:
 *   title word prefix  > title substring > keyword prefix > description substring > subsequence
 * Recently used commands get a small boost so repeated workflows float up.
 */

import type { AnyCommand } from './types';

export interface SearchHit {
  command: AnyCommand;
  score: number;
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function scoreCommand(cmd: AnyCommand, query: string): number {
  const q = norm(query.trim());
  if (!q) return 1;
  const title = norm(cmd.title);
  const words = title.split(/[\s\-—/+]+/);
  const terms = q.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (title.startsWith(term)) best = 100;
    else if (words.some((w) => w.startsWith(term))) best = 80;
    else if (title.includes(term)) best = 60;
    else if (cmd.keywords.some((k) => norm(k).startsWith(term))) best = 50;
    else if (cmd.keywords.some((k) => norm(k).includes(term))) best = 35;
    else if (norm(cmd.description).includes(term)) best = 20;
    else if (norm(cmd.category).startsWith(term)) best = 18;
    else if (isSubsequence(term, title)) best = 10;
    if (best === 0) return 0; // every term must match something
    total += best;
  }
  return total;
}

export function searchCommands(commands: readonly AnyCommand[], query: string, recent: readonly string[] = [], limit = 12): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const command of commands) {
    const s = scoreCommand(command, query);
    if (s <= 0) continue;
    const r = recent.indexOf(command.id);
    const boost = r >= 0 ? Math.max(0, 8 - r) : 0;
    hits.push({ command, score: s + boost });
  }
  hits.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title));
  return hits.slice(0, limit);
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}
