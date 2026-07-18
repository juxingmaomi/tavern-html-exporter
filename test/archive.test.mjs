import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArchiveDocument, buildExportFiles } from '../src/archive.js';
import { normalizeSettings } from '../src/core.js';

const record = {
  id: 0,
  role: 'assistant',
  hidden: false,
  name: '角色',
  source: '安全文本',
  html: '<p>正文</p>',
};

test('custom CSS cannot close the style element', () => {
  const settings = normalizeSettings({ customCss: '</style><script>globalThis.pwned=true</script><style>' });
  const html = buildArchiveDocument([record], {
    title: '测试', baseName: '测试', part: 1, totalParts: 1, settings,
    characterName: '角色', chatTitle: '聊天',
  });
  assert.equal(html.includes('</style><script>globalThis.pwned=true'), false);
  assert.match(html, /\\u003c\/style\\u003e/);
  assert.equal(html.includes('String.raw'), false);
});

test('generated runtime script is valid JavaScript', () => {
  const settings = normalizeSettings({});
  const html = buildArchiveDocument([record], {
    title: '测试', baseName: '测试', part: 1, totalParts: 1, settings,
    characterName: '角色', chatTitle: '聊天',
  });
  const scripts = Array.from(html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/gi), match => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
});

test('large exports are split into versioned files', () => {
  const settings = normalizeSettings({ messagesPerFile: 10, filename: '{{char}}_{{chat}}' });
  const records = Array.from({ length: 23 }, (_, index) => ({ ...record, id: index }));
  const files = buildExportFiles(records, settings, {
    characterName: '角色', userName: '小薇', chatTitle: '测试聊天',
  });
  assert.equal(files.length, 3);
  assert.equal(files[0].name, '角色_测试聊天_v1.1_01.html');
  assert.equal(files[2].name, '角色_测试聊天_v1.1_03.html');
});
