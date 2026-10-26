import { readFileSync, writeFileSync } from 'node:fs';

const root = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const path = 'apps/docs/package-lock.json';
const docs = JSON.parse(readFileSync(path, 'utf8'));
const out = {};
let inserted = false;
for (const [key, value] of Object.entries(docs.packages)) {
  if (key === 'node_modules/typescript') {
    for (const [k, v] of Object.entries(root.packages)) {
      if (k.startsWith('node_modules/@typescript/typescript-')) out[k] = v;
    }
    out[key] = root.packages['node_modules/typescript'];
    inserted = true;
    continue;
  }
  out[key] = value;
}
if (!inserted) throw new Error('typescript entry missing');
// keep key ordering: @typescript/* entries sort before other scopes; rebuild sorted
const rootKey = '';
const sorted = { [rootKey]: out[rootKey] };
for (const k of Object.keys(out).filter((k) => k !== rootKey).sort((a, b) => a.localeCompare(b, 'en'))) sorted[k] = out[k];
sorted[rootKey].devDependencies.typescript = '^7.0.2';
docs.packages = sorted;
writeFileSync(path, JSON.stringify(docs, null, 2) + '\n');
