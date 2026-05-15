const fs = require('fs');
const path = require('path');

// Filename-based hint used when content sniffing can't classify the file
// (file is missing, empty, or carries no SOPS markers in the first chunk).
// "binary" is the safe default — SOPS treats any unknown format as binary.
function detectByExtension(sopsFilePath) {
    const base = sopsFilePath.replace(/\.sops$/, '');
    const basename = path.basename(base).toLowerCase();
    if (basename === '.env' || basename.endsWith('.env')) return 'dotenv';
    if (basename === '.envrc' || basename.endsWith('.envrc')) return 'dotenv';
    const ext = path.extname(base).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') return 'yaml';
    if (ext === '.json') return 'json';
    if (ext === '.ini') return 'ini';
    return 'binary';
}

function readHead(filePath, bytes = 4096) {
    let fd = -1;
    try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(bytes);
        const n = fs.readSync(fd, buf, 0, bytes, 0);
        return buf.slice(0, n).toString('utf8');
    } catch {
        return null;
    } finally {
        if (fd !== -1) { try { fs.closeSync(fd); } catch {} }
    }
}

// Classify a SOPS-encrypted file by inspecting its first ~4 KB of bytes.
// Returns { type, source, confidence }:
//   type:       'json' | 'yaml' | 'dotenv' | 'ini' | 'binary'
//   source:     'content' (markers found) | 'extension' (filename fallback)
//   confidence: 'high'   — recognized SOPS marker in content
//               'medium' — content present but ambiguous, fell back to extension
//               'low'    — could not read the file at all (e.g. doesn't exist yet)
//
// Strong content detection lets us pick the right --input-type regardless of
// what the file is named. Without it, a binary-store payload sitting at
// `foo.env.sops` would always fail (the basename says "dotenv" but the bytes
// are JSON-wrapped) and the user would see a cryptic sops parse error.
function detectStoreType(sopsFilePath) {
    const head = readHead(sopsFilePath);
    if (head == null) {
        return { type: detectByExtension(sopsFilePath), source: 'extension', confidence: 'low' };
    }
    const trimmed = head.replace(/^﻿/, '').trimStart();

    // JSON-wrapped payload. Two flavors:
    //   binary store:  {"data":"ENC[...]","sops":{...}}  — entire content as one blob
    //   json store:    structured JSON with ENC[...] string leaves
    if (trimmed.startsWith('{')) {
        if (/^\{\s*"data"\s*:\s*"ENC\[/.test(trimmed)) {
            return { type: 'binary', source: 'content', confidence: 'high' };
        }
        if (/"sops"\s*:\s*\{/.test(trimmed) || /"mac"\s*:\s*"ENC\[/.test(trimmed)) {
            return { type: 'json', source: 'content', confidence: 'high' };
        }
        // Looks like JSON but no SOPS marker yet — fall through to extension hint
    }

    // YAML store: explicit doc separator, top-level sops block, or unquoted mac
    if (/^---\s*$/m.test(trimmed) ||
        /^sops:\s*$/m.test(trimmed) ||
        /^\s+mac:\s*ENC\[/m.test(trimmed)) {
        return { type: 'yaml', source: 'content', confidence: 'high' };
    }

    // INI store: section header AND at least one key=ENC[
    // Checked before dotenv because dotenv's KEY=ENC[ pattern would otherwise
    // shadow it — INI has those same key=value lines under [sections].
    if (/^\[[^\]]+\]/m.test(trimmed) && /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*ENC\[/m.test(trimmed)) {
        return { type: 'ini', source: 'content', confidence: 'high' };
    }

    // dotenv store: KEY=ENC[...] or the explicit sops_version= footer
    if (/^sops_version=/m.test(trimmed) ||
        /^[A-Za-z_][A-Za-z0-9_]*=ENC\[/m.test(trimmed)) {
        return { type: 'dotenv', source: 'content', confidence: 'high' };
    }

    return { type: detectByExtension(sopsFilePath), source: 'extension', confidence: 'medium' };
}

module.exports = { detectStoreType, detectByExtension };
