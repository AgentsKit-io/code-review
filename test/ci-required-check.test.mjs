import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ci.yml reports a job named exactly 'check' on every pull request", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /^ {2}check:\n(?: {4}#.*\n)* {4}name: check\n/m);
  const on = ci.slice(ci.indexOf("\non:"), ci.indexOf("\npermissions:"));
  assert.match(on, /pull_request:/);
  assert.doesNotMatch(on, /^ {2,4}(paths|paths-ignore|branches-ignore):/m);
  assert.doesNotMatch(ci, /^ {4}if:/m);
});
