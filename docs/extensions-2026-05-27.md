# Extension Ideas: sops-open-decrypted

Date: 2026-05-27
Context: VS Code extension that mounts a `sops-decrypted://` virtual filesystem so `*.sops` files open transparently in a native editor, with atomic re-encrypt on Ctrl+S. Currently v0.2.1, JavaScript, single publisher (`pike00`), ~30 KB of source across 11 files.

## Homelab integration surface

The homelab is sops-heavy: every app in `/home/will/Documents/Homelab/apps/*/` has a `.env.sops`, `.tfvars.sops`, or `.pem.sops`, all using the same age recipient pinned in `/home/will/projects/sops_open_decrypted/.sops.yaml:6`. Adjacent tooling worth wiring into: the `just secrets` wrapper (per the `feedback_just_config_secret_leakage` memory), the `pre-push-secrets-scan` skill at `/home/will/.claude/skills/pre-push-secrets-scan/`, the Loki+Promtail stack at `/home/will/Documents/Homelab/monitoring/compose.logs.yml`, Grafana at `grafana.lab.khanpikehome.com`, Mattermost via `~/projects/mattermost-interactive`, the `bitwarden-cli` skill, and the existing `drape` secret tool at `~/projects/drape/`. The extension currently does none of these; it shells out to `sops` and hopes.

---

## Quick wins

### Marketplace install badge in README
- **Effort:** S, **Impact:** low
- **Anchor:** `/home/will/projects/sops_open_decrypted/README.md:39` already names the marketplace ID `pike00.sops-open-decrypted` but there is no shields.io badge above the title.
- **Why:** social proof and install count visibility, three lines of markdown.

### Status-bar pill showing the resolved age identity
- **Effort:** S, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/extension.js:29` already creates a `LanguageStatusItem`; extend it to read `$SOPS_AGE_KEY_FILE` from the resolved env (`/home/will/projects/sops_open_decrypted/src/util/config.js:110`) and display `unlock as <fingerprint-prefix>`.
- **Why:** the most common "wait, who signed this" question lands in the trace log today; surface it in the editor chrome.

### Even out `commandPalette` `when:` clauses
- **Effort:** S, **Impact:** low
- **Anchor:** `/home/will/projects/sops_open_decrypted/package.json:256` registers `sops.showLogFile` with no `when:`, while peer commands have `resourceScheme == sops-decrypted || resourceExtname == .sops`. Drift.
- **Why:** one-line consistency fix; prevents the trace-log command from appearing in unrelated contexts.

### Unit tests for `sopsErrors.normalize`
- **Effort:** S, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/util/sopsErrors.js:7` has 7 regex patterns; `/home/will/projects/sops_open_decrypted/scripts/test-detection.js` covers detection only.
- **Why:** these patterns are silent regressions waiting to happen; one fixture string per pattern at ~80 LoC catches the next sops stderr-format change cold.

### mtime-keyed detection cache
- **Effort:** S, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/util/storeDetection.js:45` re-reads 4 KB from disk on every `readFile` and again on `writeFile` (`src/providers/sopsFileSystemProvider.js:175`, `:255`).
- **Why:** a `Map<path, {mtimeNs, detection}>` halves IO for opens-then-saves; trivial to invalidate.

---

## New features

### "SOPS: Edit Single Key" command
- **Effort:** M, **Impact:** high
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/commands/showEncryptionCoverage.js:23` already walks every dotenv key; add a sibling command that decrypts just one (`sops decrypt --extract '["KEY"]'`), opens a one-line virtual document, and re-encrypts on save.
- **Why:** rotating a single API token currently round-trips the entire file, which means the diff is noisy and reviewer eyes glaze.

### "SOPS: Diff With HEAD (decrypted)"
- **Effort:** M, **Impact:** high
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/commands/revealInSCM.js` opens the SCM diff but shows encrypted bytes; extend to call `git show HEAD:<path>`, decrypt both sides, then `vscode.commands.executeCommand('vscode.diff', ...)`.
- **Why:** sops diffs are unreviewable today; this is the #1 missing PR-review affordance.

### Diagnostic squiggles for keys that should be encrypted but aren't
- **Effort:** M, **Impact:** high
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/util/sopsMetadata.js:35` already computes `shouldKeyBeEncrypted(key, rules)`; pipe results into a `vscode.DiagnosticCollection`.
- **Why:** today the user must manually run `SOPS: Show Encryption Coverage`; squiggles make leaks impossible to miss when editing.

### `.sops.yaml` JSON-schema completion + validation
- **Effort:** M, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/.sops.yaml:1` is hand-written; no schema exists in the wild, so writing one would help every sops user.
- **Why:** `path_regex`, `encrypted_regex`, recipient-block shape are all known; autocomplete + hover + invalid-regex diagnostics drop config-mistakes-as-cryptic-sops-errors by an order of magnitude.

### "SOPS: Rekey" wrapping `sops updatekeys`
- **Effort:** S, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/util/findSopsYaml.js` already finds the governing config; add `runSops(['updatekeys', '--yes', sopsPath])` with progress notification.
- **Why:** when `.sops.yaml` recipients change, every file under it is silently stale until the user remembers to `sops updatekeys` from a terminal.

### "Secrets Outline" tree view
- **Effort:** L, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/providers/decorationProvider.js` already decorates per URI; a `TreeDataProvider` would enumerate `**/*.sops` and tag each with recipient summary + cleartext-key count.
- **Why:** in a Homelab-sized repo (50+ sops files) you cannot answer "which files does my age key actually decrypt?" without a script.

### Hex view fallback for binary stores
- **Effort:** M, **Impact:** low
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/util/storeDetection.js:16` returns `'binary'` for `*.pem.sops`/`*.tfvars.sops` but the editor still tries text rendering, which mangles non-UTF8 bytes.
- **Why:** `/home/will/projects/sops_open_decrypted/test.binary.tfvars.sops` exists as a fixture; the failure mode is real.

---

## New Docker services

### `sops-rotation-bot` (scheduled container)
- **Effort:** L, **Impact:** high
- **Anchor:** an Alpine + sops crond container that walks `/home/will/Documents/Homelab/apps/*/.env.sops`, parses recipients via `sops filestatus`, and posts a Mattermost message via `~/projects/mattermost-interactive` when any file's recipients diverge from the governing `.sops.yaml`.
- **Why:** today the only signal that you've rotated `.sops.yaml` but forgotten `sops updatekeys` is a runtime decrypt failure days later. The `feedback_docker_scheduling` memory establishes Alpine+crond as the preferred pattern.

### `sops-coverage-exporter` (Prom exporter)
- **Effort:** M, **Impact:** medium
- **Anchor:** a Python container exposing `sops_files_total`, `sops_cleartext_keys_total{file}`, `sops_recipients_total{key_type}` over `/metrics`, scraped by the existing Prometheus in `/home/will/Documents/Homelab/monitoring/`.
- **Why:** Grafana at `grafana.lab.khanpikehome.com` has no panel for secret hygiene; an exporter slots in next to Promtail with ~60 LoC.

### `vsce-publisher` runner image
- **Effort:** S, **Impact:** low
- **Anchor:** `/home/will/projects/sops_open_decrypted/.github/workflows/release.yml` pulls vsce + node on every tag.
- **Why:** a vendored image with `@vscode/vsce`, `ovsx`, `node 20` baked in cuts release time from ~90s to ~15s; same image works for future extensions.

---

## Integrations

### Wire `pre-push-secrets-scan` skill into VS Code
- **Effort:** M, **Impact:** high
- **Anchor:** the skill at `/home/will/.claude/skills/pre-push-secrets-scan/` runs against `git diff`; add `sops.scanWorkspace` that invokes the same Python and surfaces hits as `Diagnostics`. Two services touched: `pre-push-secrets-scan` skill and the Gitea CI workflows in `~/projects/finance-hub/.gitea/workflows/`, `~/projects/personal-crm/.gitea/workflows/`.
- **Why:** the skill catches secrets pre-push; running it inside the editor catches them pre-commit, which is even better.

### Replace direct `sops` calls with `just secrets sopsx` when under `~/Documents/Homelab/`
- **Effort:** M, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/providers/sopsFileSystemProvider.js:139` `_runSops` shells out directly; per `feedback_just_config_secret_leakage` the Homelab repo deliberately wraps sops to avoid stdout leaks. Two services touched: the Homelab repo's `~/Documents/Homelab/justfile` recipes and Loki at `http://127.0.0.1:3100`.
- **Why:** keeps audit logging consistent; uses the same path as the rest of the toolchain.

### Bitwarden lookup for age recipients
- **Effort:** M, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/commands/showRecipients.js:31` already has a Quick Pick of recipients with a copy-to-clipboard action; add a third action "Look up in Bitwarden" that invokes the `/home/will/.claude/skills/bitwarden-cli/` skill to fetch the human owner of that age public key.
- **Why:** "who is this recipient?" is unanswerable today; Bitwarden already stores the mapping for team identities.

### Loki log shipping
- **Effort:** S, **Impact:** low
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/util/logger.js:66` already writes a structured trace; add a fire-and-forget POST to `http://127.0.0.1:3100/loki/api/v1/push` with labels `job=sops-vscode`, `host=<os.hostname>`, matching the pattern documented in `/home/will/.claude/CLAUDE.md` "Structured Logging".
- **Why:** centralized debugging across willbook + ares + calypso; same dashboard as the rest of the homelab.

---

## Architectural improvements

### Migrate to TypeScript
- **Effort:** L, **Impact:** medium
- **Anchor:** all 11 source files in `/home/will/projects/sops_open_decrypted/src/` are `.js`; the defensive `err.stderr?.toString() || err.message` pattern recurs at `src/providers/sopsFileSystemProvider.js:159`, `src/util/preflight.js:23`, `src/util/preflight.js:46`, `src/commands/showEffectiveConfig.js`. Each instance hides a real type ambiguity.
- **Why:** a single `interface Detection { type: StoreType; source: 'content'|'extension'; confidence: 'high'|'medium'|'low' }` would catch the most common consumer bug (reading `detection.foo` instead of `detection.type`) at compile time.

### Replace regex-based `parseRecipients` with `sops filestatus --output-format json`
- **Effort:** M, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/util/sopsMetadata.js:1-17` runs nine separate regexes across YAML/JSON/dotenv/INI shapes to scrape recipient lists; `sops filestatus` ships this as structured JSON.
- **Why:** drops ~30 LoC, removes a brittle parser, and works for store types you don't yet handle. The cost is one extra sops invocation per `showRecipients` call (~50 ms).

### Worker pool for `_runSops`
- **Effort:** L, **Impact:** medium
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/providers/sopsFileSystemProvider.js:139` is sequential. The Secrets Outline tree-view idea above would scan dozens of files; today the only knob is the 30s per-call timeout at `:153`.
- **Why:** KMS-backed decrypts can take 800 ms each; sequentially that's a 30-second tree-view refresh on a 35-file repo, parallel is 2 seconds.

### Drop `redirectEditorProvider` in favor of `onDidOpenTextDocument`
- **Effort:** M, **Impact:** low
- **Anchor:** `/home/will/projects/sops_open_decrypted/extension.js:49` registers a custom editor whose entire job is to close itself and reopen the virtual URI; `/home/will/projects/sops_open_decrypted/src/providers/redirectEditorProvider.js` is 60 lines of webview-create-then-dispose.
- **Why:** webview create/destroy is the largest single source of flicker on file open; a workspace event listener achieves the same redirect with no webview at all.

---

## Wild ideas / spin-offs

### Extract `sops-lsp` server
- **Effort:** L, **Impact:** high
- **Anchor:** `/home/will/projects/sops_open_decrypted/src/util/storeDetection.js`, `src/util/sopsErrors.js`, `src/util/sopsMetadata.js` are pure logic with zero VS Code coupling.
- **Why:** SOPS has no LSP. Extract these three files into a standalone server, the VS Code extension becomes a thin client, and Neovim / Helix / JetBrains users get the same diagnostics for free. You'd be first.

### `drape` as an alternative backend
- **Effort:** M, **Impact:** low
- **Anchor:** `~/projects/drape/` is your existing secret/config tool; the FileSystemProvider in `/home/will/projects/sops_open_decrypted/src/providers/sopsFileSystemProvider.js` is store-agnostic at the boundary.
- **Why:** pair-package the two repos so `*.drape` files Just Work in this extension; cross-promotes both tools.

### `sopex` CLI mirror
- **Effort:** M, **Impact:** medium
- **Anchor:** the same three util files above plus a thin yargs wrapper.
- **Why:** when you're SSH'd into a server with no VS Code, `sopex coverage app/.env.sops` would produce the same Quick-Pick output as `SOPS: Show Encryption Coverage`. No new logic, just a different shell.

### Read-only audit dashboard at `sops.lab.khanpikehome.com`
- **Effort:** L, **Impact:** low
- **Anchor:** a small SvelteKit app behind the existing Traefik gateway and `tailnet_dns_service` middleware tier (per `/home/will/.claude/CLAUDE.md` "Host Toolchain"); enumerates every `*.sops` in `~/Documents/Homelab` and `~/projects/*` via filesystem scan, shows recipient + coverage tables, never decrypts.
- **Why:** "what is the current state of my secrets across the homelab" has no answer today; this is the dashboard, scoped to read-only auditing so it's safe to run unattended.

---

Total: 27 ideas. The two biggest-bang items by my read are **diff-with-HEAD (decrypted)** and **diagnostic squiggles for cleartext-that-should-be-encrypted**, both M-effort, both block real workflow friction.
