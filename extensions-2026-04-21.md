# Extension Ideas: sops_open_decrypted
Date: 2026-04-21
Context: VSCode extension v0.2.0 that mounts a virtual `sops-decrypted://` filesystem so `.sops` files open decrypted in a native editor; Ctrl+S re-encrypts via a `/dev/shm` tmp file. 11 commands wired; shipped as a local-publisher extension only.

## Homelab integration surface

- **142 `.sops` files under `~/Documents/Homelab/`** across `infra/`, `apps/`, `media/`, `ai/`, `automation/` groups, plus 6 in `~/projects/` (finance-hub, personal-crm, plaid-sync, this repo). Anything that reduces edit-friction on those files compounds fast.
- Directly adjacent stacks: `infra/identity/{lldap,authelia,authentik}`, `infra/backup/kopia`, `infra/gateway/{traefik,cloudflare,tailscale}`, `infra/just` (hl/just wrapper).
- Peer user-projects: `~/projects/just-sidebar` (VSCode extension, same shape), `~/projects/plaid-sync` (`.env.sops` consumer), `~/projects/finance-hub`.
- Home Assistant, Mempalace MCP, UptimeKuma all live on the same tailnet and have APIs that could pair with an editor event stream.

## Quick wins

### Add README.md + LICENSE
- **Effort:** S · **Impact:** med
- **Anchor:** `ls` of repo root shows `extension.js`, `package.json`, test fixtures, handoff markdown — no README, no LICENSE.
- **Why:** pre-req for publishing anywhere (OpenVSX, tarball shared with willbook/calypso) and for memory: `vscode_extension_publishing` notes just-sidebar already hit this. Five-minute job that unblocks every distribution idea below.

### Fill real `publisher` + `repository` fields
- **Effort:** S · **Impact:** med
- **Anchor:** [package.json:6](package.json#L6) — `"publisher": "local"`, no `repository`, no `icon`.
- **Why:** required by `vsce package`; blocks packaging to `.vsix` even for private distribution.

### Surface actionable error when `sops` binary missing
- **Effort:** S · **Impact:** med
- **Anchor:** [src/providers/sopsFileSystemProvider.js:60](src/providers/sopsFileSystemProvider.js#L60) — `execFileSync` on ENOENT currently throws `SOPS decrypt failed: spawn sops ENOENT`.
- **Why:** On a fresh calypso install (no `sops` yet), users see the raw ENOENT. A pre-flight `fs.existsSync` on the resolved `binaryPath` + "install sops, or set `sops.binaryPath`" message is one `if` block.

### `npm test` script + unit tests for pure utilities
- **Effort:** S · **Impact:** high
- **Anchor:** [src/util/paths.js:5](src/util/paths.js#L5) `getInputType`, [src/util/dotenv.js:1](src/util/dotenv.js#L1) `findInvalidDotenvLines`, [src/util/sopsMetadata.js:15](src/util/sopsMetadata.js#L15) `parseCoverageRules` — all pure functions, zero tests.
- **Why:** regex-based metadata parsing is exactly the kind of code that silently breaks on a SOPS version bump; memory `sops-extension-fixes` shows two compounding bugs already snuck through.

### Configurable tmp dir instead of hard-coded `/dev/shm`
- **Effort:** S · **Impact:** low
- **Anchor:** [src/providers/sopsFileSystemProvider.js:93](src/providers/sopsFileSystemProvider.js#L93) — `const tmp = /dev/shm/sops-...`
- **Why:** `/dev/shm` exists on Linux only. On macOS calypso, this would fall through to `shred -u` on a non-existent path and leak the plaintext via `/dev/shm` missing → `fs.writeFileSync` ENOENT. Add `sops.tmpDir` setting with `os.tmpdir()` default outside Linux.

### Status-bar encrypted/total counter
- **Effort:** S · **Impact:** low
- **Anchor:** [extension.js:16-25](extension.js#L16-L25) — `LanguageStatusItem` exists but just shows filename.
- **Why:** for `.env.sops` files, showing `3/8 encrypted` in the language status tells you at a glance whether `unencrypted_suffix` rules are doing what you think; cheap reuse of the logic already in `showEncryptionCoverage`.

## New features

### Read-only "peek decrypted" mode
- **Effort:** S · **Impact:** med
- **Anchor:** [src/providers/sopsFileSystemProvider.js:15](src/providers/sopsFileSystemProvider.js#L15) — provider is always writable.
- **Why:** sometimes you just want to confirm a value without any chance of a save-and-corrupt cycle. A second command `sops.peekDecrypted` that opens the same virtual URI with `isReadonly: true` is a handful of lines.

### Diff current edits vs. on-disk encrypted
- **Effort:** M · **Impact:** high
- **Anchor:** [src/commands/editorActions.js:17](src/commands/editorActions.js#L17) — `revealSource` exists; no diff equivalent.
- **Why:** before you Ctrl+S and rewrite a production `.env.sops`, you want to see exactly what will change. Decrypt a pristine copy into memory and fire `vscode.diff` against the dirty buffer.

### `sops.rotateRecipients` — re-encrypt with current `.sops.yaml`
- **Effort:** M · **Impact:** high
- **Anchor:** [src/util/sopsMetadata.js:1](src/util/sopsMetadata.js#L1) knows current recipients; no command wraps `sops updatekeys` / `sops -r`.
- **Why:** the single most common post-key-rotation chore. Today you'd shell out to `sops updatekeys` per file. Extension could scan the workspace, group by applicable rule, and fire `updatekeys` in a progress bar.

### `sops.encryptPlaintext` — turn `.env` into `.env.sops`
- **Effort:** M · **Impact:** med
- **Anchor:** [src/providers/sopsFileSystemProvider.js:70](src/providers/sopsFileSystemProvider.js#L70) — `writeFile` already owns the encrypt path.
- **Why:** initial onboarding of a new service today requires `sops -e .env > .env.sops && rm .env`. A right-click "SOPS: Encrypt in place" on any plaintext `.env` would collapse that.

### CodeLens over `.sops.yaml` creation_rules
- **Effort:** M · **Impact:** med
- **Anchor:** [src/commands/showSopsYaml.js:17](src/commands/showSopsYaml.js#L17) — opens the yaml but offers no affordances.
- **Why:** each `creation_rule` would show inline "42 files matched · 3 age · 0 kms · rotate all". Clickable → bulk rotate. For a 142-file homelab this is where the scale shows up.

### Detect drift against `.sops.yaml`
- **Effort:** M · **Impact:** high
- **Anchor:** [src/util/sopsMetadata.js:1-12](src/util/sopsMetadata.js#L1-L12) parses in-file recipients; no comparator against what `.sops.yaml` currently prescribes.
- **Why:** reality: someone adds a recipient to `.sops.yaml` but forgets `sops updatekeys` on older files. Show a warning badge on drifted `.sops` files in the explorer (piggyback on `decorationProvider`).

### Auto-detect age key file in effective-config diagnostics
- **Effort:** S · **Impact:** low
- **Anchor:** [src/commands/showEffectiveConfig.js:63](src/commands/showEffectiveConfig.js#L63) — lists env vars, but doesn't flag "you have `~/.config/sops/age/keys.txt` but `SOPS_AGE_KEY_FILE` is unset".
- **Why:** new-machine symptom is always "decrypt failed: no suitable key". Three extra lines in Effective Config would name the culprit.

### Pre-commit hook binary: scan `.env` for secrets that should be `.env.sops`
- **Effort:** M · **Impact:** high
- **Anchor:** memory `secrets-scanning` + existing `findInvalidDotenvLines` at [src/util/dotenv.js:1](src/util/dotenv.js#L1).
- **Why:** ship a `bin/sops-open-precommit` that, given a workspace, flags any plaintext `.env` whose key names match `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE`. Reuse the masking regex already in `showEffectiveConfig.js:6`.

## New Docker services

### sops-audit daemon
- **Effort:** L · **Impact:** med
- **Anchor:** `~/Documents/Homelab/infra/backup/kopia/.env.sops` plus 141 siblings; no cron today enforces "rotate keys every N days".
- **Why:** tiny Alpine container on the same cron pattern as memory `feedback_docker_scheduling` (Alpine crond), walks the homelab tree, emits Prometheus metrics for `sops_file_age_days`, `sops_recipient_count`, `sops_drift_detected`. Wire into existing monitoring stack.

### age-pubkey directory service
- **Effort:** L · **Impact:** med
- **Anchor:** `.sops.yaml` files today contain raw age public keys (see this repo's [.sops.yaml](.sops.yaml) — one huge hybrid postquantum key).
- **Why:** small Go/Python service behind Traefik + Authelia that serves `ares.pubkey`, `willbook.pubkey`, `calypso.pubkey`. Extension gains a "SOPS: Add Host Recipient" command that queries the service by hostname instead of pasting a 2 kB string. Naturally grows into the post-quantum rotation story (memory `age_native_postquantum_support`).

### sops-webhook sidecar
- **Effort:** M · **Impact:** low
- **Anchor:** `infra/gateway/traefik/.env.sops`, `infra/backup/kopia/.env.sops`, etc — each has downstream services that need reload on secret change.
- **Why:** exposes a tiny HTTP endpoint that, given a `.sops` path, runs the right `docker compose up -d <service>` via the `hl` wrapper. Extension fires webhook after successful re-encrypt; operator doesn't have to remember which stack to bounce.

### Transparent FUSE mount for `.sops` trees
- **Effort:** L · **Impact:** high
- **Anchor:** extension is VSCode-only; CLI workflows (zsh, vim on calypso) still need `sops exec-file`.
- **Why:** companion container that FUSE-mounts `~/Documents/Homelab/` as `~/Homelab-decrypted/` — reads decrypt on demand, writes re-encrypt. Extension and shell share one code path. Big project, but replaces both this extension and the `sops exec-file` pipeline.

## Integrations

### Kopia snapshot hook on successful re-encrypt
- **Effort:** M · **Impact:** high
- **Anchor:** [src/providers/sopsFileSystemProvider.js:111](src/providers/sopsFileSystemProvider.js#L111) (`logOpResult ok`), `~/Documents/Homelab/infra/backup/kopia/` (Kopia stack), memory `project_kopia_backup.md`.
- **Why:** fire a Kopia HTTP API call to snapshot the just-edited file immediately after encrypt. Pairs the extension (originator of secret change) with Kopia (canonical backup) so every edit is restorable without waiting for the next scheduled run.

### Home Assistant notification on encrypt failure
- **Effort:** S · **Impact:** med
- **Anchor:** [src/util/logger.js:33](src/util/logger.js#L33) (`logOpResult` on failure), `apps/home-assistant` + memory `reference_ha_config_location`.
- **Why:** a botched encrypt on a prod homelab secret is exactly the thing you want to know about from your phone at 10pm, not the next time you `git status`. POST to HA's `/api/services/notify/mobile_app_will` with the first line of stderr.

### LLDAP user-add command wired through the extension
- **Effort:** L · **Impact:** med
- **Anchor:** `infra/identity/lldap/.env.sops` + `infra/identity/authelia/configuration.yml.sops` (via memory `authelia-lldap-deploy`), `infra/gateway/traefik/.env.sops`.
- **Why:** common multi-file workflow today is "edit LLDAP admin creds, restart LLDAP, restart Authelia, note new cred in Traefik". A `sops.lldapAddUser` command could script the chained edits + restarts across all three stacks. Two real services: LLDAP + Authelia.

### Mempalace drawer on `.sops.yaml` changes
- **Effort:** M · **Impact:** low
- **Anchor:** [src/providers/sopsFileSystemProvider.js:111](src/providers/sopsFileSystemProvider.js#L111), memory `project_mempalace_status.md`, palace already has `sops-configuration` room.
- **Why:** when someone (Claude or human) edits a `.sops.yaml`, auto-file a drawer capturing the before/after recipient list into `wing_homelab` `sops-configuration` room. Two services: this extension + Mempalace MCP.

### just-sidebar view container for workspace `.sops` files
- **Effort:** M · **Impact:** med
- **Anchor:** `~/projects/just-sidebar/` + memory `just_sidebar_extension`, this extension's `FileDecorationProvider` at [src/providers/decorationProvider.js:5](src/providers/decorationProvider.js#L5).
- **Why:** tree view of all `.sops` files in workspace with lock/unlock decorations, click to decrypt. Two adjacent VSCode extensions sharing a namespace. Concrete enough that you could publish a combined `pike00-homelab-pack` meta-extension.

### UptimeKuma monitor for cert-embedded age keys
- **Effort:** M · **Impact:** low
- **Anchor:** `infra/monitoring/uptime-kuma` + memory `monitoring_uptime_kuma_api_key_stale`, age keys in `.sops.yaml` rotate on schedule.
- **Why:** UptimeKuma Push monitor that the extension pings every time it successfully re-encrypts using a given recipient set. If no ping in 30 days for a recipient, something's broken or unused.

## Architectural improvements

### Replace `execFileSync` with async `execFile`
- **Effort:** M · **Impact:** high
- **Anchor:** [src/providers/sopsFileSystemProvider.js:60](src/providers/sopsFileSystemProvider.js#L60), [src/providers/sopsFileSystemProvider.js:108](src/providers/sopsFileSystemProvider.js#L108).
- **Why:** `execFileSync` blocks the entire extension host thread. For a small `.env.sops` this is invisible; for a 40 kB yaml with dozens of recipients it's a 300 ms freeze. Async variant + progress indicator is the standard VSCode pattern.

### TypeScript + strict mode
- **Effort:** L · **Impact:** med
- **Anchor:** [package.json:7](package.json#L7) — no `devDependencies`, no `tsconfig.json`.
- **Why:** config.js:99-104 has `configPath` that is `null | string | ''` depending on path; strict TS catches that. Migration is file-by-file because all surface is JS with commonjs.

### Use `vscode.workspace.fs.readFile` everywhere
- **Effort:** S · **Impact:** med
- **Anchor:** [src/commands/showRecipients.js:14](src/commands/showRecipients.js#L14), [src/commands/showEncryptionCoverage.js:18](src/commands/showEncryptionCoverage.js#L18), [src/commands/showSopsYaml.js:23](src/commands/showSopsYaml.js#L23) — all use `fs.readFileSync`.
- **Why:** on Remote SSH (calypso host mount), Node `fs` reads the *extension host's* filesystem, not the workspace's. `workspace.fs` is scheme-aware and uniform. Memory `vscode-remote-ssh-extensions` already bit us once.

### Centralized typed error classes
- **Effort:** M · **Impact:** low
- **Anchor:** [src/providers/sopsFileSystemProvider.js:66](src/providers/sopsFileSystemProvider.js#L66), [src/providers/sopsFileSystemProvider.js:116](src/providers/sopsFileSystemProvider.js#L116), [src/util/config.js:99-104](src/util/config.js#L99-L104).
- **Why:** each failure site today wraps errors inline. `SopsConfigError` / `SopsExecError` / `SopsValidationError` lets commands render consistent toasts and the log channel can filter by type.

### Structured recipient parser for yaml/json
- **Effort:** M · **Impact:** med
- **Anchor:** [src/util/sopsMetadata.js:7-12](src/util/sopsMetadata.js#L7-L12) — regex-based line scan.
- **Why:** misses Vault URIs, BigQuery (`sops_gcp_kms_list_*_map_resource_id`), and any nested structure SOPS adds in newer versions. Load the file via `js-yaml` / `JSON.parse` and read `.sops.*` structured.

### Integration tests with `@vscode/test-electron`
- **Effort:** L · **Impact:** high
- **Anchor:** [test.env.sops](test.env.sops) and [test.yaml.sops](test.yaml.sops) exist as fixtures but are never executed in CI.
- **Why:** catches the exact class of bug from memory `sops-open-decrypted` (tmp path extension, ancestor-discovery). Real editor, real sops binary, real fixture files, verify decrypt → edit → save → verify ciphertext matches shape.

## Wild ideas / spin-offs

### Claude Code skill: `sops-edit-key`
- **Effort:** M · **Impact:** high
- **Anchor:** memory `feedback_never_read_secrets.md` (never cat age keys or decrypted `.env`) + this extension's encrypt path at [src/providers/sopsFileSystemProvider.js:70](src/providers/sopsFileSystemProvider.js#L70).
- **Why:** Claude today cannot safely update a single key in a `.env.sops` without violating the "never read decrypted secrets" rule. A skill that wraps `sops --set "[\"FOO\"]" "\"newvalue\""` (no plaintext read) would let Claude Code actually participate in secret maintenance. Natural next step for the homelab automation story.

### Post-quantum migration assistant
- **Effort:** L · **Impact:** med
- **Anchor:** [.sops.yaml](.sops.yaml) already uses the hybrid mlkem age key; memory `age_native_postquantum_support`, `hybrid-age-quantum-model`.
- **Why:** command `sops.auditPQReadiness` walks every `.sops.yaml` in a workspace, flags rules with only classical-age recipients, offers to add the hybrid recipient + re-encrypt matched files. Leverages the work already done in this repo's own sops.yaml.

### sops-open-web — tailnet-only mobile editor
- **Effort:** L · **Impact:** low
- **Anchor:** memory `tailnet-infrastructure`, `tailscale_cloudflare_integration`, existing `authelia-lldap-deploy` for auth.
- **Why:** small Preact app behind Traefik + Authelia that mirrors the decrypt-edit-re-encrypt loop over HTTP. Lets you fix a broken secret from a phone when you're away from willbook. Ambitious but reuses the existing identity + reverse-proxy stack wholesale.

### Device-local append-only decrypt audit log
- **Effort:** M · **Impact:** med
- **Anchor:** [src/util/logger.js:20](src/util/logger.js#L20) — logger exists but output is ephemeral and unsigned.
- **Why:** write a hash-chained record of every decrypt/encrypt to `~/.local/state/sops-open-decrypted/ledger.jsonl`. "Was a secret opened at 2 AM?" becomes answerable. Could later anchor into `keepassxc-secret-service` or similar for stronger audit.

### Beancount ledger: isolate Plaid/Fava API keys
- **Effort:** M · **Impact:** low
- **Anchor:** `~/projects/plaid-sync/.env.sops` + `~/Documents/Finance/Ledger` + memory `plaid_sync_preferences.md`.
- **Why:** tiny sidecar that injects decrypted plaid/fava credentials at `bean-query`/`fava` runtime via `sops exec-env`, so those tokens never live as plaintext env exports in zsh history. Niche, but fits the finance-hub workflow.
