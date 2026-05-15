#!/usr/bin/env node
// Pure unit test for storeDetection — no sops binary required.
// Writes synthetic fixtures into a temp dir, asserts detection picks the
// right type with the right source/confidence.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectStoreType, detectByExtension } = require('../src/util/storeDetection');

const cases = [
    // [filename, content, expectedType, expectedSource, expectedConfidence]
    [
        'binary-store.env.sops',
        '{\n  "data": "ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]",\n  "sops": { "version": "3.10.0" }\n}\n',
        'binary', 'content', 'high',
    ],
    [
        'json-store.json.sops',
        '{\n  "secret": "ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]",\n  "sops": { "mac": "ENC[...]" }\n}\n',
        'json', 'content', 'high',
    ],
    [
        'yaml-store.yaml.sops',
        'secret: ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]\nsops:\n    version: "3.10.0"\n',
        'yaml', 'content', 'high',
    ],
    [
        'dotenv-store.env.sops',
        'API_KEY=ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]\nsops_version=3.10.0\n',
        'dotenv', 'content', 'high',
    ],
    [
        'ini-store.ini.sops',
        '[main]\nsecret=ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]\n',
        'ini', 'content', 'high',
    ],
    [
        'mystery.tfvars.sops',
        // No SOPS markers — should fall back to extension (tfvars → binary)
        'data = "this looks like HCL but has no sops markers"\n',
        'binary', 'extension', 'medium',
    ],
    [
        'mystery.yaml.sops',
        // No SOPS markers — extension says yaml
        'plain: yaml content without encryption markers\n',
        'yaml', 'extension', 'medium',
    ],
];

const extensionCases = [
    ['foo.env.sops', 'dotenv'],
    ['/abs/path/.env.sops', 'dotenv'],
    ['/abs/path/.envrc.sops', 'dotenv'],
    ['foo.yaml.sops', 'yaml'],
    ['foo.yml.sops', 'yaml'],
    ['foo.json.sops', 'json'],
    ['foo.ini.sops', 'ini'],
    ['foo.tfvars.sops', 'binary'],
    ['foo.pem.sops', 'binary'],
    ['weird-no-ext.sops', 'binary'],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sops-detection-'));
let fails = 0;
let passes = 0;

for (const [name, content, expType, expSource, expConfidence] of cases) {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content, { mode: 0o600 });
    const got = detectStoreType(p);
    const ok = got.type === expType && got.source === expSource && got.confidence === expConfidence;
    const tag = ok ? 'PASS' : 'FAIL';
    if (ok) passes += 1; else fails += 1;
    process.stdout.write(`${tag} content: ${name}\n`);
    if (!ok) {
        process.stdout.write(`     expected type=${expType} source=${expSource} confidence=${expConfidence}\n`);
        process.stdout.write(`     got      type=${got.type} source=${got.source} confidence=${got.confidence}\n`);
    }
}

for (const [name, expType] of extensionCases) {
    const got = detectByExtension(name);
    const ok = got === expType;
    const tag = ok ? 'PASS' : 'FAIL';
    if (ok) passes += 1; else fails += 1;
    process.stdout.write(`${tag} ext:     ${name} -> ${got}${ok ? '' : ` (expected ${expType})`}\n`);
}

// missing file
const missing = path.join(tmp, 'does-not-exist.env.sops');
const got = detectStoreType(missing);
const ok = got.type === 'dotenv' && got.source === 'extension' && got.confidence === 'low';
if (ok) { passes += 1; process.stdout.write('PASS missing: returns extension/low\n'); }
else { fails += 1; process.stdout.write(`FAIL missing: got ${JSON.stringify(got)}\n`); }

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`\n${passes} passed, ${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
