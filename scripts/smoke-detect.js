#!/usr/bin/env node
// Smoke test: classify every test.*.sops fixture and check that running
// `sops decrypt --input-type <detected> --output-type <detected>` actually
// succeeds. No VS Code dependency — pure node + sops binary.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { detectStoreType } = require('../src/util/storeDetection');

const REPO = path.resolve(__dirname, '..');
const FIXTURES = fs.readdirSync(REPO)
    .filter(f => f.endsWith('.sops'))
    .filter(f => !f.startsWith('.'))
    .map(f => path.join(REPO, f));

if (!FIXTURES.length) {
    console.error('no *.sops fixtures found at repo root');
    process.exit(1);
}

let fails = 0;
for (const fixture of FIXTURES) {
    const det = detectStoreType(fixture);
    process.stdout.write(`${path.basename(fixture)}\n`);
    process.stdout.write(`  detected: type=${det.type} source=${det.source} confidence=${det.confidence}\n`);
    const args = ['decrypt', '--input-type', det.type, '--output-type', det.type, fixture];
    try {
        const out = execFileSync('sops', args, { timeout: 10000 });
        process.stdout.write(`  decrypt:  ok (${out.length} bytes)\n\n`);
    } catch (err) {
        fails += 1;
        const stderr = err.stderr?.toString() || err.message;
        const firstLine = stderr.split(/\r?\n/).find(l => l.trim()) || stderr;
        process.stdout.write(`  decrypt:  FAILED — ${firstLine}\n\n`);
    }
}

process.exit(fails === 0 ? 0 : 1);
