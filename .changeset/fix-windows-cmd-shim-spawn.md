---
"@agentskit/code-review": patch
---

Fix local CLI providers (`claude-cli`, `codex-cli`, ...) failing to spawn on Windows. npm's global install of any Node CLI produces a `.cmd` shim there, and Windows' `CreateProcess` cannot execute one without a shell, so the previous plain `child_process.spawn` failed with `ENOENT`/`EINVAL` for every local provider regardless of the configured path — reproduced live via `doctor --provider claude-cli`, which reported `executable: not found` even though the CLI ran fine directly in the same shell. Switched to `cross-spawn`, which detects this case and re-execs through `cmd.exe` with the same argument escaping Node's own `shell: true` uses.
