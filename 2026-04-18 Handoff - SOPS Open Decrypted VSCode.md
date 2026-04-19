---
summary: "SOPS open-decrypted VSCode workflow -- fully deployed"
---

# Handoff: SOPS Open Decrypted VSCode

**Date:** 2026-04-18
**Goal:** Open `.sops` files decrypted in a secure RAM tmpfs temp file that auto-erases when the editor closes.

## Current Status

All components deployed and working:

- Shell script installed and executable
- VS Code task configured for Homelab workspace
- Global keybinding set
- Command Runner extension installed and configured

## What Was Built

### Script: `~/.local/bin/sops-open`
- Decrypts a `.sops` file into `/dev/shm/sops-XXXXXX` (RAM tmpfs, never hits disk)
- `chmod 600` on the temp file immediately after creation
- `trap` on EXIT/INT/TERM calls `shred -u` to wipe the file when VS Code closes
- Uses `code --wait` so the shell waits for the editor tab to close before running cleanup

### VS Code Task: `Homelab/.vscode/tasks.json`
- Label: "Open SOPS Decrypted"
- Runs `sops-open ${file}` against the currently focused file
- Presentation: silent, closes terminal panel after

### Keybinding: `~/.config/Code/User/keybindings.json`
- `Ctrl+Shift+Alt+S` → runs the "Open SOPS Decrypted" task

### Extension: `edonet.vscode-command-runner` (v0.0.124)
- Adds "Run Command" to editor right-click context menu
- Config in `~/.config/Code/User/settings.json`:
  ```json
  "command-runner.commands": {
      "Open SOPS Decrypted": "sops-open ${file}"
  }
  ```
- Right-click any open file → "Run Command" → "Open SOPS Decrypted"

## Usage

**From file explorer:** Focus the `.sops` file, press `Ctrl+Shift+Alt+S`

**From editor (file open):** Right-click → Run Command → Open SOPS Decrypted

**From terminal:** `sops-open infra/lldap/.env.sops`

## Next Steps

- [ ] Consider adding the task to other workspace `.vscode/tasks.json` files (not just Homelab)
- [ ] Consider adding `.gitignore` entry for `.vscode/tasks.json` if workspace tasks shouldn't be committed, or commit it intentionally (currently tracked by Homelab git)
- [ ] Optionally add a file-type restriction to the keybinding: `"when": "resourceExtname =~ /\\.sops$/"`
- [ ] Consider adding a `chezmoi` entry for `~/.config/Code/User/keybindings.json` so it syncs to other machines

## Files Touched

- `~/.local/bin/sops-open` -- new script
- `~/.config/Code/User/keybindings.json` -- new file
- `~/.config/Code/User/settings.json` -- added command-runner config
- `~/Documents/Homelab/.vscode/tasks.json` -- new file

## Blockers

None -- fully working.
