import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const CI = ".github/workflows/ci.yml";

// Returns the list of problems that would keep the required check "check" from reporting.
function problems(ci) {
  const out = [];
  const lines = ci.split("\n");
  const section = (key) => {
    const start = lines.findIndex((l) => l === `${key}:`);
    if (start < 0) return null;
    const end = lines.findIndex((l, i) => i > start && /^\S/.test(l));
    return lines.slice(start + 1, end < 0 ? undefined : end);
  };
  const on = section("on");
  const pr = on?.findIndex((l) => /^ {2}pull_request:/.test(l)) ?? -1;
  if (pr < 0) out.push("no pull_request trigger");
  else {
    const rest = on.slice(pr + 1);
    const next = rest.findIndex((l) => /^ {2}\S/.test(l));
    const body = rest.slice(0, next < 0 ? undefined : next).join("\n");
    if (/^ {4}(paths|paths-ignore|branches|branches-ignore):/m.test(body)) out.push("pull_request filter");
  }
  const jobs = section("jobs") ?? [];
  const start = jobs.findIndex((l) => /^ {2}check:\s*$/.test(l));
  if (start < 0) out.push("no job with id check");
  else {
    const rest = jobs.slice(start + 1);
    const next = rest.findIndex((l) => /^ {2}\S/.test(l));
    const body = rest.slice(0, next < 0 ? undefined : next);
    const name = body.find((l) => /^ {4}name:/.test(l));
    if (name && name.replace(/^ {4}name:\s*/, "").replace(/["']/g, "").trim() !== "check") out.push("job name is not check");
    const cond = body.find((l) => /^ {4}if:/.test(l));
    if (cond && cond.replace(/^ {4}if:\s*/, "").replace(/\$\{\{|\}\}/g, "").trim() !== "always()") out.push("job if is not always()");
  }
  return out;
}

const header = "name: CI\non:\n  pull_request:\n    types: [opened]\n  push:\n    branches: [main]\njobs:\n";

test("plain job id check passes", () => {
  assert.deepEqual(problems(`${header}  check:\n    runs-on: ubuntu-latest\n`), []);
  assert.deepEqual(problems(`${header}  check:\n    name: check\n    runs-on: ubuntu-latest\n`), []);
});

test("aggregator job (needs + if always) as in #417 passes", () => {
  const ci = `name: CI\non:\n  pull_request:\n    types: [opened]\n  push:\n    branches: [main]\njobs:\n  pipeline:\n    uses: ./.github/workflows/ci-standard.yml\n  check:\n    needs: pipeline\n    if: always()\n    runs-on: ubuntu-24.04\n`;
  assert.deepEqual(problems(ci), []);
});

test("filters, renames and conditional skips are rejected", () => {
  assert.deepEqual(problems(header.replace("types: [opened]", "paths: ['src/**']") + "  check:\n    runs-on: x\n"), ["pull_request filter"]);
  assert.deepEqual(problems(`${header}  check:\n    name: build\n    runs-on: x\n`), ["job name is not check"]);
  assert.deepEqual(problems(`${header}  check:\n    if: github.actor != 'bot'\n    runs-on: x\n`), ["job if is not always()"]);
  assert.deepEqual(problems(`${header}  build:\n    runs-on: x\n`), ["no job with id check"]);
});

test("repository ci.yml reports 'check' on every pull request", { skip: !existsSync(CI) }, () => {
  assert.deepEqual(problems(readFileSync(CI, "utf8")), []);
});
