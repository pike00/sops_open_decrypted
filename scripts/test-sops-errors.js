#!/usr/bin/env node
// Pure unit test for sopsErrors.normalize / firstLine — no sops binary required.
// Each stderr pattern gets a realistic fixture, and every regex alternation token
// is exercised individually, so an accidental deletion of a branch (or a sops
// output-format change) fails loudly instead of silently degrading to the raw
// passthrough.

const { normalize, firstLine } = require('../src/util/sopsErrors');

let passes = 0;
let fails = 0;
function check(label, ok, detail) {
    if (ok) { passes += 1; process.stdout.write(`PASS ${label}\n`); }
    else { fails += 1; process.stdout.write(`FAIL ${label}${detail ? `\n     ${detail}` : ''}\n`); }
}

// A stable, unique substring of each pattern's explanation. Asserting on these
// (rather than the full text) keeps the tests resilient to wording tweaks while
// still proving the right branch matched.
const MARKERS = {
    noKey:   'No available recipient key matched',
    mac:     'edited outside SOPS',
    config:  'The configured .sops.yaml path does not exist',
    type:    'sops rejected the input/output type',
    parse:   'sops could not parse the file in the expected format',
    timeout: 'sops timed out after 30 s',
    kms:     'KMS/HSM access denied',
};

// Realistic, multi-line stderr per pattern → expected marker.
const patternCases = [
    ['no-key (decrypt failure)',
        'Failed to decrypt sops data key with available keys:\n\nno key could decrypt the data\n', MARKERS.noKey],
    ['mac mismatch',
        'Error: MAC mismatch. File has 1 keys, computed 0\n', MARKERS.mac],
    ['missing .sops.yaml',
        'config file not found: open /home/will/repo/.sops.yaml: no such file or directory\n', MARKERS.config],
    ['unknown input type',
        'error: unknown input type foo\n', MARKERS.type],
    ['parse failure',
        'Error unmarshalling input yaml: cannot parse value at line 3\n', MARKERS.parse],
    ['kms timeout',
        'failed to call KMS: context deadline exceeded\n', MARKERS.timeout],
    ['kms access denied',
        'Error getting data key: AccessDenied: User is not authorized\n', MARKERS.kms],
];

for (const [label, input, marker] of patternCases) {
    const out = normalize(input);
    const ok = out.includes(marker) && out.includes('— sops said:');
    check(`pattern ${label}`, ok, ok ? '' : `got: ${JSON.stringify(out.slice(0, 120))}`);
}

// Every alternation token, isolated, must reach its pattern as the first match.
// (Order matters: earlier patterns win, so these tokens are chosen to be
// unambiguous on their own.)
const alternationCases = [
    // pattern 1
    ['no key could decrypt the data', MARKERS.noKey],
    ['Failed to decrypt sops data key', MARKERS.noKey],
    ['could not decrypt data key', MARKERS.noKey],
    ['no MasterKey successfully decrypted', MARKERS.noKey],
    // pattern 2
    ['MAC mismatch', MARKERS.mac],
    ['MAC check failed', MARKERS.mac],
    ['MAC for new ENC tree', MARKERS.mac],
    // pattern 3 (both .yaml and .yml spellings)
    ['open /x/.sops.yaml: no such file', MARKERS.config],
    ['open /x/.sops.yml: no such file', MARKERS.config],
    // pattern 4
    ['unknown input type', MARKERS.type],
    ['unknown output type', MARKERS.type],
    ['invalid input type', MARKERS.type],
    ['invalid output type', MARKERS.type],
    // pattern 5
    ['cannot parse', MARKERS.parse],
    ['could not load input', MARKERS.parse],
    ['invalid yaml', MARKERS.parse],
    ['invalid json', MARKERS.parse],
    ['not a valid', MARKERS.parse],
    ['cannot unmarshal', MARKERS.parse],
    // pattern 6
    ['ETIMEDOUT', MARKERS.timeout],
    ['timed out', MARKERS.timeout],
    ['context deadline exceeded', MARKERS.timeout],
    // pattern 7
    ['Error getting data key', MARKERS.kms],
    ['access denied', MARKERS.kms],
    ['AccessDenied', MARKERS.kms],
    ['InvalidAuthenticationToken', MARKERS.kms],
    ['Could not contact KMS', MARKERS.kms],
];

for (const [token, marker] of alternationCases) {
    const out = normalize(token);
    check(`alt:    ${JSON.stringify(token)} -> ${marker.split(' ')[0]}…`,
        out.includes(marker), `got: ${JSON.stringify(out.slice(0, 100))}`);
}

// Precedence: earlier pattern wins when two could match.
{
    const out = normalize('MAC mismatch; also: cannot parse the tree');
    check('precedence: MAC before parse', out.includes(MARKERS.mac) && !out.includes(MARKERS.parse));
}

// Empty / falsy input.
for (const [label, v] of [['empty string', ''], ['undefined', undefined], ['null', null]]) {
    check(`empty:  ${label}`, normalize(v) === 'sops produced no error output.');
}

// Unrecognized input falls through to the raw first line — no explanation prefix.
{
    const out = normalize('totally unrecognized boom\nsecond line');
    check('fallback: passthrough first line',
        out === 'totally unrecognized boom' && !out.includes('— sops said:'),
        `got: ${JSON.stringify(out)}`);
}

// firstLine: picks the first non-blank line, truncates with an ellipsis.
check('firstLine: skips blank lines', firstLine('\n  \nfoo\nbar') === 'foo');
check('firstLine: short string unchanged', firstLine('hello') === 'hello');
{
    const out = firstLine('x'.repeat(500), 400);
    check('firstLine: truncates to max + ellipsis', out.length === 401 && out.endsWith('…'));
}
// normalize fallback truncates at 500.
{
    const out = normalize('y'.repeat(600));
    check('normalize: fallback truncates at 500', out.length === 501 && out.endsWith('…'));
}

process.stdout.write(`\n${passes} passed, ${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
