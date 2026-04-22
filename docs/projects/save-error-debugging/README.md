---
title: Save Error Debugging
status: active
repos: [sops_open_decrypted]
started: 2026-04-21
last_updated: 2026-04-21
next_step: Reload the extension host, reproduce a save failure, then pull the trace from `~/.local/state/sops-open-decrypted/trace.log` and triage.
---

# Save Error Debugging

## Goal
Diagnose why saving files through the `sops-decrypted://` virtual filesystem keeps producing cryptic errors. Most recent case: the dotenv validator fired on line 19 of `~/Documents/Homelab/ai/litellm/.env` where a Copilot ghost-text completion (`OLLAMA_API_KEY=sk-ollama-...`) looked accepted but the actual buffer still read `OLLAMA_API_KEY` with no `=`. Use the new file-based trace log to capture a full record of each failure, identify the real triggers (auto-save race, completion-acceptance timing, format-on-save), and either eliminate the class of bug or turn it into a clearly actionable message instead of a blocking toast.

## Tasks
- [ ] Reload extension host after the logger change; confirm `~/.local/state/sops-open-decrypted/trace.log` starts getting written.
- [ ] Reproduce the ghost-text save failure on `litellm/.env` and capture the exact trace entries (writeFile enter, validator result, save trigger).
- [ ] Cross-reference: is the save triggered by Ctrl+S, `files.autoSave`, `editor.formatOnSave`, or focus-change? VS Code does not expose the trigger directly; infer from timing + active-editor state.
- [ ] Audit every code path that ends in `SopsFileSystemProvider.writeFile` (native save, `sops.saveDecrypted` command, format-on-save) and log the trigger at each entry.
- [ ] Decide validator policy for edge cases: bare `KEY` (no `=`), `KEY=` (empty value — currently accepted), `=VALUE` (no key), lines with only whitespace after `#`. Document each case.
- [ ] Consider "best-effort save" mode: on validator failure, offer "Save anyway" vs "Fix first" via `showWarningMessage` instead of an outright throw. Weigh against the current hard-fail safety.
- [ ] Write unit tests for `findInvalidDotenvLines` covering every case above, then integration tests using `@vscode/test-electron` against `test.env.sops`.
- [ ] Cross-check against memory `sops-extension-fixes` — what prior bugs were already surfaced and fixed? Avoid regression.
- [ ] Document the diagnosis + chosen policy in this README's Notes section.

## Session Log

### 2026-04-21
- Project created after yet another save failure on litellm/.env (line 19 `OLLAMA_API_KEY` missing `=`, Copilot ghost text).
- Built file-based trace logger: `src/util/logger.js` now writes to `~/.local/state/sops-open-decrypted/trace.log` (override: `sops.debugLogFile`). Channel logs stay short; file logs carry full argv, cwd, env var names, stderr, durations, validator decisions.
- Added `sops.showLogFile` command + `sops.debugLogFile` setting.
- Redaction rule: never log file contents (plaintext or ciphertext), never log env var values — only names.

## Notes
### Why the current failure is not obviously a bug
The validator at `src/util/dotenv.js:1` rejects any non-blank, non-comment line missing `=`. Line 19 of `litellm/.env` really did lack `=` — the grey `sk-ollama-...` string in the screenshot is a Copilot inline suggestion, not file content. So the validator is technically correct. The open question is *why the save fired at all* while the user was mid-completion.

### Candidate triggers to distinguish
- **Ctrl+S while completion is shown** — user intent is to accept and save, but VS Code sends the save first.
- **`files.autoSave: "onFocusChange"` or `"afterDelay"`** — saves happen without explicit user action; ghost text still unaccepted.
- **`editor.formatOnSave`** with a formatter that doesn't understand the virtual scheme.
- **Copilot's own "suggestion dismiss on save"** behaviour races the save event.

The trace log's `writeFile enter` entry + timing vs preceding `readFile` will help distinguish.

### Related memory
- `sops-extension-fixes` — prior two compounding bugs (tmp path extension, ancestor-discovery).
- `feedback_sops_workflow_direction` — canonical flow is edit `.env` first then encrypt. Implication: the virtual-FS save path is on the hot path and must stay reliable.
- `feedback_never_read_secrets` — the logger MUST NOT log file bodies or env var values. Current impl respects this; any new trace call must be audited for the same.
