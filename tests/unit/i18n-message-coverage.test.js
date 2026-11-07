import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { messages } from '../../src/i18n/messages.js';

function flattenMessages(dictionary, prefix = '') {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : flattenMessages(value, path);
  });
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(js|vue)$/.test(path) ? [path] : [];
  });
}

describe('translation coverage', () => {
  const zh = Object.fromEntries(flattenMessages(messages['zh-CN']));
  const en = Object.fromEntries(flattenMessages(messages['en-US']));

  it('provides matching keys and interpolation parameters in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, value] of Object.entries(zh)) {
      expect(placeholders(en[key]), key).toEqual(placeholders(value));
    }
  });

  it('resolves every literal translation key used by the frontend', () => {
    const root = resolve('src');
    const missing = [];
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?<![\w$.])(?:t|\$t)\(\s*['"]([^'"]+)['"]/g)) {
        if (!(match[1] in zh) || !(match[1] in en)) {
          missing.push(`${relative(root, file)}: ${match[1]}`);
        }
      }
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});
