/** Split comma-separated proxy fields without splitting quoted passwords. */
export function splitIniFields(text) {
    const fields = [];
    let start = 0;
    let quote = '';
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
        } else if (char === '"' || char === "'") {
            const prefix = text.slice(start, index).trim();
            if (!prefix || /^[\w-]+\s*=$/.test(prefix)) quote = char;
        } else if (char === ',') {
            fields.push(text.slice(start, index).trim());
            start = index + 1;
        }
    }
    fields.push(text.slice(start).trim());
    return fields;
}

export function unquoteIniValue(value) {
    const text = value.trim();
    const quote = text[0];
    if ((quote !== '"' && quote !== "'") || text.at(-1) !== quote) return text;
    return text
        .slice(1, -1)
        .replace(/\\([\\"'])/g, (match, char) => (char === quote || char === '\\' ? char : match));
}

export function quoteIniValue(value) {
    const text = String(value ?? '');
    return /[,\s"'\\=#;]/.test(text) ? JSON.stringify(text) : text;
}
