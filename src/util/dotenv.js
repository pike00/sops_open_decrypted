function findInvalidDotenvLines(text) {
    const bad = [];
    const lines = text.split(/\r?\n/);
    let inMultiline = false;
    let quoteChar = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (inMultiline) {
            // Continuation lines are valid; close the block when quote is found.
            if (trimmed.endsWith(quoteChar)) { inMultiline = false; quoteChar = ''; }
            continue;
        }
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) { bad.push({ n: i + 1, text: trimmed }); continue; }
        // Detect an unclosed opening quote — value continues on subsequent lines.
        const valueRaw = line.slice(eq + 1).trim();
        const q = valueRaw[0];
        if ((q === '"' || q === "'") &&
            !(valueRaw.length > 1 && valueRaw[valueRaw.length - 1] === q)) {
            inMultiline = true;
            quoteChar = q;
        }
    }
    return bad;
}

module.exports = { findInvalidDotenvLines };
