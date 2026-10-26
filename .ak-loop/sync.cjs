const fs = require('fs');
const r = JSON.parse(fs.readFileSync('package-lock.json'));
const f = 'apps/docs/package-lock.json';
const d = JSON.parse(fs.readFileSync(f));
const out = {};
for (const [k, v] of Object.entries(d.packages)) {
  if (k === 'node_modules/typescript') {
    for (const [rk, rv] of Object.entries(r.packages)) {
      if (rk.startsWith('node_modules/@typescript/typescript-')) out[rk] = rv;
    }
    out[k] = r.packages[k];
  } else out[k] = v;
}
const sorted = {};
sorted[''] = out[''];
sorted[''].devDependencies.typescript = '^7.0.2';
for (const k of Object.keys(out).filter((x) => x !== '').sort()) sorted[k] = out[k];
d.packages = sorted;
fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
const p = 'apps/docs/package.json';
fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"typescript": "^6.0.3"', '"typescript": "^7.0.2"'));
