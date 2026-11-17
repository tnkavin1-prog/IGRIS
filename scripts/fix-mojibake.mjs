// node scripts/fix-mojibake.mjs apps/desktop-hud/src
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = [
  ['â€¦', '…'], ['â€“', '–'], ['â€”', '—'], ['â€˜', '‘'], ['â€™', '’'],
  ['â€œ', '“'], ['â€\u009d', '”'], ['Â·', '·'], ['Ã—', '×'], ['Â ', ' '],
];
const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css|html)$/.test(p) ? [p] : [];
  });

let touched = 0;
for (const file of walk(process.argv[2] ?? 'src')) {
  const before = readFileSync(file, 'utf8');
  const after = MAP.reduce((s, [bad, good]) => s.split(bad).join(good), before);
  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    console.log('fixed', file);
    touched++;
  }
}
console.log(touched ? `${touched} file(s) repaired` : 'clean');
