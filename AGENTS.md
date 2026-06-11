# SOPS Open Decrypted — VS Code Extension

VS Code extension that mounts a virtual `sops-decrypted://` filesystem so `.sops` files open decrypted in a native text editor. Ctrl+S re-encrypts via the sops binary.

## Architecture

- `extension.js` — activation, registers providers and commands
- `src/providers/sopsFileSystemProvider.js` — virtual FS: `readFile` decrypts, `writeFile` encrypts; atomic write via staged rename + fsync; autosave blocked (manual Ctrl+S only)
- `src/providers/redirectEditorProvider.js` — custom editor that redirects `.sops` file opens to the virtual FS URI
- `src/providers/decorationProvider.js` — file decoration (lock badge) on `sops-decrypted://` URIs
- `src/commands/` — one file per command; all registered via `src/commands/index.js`
- `src/util/storeDetection.js` — sniffs sops store type (json/yaml/dotenv/ini/binary) from file content; falls back to filename extension
- `src/util/sopsErrors.js` — normalizes sops stderr into human-readable messages
- `src/util/config.js` — resolves `sops.*` VS Code settings (binaryPath, configPath, env, envFile)
- `src/util/logger.js` — output channel + optional trace log file; exports `SOPS_ENV_RE`
- `src/util/findSopsYaml.js` — ancestor-walk to find `.sops.yaml`/`.sops.yml`
- `src/util/saveReasonTracker.js` — captures `TextDocumentSaveReason` so writeFile can distinguish manual vs autosave

## Key conventions

- Plaintext tmp files go to `/dev/shm` on Linux (memory-backed), `os.tmpdir()` elsewhere; always shredded in `finally`.
- sops is invoked with `--input-type` and `--output-type` both set to the detected store type; `--filename-override` makes creation_rules match against the real path.
- Binary preflight (`checkBinary`) result is cached per resolved `binaryPath`; cache is cleared on `sops.binaryPath`/`sops.env`/`sops.envFile` config change.
- When primary decrypt fails and confidence was not `high`, the provider retries with alternate store types before surfacing the error.

## Tests

```bash
npm test          # unit + smoke (smoke requires sops binary and age key)
npm run test:unit # pure-node detection tests only (18 cases, no sops binary needed)
```

## Publishing

```bash
npm run package   # produces .vsix
npm run publish   # requires VSCE_PAT in env
```

Tag `v*.*.*` triggers the GitHub Actions release workflow (`.github/workflows/release.yml`).
