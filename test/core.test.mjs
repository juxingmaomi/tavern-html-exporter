import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRulesWithTokens,
  compileRules,
  normalizeMessage,
  parseJsonChat,
  restoreRuleTokens,
} from '../src/core.js';

test('custom replacements support Tavern-compatible tokens', () => {
  const replacements = ['$0', '$&', '$1', '$<word>', '${word}', '{{match}}'];
  for (const replacement of replacements) {
    const rules = compileRules([{
      name: replacement,
      pattern: '(?<word>A)',
      flags: 'g',
      replacement: `<b>${replacement}</b>`,
    }]);
    const result = applyRulesWithTokens('A', rules);
    assert.equal(restoreRuleTokens(result.text, result.tokens), '<b>A</b>');
  }
});

test('regex literal flags are accepted', () => {
  const rules = compileRules([{ pattern: '/hello/i', replacement: 'ok' }]);
  const result = applyRulesWithTokens('HELLO', rules);
  assert.equal(restoreRuleTokens(result.text, result.tokens), 'ok');
});

test('JSONL parser skips malformed rows and metadata', () => {
  const parsed = parseJsonChat([
    JSON.stringify({ user_name: '小薇', character_name: '角色', chat_metadata: {} }),
    JSON.stringify({ name: '小薇', is_user: true, mes: '你好' }),
    '{broken',
    JSON.stringify({ name: '角色', is_user: false, mes: '你好呀' }),
  ].join('\n'));
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.metadata.character_name, '角色');
  assert.equal(parsed.warnings.length, 1);
});

test('hidden character messages stay assistant messages', () => {
  const message = normalizeMessage({ name: '角色', is_user: false, is_system: true, mes: '隐藏内容' }, 3, {
    characterName: '角色',
    userName: '小薇',
  });
  assert.equal(message.role, 'assistant');
  assert.equal(message.hidden, true);
});
