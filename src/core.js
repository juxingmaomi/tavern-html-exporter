export const SCRIPT_NAME = '聊天记录 HTML 导出器';
export const SCRIPT_VERSION = 'v1.4';
export const BUTTON_NAME = 'HTML导出';
export const STORAGE_KEY = 'th_html_exporter_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
  sourceMode: 'current',
  filename: '{{char}}_{{chat}}',
  messagesPerFile: 100,
  includeUser: true,
  includeAssistant: true,
  includeSystem: false,
  includeHidden: false,
  preferDisplayedSnapshot: true,
  exportTheme: 'paper',
  customCss: '',
  rules: [],
});

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeSettings(input = {}) {
  const settings = Object.assign(clone(DEFAULT_SETTINGS), input || {});
  settings.sourceMode = settings.sourceMode === 'jsonl' ? 'jsonl' : 'current';
  settings.filename = String(settings.filename || DEFAULT_SETTINGS.filename);
  settings.messagesPerFile = Math.max(10, Math.min(500, Number.parseInt(settings.messagesPerFile, 10) || 100));
  settings.includeUser = Boolean(settings.includeUser);
  settings.includeAssistant = Boolean(settings.includeAssistant);
  settings.includeSystem = Boolean(settings.includeSystem);
  settings.includeHidden = Boolean(settings.includeHidden);
  settings.preferDisplayedSnapshot = Boolean(settings.preferDisplayedSnapshot);
  settings.exportTheme = ['paper', 'eye', 'dark'].includes(settings.exportTheme) ? settings.exportTheme : 'paper';
  settings.customCss = String(settings.customCss || '');
  settings.rules = Array.isArray(settings.rules)
    ? settings.rules.map((rule, index) => ({
        enabled: rule?.enabled !== false,
        name: String(rule?.name || `规则 ${index + 1}`),
        pattern: String(rule?.pattern || ''),
        flags: String(rule?.flags || 'gs'),
        replacement: String(rule?.replacement || ''),
      }))
    : [];
  return settings;
}

export function sanitizeFilename(value) {
  return String(value || '聊天记录')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 150) || '聊天记录';
}

export function resolveFilename(template, context) {
  const date = new Date();
  const pad = number => String(number).padStart(2, '0');
  const dateText = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return sanitizeFilename(String(template || DEFAULT_SETTINGS.filename)
    .replace(/\{\{char\}\}/gi, context.characterName || '角色')
    .replace(/\{\{user\}\}/gi, context.userName || '用户')
    .replace(/\{\{chat\}\}/gi, context.chatTitle || '聊天记录')
    .replace(/\{\{date\}\}/gi, dateText));
}

export function getMessageRole(message) {
  if (['user', 'assistant', 'system'].includes(message?.role)) return message.role;
  if (message?.is_user === true || message?.is_user === 'true') return 'user';
  if (message?.extra?.type === 'narrator') return 'system';
  const name = String(message?.name || '').trim();
  if (message?.is_system && /^(system|系统)$/i.test(name)) return 'system';
  return 'assistant';
}

export function isMessageHidden(message) {
  return Boolean(message?.is_hidden || message?.hidden || message?.extra?.is_hidden || message?.is_system && getMessageRole(message) !== 'system');
}

export function getMessageText(message) {
  const values = [message?.message, message?.mes, message?.content, message?.text, message?.extra?.display_text];
  for (const value of values) {
    if (value === undefined || value === null) continue;
    return String(value);
  }
  return '';
}

export function getMessageId(message, fallback) {
  for (const value of [message?.message_id, message?.id]) {
    const id = Number(value);
    if (Number.isFinite(id)) return id;
  }
  return fallback;
}

export function normalizeMessage(message, index, context = {}) {
  const role = getMessageRole(message);
  const characterName = context.characterName || '角色';
  const userName = context.userName || '用户';
  return {
    original: message,
    id: getMessageId(message, index),
    role,
    hidden: isMessageHidden(message),
    name: String(message?.name || (role === 'user' ? userName : role === 'system' ? '系统' : characterName)),
    text: getMessageText(message),
    extra: message?.extra || {},
  };
}

export function shouldIncludeMessage(message, settings) {
  if (message.hidden && !settings.includeHidden) return false;
  if (message.role === 'user') return settings.includeUser;
  if (message.role === 'system') return settings.includeSystem;
  return settings.includeAssistant;
}

function normalizeFlags(flags) {
  const allowed = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);
  const result = [];
  for (const flag of String(flags || 'gs')) {
    if (allowed.has(flag) && !result.includes(flag)) result.push(flag);
  }
  if (!result.includes('g')) result.unshift('g');
  return result.join('');
}

function parsePattern(pattern, flags) {
  const text = String(pattern || '').trim();
  const literal = text.match(/^\/(.*)\/([dgimsuvy]*)$/s);
  if (literal) return { pattern: literal[1], flags: normalizeFlags(literal[2] || flags) };
  return { pattern: text, flags: normalizeFlags(flags) };
}

export function compileRules(ruleList = []) {
  return ruleList
    .filter(rule => rule?.enabled !== false && String(rule?.pattern || '').trim())
    .map((rule, index) => {
      const parsed = parsePattern(rule.pattern, rule.flags);
      try {
        return {
          name: String(rule.name || `规则 ${index + 1}`),
          regex: new RegExp(parsed.pattern, parsed.flags),
          replacement: String(rule.replacement || ''),
        };
      } catch (error) {
        throw new Error(`${rule.name || `规则 ${index + 1}`}：${error.message}`);
      }
    });
}

function expandReplacement(template, match, captures, groups) {
  return String(template || '').replace(
    /\{\{match\}\}|\$\$|\$&|\$0(?!\d)|\$(\d{1,2})|\$<([^>]+)>|\$\{([^}]+)\}/g,
    (token, number, angleName, braceName) => {
      if (token === '{{match}}' || token === '$&' || token === '$0') return match;
      if (token === '$$') return '$';
      if (number !== undefined) return captures[Number(number) - 1] ?? '';
      const name = angleName ?? braceName;
      return name === undefined ? token : groups?.[name] ?? '';
    },
  );
}

export function applyRulesWithTokens(value, rules) {
  let text = String(value ?? '');
  const tokens = [];
  for (const rule of rules) {
    text = text.replace(rule.regex, (...args) => {
      const match = args[0];
      const groups = typeof args.at(-1) === 'object' ? args.at(-1) : undefined;
      const tailSize = groups ? 3 : 2;
      const captures = args.slice(1, -tailSize);
      const html = expandReplacement(rule.replacement, match, captures, groups);
      const token = `\uE100THX_${tokens.length}_\uE101`;
      tokens.push({ token, html, rule: rule.name });
      return token;
    });
  }
  return { text, tokens };
}

export function restoreRuleTokens(value, tokens, transform = html => html) {
  let result = String(value ?? '');
  for (const entry of tokens) result = result.split(entry.token).join(transform(entry.html, entry));
  return result;
}

export function parseJsonChat(text) {
  const source = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('文件是空的。');
  const warnings = [];
  let rows;
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) rows = parsed;
    else if (Array.isArray(parsed?.chat)) rows = parsed.chat;
    else if (Array.isArray(parsed?.lines)) rows = parsed.lines;
    else rows = [parsed];
  } catch {
    rows = [];
    source.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      try {
        rows.push(JSON.parse(line));
      } catch (error) {
        warnings.push(`第 ${index + 1} 行无法解析，已跳过。`);
      }
    });
  }
  const metadata = rows.find(row => row && typeof row === 'object' && !getMessageText(row) && (row.user_name || row.character_name || row.chat_metadata)) || {};
  const messages = rows.filter(row => row && typeof row === 'object' && getMessageText(row) !== '');
  if (!messages.length) throw new Error('没有找到聊天消息。');
  return { messages, metadata, warnings };
}

export function chunk(items, size) {
  const result = [];
  const safeSize = Math.max(1, Number.parseInt(size, 10) || 100);
  for (let index = 0; index < items.length; index += safeSize) result.push(items.slice(index, index + safeSize));
  return result;
}
