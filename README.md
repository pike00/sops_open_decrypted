# SOPS Open Decrypted

Open Mozilla SOPS-encrypted files directly in VS Code. When you open a `*.sops` file, the extension decrypts it transparently into a native text editor. Saving re-encrypts and writes the result atomically back to disk. The plaintext never touches a persistent file.

## Features

- **Transparent decrypt on open** -- `*.sops` files open in a real VS Code text editor with full syntax highlighting, IntelliSense, and diff support
- **Atomic re-encrypt on save** -- Ctrl+S encrypts in memory and writes via a staged rename; the original file is never partially overwritten
- **Autosave guard** -- AfterDelay and FocusOut autosave modes are intentionally blocked; only explicit saves trigger re-encryption
- **In-memory only** -- decrypted content is never written to a persistent file; any temp file uses `/dev/shm` on Linux (RAM-backed)
- **Auto-detection of store type** -- sniffs json/yaml/dotenv/ini/binary from file content with high confidence; falls back to filename hints and tolerant retry
- **Configurable sops environment** -- set the binary path, config path, env vars, and a dotenv file per workspace or resource
- **Rich command palette** -- inspect recipients, encryption coverage, effective config, and the applicable `.sops.yaml` without leaving VS Code
- **Context menu integration** -- right-click any `.sops` file in the Explorer to open it decrypted
- **Editor toolbar buttons** -- Save, Discard, and Reveal Source appear in the title bar when a decrypted view is active

## Requirements

- VS Code 1.85.0 or later
- `sops` binary (v3.x) installed and available on `PATH`, or configured via `sops.binaryPath`
- Valid SOPS keys configured and accessible for the files you want to open (age key, AWS credentials, etc.)
- A `.sops.yaml` in an ancestor directory of the file being opened, or `sops.configPath` pointing to one

## Quick Start

1. **Install sops** -- download from [github.com/getsops/sops/releases](https://github.com/getsops/sops/releases) or via your package manager:
   ```sh
   # macOS
   brew install sops

   # Arch Linux
   pacman -S sops

   # Download binary directly
   curl -Lo sops https://github.com/getsops/sops/releases/latest/download/sops-v3.x.x.linux.amd64
   chmod +x sops && sudo mv sops /usr/local/bin/
   ```

2. **Install the extension** -- search for "SOPS Open Decrypted" in the VS Code Extensions panel, or install from the marketplace:
   ```sh
   code --install-extension pike00.sops-open-decrypted
   ```

3. **Open a `.sops` file** -- click any `*.sops` file in the Explorer. The extension intercepts the open and displays the decrypted content. Edit and press Ctrl+S to re-encrypt.

If sops cannot decrypt the file (wrong key, missing config), an error notification appears with **Show Log** and **Show Effective Configuration** actions to help diagnose the problem.

## Configuration

All settings are prefixed `sops.` and can be set at user, workspace, or folder level.

| Setting | Type | Default | Description |
|---|---|---|---|
| `sops.binaryPath` | `string` | `"sops"` | Path to the sops binary. Supports `~`, `${workspaceFolder}`, `${env:VAR}`. |
| `sops.configPath` | `string` | `""` | Path to `.sops.yaml`. When set, passed via `--config`, bypassing the ancestor directory walk. Relative paths resolve against the workspace folder. |
| `sops.envFile` | `string` | `""` | Path to a dotenv file loaded into the sops process environment (e.g. for `SOPS_AGE_KEY_FILE`, `AWS_PROFILE`). Gitignore this file if it contains secrets. Values in `sops.env` take precedence. |
| `sops.env` | `object` | `{}` | Inline `key=value` env vars merged on top of `sops.envFile` before invoking sops. Do not embed private key material directly -- reference key files by path instead. |
| `sops.debugLogFile` | `string` | `""` | Append-only trace log path. Empty defaults to `$XDG_STATE_HOME/sops-open-decrypted/trace.log` (falls back to `~/.local/state/...`). Supports `~`, `${userHome}`, `${env:VAR}`. Never logs file bodies or env values. |

### Example: age key via envFile

`.vscode/sops.env` (gitignored):
```sh
SOPS_AGE_KEY_FILE=/home/yourname/.config/sops/age/keys.txt
```

`settings.json`:
```json
{
  "sops.envFile": "${workspaceFolder}/.vscode/sops.env"
}
```

### Example: AWS profile per workspace

```json
{
  "sops.env": {
    "AWS_PROFILE": "prod-readonly"
  }
}
```

## Commands

All commands are in the **SOPS** category and available via the Command Palette (Ctrl+Shift+P).

| Command | Description |
|---|---|
| `SOPS: Open SOPS Decrypted` | Open a `.sops` file in the decrypted editor view. Also available via Explorer right-click. |
| `SOPS: New Encrypted File` | Create a new encrypted file: pick a store type and name, then edit it decrypted. Recipients come from the governing `.sops.yaml`. Also available via Explorer folder right-click. |
| `SOPS: Save & Re-encrypt` | Encrypt the current in-memory content and write it back to the `.sops` file. Equivalent to Ctrl+S. |
| `SOPS: Discard` | Revert all in-memory edits, restoring the last decrypted state from disk. |
| `SOPS: Reveal .sops Source` | Reveal the underlying encrypted `.sops` file in the Explorer. |
| `SOPS: Reveal in Source Control` | Open the `.sops` file in the SCM diff view. |
| `SOPS: Open Applicable .sops.yaml` | Open the `.sops.yaml` that governs the active file. |
| `SOPS: Show .sops.yaml` | Walk up from the current file and open the nearest `.sops.yaml`. |
| `SOPS: Show Recipients` | Display the age/KMS/PGP recipients embedded in the file, with a copy-to-clipboard option. |
| `SOPS: Show Encryption Coverage` | For `.env` and `.ini` files, show which keys are encrypted vs. cleartext. |
| `SOPS: Show Effective Configuration` | Show the resolved sops binary path, config path, and env vars (secret values masked). |
| `SOPS: Show Log` | Open the SOPS output channel. |
| `SOPS: Show Trace Log File` | Open the file-based trace log in the editor. |

## Supported Formats

The store type is detected from file content, not just the filename. Detection checks for JSON structure, YAML structure, dotenv `KEY=VALUE` lines, and INI `[section]` headers, in that order. Unknown or binary content falls back to the binary store.

| Format | Store Type | Example Filenames |
|---|---|---|
| JSON | `json` | `config.sops`, `secrets.json.sops` |
| YAML | `yaml` | `values.sops`, `secrets.yaml.sops` |
| dotenv | `dotenv` | `.env.sops`, `app.env.sops` |
| INI | `ini` | `config.ini.sops` |
| Binary | `binary` | `cert.pem.sops`, `archive.tar.sops` |

## Key Providers

The extension delegates all cryptographic operations to the `sops` binary. Supported key providers:

- **age** -- recommended for personal and homelab use; key file set via `SOPS_AGE_KEY_FILE`
- **AWS KMS** -- uses standard AWS credential chain (`AWS_PROFILE`, instance role, etc.)
- **GCP KMS** -- uses application default credentials
- **Azure Key Vault** -- uses Azure SDK credential chain
- **PGP** -- legacy; requires GPG agent running with the appropriate key

## Security Notes

**Autosave is intentionally disabled.** AfterDelay and FocusOut autosave will not trigger re-encryption — the write is rejected and the editor stays dirty, so no edits are lost. Only an explicit save (Ctrl+S or the Save & Re-encrypt command) writes to disk. This prevents partial or unintended re-encryption during editing (which would also churn git and spawn sops on every pause). If you run with `files.autoSave` enabled, VS Code will surface a save-rejected notice on each autosave tick; set `files.autoSave` to `off` for these files to avoid it.

**Plaintext stays in memory.** The decrypted content lives in a `sops-decrypted://` virtual filesystem backed by a JavaScript `Buffer`. On Linux, any temp file required for intermediate sops operations uses `/dev/shm` (RAM-backed, not persisted to disk). On other platforms, temp files use the OS temp directory and are deleted immediately after use.

**Decrypted views are not restored across reloads.** On window reload, VS Code would otherwise re-open any previously-open decrypted tabs (silently re-running `sops decrypt`). To avoid that, the extension closes all restored decrypted tabs at startup. Tabs with *unsaved* edits are left alone so your work is never discarded.

**Hot-exit can leak cleartext.** VS Code's `files.hotExit` persists *unsaved* editor contents to backup storage between sessions, and there is no API to exempt a virtual filesystem scheme from this. If you leave a decrypted file unsaved when the window closes or crashes, its plaintext may land in VS Code's backup directory. For a secrets workflow, set `files.hotExit` to `off` (VS Code then prompts you to save on exit instead) or don't leave decrypted files unsaved. The extension warns once when hot-exit is enabled; silence it with `sops.warnOnHotExit: false`.

**Atomic writes.** Re-encryption writes to a staging file alongside the `.sops` file, then renames it into place. The original encrypted file is never partially overwritten.

**Trace log never records secret values.** The debug log (`sops.debugLogFile`) captures file paths, sops arguments, process durations, and stderr output. It does not log decrypted file content, env var values, or key material.

**Do not commit key material in settings.** Use `sops.envFile` (gitignored) or `sops.env` with path references rather than embedding private key content inline.

## Troubleshooting

**sops binary not found**

The extension cannot find the `sops` executable.

- Verify `sops` is on your `PATH`: open a terminal and run `sops --version`
- If sops is installed in a non-standard location, set `sops.binaryPath` to the absolute path
- Run `SOPS: Show Effective Configuration` to see what path the extension resolved

**Key not available / decryption failed**

The file was encrypted with a key the extension cannot access.

- Check which recipients the file was encrypted for: run `SOPS: Show Recipients`
- For age: verify `SOPS_AGE_KEY_FILE` points to a file containing the correct private key
- For AWS KMS: verify your AWS credentials are valid (`aws sts get-caller-identity`)
- Use `sops.envFile` or `sops.env` to pass credentials into the sops process

**MAC mismatch error**

The file's message authentication code does not match, meaning the file was modified outside sops after encryption.

- This is a sops integrity check -- the file content was altered without going through sops
- If you intentionally edited the encrypted file, you can pass `--ignore-mac` via a wrapper script set as `sops.binaryPath`, but this is not recommended
- Restore the file from version control if the modification was unintended

**Wrong format detected**

The extension guessed the wrong store type and sops failed with a parse error.

- Check `SOPS: Show Log` for the sops stderr output
- The extension retries with an alternate store type on certain failures
- If auto-detection consistently fails, rename the file to include a format hint (e.g. `config.yaml.sops`) -- the extension uses the second-to-last extension as a hint when content-sniffing is ambiguous

**No .sops.yaml found**

sops cannot locate a configuration file and does not know which keys to use.

- Verify a `.sops.yaml` exists in the file's directory or an ancestor
- Run `SOPS: Show .sops.yaml` to see which config file sops would find from the current file's location
- Set `sops.configPath` to point explicitly to the correct config file

## License

MIT
