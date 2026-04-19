function findInvalidDotenvLines(text) {
    const bad = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (line.indexOf('=') < 0) bad.push({ n: i + 1, text: trimmed });
    }
    return bad;
}

module.exports = { findInvalidDotenvLines };
