# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-14

### Added

- Multi-format SOPS file support: content-based store type detection (json/yaml/dotenv/ini/binary) with high-confidence sniffing, filename hint fallback, and tolerant alternate-type retry for ambiguous cases
- Normalized SOPS error messages with actionable explanations surfaced directly in the editor
- Binary preflight check for the sops binary with per-path caching; cache is invalidated when `sops.binaryPath`, `sops.env`, or `sops.envFile` change
- Atomic encrypted writes via staged rename with fsync to prevent partial writes on failure
- Save reason tracking to prevent unintended re-encryption during autosave (AfterDelay and FocusOut saves are blocked)
- New commands: **Show Recipients**, **Show Encryption Coverage**, **Show Effective Configuration**, **Show Log**, **Show Trace Log File**
- Failure actions: Show Log, Show Recipients, and Show Effective Configuration are surfaced directly on error notifications
- File-based trace log at `$XDG_STATE_HOME/sops-open-decrypted/trace.log` for persistent debugging
- Expanded `.sops.yaml` creation rules in the custom editor redirect: per-path rules for `.env`, `.tfvars`, `.pem`/`.key`, `credentials.json`, and `.envrc` with `input_type`/`output_type` pins and `unencrypted_regex` carve-outs for common config keys
- Support for `sops.envFile` and `sops.env` inline configuration options
- Pure-node unit tests and live-sops smoke tests with binary, dotenv, and yaml fixtures behind `npm test`

### Changed

- SOPS stderr is now parsed and normalized into actionable error messages rather than surfaced raw
- The binary preflight cache is now invalidated when sops-related configuration changes

## [0.1.0] - 2026-04-18

### Added

- Initial release of SOPS Open Decrypted
- Transparent decrypt/encrypt of SOPS-encrypted files via a virtual filesystem provider
- Files open decrypted in the editor and are re-encrypted on save without leaving plaintext on disk
- Custom editor redirect for SOPS-managed files
- Basic `.sops.yaml` creation support

[0.2.0]: https://github.com/pike00/sops_open_decrypted/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pike00/sops_open_decrypted/releases/tag/v0.1.0
