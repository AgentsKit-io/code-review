import { readFileSync, writeFileSync } from 'node:fs';
const root = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const docsPath = 'apps/docs/package-lock.json';
const docs = JSON.parse(readFileSync(docsPath, 'utf8'));
docs.packages[''].devDependencies.typescript = '^7.0.2';
const next = {};
for (const [k, v] of Object.entries(docs.packages)) {
  if (k === 'node_modules/typescript') continue;
  next[k] = v;
}
for (const [k, v] of Object.entries(root.packages)) {
  if (k === 'node_modules/typescript' || k.startsWith('node_modules/@typescript/typescript-')) next[k] = v;
}
const sorted = {};
for (const k of Object.keys(next).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a < b ? -1 : 1))) sorted[k] = next[k];
docs.packages = sorted;
writeFileSync(docsPath, JSON.stringify(docs, null, 2) + '\n');
