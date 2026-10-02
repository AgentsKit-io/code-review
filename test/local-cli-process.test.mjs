import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { redactDiagnostic, runLocalCli } from '../dist/src/local-cli-process.js'

const node = process.execPath

test('isolated workers receive temporary HOME/TMPDIR and only the selected credential', async () => {
  process.env.AGENTSKIT_TEST_INHERITED = 'must-not-pass'
  try {
    const result = await runLocalCli(node, ['-e', 'process.stdout.write(JSON.stringify({ home: process.env.HOME, tmp: process.env.TMPDIR, cwd: process.cwd(), inherited: process.env.AGENTSKIT_TEST_INHERITED, key: process.env.TEST_PROVIDER_KEY }))'], {
      providerCredential: { name: 'TEST_PROVIDER_KEY', value: 'selected-secret' },
    })
    const env = JSON.parse(result.stdout)
    assert.notEqual(env.home, process.env.HOME)
    assert.notEqual(env.tmp, process.env.TMPDIR)
    assert.match(env.cwd, /agentskit-review-worker-[^/]+\/home$/)
    assert.equal(env.inherited, undefined)
    assert.equal(env.key, 'selected-secret')
  } finally { delete process.env.AGENTSKIT_TEST_INHERITED }
})

test('trusted-local mode explicitly inherits the caller environment', async () => {
  process.env.AGENTSKIT_TEST_INHERITED = 'trusted-value'
  try {
    const result = await runLocalCli(node, ['-e', 'process.stdout.write(process.env.AGENTSKIT_TEST_INHERITED ?? "")'], { mode: 'trusted-local' })
    assert.equal(result.stdout, 'trusted-value')
  } finally { delete process.env.AGENTSKIT_TEST_INHERITED }
})

test('abort terminates a local worker and returns a stable error code', async () => {
  const controller = new AbortController()
  const pending = runLocalCli(node, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal, timeoutMs: 5000 })
  setTimeout(() => controller.abort(), 25)
  await assert.rejects(pending, (error) => error?.code === 'ABORT_ERR' && error.message === `${node} aborted`)
})


test('output overflow stops the worker and never returns unbounded output', async () => {
  const pending = runLocalCli(node, ['-e', "process.stdout.write('x'.repeat(100))"], { maxOutputBytes: 10 })
  await assert.rejects(pending, (error) => error?.message.includes('stdout exceeded 10 bytes') && error.stdout.length <= 10)
})

test('failed worker diagnostics redact explicit credentials and known token formats', async () => {
  const secret = 'provider-secret-123456'
  const pending = runLocalCli(node, ['-e', `process.stderr.write(${JSON.stringify(`key=${secret} token=sk-1234567890123456`)}); process.exit(1)`], {
    providerCredential: { name: 'TEST_PROVIDER_KEY', value: secret },
  })
  await assert.rejects(pending, (error) => {
    assert.match(error.message, /exited with code 1/)
    assert.doesNotMatch(error.stderr, new RegExp(secret))
    assert.doesNotMatch(error.stderr, /sk-1234567890123456/)
    assert.match(error.stderr, /\[REDACTED\]/)
    return true
  })
})

test('rejects unsafe worker limits before spawning', async () => {
  await assert.rejects(runLocalCli(node, ['-e', 'process.exit(0)'], { maxOutputBytes: 25 * 1024 * 1024 + 1 }), /maxOutputBytes/)
  await assert.rejects(runLocalCli(node, ['-e', 'process.exit(0)'], { timeoutMs: 10 * 60 * 1000 + 1 }), /timeout/)
})

test('missing executable remains a typed spawn failure without raw output', async () => {
  await assert.rejects(runLocalCli('agentskit-command-does-not-exist', []), (error) => error?.code === 'ENOENT' && error.stdout === '' && error.stderr === '')
})

// `stdin` exists so a caller (the claude-code adapter) can send a large prompt without it ever
// becoming a CLI argument: Windows' ~32K total command-line length is exceeded by a real file's
// content plus review instructions, which failed as `spawn ENAMETOOLONG` regardless of the file's
// own size — a CLI argument was never going to scale for this, no matter how it was chunked.
test('the stdin option writes content to the child before stdin closes', async () => {
  const result = await runLocalCli(node, ['-e', 'let data = ""; process.stdin.on("data", (c) => { data += c }); process.stdin.on("end", () => process.stdout.write(data))'], { stdin: 'hello from the parent' })
  assert.equal(result.stdout, 'hello from the parent')
})

test('omitting stdin still closes it empty, unchanged from before', async () => {
  const result = await runLocalCli(node, ['-e', 'let data = ""; process.stdin.on("data", (c) => { data += c }); process.stdin.on("end", () => process.stdout.write(JSON.stringify({ length: data.length })))'])
  assert.equal(result.stdout, '{"length":0}')
})

test('local CLI diagnostics use shared core secret redaction', () => {
  const fixtures = [
    ['sk-proj', 'value=sk-proj-abcdefghijklmnop', 'value=[REDACTED]'],
    ['sk-ant', 'value=sk-ant-abcdefghijklmnop', 'value=[REDACTED]'],
    ['pk', 'value=pk-abcdefghijklmnop', 'value=[REDACTED]'],
    ['xai', 'value=xai-abcdefghijklmnop', 'value=[REDACTED]'],
    ['AIza', 'value=AIza-abcdefghijklmnop', 'value=[REDACTED]'],
    ['ghp', 'value=ghp_abcdefghijklmnop', 'value=[REDACTED]'],
    ['gho', 'value=gho_abcdefghijklmnop', 'value=[REDACTED]'],
    ['ghs', 'value=ghs_abcdefghijklmnop', 'value=[REDACTED]'],
    ['ghr', 'value=ghr_abcdefghijklmnop', 'value=[REDACTED]'],
    ['github_pat', 'value=github_pat_abcdefghijklmnop', 'value=[REDACTED]'],
    ['xoxb', 'value=xoxb-abcdefghijkl', 'value=[REDACTED]'],
    ['xoxp', 'value=xoxp-abcdefghijkl', 'value=[REDACTED]'],
    ['AKIA', 'value=AKIA1234567890ABCDEF', 'value=[REDACTED]'],
    ['Bearer', 'value=Bearer abcdefghijkl', 'value=Bearer [REDACTED]'],
    ['short Bearer', 'value=Bearer short', 'value=Bearer [REDACTED]'],
    ['bot path', 'path=/botfakeBotTokenValue12345/method', 'path=/bot[REDACTED]/method'],
    ['PEM block', '-----BEGIN RSA PRIVATE KEY-----\nfake-private-key-material\n-----END RSA PRIVATE KEY-----', '[REDACTED]'],
    ['PEM EC block', '-----BEGIN EC PRIVATE KEY-----\nfake-private-key-material\n-----END EC PRIVATE KEY-----', '[REDACTED]'],
    ['api_key unquoted', 'api_key=fakeApiKeyValue12345', 'api_key=[REDACTED]'],
    ['api_key quoted', 'api_key="fakeApiKeyValue12345"', 'api_key="[REDACTED]"'],
    ['api-key quoted', "api-key='fakeApiKeyValue12345'", "api-key='[REDACTED]'"],
    ['secret unquoted', 'secret:fakeSecretValue12345', 'secret:[REDACTED]'],
    ['secret quoted', "secret:'fakeSecretValue12345'", "secret:'[REDACTED]'"],
    ['token unquoted', 'token=fakeTokenValue123456', 'token=[REDACTED]'],
    ['token quoted', 'token="fakeTokenValue123456"', 'token="[REDACTED]"'],
    ['password unquoted', 'password=fakePasswordValue12345', 'password=[REDACTED]'],
    ['password quoted', "password:'fakePasswordValue12345'", "password:'[REDACTED]'"],
    ['access_token', 'access_token=fakeAccessTokenValue12345', 'access_token=[REDACTED]'],
    ['refresh_token', 'refresh_token=fakeRefreshTokenValue12345', 'refresh_token=[REDACTED]'],
    ['client_secret', 'client_secret=fakeClientSecretValue12345', 'client_secret=[REDACTED]'],
    ['bot_token', 'bot_token=fakeBotTokenValue12345', 'bot_token=[REDACTED]'],
    ['oauth_token', 'oauth_token=fakeOauthTokenValue12345', 'oauth_token=[REDACTED]'],
    ['camel token', 'refreshToken=fakeRefreshTokenValue12345', 'refreshToken=[REDACTED]'],
    ['passwd', 'passwd=fakePasswordValue12345', 'passwd=[REDACTED]'],
    ['authorization', 'authorization=fakeAuthorizationValue12345', 'authorization=[REDACTED]'],
    ['credential', 'credential=fakeCredentialValue12345', 'credential=[REDACTED]'],
    ['private_key', 'private_key=fakePrivateKeyValue12345', 'private_key=[REDACTED]'],
    ['signature', 'signature=fakeSignatureValue12345', 'signature=[REDACTED]'],
    ['normal words', 'normal words and credentials are discussed here', 'normal words and credentials are discussed here'],
    ['short ids', 'id=abc123; id=deadbeef', 'id=abc123; id=deadbeef'],
    ['file path', 'path=/Users/example/repo/src/file.ts', 'path=/Users/example/repo/src/file.ts'],
    ['commit SHA', 'commit=0123456789abcdef0123456789abcdef01234567', 'commit=0123456789abcdef0123456789abcdef01234567'],
    ['URL without credentials', 'https://example.test/path?q=hello', 'https://example.test/path?q=hello'],
  ]
  for (const [name, input, expected] of fixtures) assert.equal(redactDiagnostic(input), expected, name)
  assert.equal(redactDiagnostic('failure customCredentialValue12345', ['customCredentialValue12345']), 'failure [REDACTED]')
  assert.equal(redactDiagnostic('x'.repeat(4001)).length, 4000)
})
// Every local CLI provider this module spawns by bare name (claude, codex, ...) is a globally
// npm-installed Node CLI. On Windows, npm's only artifact for such a CLI is a `.cmd` shim;
// CreateProcess cannot execute one without a shell, so a plain spawn(cmd, args, { ... }) (no shell
// option given -> shell: false) failed with ENOENT/EINVAL for every one of them regardless of the
// path given -- reproduced live via `agentskit-review doctor --provider claude-cli`, which
// reported executable: not found even though `claude --version` succeeds in the same shell. Only
// meaningful on the platform where the bug reproduces.
if (process.platform === 'win32') {
  test('runs a Windows .cmd file directly, with shell-free argv semantics preserved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentskit-review-cmd-test-'))
    const cmdPath = join(dir, 'greet.cmd')
    // A shell-metacharacter (&) argument proves spawnNodeChild's cmd.exe re-quoting keeps this argv
    // element intact end to end, the same way shell: false would for a real executable.
    writeFileSync(cmdPath, '@echo off\r\necho hello %1\r\nexit /b 0\r\n')
    const result = await runLocalCli(cmdPath, ['a & b'])
    assert.match(result.stdout, /hello "a & b"/)
  })
}
