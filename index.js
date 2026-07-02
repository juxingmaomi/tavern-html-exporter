// == TavernHelper Script ==
// name: 聊天记录 HTML 导出器
// author: Codex
// version: v0.31
// description: 在酒馆助手中导出聊天为 HTML，支持当前聊天导出、聊天文件列表单个导出、单文件分页和正则渲染规则。

(function () {
  'use strict';

  const SCRIPT_NAME = '聊天记录 HTML 导出器';
  const SCRIPT_VERSION = 'v0.31';
  const BUTTON_NAME = 'HTML导出';
  const STORAGE_KEY = 'th_html_exporter_settings_v3';
  const STYLE_ID = 'th-html-exporter-style-v2';
  const FALLBACK_ID = 'th-html-exporter-floating-button';
  const MINIMIZED_BUTTON_ID = 'th-html-exporter-minimized-button';
  let chatListExportObserver = null;
  let chatListExportRefreshTimer = null;
  let minimizedButtonPosition = null;

  const DEFAULT_SETTINGS = {
    filename: '{{char}}_{{chat}}',
    messagesPerFile: 50,
    singleFilePagination: false,
    panelTheme: 'night',
    includeUser: true,
    includeAssistant: true,
    includeSystem: false,
    includeHidden: false,
    renderRawHtml: false,
    applyTavernDisplay: true,
    forceRegexDepth: false,
    userReadableFallback: true,
    userExtractTags: '本轮用户输入',
    userExcludeTags: 'recall, supplement, meta:检定结果',
    allowScripts: false,
    renderOpeningWidget: false,
    escapeCaptures: false,
    exportTheme: 'eye',
    advancedOpen: false,
    customCss: '',
    rules: [
      {
        enabled: true,
        name: '自定义规则 1',
        pattern: '',
        flags: 'gs',
        replacement: '',
      },
    ],
  };

  const EXPORT_THEMES = {
    eye: {
      label: '护眼绿',
      swatch: ['#eef6ea', '#dfeede', '#446d59'],
      colorScheme: 'light',
      paper: '#eef6ea',
      ink: '#24372d',
      muted: '#668074',
      line: 'rgba(87, 118, 101, 0.42)',
      user: '#5b8f83',
      assistant: '#446d59',
      system: '#85743e',
      panel: 'rgba(255, 255, 255, 0.62)',
      titlePanel: 'rgba(255, 255, 255, 0.72)',
      metaBg: 'rgba(255, 255, 255, 0.46)',
      accent: '#2f6f59',
      shadow: '0 14px 36px rgba(55, 84, 68, 0.10)',
    },
    white: {
      label: '白色',
      swatch: ['#ffffff', '#f4f5f2', '#26332e'],
      colorScheme: 'light',
      paper: '#f7f8f5',
      ink: '#202b27',
      muted: '#66736e',
      line: 'rgba(78, 96, 88, 0.26)',
      user: '#537f78',
      assistant: '#2f443d',
      system: '#7a633b',
      panel: 'rgba(255, 255, 255, 0.86)',
      titlePanel: 'rgba(255, 255, 255, 0.92)',
      metaBg: 'rgba(240, 243, 240, 0.82)',
      accent: '#2f6f59',
      shadow: '0 12px 30px rgba(40, 50, 45, 0.08)',
    },
    dark: {
      label: '黑色',
      swatch: ['#10161d', '#1a2630', '#d7b9a7'],
      colorScheme: 'dark',
      paper: '#10161d',
      ink: '#e8ece7',
      muted: '#9baaa3',
      line: 'rgba(154, 174, 164, 0.28)',
      user: '#79c4b6',
      assistant: '#d7b9a7',
      system: '#c8ad75',
      panel: 'rgba(24, 34, 43, 0.88)',
      titlePanel: 'rgba(21, 31, 40, 0.94)',
      metaBg: 'rgba(255, 255, 255, 0.07)',
      accent: '#9ed8c4',
      shadow: '0 16px 38px rgba(0, 0, 0, 0.28)',
    },
  };

  function getHostWindow() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) return window.parent;
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 无法访问父窗口`, error);
    }
    return window;
  }

  function getHostDocument() {
    return getHostWindow().document || document;
  }

  function get$() {
    const host = getHostWindow();
    return host.jQuery || host.$ || window.jQuery || window.$;
  }

  function notify(type, message) {
    const host = getHostWindow();
    const toastr = host.toastr || window.toastr;
    if (toastr && typeof toastr[type] === 'function') {
      toastr[type](message);
      return;
    }
    if (type === 'error') {
      console.error(`[${SCRIPT_NAME}] ${message}`);
    } else {
      console.log(`[${SCRIPT_NAME}] ${message}`);
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSettings(input) {
    const merged = Object.assign(clone(DEFAULT_SETTINGS), input || {});
    merged.messagesPerFile = Math.max(1, Math.min(5000, parseInt(merged.messagesPerFile, 10) || 50));
    merged.singleFilePagination = Boolean(merged.singleFilePagination);
    merged.panelTheme = merged.panelTheme === 'day' ? 'day' : 'night';
    merged.advancedOpen = Boolean(merged.advancedOpen);
    merged.renderOpeningWidget = Boolean(merged.renderOpeningWidget);
    if (!EXPORT_THEMES[merged.exportTheme]) merged.exportTheme = DEFAULT_SETTINGS.exportTheme;
    merged.userExtractTags = String(merged.userExtractTags || DEFAULT_SETTINGS.userExtractTags);
    merged.userExcludeTags = String(merged.userExcludeTags || DEFAULT_SETTINGS.userExcludeTags);
    merged.rules = Array.isArray(merged.rules) ? merged.rules : [];
    merged.rules = merged.rules.map((rule) => Object.assign({
      enabled: true,
      name: '',
      pattern: '',
      flags: 'gs',
      replacement: '',
    }, rule || {}));
    return merged;
  }

  function getExportTheme(settings) {
    return EXPORT_THEMES[(settings && settings.exportTheme) || DEFAULT_SETTINGS.exportTheme] || EXPORT_THEMES.eye;
  }

  function buildThemeVariables(settings) {
    const theme = getExportTheme(settings);
    return `
      color-scheme: ${theme.colorScheme};
      --paper: ${theme.paper};
      --ink: ${theme.ink};
      --muted: ${theme.muted};
      --line: ${theme.line};
      --user: ${theme.user};
      --assistant: ${theme.assistant};
      --system: ${theme.system};
      --panel: ${theme.panel};
      --title-panel: ${theme.titlePanel};
      --meta-bg: ${theme.metaBg};
      --accent: ${theme.accent};
      --message-shadow: ${theme.shadow};`;
  }

  function createDiagnostics(settings) {
    const normalized = normalizeSettings(settings);
    return {
      version: SCRIPT_VERSION,
      time: new Date().toLocaleString(),
      theme: getExportTheme(normalized).label,
      source: {
        mode: '当前聊天',
        fileName: '',
        folder: '',
      },
      settings: {
        applyTavernDisplay: Boolean(normalized.applyTavernDisplay),
        renderRawHtml: Boolean(normalized.renderRawHtml),
        forceRegexDepth: Boolean(normalized.forceRegexDepth),
        userReadableFallback: Boolean(normalized.userReadableFallback),
        singleFilePagination: Boolean(normalized.singleFilePagination),
        allowScripts: Boolean(normalized.allowScripts),
        renderOpeningWidget: Boolean(normalized.renderOpeningWidget),
      },
      counts: {
        messages: 0,
        files: 0,
        internalPages: 0,
        displayed: 0,
        pipeline: 0,
        raw: 0,
        userFallback: 0,
        userTagExtracts: 0,
        userSanitizedExtracts: 0,
        customRuleHits: 0,
        normalizedQuotes: 0,
        removedEmptyParagraphs: 0,
        removedDetailsSpacers: 0,
        removedScripts: 0,
        openingWidgets: 0,
        iframes: 0,
        styles: 0,
        downloadLinks: 0,
        autoDownloadAttempts: 0,
        manualSaveAttempts: 0,
        savePickerAttempts: 0,
        openFallbacks: 0,
        chatFileReadAttempts: 0,
        staticizedIframes: 0,
        iframeStaticFailures: 0,
        archiveScriptsRemoved: 0,
        structuredCodeBlocks: 0,
        genericTagBlocks: 0,
        suspiciousSourceBlocks: 0,
      },
      ruleHits: {},
      archiveDetails: [],
      warnings: [],
      errors: [],
    };
  }

  function pushDiagnostic(diagnostics, type, message) {
    if (!diagnostics || !message) return;
    const list = type === 'error' ? diagnostics.errors : diagnostics.warnings;
    const text = String(message);
    if (list.includes(text)) return;
    if (list.length < 80) {
      list.push(text);
    } else if (list.length === 80) {
      list.push('还有更多提示被省略，请缩小导出范围后重试。');
    }
  }

  function bumpDiagnosticCount(diagnostics, key, amount) {
    if (!diagnostics || !diagnostics.counts) return;
    diagnostics.counts[key] = (Number(diagnostics.counts[key]) || 0) + (Number(amount) || 0);
  }

  function getErrorMessage(error) {
    return error && error.message ? error.message : String(error || '未知错误');
  }

  function formatDiagnostics(diagnostics, status) {
    const data = diagnostics || createDiagnostics(normalizeSettings(null));
    const counts = data.counts || {};
    const lines = [
      `聊天记录 HTML 导出器 ${data.version || SCRIPT_VERSION} 诊断信息`,
      `状态：${status || (data.errors && data.errors.length ? '失败' : '完成')}`,
      `时间：${data.time || new Date().toLocaleString()}`,
      `主题：${data.theme || '未知'}`,
      `来源：${data.source && data.source.mode || '当前聊天'}${data.source && data.source.fileName ? `；文件 ${data.source.fileName}` : ''}${data.source && data.source.folder ? `；目录 ${data.source.folder}` : ''}`,
      `设置：套用酒馆显示=${data.settings && data.settings.applyTavernDisplay ? '开' : '关'}；原文按HTML=${data.settings && data.settings.renderRawHtml ? '开' : '关'}；强制渲染旧楼层=${data.settings && data.settings.forceRegexDepth ? '开' : '关'}；用户保底=${data.settings && data.settings.userReadableFallback ? '开' : '关'}；单文件分页=${data.settings && data.settings.singleFilePagination ? '开' : '关'}；允许脚本=${data.settings && data.settings.allowScripts ? '开' : '关'}；首楼小组件=${data.settings && data.settings.renderOpeningWidget ? '开' : '关'}`,
      `数量：消息 ${counts.messages || 0} 条；HTML ${counts.files || 0} 个；内分页 ${counts.internalPages || 0} 页`,
      `渲染来源：酒馆已显示 ${counts.displayed || 0} 条；酒馆渲染接口 ${counts.pipeline || 0} 条；原文 ${counts.raw || 0} 条`,
      `用户楼层保底：启用 ${counts.userFallback || 0} 条；标签提取 ${counts.userTagExtracts || 0} 条；清理提取 ${counts.userSanitizedExtracts || 0} 条`,
      `清理统计：自定义规则命中 ${counts.customRuleHits || 0} 次；引号修复 ${counts.normalizedQuotes || 0} 处；空段落 ${counts.removedEmptyParagraphs || 0} 个；折叠块空行 ${counts.removedDetailsSpacers || 0} 个；iframe ${counts.iframes || 0} 个；style ${counts.styles || 0} 个；移除脚本 ${counts.removedScripts || 0} 个；首楼小组件 ${counts.openingWidgets || 0} 个`,
      `下载准备：手动下载链接 ${counts.downloadLinks || 0} 个；自动下载尝试 ${counts.autoDownloadAttempts || 0} 次；手动保存尝试 ${counts.manualSaveAttempts || 0} 次；保存窗口 ${counts.savePickerAttempts || 0} 次；打开预览 ${counts.openFallbacks || 0} 次；聊天文件读取 ${counts.chatFileReadAttempts || 0} 次`,
    ];

    if ((counts.staticizedIframes || 0) || (counts.iframeStaticFailures || 0) || (counts.archiveScriptsRemoved || 0) || (counts.structuredCodeBlocks || 0) || (counts.genericTagBlocks || 0) || (counts.suspiciousSourceBlocks || 0)) {
      lines.push(`归档处理：iframe静态化 ${counts.staticizedIframes || 0} 个；iframe失败 ${counts.iframeStaticFailures || 0} 个；移除脚本 ${counts.archiveScriptsRemoved || 0} 个；结构代码块 ${counts.structuredCodeBlocks || 0} 个；通用标签块 ${counts.genericTagBlocks || 0} 个；可疑源码残留 ${counts.suspiciousSourceBlocks || 0} 处`);
    }

    if (data.archiveDetails && data.archiveDetails.length) {
      lines.push('归档明细：');
      data.archiveDetails.forEach((message) => lines.push(`- ${message}`));
    }

    const ruleEntries = Object.entries(data.ruleHits || {});
    if (ruleEntries.length) {
      lines.push('自定义规则命中：');
      ruleEntries.forEach(([name, count]) => lines.push(`- ${name}：${count} 次`));
    }

    if (data.warnings && data.warnings.length) {
      lines.push('提示/警告：');
      data.warnings.forEach((message) => lines.push(`- ${message}`));
    }

    if (data.errors && data.errors.length) {
      lines.push('错误：');
      data.errors.forEach((message) => lines.push(`- ${message}`));
    }

    if ((!data.warnings || !data.warnings.length) && (!data.errors || !data.errors.length)) {
      lines.push('未记录到明显错误。');
    }

    return lines.join('\n');
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : null);
    } catch (error) {
      notify('warning', `设置读取失败，已使用默认值：${error.message}`);
      return normalizeSettings(null);
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function escapeJsonForScript(value) {
    return JSON.stringify(String(value == null ? '' : value))
      .replace(/</g, '\\u003C')
      .replace(/>/g, '\\u003E')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function escapeJsonDataForScript(value) {
    return JSON.stringify(value == null ? null : value)
      .replace(/</g, '\\u003C')
      .replace(/>/g, '\\u003E')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function sanitizeFilename(value) {
    return String(value || '聊天记录')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140) || '聊天记录';
  }

  function getTavernHelper() {
    const host = getHostWindow();
    return window.TavernHelper || host.TavernHelper || null;
  }

  function getSillyTavern() {
    const host = getHostWindow();
    return window.SillyTavern || host.SillyTavern || null;
  }

  function getCharacterName() {
    const st = getSillyTavern();
    let name = '角色';
    try {
      if (st && st.characters && st.characterId !== undefined && st.characters[st.characterId]) {
        name = st.characters[st.characterId].name || name;
      } else if (st && st.name2) {
        name = st.name2;
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 获取角色名失败`, error);
    }
    return name;
  }

  function getUserName() {
    const st = getSillyTavern();
    return (st && st.name1) || '用户';
  }

  function getChatTitle() {
    const st = getSillyTavern();
    let title = '当前聊天';
    try {
      if (st && typeof st.getCurrentChatId === 'function') {
        title = st.getCurrentChatId() || title;
      } else if (st && st.chatId) {
        title = st.chatId;
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 获取聊天名失败`, error);
    }
    title = String(title).split(/[\\/]/).pop().replace(/\.(jsonl?|txt)$/i, '');
    return title || '当前聊天';
  }

  function getDateStamp() {
    const date = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function resolveFilename(template, context) {
    const th = getTavernHelper();
    let name = template || DEFAULT_SETTINGS.filename;
    try {
      if (!context && th && typeof th.substitudeMacros === 'function') {
        name = th.substitudeMacros(name);
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 宏替换失败`, error);
    }
    const characterName = context && context.characterName ? context.characterName : getCharacterName();
    const userName = context && context.userName ? context.userName : getUserName();
    const chatTitle = context && context.chatTitle ? context.chatTitle : getChatTitle();
    name = String(name)
      .replace(/\{\{char\}\}/gi, characterName)
      .replace(/\{\{user\}\}/gi, userName)
      .replace(/\{\{chat\}\}/gi, chatTitle)
      .replace(/\{\{date\}\}/gi, getDateStamp());
    return sanitizeFilename(name);
  }

  function getMessageRole(message) {
    if (message.role) return message.role;
    const isUser = message.is_user === true || message.is_user === 'true';
    const isSystem = message.is_system === true || message.is_system === 'true';
    if (isUser) return 'user';
    if (isSystem && /^(system|系统)$/i.test(String(message.name || '').trim())) return 'system';
    return 'assistant';
  }

  function isMessageHidden(message) {
    return Boolean(message.is_hidden || message.hidden || message.extra && message.extra.is_hidden);
  }

  function getMessageId(message, fallback) {
    if (message.message_id !== undefined) {
      const id = Number(message.message_id);
      if (Number.isFinite(id)) return id;
    }
    if (message.id !== undefined) {
      const id = Number(message.id);
      if (Number.isFinite(id)) return id;
    }
    return fallback;
  }

  function getMessageCharacterName(message) {
    return message && message.__export_character_name ? message.__export_character_name : getCharacterName();
  }

  function getMessageUserName(message) {
    return message && message.__export_user_name ? message.__export_user_name : getUserName();
  }

  function getMessageText(message) {
    const candidates = [
      message.message,
      message.mes,
      message.text,
      message.content,
      message.extra && message.extra.display_text,
    ];
    for (const value of candidates) {
      if (value === undefined || value === null) continue;
      const text = String(value);
      if (text.trim()) return text;
    }
    if (message.message !== undefined) return String(message.message || '');
    if (message.mes !== undefined) return String(message.mes || '');
    return '';
  }

  function getTavernRegexSource(message) {
    const role = getMessageRole(message);
    if (role === 'user') return 'user_input';
    if (role === 'system') return 'world_info';
    return 'ai_output';
  }

  function getMessages(settings) {
    const th = getTavernHelper();
    if (!th || typeof th.getChatMessages !== 'function' || typeof th.getLastMessageId !== 'function') {
      throw new Error('没有找到 TavernHelper.getChatMessages，请确认脚本运行在酒馆助手里。');
    }
    const lastId = th.getLastMessageId();
    if (lastId < 0) return [];
    const messages = th.getChatMessages(`0-${lastId}`, {
      role: 'all',
      hide_state: 'all',
      include_swipes: false,
    }) || [];
    return messages.filter((message, index) => {
      const role = getMessageRole(message);
      const hidden = isMessageHidden(message);
      if (hidden && !settings.includeHidden) return false;
      if (role === 'user' && !settings.includeUser) return false;
      if (role === 'assistant' && !settings.includeAssistant) return false;
      if (role === 'system' && !settings.includeSystem) return false;
      message.__export_id = getMessageId(message, index);
      message.__export_depth = Number.isFinite(message.__export_id) ? Math.max(0, lastId - message.__export_id) : index;
      return true;
    });
  }

  function normalizeFlags(flags) {
    const allowed = new Set(['g', 'i', 'm', 's', 'u', 'y']);
    const result = [];
    String(flags || 'gs').split('').forEach((flag) => {
      if (allowed.has(flag) && !result.includes(flag)) result.push(flag);
    });
    if (!result.includes('g')) result.unshift('g');
    return result.join('');
  }

  function compileRules(settings) {
    const compiled = [];
    settings.rules.forEach((rule, index) => {
      if (!rule || !rule.enabled || !String(rule.pattern || '').trim()) return;
      try {
        compiled.push({
          index,
          name: rule.name || `规则 ${index + 1}`,
          regex: new RegExp(rule.pattern, normalizeFlags(rule.flags)),
          replacement: String(rule.replacement || ''),
        });
      } catch (error) {
        throw new Error(`${rule.name || `规则 ${index + 1}`} 正则错误：${error.message}`);
      }
    });
    return compiled;
  }

  function sanitizeRenderedHtml(html, allowScripts, diagnostics) {
    let cleaned = String(html == null ? '' : html);
    cleaned = cleaned
      .replace(/<!doctype[\s\S]*?>/gi, '')
      .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
      .replace(/<meta[\s\S]*?>/gi, '')
      .replace(/<title[\s\S]*?<\/title>/gi, '')
      .replace(/<link[\s\S]*?>/gi, '');
    if (!allowScripts) {
      const scriptTag = 'script';
      const scriptRegex = new RegExp(`<${scriptTag}[\\s\\S]*?<\\/${scriptTag}>`, 'gi');
      const removed = cleaned.match(scriptRegex);
      if (removed && removed.length) bumpDiagnosticCount(diagnostics, 'removedScripts', removed.length);
      cleaned = cleaned.replace(scriptRegex, '');
    }
    return cleaned;
  }

  function formatCapture(value, settings) {
    const text = String(value == null ? '' : value);
    return settings.escapeCaptures ? escapeHtml(text) : text;
  }

  function buildReplacement(template, match, captures, namedGroups, settings) {
    return String(template || '').replace(/\$\$|\$&|\$(\d{1,2})|\$\{([^}]+)\}/g, (token, number, name) => {
      if (token === '$$') return '$';
      if (token === '$&') return formatCapture(match, settings);
      if (number !== undefined) return formatCapture(captures[Number(number) - 1] || '', settings);
      if (name !== undefined) return formatCapture(namedGroups && namedGroups[name] || '', settings);
      return token;
    });
  }

  function restoreTokens(text, tokens) {
    let result = text;
    tokens.forEach((entry) => {
      result = result.split(entry.token).join(entry.html);
    });
    return result;
  }

  function applyRules(text, rules, settings, diagnostics) {
    const tokens = [];
    let output = String(text == null ? '' : text);
    rules.forEach((rule) => {
      output = output.replace(rule.regex, (...args) => {
        const match = args[0];
        let namedGroups = {};
        if (args.length > 2 && typeof args[args.length - 1] === 'object') {
          namedGroups = args.pop() || {};
        }
        args.pop();
        args.pop();
        const captures = args.slice(1);
        const html = sanitizeRenderedHtml(
          buildReplacement(rule.replacement, match, captures, namedGroups, settings),
          settings.allowScripts,
          diagnostics,
        );
        if (diagnostics) {
          diagnostics.counts.customRuleHits += 1;
          diagnostics.ruleHits[rule.name] = (diagnostics.ruleHits[rule.name] || 0) + 1;
        }
        const token = `\uE000TH_HTML_EXPORT_${tokens.length}\uE001`;
        tokens.push({ token, html });
        return token;
      });
    });
    return { text: output, tokens };
  }

  function readRenderedMessageHtml(th, messageId, diagnostics) {
    if (!th || typeof th.retrieveDisplayedMessage !== 'function' || !Number.isFinite(messageId)) return '';
    try {
      const displayed = th.retrieveDisplayedMessage(messageId);
      if (!displayed || !displayed.length || typeof displayed.html !== 'function') return '';
      return String(displayed.html() || '').trim();
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 读取酒馆已显示内容失败 #${messageId}`, error);
      pushDiagnostic(diagnostics, 'warning', `读取酒馆已显示内容失败 #${messageId}：${getErrorMessage(error)}`);
      return '';
    }
  }

  function hasMeaningfulRenderedHtml(html) {
    const raw = String(html == null ? '' : html).trim();
    if (!raw) return false;
    const template = getHostDocument().createElement('template');
    template.innerHTML = raw;
    template.content.querySelectorAll('script, style, .mes_buttons, .extraMesButtons, .mes_edit_buttons, .mes_timer, .tokenCounterDisplay, .mesIDDisplay, [hidden]').forEach((node) => node.remove());
    template.content.querySelectorAll('[style]').forEach((node) => {
      const style = String(node.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
      if (style.includes('display:none') || style.includes('visibility:hidden')) node.remove();
    });
    if (template.content.querySelector('img, video, audio, iframe, canvas, svg, table, details, pre, code')) return true;
    const text = String(template.content.textContent || '')
      .replace(/复制|重置|耗时/g, '')
      .replace(/\s+/g, '')
      .trim();
    return text.length > 0;
  }

  function splitSettingList(value) {
    return String(value || '')
      .split(/[\n,，、;；]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function uniqueList(items) {
    const result = [];
    items.forEach((item) => {
      if (item && !result.includes(item)) result.push(item);
    });
    return result;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cleanupReadableUserText(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^\s*```(?:html|text|markdown)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractTaggedBlock(text, tag) {
    const source = String(text == null ? '' : text);
    const escapedTag = escapeRegExp(tag);
    const regex = new RegExp(`<\\s*${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\s*\\/\\s*${escapedTag}\\s*>`, 'i');
    const match = source.match(regex);
    if (!match) return '';
    return cleanupReadableUserText(match[1]);
  }

  function removeTaggedBlocks(text, tags) {
    let output = String(text == null ? '' : text);
    tags.forEach((tag) => {
      const escapedTag = escapeRegExp(tag);
      const regex = new RegExp(`<\\s*${escapedTag}(?:\\s[^>]*)?>[\\s\\S]*?<\\s*\\/\\s*${escapedTag}\\s*>`, 'gi');
      output = output.replace(regex, '\n');
    });
    return output;
  }

  function extractReadableUserText(text, settings) {
    const source = String(text == null ? '' : text);
    const extractTags = uniqueList([
      ...splitSettingList(settings && settings.userExtractTags),
      '本轮用户输入',
    ]);

    for (const tag of extractTags) {
      const extracted = extractTaggedBlock(source, tag);
      if (extracted) return { text: extracted, mode: 'tag', tag };
    }

    const excludeTags = uniqueList([
      ...splitSettingList(settings && settings.userExcludeTags),
      'recall',
      'supplement',
      'meta:检定结果',
    ]);
    let cleaned = removeTaggedBlocks(source, excludeTags);
    cleaned = cleaned
      .replace(/```html[\s\S]*$/i, '')
      .replace(/以下输入的代码为[\s\S]*$/m, '')
      .replace(/^\s*以下是用户(?:的)?(?:本轮输入|输入)?[:：]?\s*/m, '')
      .replace(/^\s*\[时间约束词\][\s\S]*$/m, '')
      .replace(/^\s*(?:now|today|days|weeks|months|seasons|years|old|unknown)\s*=.*$/gim, '')
      .replace(/^\s*AM\d+\s*\|.*$/gim, '');
    cleaned = cleanupReadableUserText(cleaned);
    return cleaned ? { text: cleaned, mode: 'sanitized', tag: '' } : null;
  }

  function hasRenderedIframeContent(html) {
    return /<iframe\b|class=["'][^"']*\bTH-render\b|TH-render/i.test(String(html || ''));
  }

  function getUserReadableFallback(message, originalText, renderedText, settings) {
    if (!settings || !settings.userReadableFallback) return null;
    if (getMessageRole(message) !== 'user') return null;
    const source = String(renderedText == null ? '' : renderedText);
    if (hasRenderedIframeContent(source)) return null;

    let reason = '';
    if (!source.trim() || !hasMeaningfulRenderedHtml(source)) {
      reason = 'empty';
    } else if (/```html/i.test(source)) {
      reason = 'html-fence';
    } else if (/以下输入的代码为|<recall>|<\/recall>|^\s*AM\d+\s*\|/im.test(source)) {
      reason = 'prompt-artifact';
    }
    if (!reason) return null;

    const extracted = extractReadableUserText(originalText, settings);
    if (!extracted || !extracted.text) return null;
    return Object.assign({ reason }, extracted);
  }

  function applyTavernRenderPipeline(th, source, message, settings, diagnostics) {
    const messageId = Number(message.__export_id);
    let result = String(source == null ? '' : source);
    let applied = false;

    if (th && typeof th.formatAsTavernRegexedString === 'function') {
      try {
        const option = {};
        const depth = Number(message.__export_depth);
        if (settings && settings.forceRegexDepth) {
          option.depth = 0;
        } else if (Number.isFinite(depth)) {
          option.depth = depth;
        }
        const characterName = getMessageCharacterName(message);
        if (characterName) option.character_name = characterName;
        result = th.formatAsTavernRegexedString(
          result,
          getTavernRegexSource(message),
          'display',
          option,
        );
        applied = true;
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 酒馆正则处理失败 #${messageId}`, error);
        pushDiagnostic(diagnostics, 'warning', `酒馆正则处理失败 #${messageId}：${getErrorMessage(error)}`);
      }
    }

    if (th && typeof th.formatAsDisplayedMessage === 'function') {
      try {
        result = th.formatAsDisplayedMessage(result, { message_id: messageId });
        applied = true;
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 酒馆显示格式处理失败 #${messageId}`, error);
        pushDiagnostic(diagnostics, 'warning', `酒馆显示格式处理失败 #${messageId}：${getErrorMessage(error)}`);
      }
    }

    return { text: result, applied };
  }

  function isWhitespaceTextNode(node) {
    return node && node.nodeType === 3 && !String(node.nodeValue || '').trim();
  }

  function isEmptyParagraph(node) {
    if (!node || node.nodeType !== 1 || node.tagName !== 'P') return false;
    if (node.querySelector('img, video, audio, iframe, canvas, svg, table, input, textarea, select')) {
      return false;
    }
    const html = String(node.innerHTML || '')
      .replace(/&nbsp;/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .trim();
    const text = String(node.textContent || '').replace(/\u00a0/g, '').trim();
    return !html && !text;
  }

  function removeDetailsSpacerNodes(details) {
    let removed = 0;
    const removeLeading = (startNode) => {
      let node = startNode;
      while (node) {
        const shouldRemove = isWhitespaceTextNode(node)
          || isEmptyParagraph(node)
          || (node.nodeType === 1 && node.tagName === 'BR');
        if (!shouldRemove) break;
        const next = node.nextSibling;
        node.remove();
        removed += 1;
        node = next;
      }
    };

    removeLeading(details.firstChild);
    const summary = Array.from(details.children).find((child) => child.tagName === 'SUMMARY');
    if (summary) removeLeading(summary.nextSibling);
    return removed;
  }

  function normalizeQuoteText(text) {
    const value = String(text == null ? '' : text).trim();
    if (!value) return value;

    const pairs = [
      ['“', '”', 'keep'],
      ['"', '"', 'double'],
      ['＂', '＂', 'double'],
      ['「', '」', 'keep'],
      ['『', '』', 'keep'],
      ['‘', '’', 'keep'],
      ["'", "'", 'single'],
      ['＇', '＇', 'single'],
    ];

    for (const [open, close, mode] of pairs) {
      if (value.startsWith(open) && value.endsWith(close) && value.length >= open.length + close.length) {
        const inner = value.slice(open.length, value.length - close.length).trim();
        if (mode === 'double') return `“${inner}”`;
        if (mode === 'single') return `‘${inner}’`;
        return `${open}${inner}${close}`;
      }
    }

    return `“${value}”`;
  }

  function normalizeQuoteElements(root) {
    let changed = 0;
    root.querySelectorAll('q').forEach((quote) => {
      if (quote.children.length > 0) return;
      const before = String(quote.textContent || '');
      const after = normalizeQuoteText(before);
      if (after !== before) changed += 1;
      quote.textContent = after;
    });
    return changed;
  }

  function pushArchiveDetail(diagnostics, message) {
    if (!diagnostics || !message) return;
    diagnostics.archiveDetails = diagnostics.archiveDetails || [];
    const text = String(message);
    if (diagnostics.archiveDetails.includes(text)) return;
    if (diagnostics.archiveDetails.length < 140) {
      diagnostics.archiveDetails.push(text);
    } else if (diagnostics.archiveDetails.length === 140) {
      diagnostics.archiveDetails.push('还有更多归档明细被省略。');
    }
  }

  function extractArchiveBodyHtml(value) {
    const raw = String(value == null ? '' : value);
    const matches = Array.from(raw.matchAll(/<body\b[^>]*>([\s\S]*?)<\/body>/gi));
    if (matches.length) return matches[matches.length - 1][1];
    return raw
      .replace(/<!doctype[\s\S]*?>/gi, '')
      .replace(/<\/?(?:html|head|body)[^>]*>/gi, '');
  }

  function sanitizeArchiveStaticHtml(value, settings, diagnostics, messageId) {
    const hostDocument = getHostDocument();
    const template = hostDocument.createElement('template');
    template.innerHTML = extractArchiveBodyHtml(value);
    let removedScripts = 0;
    template.content.querySelectorAll('script').forEach((node) => {
      const src = String(node.getAttribute('src') || '');
      const dangerousSource = /^blob:/i.test(src) || /^\/scripts\//i.test(src) || /JS-Slash-Runner|tailwindcss|jquery|vue/i.test(src);
      if (!settings.allowScripts || dangerousSource) {
        node.remove();
        removedScripts += 1;
      }
    });
    template.content.querySelectorAll('meta, title, link[rel="modulepreload"], link[as="script"]').forEach((node) => node.remove());
    if (removedScripts) {
      bumpDiagnosticCount(diagnostics, 'archiveScriptsRemoved', removedScripts);
      pushArchiveDetail(diagnostics, '#' + messageId + ': 静态化时移除脚本 ' + removedScripts + ' 个');
    }
    return template.innerHTML.trim();
  }

  function staticizeArchiveIframes(root, settings, diagnostics, messageId) {
    const hostDocument = getHostDocument();
    const frames = Array.from(root.querySelectorAll('iframe[srcdoc]'));
    frames.forEach((iframe, index) => {
      try {
        const rawSrcdoc = iframe.getAttribute('srcdoc') || '';
        if (!rawSrcdoc.trim()) return;
        const staticHtml = sanitizeArchiveStaticHtml(rawSrcdoc, settings, diagnostics, messageId);
        if (!staticHtml) {
          bumpDiagnosticCount(diagnostics, 'iframeStaticFailures', 1);
          pushArchiveDetail(diagnostics, '#' + messageId + ': iframe ' + (index + 1) + ' 静态化后为空');
          return;
        }
        const wrapper = hostDocument.createElement('div');
        wrapper.className = 'th-archive-static-frame';
        wrapper.setAttribute('data-archive-source', 'iframe-srcdoc');
        wrapper.innerHTML = staticHtml;
        const render = iframe.closest && iframe.closest('.TH-render');
        if (render) render.replaceWith(wrapper);
        else iframe.replaceWith(wrapper);
        bumpDiagnosticCount(diagnostics, 'staticizedIframes', 1);
        pushArchiveDetail(diagnostics, '#' + messageId + ': iframe ' + (index + 1) + ' 已静态化保存');
      } catch (error) {
        bumpDiagnosticCount(diagnostics, 'iframeStaticFailures', 1);
        pushArchiveDetail(diagnostics, '#' + messageId + ': iframe ' + (index + 1) + ' 静态化失败：' + getErrorMessage(error));
      }
    });
  }

  function recordSuspiciousArchiveSource(root, diagnostics, messageId) {
    const html = root && root.innerHTML ? String(root.innerHTML) : '';
    if (!html) return;
    const fence = String.fromCharCode(96);
    const suspicious = html.match(new RegExp('(?:&lt;\\\\/?(?:script|style|div|details|Episode|RandomTheater|PhoneAnalysis|rednote|msg)\\\\b|' + fence + '{3,}\\\\s*html\\\\b)', 'gi'));
    if (!suspicious || !suspicious.length) return;
    bumpDiagnosticCount(diagnostics, 'suspiciousSourceBlocks', 1);
    pushArchiveDetail(diagnostics, '#' + messageId + ': 仍检测到可疑源码痕迹 ' + suspicious.length + ' 处');
  }

  function cleanupTavernRenderedHtml(html, settings, diagnostics, messageId) {
    const raw = String(html == null ? '' : html);
    const needsCleanup = /TH-render|<iframe|hidden!|<details|<p\b|<br\b|<q\b/i.test(raw);
    if (!raw || !needsCleanup) {
      return raw;
    }

    const template = getHostDocument().createElement('template');
    template.innerHTML = raw;

    bumpDiagnosticCount(diagnostics, 'normalizedQuotes', normalizeQuoteElements(template.content));
    bumpDiagnosticCount(diagnostics, 'iframes', template.content.querySelectorAll('iframe').length);
    bumpDiagnosticCount(diagnostics, 'styles', template.content.querySelectorAll('style').length);

    template.content.querySelectorAll('p').forEach((node) => {
      if (isEmptyParagraph(node)) {
        node.remove();
        bumpDiagnosticCount(diagnostics, 'removedEmptyParagraphs', 1);
      }
    });

    template.content.querySelectorAll('details').forEach((details) => {
      bumpDiagnosticCount(diagnostics, 'removedDetailsSpacers', removeDetailsSpacerNodes(details));
    });

    staticizeArchiveIframes(template.content, settings, diagnostics, messageId == null ? '?' : messageId);

    template.content.querySelectorAll('.TH-render').forEach((render) => {
      if (!render.querySelector('iframe[srcdoc]')) return;
      render.querySelectorAll('.TH-collapse-code-block-button, pre, .code-copy, .copy-code-button').forEach((node) => {
        node.remove();
      });
    });

    template.content.querySelectorAll('iframe[srcdoc]').forEach((iframe) => {
      const previous = iframe.previousElementSibling;
      if (previous && previous.tagName === 'PRE' && previous.querySelector('code')) {
        previous.remove();
      }

      iframe.classList.add('th-export-frame');
      iframe.removeAttribute('loading');
      iframe.setAttribute('scrolling', 'auto');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      const currentHeight = parseInt(iframe.style.height || iframe.getAttribute('height') || '', 10);
      if (!Number.isFinite(currentHeight) || currentHeight <= 0) {
        iframe.style.height = '360px';
      }
      if (!iframe.getAttribute('title')) {
        iframe.setAttribute('title', 'HTML 渲染内容');
      }
      iframe.setAttribute(
        'sandbox',
        settings.allowScripts
          ? 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
          : 'allow-same-origin',
      );
    });

    recordSuspiciousArchiveSource(template, diagnostics, messageId == null ? '?' : messageId);
    return template.innerHTML;
  }

  function renderMessageContent(message, settings, rules, diagnostics) {
    const th = getTavernHelper();
    const messageId = Number(message.__export_id);
    const originalSource = getMessageText(message);
    let source = originalSource;
    let shouldRenderRaw = settings.renderRawHtml;
    let renderSource = 'raw';

    if (settings.applyTavernDisplay) {
      const renderedHtml = message.__export_file_mode ? '' : readRenderedMessageHtml(th, messageId, diagnostics);
      if (renderedHtml && hasMeaningfulRenderedHtml(renderedHtml)) {
        source = renderedHtml;
        shouldRenderRaw = true;
        renderSource = 'displayed';
      } else {
        if (renderedHtml) {
          pushDiagnostic(diagnostics, 'warning', `酒馆已显示内容为空或仅含控件，已回退原始消息 #${messageId}`);
        }
        const rendered = applyTavernRenderPipeline(th, source, message, settings, diagnostics);
        source = rendered.text;
        shouldRenderRaw = shouldRenderRaw || rendered.applied;
        renderSource = rendered.applied ? 'pipeline' : 'raw';
      }
    }

    const readableFallback = getUserReadableFallback(message, originalSource, source, settings);
    if (readableFallback) {
      source = readableFallback.text;
      shouldRenderRaw = false;
      bumpDiagnosticCount(diagnostics, 'userFallback', 1);
      bumpDiagnosticCount(diagnostics, readableFallback.mode === 'tag' ? 'userTagExtracts' : 'userSanitizedExtracts', 1);
      pushDiagnostic(diagnostics, 'warning', '部分 user 楼层渲染为空、露出 HTML 代码或包含召回代码，已只保留用户本轮输入。');
    }

    bumpDiagnosticCount(diagnostics, renderSource, 1);

    const processed = applyRules(source, rules, settings, diagnostics);
    if (shouldRenderRaw) {
      const html = sanitizeRenderedHtml(processed.text, settings.allowScripts, diagnostics);
      return {
        html: cleanupTavernRenderedHtml(restoreTokens(html, processed.tokens), settings, diagnostics, Number.isFinite(messageId) ? messageId : '?'),
        rendered: true,
      };
    }
    return {
      html: restoreTokens(escapeHtml(processed.text), processed.tokens),
      rendered: processed.tokens.length > 0,
    };
  }

  function buildPartName(baseName, part, totalParts) {
    const versionedBaseName = `${baseName}_${SCRIPT_VERSION}`;
    if (totalParts <= 1) return `${versionedBaseName}.html`;
    return `${versionedBaseName}_第${part}页.html`;
  }

  function buildSingleFileName(baseName) {
    return `${baseName}_${SCRIPT_VERSION}_分页.html`;
  }

  function buildNav(baseName, part, totalParts) {
    if (totalParts <= 1) return '';
    const prev = part > 1
      ? `<a class="nav-link" href="${escapeAttr(buildPartName(baseName, part - 1, totalParts))}">上一页</a>`
      : '<span class="nav-disabled">上一页</span>';
    const next = part < totalParts
      ? `<a class="nav-link" href="${escapeAttr(buildPartName(baseName, part + 1, totalParts))}">下一页</a>`
      : '<span class="nav-disabled">下一页</span>';
    return `<nav class="archive-nav">${prev}<span class="nav-page">第 ${part} / ${totalParts} 页</span>${next}</nav>`;
  }

  function getExportIdLabel(message, fallback) {
    const id = Number(message && message.__export_id);
    return Number.isFinite(id) ? String(id) : String(fallback);
  }

  function buildInternalPageData(messages, perPage) {
    const safePerPage = Math.max(1, parseInt(perPage, 10) || 50);
    const totalPages = Math.max(1, Math.ceil(messages.length / safePerPage));
    const pages = [];
    for (let page = 1; page <= totalPages; page += 1) {
      const startIndex = (page - 1) * safePerPage;
      const endIndex = Math.min(messages.length - 1, page * safePerPage - 1);
      pages.push({
        page,
        startLabel: getExportIdLabel(messages[startIndex], startIndex + 1),
        endLabel: getExportIdLabel(messages[endIndex], endIndex + 1),
      });
    }
    return { totalPages, perPage: safePerPage, pages };
  }

  function buildInternalNav(pageData) {
    if (!pageData || pageData.totalPages <= 1) return '';
    const chips = pageData.pages.map((page) => {
      const range = page.startLabel === page.endLabel
        ? `#${page.startLabel}`
        : `#${page.startLabel}-#${page.endLabel}`;
      return `<button type="button" class="archive-page-chip" data-page-jump="${page.page}" aria-current="${page.page === 1 ? 'page' : 'false'}"><span>第 ${page.page} 页</span><small>${escapeHtml(range)}</small></button>`;
    }).join('');
    return `
      <nav class="archive-nav archive-pager" aria-label="HTML 内分页">
        <div class="archive-pager-row">
          <button type="button" class="archive-page-button" data-page-action="prev" disabled>上一页</button>
          <span class="nav-page" data-page-status>第 1 / ${pageData.totalPages} 页</span>
          <button type="button" class="archive-page-button" data-page-action="next">下一页</button>
        </div>
        <div class="archive-page-tags" aria-label="页签导航">${chips}</div>
      </nav>`;
  }

  function buildReaderTools(pageData) {
    const pager = pageData && pageData.totalPages > 1
      ? `
        <div class="archive-floating-pager">
          <button type="button" data-page-action="prev" disabled>上一页</button>
          <select data-page-select aria-label="选择页数">
            ${pageData.pages.map((page) => `<option value="${page.page}">第 ${page.page} 页 #${escapeHtml(page.startLabel)}-#${escapeHtml(page.endLabel)}</option>`).join('')}
          </select>
          <button type="button" data-page-action="next">下一页</button>
          <span data-page-status>第 1 / ${pageData.totalPages} 页</span>
        </div>`
      : '';
    return `
      <section class="archive-tools" aria-label="阅读工具">
        ${pager}
        <div class="archive-jump">
          <span>楼层</span>
          <input type="number" min="0" step="1" inputmode="numeric" data-floor-input placeholder="例如 1200">
          <button type="button" data-floor-jump>跳转</button>
        </div>
        <div class="archive-bookmark-actions">
          <button type="button" data-bookmark-save>标记当前位置</button>
          <button type="button" data-bookmark-go>回到书签</button>
          <button type="button" data-bookmark-copy>复制书签码</button>
          <span data-bookmark-status>尚未标记</span>
        </div>
      </section>`;
  }

  function buildHtmlDocument(messages, meta) {
    const title = escapeHtml(meta.title);
    const subtitleCharacterName = meta.characterName || getCharacterName();
    const subtitleChatTitle = meta.chatTitle || getChatTitle();
    const singleFile = Boolean(meta.settings.singleFilePagination);
    const perPage = Math.max(1, parseInt(meta.settings.messagesPerFile, 10) || 50);
    const pageData = singleFile ? buildInternalPageData(messages, perPage) : null;
    const nav = singleFile ? buildInternalNav(pageData) : buildNav(meta.baseName, meta.part, meta.totalParts);
    const customCss = meta.settings.customCss || '';
    const pageBuckets = singleFile ? Array.from({ length: pageData.totalPages }, () => []) : null;
    const messageIndex = [];
    const articleHtmlList = messages.map((message, index) => {
      const role = getMessageRole(message);
      const id = Number(message.__export_id);
      const articleId = Number.isFinite(id) ? `msg-${id}` : `msg-${index + 1}`;
      const pageNumber = singleFile ? Math.floor(index / perPage) + 1 : 0;
      const pageAttr = singleFile ? ` data-page="${pageNumber}"` : '';
      const floorLabel = Number.isFinite(id) ? String(id) : String(index + 1);
      messageIndex.push({
        floor: Number.isFinite(id) ? id : index + 1,
        id: articleId,
        page: singleFile ? pageNumber : (meta.part || 1),
        label: `#${floorLabel}`,
      });
      const name = message.name || (role === 'user' ? getMessageUserName(message) : getMessageCharacterName(message));
      const hidden = isMessageHidden(message);
      const content = renderMessageContent(message, meta.settings, meta.rules, meta.diagnostics);
      const contentClass = content.rendered ? 'is-rendered-html' : 'is-plain-text';
      return `
        <article id="${escapeAttr(articleId)}" class="message message-${escapeAttr(role)}${hidden ? ' is-hidden' : ''}"${pageAttr}>
          <header class="message-head">
            <div class="message-name">${escapeHtml(name)}</div>
            <div class="message-meta">
              <span>#${Number.isFinite(id) ? id : '-'}</span>
              <span>${escapeHtml(role)}</span>
              ${hidden ? '<span>hidden</span>' : ''}
            </div>
          </header>
          <section class="message-content mes_text ${contentClass}">${content.html}</section>
        </article>`;
    });
    let messageHtml = articleHtmlList.join('\n');
    if (singleFile) {
      articleHtmlList.forEach((articleHtml, index) => {
        const pageNumber = Math.floor(index / perPage);
        if (pageBuckets[pageNumber]) pageBuckets[pageNumber].push(articleHtml);
      });
      const pageDataScripts = pageBuckets.map((items, index) => {
        const pageHtml = items.join('\n');
        const openTag = `<${'scr' + 'ipt'} type="application/json" data-page-data="${index + 1}">`;
        const closeTag = `</${'scr' + 'ipt'}>`;
        return `${openTag}${escapeJsonForScript(pageHtml)}${closeTag}`;
      }).join('\n');
      messageHtml = `
        <section class="archive-page-container" data-page-container>
          <div class="archive-page-loading">正在载入第 1 页...</div>
        </section>
        <div class="archive-page-data-store" hidden>${pageDataScripts}</div>`;
    }
    const indexOpenTag = `<${'scr' + 'ipt'} type="application/json" data-message-index>`;
    const indexCloseTag = `</${'scr' + 'ipt'}>`;
    const messageIndexScript = `${indexOpenTag}${escapeJsonDataForScript(messageIndex)}${indexCloseTag}`;
    const bodyAttributes = `${singleFile ? ` class="th-single-file" data-total-pages="${pageData.totalPages}" data-messages-per-page="${pageData.perPage}"` : ''}${meta.settings.renderOpeningWidget ? ' data-opening-widget="true"' : ''}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
${buildThemeVariables(meta.settings)}
    }
    * { box-sizing: border-box; }
    * { animation: none !important; transition: none !important; }
    body {
      margin: 0;
      background-color: var(--paper);
      color: var(--ink);
      font-family: "Clear Han Serif", "Noto Serif SC", "Microsoft YaHei", "PingFang SC", serif;
      padding: 20px;
      padding-bottom: 130px;
      line-height: 1.6;
    }
    .archive-shell {
      max-width: 850px;
      margin: 0 auto;
      padding: 0;
    }
    .archive-title {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px;
      align-items: end;
      padding: 15px;
      margin-bottom: 25px;
      background: var(--title-panel);
      border: 1px dashed var(--line);
    }
    h1 {
      margin: 0;
      color: var(--ink);
      font-size: clamp(22px, 4vw, 32px);
      font-weight: 700;
      letter-spacing: 0;
    }
    .archive-subtitle {
      color: var(--ink);
      opacity: 0.78;
      font-size: 13px;
      text-align: right;
    }
    .archive-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 15px;
      margin-bottom: 25px;
      border: 1px dashed var(--line);
      background: var(--title-panel);
    }
    .nav-link,
    .nav-disabled,
    .nav-page {
      min-width: 72px;
      text-align: center;
      font-size: 14px;
    }
    .nav-link {
      color: var(--muted);
      text-decoration: none;
      font-weight: 700;
    }
    .nav-link:hover {
      color: var(--assistant);
      text-decoration: underline;
    }
    .nav-disabled {
      color: var(--muted);
      opacity: 0.55;
    }
    .archive-tools {
      position: fixed;
      left: 50%;
      bottom: max(14px, env(safe-area-inset-bottom));
      transform: translateX(-50%);
      z-index: 80;
      width: min(1060px, calc(100vw - 28px));
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 12px;
      margin: 0;
      border: 1px dashed var(--line);
      background: color-mix(in srgb, var(--title-panel) 92%, transparent);
      box-shadow: var(--message-shadow);
      backdrop-filter: blur(14px);
    }
    .archive-floating-pager {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .archive-floating-pager select {
      min-height: 32px;
      max-width: min(260px, 52vw);
      border: 1px solid var(--line);
      background: var(--meta-bg);
      color: var(--ink);
      padding: 5px 8px;
      font: inherit;
      font-size: 13px;
      outline: none;
    }
    .archive-jump,
    .archive-bookmark-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .archive-jump span,
    .archive-bookmark-actions span {
      color: var(--muted);
      font-size: 13px;
    }
    .archive-jump input {
      width: 112px;
      min-height: 32px;
      border: 1px solid var(--line);
      background: var(--meta-bg);
      color: var(--ink);
      padding: 5px 8px;
      font: inherit;
      font-size: 13px;
      outline: none;
    }
    .archive-jump input:focus {
      border-color: var(--accent);
    }
    .archive-tools button {
      min-height: 32px;
      border: 1px solid var(--line);
      background: var(--meta-bg);
      color: var(--ink);
      padding: 5px 10px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .archive-tools button:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .archive-bookmark-actions [data-bookmark-status] {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .message.th-bookmark-flash {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
    }
    .th-opening-widget {
      margin: 0 0 14px;
      border: 1px solid var(--line);
      background: var(--meta-bg);
    }
    .th-opening-widget-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
    }
    .th-opening-widget-head strong {
      color: var(--ink);
      font-size: 13px;
    }
    .th-opening-widget-toggle {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      padding: 4px 8px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .th-opening-widget-frame {
      display: block;
      width: 100%;
      min-height: 180px;
      height: 420px;
      border: 0;
      background: transparent;
    }
    .th-opening-widget-source[hidden] {
      display: none !important;
    }
    .archive-pager {
      align-items: stretch;
      flex-direction: column;
      gap: 12px;
    }
    .archive-pager-row {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .archive-page-button,
    .archive-page-chip {
      border: 1px solid var(--line);
      background: var(--meta-bg);
      color: var(--ink);
      font: inherit;
      cursor: pointer;
    }
    .archive-page-button {
      min-width: 72px;
      padding: 7px 12px;
      font-size: 14px;
      font-weight: 700;
    }
    .archive-page-button:disabled {
      cursor: default;
      opacity: 0.45;
    }
    .archive-page-tags {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      max-height: 128px;
      overflow: auto;
      padding: 2px;
    }
    .archive-page-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 5px 9px;
      font-size: 13px;
    }
    .archive-page-chip span {
      font-weight: 700;
    }
    .archive-page-chip small {
      color: var(--muted);
      font-size: 11px;
      font-family: Consolas, "Cascadia Mono", monospace;
    }
    .archive-page-chip[aria-current="page"] {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--paper);
    }
    .archive-page-chip[aria-current="page"] small {
      color: var(--paper);
      opacity: 0.82;
    }
    .archive-page-container {
      min-height: 180px;
    }
    .archive-page-loading {
      padding: 24px;
      margin-bottom: 25px;
      border: 1px dashed var(--line);
      background: var(--title-panel);
      color: var(--muted);
      text-align: center;
      font-size: 14px;
    }
    .archive-page-warning {
      padding: 10px 12px;
      margin-bottom: 16px;
      border: 1px solid color-mix(in srgb, var(--system) 45%, transparent);
      background: color-mix(in srgb, var(--system) 12%, var(--panel));
      color: var(--ink);
      font-size: 13px;
      line-height: 1.7;
    }
    .archive-page-data-store {
      display: none !important;
    }
    body.th-single-file.th-paged-ready .message[data-page] {
      display: none;
    }
    body.th-single-file.th-lazy-pages.th-paged-ready .message[data-page] {
      display: block;
    }
    body.th-single-file.th-paged-ready .message[data-page].is-page-active {
      display: block;
    }
    .message {
      background: var(--panel);
      border: 1px solid var(--line);
      border-left: 5px solid var(--assistant);
      border-radius: 0;
      margin-bottom: 25px;
      padding: 18px;
      position: relative;
      overflow: visible;
      scroll-margin-top: 96px;
      box-shadow: var(--message-shadow);
    }
    .message-user { border-left-color: var(--user); }
    .message-assistant { border-left-color: var(--assistant); }
    .message-system { border-left-color: var(--system); }
    .message.is-hidden { opacity: 0.82; }
    .message-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      padding: 0 0 10px;
      border-bottom: none;
      background: transparent;
    }
    .message-name {
      color: var(--assistant);
      font-weight: 700;
      font-size: 1.1em;
      overflow-wrap: anywhere;
    }
    .message-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-family: Consolas, "Cascadia Mono", monospace;
    }
    .message-meta span {
      border: 1px solid rgba(122, 148, 139, 0.35);
      padding: 1px 6px;
      border-radius: 0;
      background: var(--meta-bg);
    }
    .message-content {
      padding: 0;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      text-align: justify;
      letter-spacing: 1px;
    }
    .message-content.is-plain-text,
    .message-content > p {
      white-space: pre-wrap;
    }
    .message-content.is-plain-text > p,
    .message-content.is-rendered-html > p {
      margin: 0.78em 0;
    }
    .message-content.is-plain-text > p:first-child,
    .message-content.is-rendered-html > p:first-child {
      margin-top: 0;
    }
    .message-content.is-plain-text > p:last-child,
    .message-content.is-rendered-html > p:last-child {
      margin-bottom: 0;
    }
    .message-content > p:first-child {
      margin-top: 0;
    }
    .message-content > p:last-child {
      margin-bottom: 0;
    }
    .message-content details {
      white-space: normal;
    }
    .message-content q {
      quotes: none;
    }
    .message-content q::before,
    .message-content q::after {
      content: "";
    }
    .message-content img,
    .message-content video,
    .message-content iframe,
    .message-content table {
      max-width: 100%;
    }
    .message-content .TH-render {
      width: 100%;
      white-space: normal;
    }
    .message-content .TH-collapse-code-block-button,
    .message-content .TH-render > pre,
    .message-content .TH-render .code-copy,
    .message-content .TH-render .hidden\\! {
      display: none !important;
    }
    .message-content iframe.th-export-frame,
    .message-content .TH-render iframe {
      display: block;
      width: 100%;
      min-height: 96px;
      height: 360px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      overflow: auto;
    }
    .th-archive-static-frame,
    .th-archive-static-block,
    .th-archive-generic-block {
      width: 100%;
      margin: 12px 0;
      white-space: normal;
    }
    .th-archive-generic-block {
      border: 1px dashed var(--line);
      background: var(--title-panel);
      padding: 8px 10px;
    }
    .th-archive-generic-block > summary {
      cursor: pointer;
      color: var(--muted);
      font-weight: 700;
    }
    .th-html-code-widget {
      margin: 12px 0;
      border: 1px solid var(--line);
      background: var(--title-panel);
      box-shadow: var(--message-shadow);
    }
    .th-html-code-widget-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px dashed var(--line);
      color: var(--muted);
      font-size: 12px;
    }
    .th-html-code-widget-toggle {
      border: 1px solid var(--line);
      background: var(--meta-bg);
      color: var(--ink);
      padding: 4px 8px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .th-html-code-source {
      margin-top: 8px;
    }
    .message-content pre,
    .message-content code {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .th-export-title {
      margin: 4px 0 12px;
      padding: 10px 12px;
      border-left: 4px solid var(--assistant);
      background: rgba(255, 255, 255, 0.35);
      font-size: 1.15em;
      font-weight: 700;
    }
    @media (max-width: 640px) {
      .archive-shell { width: min(100% - 20px, 980px); padding-top: 16px; }
      .archive-title { align-items: start; }
      .archive-subtitle { text-align: left; }
      .message-head { align-items: flex-start; flex-direction: column; }
      .archive-nav { gap: 8px; }
      .archive-tools { align-items: stretch; flex-direction: column; }
      .message { scroll-margin-top: 150px; }
      .archive-jump input { width: min(160px, 100%); }
      .nav-link, .nav-disabled, .nav-page { min-width: auto; }
    }
    ${customCss}
  </style>
  ${'<scr' + 'ipt>'}
${String.raw`
    window.switchTab = function(e, tabId, btn) {
      e.stopPropagation();
      const container = btn.closest('.content-wrapper');
      if (!container) return;
      container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const contents = container.querySelectorAll('.tab-content');
      if (tabId === 'tab-wuyi' && contents[0]) contents[0].classList.add('active');
      if (tabId === 'tab-siang' && contents[1]) contents[1].classList.add('active');
      if (tabId === 'tab-user' && contents[2]) contents[2].classList.add('active');
      btn.classList.add('active');
    };
    window.toggleTxPack = function(btn) {
      const wrap = btn.closest('.tx-pack-wrapper');
      if (!wrap) return;
      const ui = wrap.querySelector('.tx-pack-interface');
      const icon = btn.querySelector('.tx-icon');
      if (!ui || !icon) return;
      if (ui.style.display === 'none') {
        ui.style.display = 'block';
        icon.innerText = '-';
      } else {
        ui.style.display = 'none';
        icon.innerText = '+';
        return;
      }
      if (wrap.dataset.parsed === 'true') return;
      const rawNode = wrap.querySelector('.tx-pack-raw');
      const rawHtml = rawNode ? rawNode.innerHTML : wrap.innerHTML;
      const decodedHtml = window.thArchiveDecodeHtmlEntities(rawHtml);
      const temp = document.createElement('div');
      temp.innerHTML = decodedHtml;
      const tabsBox = wrap.querySelector('.tx-pack-tabs');
      const viewBox = wrap.querySelector('.tx-pack-viewport');
      if (!tabsBox || !viewBox) return;
      tabsBox.innerHTML = '';
      viewBox.innerHTML = '';
      const panels = window.thArchiveCollectTxPanels(rawHtml, decodedHtml, temp);
      panels.forEach((panel, index) => {
        const tBtn = document.createElement('div');
        tBtn.className = 'tx-pack-btn' + (index === 0 ? ' active' : '');
        tBtn.innerText = panel.label || ('内容 ' + (index + 1));
        const pnl = document.createElement('div');
        pnl.className = 'tx-pack-panel' + (index === 0 ? ' active' : '');
        pnl.innerHTML = window.thArchiveNormalizePanelHtml(panel.html);
        tBtn.onclick = function(event) {
          event.stopPropagation();
          tabsBox.querySelectorAll('.tx-pack-btn').forEach(b => b.classList.remove('active'));
          viewBox.querySelectorAll('.tx-pack-panel').forEach(p => p.classList.remove('active'));
          tBtn.classList.add('active');
          pnl.classList.add('active');
        };
        tabsBox.appendChild(tBtn);
        viewBox.appendChild(pnl);
      });
      if (!panels.length) {
        const empty = document.createElement('div');
        empty.className = 'tx-pack-panel active';
        empty.textContent = '没有找到可显示的内容。';
        viewBox.appendChild(empty);
      }
      wrap.dataset.parsed = 'true';
    };
    window.resizeThExportFrame = function(frame) {
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc) return;
        const body = doc.body;
        const root = doc.documentElement;
        const previousHeight = frame.style.height;
        frame.style.height = '1px';
        let childBottom = 0;
        if (body) {
          Array.from(body.children || []).forEach(child => {
            const rect = child.getBoundingClientRect();
            childBottom = Math.max(childBottom, rect.bottom);
          });
        }
        const height = Math.max(
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0,
          root ? root.scrollHeight : 0,
          root ? root.offsetHeight : 0,
          Math.ceil(childBottom),
          80,
        );
        const nextHeight = Math.max(height + 20, 96);
        if (Number.isFinite(nextHeight)) {
          frame.style.height = nextHeight + 'px';
        } else {
          frame.style.height = previousHeight || '360px';
        }
      } catch (error) {
        frame.style.height = frame.style.height || '360px';
      }
    };
    window.observeThExportFrame = function(frame) {
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc || frame.dataset.thExportObserved === 'true') return;
        frame.dataset.thExportObserved = 'true';
        const resize = () => window.resizeThExportFrame(frame);
        resize();
        if ('ResizeObserver' in window) {
          const observer = new ResizeObserver(resize);
          if (doc.documentElement) observer.observe(doc.documentElement);
          if (doc.body) observer.observe(doc.body);
          frame._thExportResizeObserver = observer;
        }
        if ('MutationObserver' in window && doc.body) {
          const mutationObserver = new MutationObserver(() => {
            setTimeout(resize, 50);
            setTimeout(resize, 220);
          });
          mutationObserver.observe(doc.body, {
            attributes: true,
            childList: true,
            subtree: true,
            characterData: true,
          });
          frame._thExportMutationObserver = mutationObserver;
        }
        doc.addEventListener('click', () => {
          setTimeout(resize, 80);
          setTimeout(resize, 300);
        }, true);
        doc.querySelectorAll('details').forEach(details => {
          details.addEventListener('toggle', () => {
            setTimeout(resize, 80);
            setTimeout(resize, 300);
          });
        });
        let ticks = 0;
        const timer = setInterval(() => {
          resize();
          ticks += 1;
          if (ticks > 40) clearInterval(timer);
        }, 250);
      } catch (error) {
        window.resizeThExportFrame(frame);
      }
    };
    window.bindThExportFrames = function() {
      document.querySelectorAll('iframe.th-export-frame, .message-content iframe[srcdoc]').forEach(frame => {
        if (frame.dataset.thExportBound === 'true') return;
        frame.dataset.thExportBound = 'true';
        frame.addEventListener('load', () => {
          window.resizeThExportFrame(frame);
          window.observeThExportFrame(frame);
          setTimeout(() => window.resizeThExportFrame(frame), 150);
          setTimeout(() => window.resizeThExportFrame(frame), 600);
        });
        setTimeout(() => window.resizeThExportFrame(frame), 80);
        setTimeout(() => window.observeThExportFrame(frame), 120);
        setTimeout(() => window.resizeThExportFrame(frame), 500);
        setTimeout(() => window.observeThExportFrame(frame), 900);
      });
    };
    window.thArchiveDecodeHtmlEntities = function(value) {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = String(value || '');
      return textarea.value;
    };
    window.thArchiveEscapeText = function(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };
    window.thArchiveStripCodeFence = function(value) {
      let text = String(value || '').trim();
      text = text.replace(/^\s*\`{3,}\s*(?:html|HTML|xml|XML)?\s*/i, '');
      text = text.replace(/\s*\`{3,}\s*$/i, '');
      return text.trim();
    };
    window.thArchiveFindTaggedContent = function(rawHtml, tag) {
      const escaped = String(tag || '').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      const patterns = [
        new RegExp('<\\\\s*' + escaped + '(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)<\\\\s*\\\\/\\\\s*' + escaped + '\\\\s*>', 'i'),
        new RegExp('&lt;\\\\s*' + escaped + '(?:\\\\s[^&]*?)?&gt;([\\\\s\\\\S]*?)&lt;\\\\s*\\\\/\\\\s*' + escaped + '\\\\s*&gt;', 'i'),
      ];
      for (const regex of patterns) {
        const match = String(rawHtml || '').match(regex);
        if (match && match[1]) return window.thArchiveDecodeHtmlEntities(match[1]);
      }
      return '';
    };
    window.thArchiveNormalizePanelHtml = function(value) {
      const decoded = window.thArchiveDecodeHtmlEntities(value);
      return String(decoded || value || '').trim().replace(/\\n/g, '<br>');
    };
    window.thArchiveCollectTxPanels = function(rawHtml, decodedHtml, temp) {
      const panels = [];
      const seen = new Set();
      const addPanel = (label, html) => {
        const content = String(html || '').trim();
        if (!content) return;
        const key = (String(label || '') + '::' + content).replace(/\\s+/g, ' ').slice(0, 1200);
        if (seen.has(key)) return;
        seen.add(key);
        panels.push({ label: String(label || ('内容 ' + (panels.length + 1))).trim(), html: content });
      };
      ['Slate', 'content', 'Snapshot', 'abstract', 'Todo', 'seeds', 'Events', 'CharacterThreads', 'Episode', 'RandomTheater', 'PhoneAnalysis', 'rednote', 'msg', 'disclaimer'].forEach(tag => {
        const el = temp.querySelector(tag) || temp.querySelector(String(tag).toLowerCase());
        if (el) addPanel(tag, el.innerHTML);
        else addPanel(tag, window.thArchiveFindTaggedContent(rawHtml, tag) || window.thArchiveFindTaggedContent(decodedHtml, tag));
      });
      temp.querySelectorAll('details').forEach((details, index) => {
        const clone = details.cloneNode(true);
        const summary = clone.querySelector('summary');
        const label = summary ? summary.textContent.trim() : ('折叠内容 ' + (index + 1));
        if (summary) summary.remove();
        addPanel(label, clone.innerHTML);
      });
      const common = new Set(['html','head','body','style','script','div','span','p','br','section','article','button','summary','details']);
      temp.querySelectorAll('*').forEach((el) => {
        const tag = String(el.tagName || '').toLowerCase();
        if (!tag || common.has(tag)) return;
        if (!el.innerHTML || !el.textContent.trim()) return;
        addPanel(el.getAttribute('data-title') || el.getAttribute('title') || tag.toUpperCase(), el.innerHTML);
      });
      if (!panels.length) {
        const fallback = window.thArchiveStripCodeFence(window.thArchiveDecodeHtmlEntities(decodedHtml || rawHtml));
        const scriptTag = 'scr' + 'ipt';
        const styleTag = 'sty' + 'le';
        const cleaned = fallback
          .replace(new RegExp('<' + scriptTag + '\\\\b[\\\\s\\\\S]*?<\\\\/' + scriptTag + '>', 'gi'), '')
          .replace(new RegExp('<' + styleTag + '\\\\b[\\\\s\\\\S]*?<\\\\/' + styleTag + '>', 'gi'), '');
        addPanel('原文', cleaned);
      }
      return panels;
    };
    window.thArchiveLooksLikeRenderableHtml = function(raw) {
      const text = window.thArchiveStripCodeFence(window.thArchiveDecodeHtmlEntities(raw));
      if (!text) return false;
      const head = text.slice(0, 1200).toLowerCase();
      if (/^(?:<!doctype html|<html\b)/i.test(head)) return true;
      if (!/<[a-z][\s\S]*>/i.test(text)) return false;
      const hasStyleOrScript = /<style\b|<script\b/i.test(text);
      const hasKnownUi = /class=["'][^"']*(?:tx-pack|custom-|content-wrapper|player|music|audio|song|slate|status|panel|tab|card|wrapper)[^"']*["']/i.test(text);
      const hasKnownTags = /<\\s*(?:Snapshot|abstract|Todo|seeds|Events|Episode|CharacterThreads|content)\\b/i.test(text);
      return hasStyleOrScript && (hasKnownUi || hasKnownTags || text.length > 900);
    };
    window.thArchiveWrapHtmlCode = function(raw) {
      const text = window.thArchiveStripCodeFence(window.thArchiveDecodeHtmlEntities(raw));
      if (/^(?:<!doctype html|<html\b)/i.test(text)) return text;
      return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><base target="_blank"></head><body>' + text + '</body></html>';
    };
    window.thArchiveIsFenceArtifact = function(node) {
      if (!node) return false;
      if (node.nodeType === 3) return !String(node.nodeValue || '').trim();
      if (node.nodeType !== 1) return false;
      if (node.matches && node.matches('br')) return true;
      if (!(node.matches && node.matches('p, div'))) return false;
      const compact = String(node.textContent || '').replace(/\\s+/g, '').toLowerCase();
      return compact === 'html' || /^\`+$/.test(compact) || /^\`+html$/.test(compact);
    };
    window.thArchiveRemoveFenceArtifacts = function(anchor) {
      const sweep = (startNode, direction) => {
        let node = startNode;
        let guard = 0;
        while (node && guard < 10 && window.thArchiveIsFenceArtifact(node)) {
          const next = direction < 0 ? node.previousSibling : node.nextSibling;
          node.remove();
          node = next;
          guard += 1;
        }
      };
      if (!anchor) return;
      sweep(anchor.previousSibling, -1);
      sweep(anchor.nextSibling, 1);
    };
    window.thArchiveCleanFenceArtifacts = function(scope) {
      const root = scope && scope.querySelectorAll ? scope : document;
      root.querySelectorAll('.message-content').forEach(section => {
        Array.from(section.childNodes || []).forEach(node => {
          if (window.thArchiveIsFenceArtifact(node)) node.remove();
        });
        const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const parent = node.parentElement;
            if (parent && parent.closest('pre, code, textarea, script, style')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
          node.nodeValue = String(node.nodeValue || '')
            .replace(/\`{3,}\\s*html\\b/gi, '')
            .replace(/\`{3,}/g, '');
        });
      });
    };
    window.thArchiveFormatPlainTextBlocks = function(scope) {
      const root = scope && scope.querySelectorAll ? scope : document;
      root.querySelectorAll('.message-content.is-plain-text, .message-content.is-rendered-html').forEach(section => {
        if (section.dataset.thPlainFormatted === 'true') return;
        const hasRichChildren = section.querySelector('p, div, details, pre, iframe, table, ul, ol, blockquote, .th-html-code-widget, .th-opening-widget');
        if (hasRichChildren) return;
        const raw = String(section.textContent || '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n').trim();
        if (!raw || !raw.includes('\\n')) return;
        section.dataset.thPlainFormatted = 'true';
        section.textContent = '';
        const groups = (raw.includes('\\n\\n') ? raw.split(/\\n{2,}/) : raw.split(/\\n+/))
          .map(item => item.trim())
          .filter(Boolean);
        groups.forEach(text => {
          const p = document.createElement('p');
          p.textContent = text;
          section.appendChild(p);
        });
      });
    };
    window.thArchiveExtractBodyHtml = function(value) {
      const raw = String(value == null ? '' : value);
      const matches = Array.from(raw.matchAll(/<body\b[^>]*>([\s\S]*?)<\/body>/gi));
      if (matches.length) return matches[matches.length - 1][1];
      return raw
        .replace(/<!doctype[\s\S]*?>/gi, '')
        .replace(/<\/?(?:html|head|body)[^>]*>/gi, '');
    };
    window.thArchiveStaticizeHtmlString = function(value) {
      const template = document.createElement('template');
      template.innerHTML = window.thArchiveExtractBodyHtml(window.thArchiveStripCodeFence(window.thArchiveDecodeHtmlEntities(value)));
      template.content.querySelectorAll('script, meta, title, link[rel="modulepreload"], link[as="script"]').forEach(node => node.remove());
      return template.innerHTML.trim();
    };
    window.thArchiveBuildGenericTaggedBlock = function(raw) {
      const decoded = window.thArchiveStripCodeFence(window.thArchiveDecodeHtmlEntities(raw));
      const temp = document.createElement('div');
      temp.innerHTML = decoded;
      const common = new Set(['html','head','body','style','script','div','span','p','br','section','article','button','summary','details','em','strong','b','i','q','ul','ol','li','blockquote']);
      const block = document.createElement('div');
      block.className = 'th-archive-static-block';
      let count = 0;
      Array.from(temp.children || []).forEach((el) => {
        const tag = String(el.tagName || '').toLowerCase();
        if (!tag || common.has(tag)) return;
        if (!String(el.textContent || '').trim() && !el.querySelector('details, div, p, table, ul, ol')) return;
        const details = document.createElement('details');
        details.className = 'th-archive-generic-block';
        const summary = document.createElement('summary');
        summary.textContent = el.getAttribute('title') || el.getAttribute('data-title') || el.tagName;
        const body = document.createElement('div');
        body.innerHTML = el.innerHTML || window.thArchiveEscapeText(el.textContent || '');
        details.appendChild(summary);
        details.appendChild(body);
        block.appendChild(details);
        count += 1;
      });
      if (!count && temp.querySelector('details, .tx-pack-wrapper, .dashboard-container, [class*="custom-"]')) {
        block.innerHTML = window.thArchiveStaticizeHtmlString(decoded);
        count = block.textContent.trim() || block.querySelector('*') ? 1 : 0;
      }
      return count ? block : null;
    };
    window.thArchivePostProcessArchiveBlocks = function(scope) {
      const root = scope && scope.querySelectorAll ? scope : document;
      root.querySelectorAll('.tx-pack-wrapper').forEach(wrap => {
        const button = wrap.querySelector('.tx-pack-toggle, .custom-tx-pack-toggle');
        if (button && !button.dataset.thArchiveBound) {
          button.dataset.thArchiveBound = 'true';
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof window.toggleTxPack === 'function') window.toggleTxPack(button);
          });
        }
      });
    };

    

  window.thArchiveRenderHtmlCodeBlocks = function(scope) {
      const root = scope && scope.querySelectorAll ? scope : document;
      root.querySelectorAll('.message-content pre').forEach(pre => {
        if (pre.dataset.thHtmlCodeChecked === 'true' || pre.classList.contains('th-opening-widget-source')) return;
        pre.dataset.thHtmlCodeChecked = 'true';
        const code = pre.querySelector('code') || pre;
        const raw = window.thArchiveStripCodeFence(code ? code.textContent || '' : '');
        if (!window.thArchiveLooksLikeRenderableHtml(raw)) return;
        const content = pre.closest('.message-content');
        if (!content) return;
        const key = window.thArchiveStripCodeFence(window.thArchiveDecodeHtmlEntities(raw)).replace(/\\s+/g, ' ').slice(0, 2400);
        content.__thHtmlCodeSeen = content.__thHtmlCodeSeen || new Set();
        if (content.__thHtmlCodeSeen.has(key)) {
          pre.hidden = true;
          pre.style.display = 'none';
          window.thArchiveRemoveFenceArtifacts(pre);
          return;
        }
        content.__thHtmlCodeSeen.add(key);

        const generic = window.thArchiveBuildGenericTaggedBlock(raw);
        const wrap = generic || document.createElement('div');
        if (!generic) {
          wrap.className = 'th-archive-static-block';
          wrap.innerHTML = window.thArchiveStaticizeHtmlString(raw);
        }
        if (!wrap.textContent.trim() && !wrap.querySelector('*')) return;
        pre.classList.add('th-html-code-source');
        pre.hidden = true;
        pre.style.display = 'none';
        content.insertBefore(wrap, pre);
        window.thArchiveRemoveFenceArtifacts(pre);
        window.thArchivePostProcessArchiveBlocks(content);
      });
    };

    window.thArchiveLooksLikeOpeningWidget = function(raw) {
      const text = String(raw || '').trim();
      if (!text) return false;
      const head = text.slice(0, 900).toLowerCase();
      if (head.startsWith('<!doctype html') || head.startsWith('<html')) return true;
      const scriptTag = 'scr' + 'ipt';
      const hasScript = new RegExp('<' + scriptTag + '\\\\b', 'i').test(text);
      const hasStyle = /<style\\b/i.test(text);
      const hasAudio = /<audio\\b|\\.mp3\\b|\\.m4a\\b|\\.ogg\\b|music|player|song|audio|播放|歌曲|音乐/i.test(text);
      const hasPlayerClass = /class=["'][^"']*(?:player|music|audio|song)[^"']*["']/i.test(text);
      return (hasScript && hasStyle && hasAudio) || (hasStyle && hasPlayerClass);
    };
    window.thArchiveWrapOpeningWidgetHtml = function(raw) {
      const text = String(raw || '').trim();
      if (/^(?:<!doctype html|<html\\b)/i.test(text)) return text;
      return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><base target="_blank"></head><body>' + text + '</body></html>';
    };
    window.thArchiveRenderOpeningWidgets = function(scope) {
      if (!document.body || document.body.dataset.openingWidget !== 'true') return;
      const root = scope && scope.querySelector ? scope : document;
      const candidates = [];
      ['msg-0', 'msg-1'].forEach(id => {
        const node = root.querySelector('#' + id) || document.getElementById(id);
        if (node) candidates.push(node);
      });
      const firstMessage = root.querySelector('.message[id]') || document.querySelector('.message[id]');
      if (firstMessage) candidates.push(firstMessage);
      const seen = new Set();
      for (const article of candidates) {
        if (!article || seen.has(article) || article.dataset.thOpeningWidgetChecked === 'true') continue;
        seen.add(article);
        article.dataset.thOpeningWidgetChecked = 'true';
        const content = article.querySelector('.message-content');
        if (!content) continue;
        const firstElement = content.firstElementChild;
        if (!firstElement || firstElement.tagName !== 'PRE') continue;
        const code = firstElement.querySelector('code') || firstElement;
        const raw = code ? String(code.textContent || '').trim() : '';
        if (!window.thArchiveLooksLikeOpeningWidget(raw)) continue;

        const wrap = document.createElement('div');
        wrap.className = 'th-opening-widget';
        const head = document.createElement('div');
        head.className = 'th-opening-widget-head';
        const label = document.createElement('strong');
        label.textContent = '首楼小组件预览';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'th-opening-widget-toggle';
        button.textContent = '显示代码';
        head.appendChild(label);
        head.appendChild(button);

        const frame = document.createElement('iframe');
        frame.className = 'th-export-frame th-opening-widget-frame';
        frame.setAttribute('title', '首楼 HTML 小组件');
        frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals allow-downloads');
        frame.setAttribute('allow', 'autoplay; encrypted-media');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('scrolling', 'auto');
        frame.srcdoc = window.thArchiveWrapOpeningWidgetHtml(raw);

        firstElement.classList.add('th-opening-widget-source');
        firstElement.hidden = true;
        firstElement.style.display = 'none';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const shouldShow = firstElement.hidden || firstElement.style.display === 'none';
          firstElement.hidden = !shouldShow;
          firstElement.style.display = shouldShow ? '' : 'none';
          button.textContent = shouldShow ? '隐藏代码' : '显示代码';
        });

        wrap.appendChild(head);
        wrap.appendChild(frame);
        content.insertBefore(wrap, firstElement);
        if (typeof window.bindThExportFrames === 'function') window.bindThExportFrames();
        break;
      }
    };
    window.thArchiveGetMessageIndex = function() {
      if (Array.isArray(window.__thArchiveMessageIndex)) return window.__thArchiveMessageIndex;
      const node = document.querySelector('[data-message-index]');
      if (!node) {
        window.__thArchiveMessageIndex = [];
        return window.__thArchiveMessageIndex;
      }
      try {
        const parsed = JSON.parse(node.textContent || '[]');
        window.__thArchiveMessageIndex = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        window.__thArchiveMessageIndex = [];
      }
      return window.__thArchiveMessageIndex;
    };
    window.thArchiveSetToolStatus = function(text) {
      document.querySelectorAll('[data-bookmark-status]').forEach(item => {
        item.textContent = text || '';
        item.title = text || '';
      });
    };
    window.thArchiveStorageKey = function() {
      return 'thArchiveBookmark:' + location.pathname + ':' + document.title;
    };
    window.thArchiveReadBookmark = function() {
      try {
        const raw = localStorage.getItem(window.thArchiveStorageKey());
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    };
    window.thArchiveWriteBookmark = function(bookmark) {
      try {
        localStorage.setItem(window.thArchiveStorageKey(), JSON.stringify(bookmark));
        return true;
      } catch (error) {
        return false;
      }
    };
    window.thArchiveFindEntryByFloor = function(floor) {
      const wanted = Number(floor);
      if (!Number.isFinite(wanted)) return null;
      return window.thArchiveGetMessageIndex().find(entry => Number(entry.floor) === wanted) || null;
    };
    window.thArchiveFindEntryByElementId = function(id) {
      return window.thArchiveGetMessageIndex().find(entry => entry.id === id) || null;
    };
    window.thArchiveBookmarkCode = function(entry) {
      if (!entry) return '';
      const floor = Number(entry.floor);
      if (Number.isFinite(floor)) return '#' + floor;
      return String(entry.label || entry.id || '');
    };
    window.thArchiveHashForEntry = function(entry) {
      if (!entry) return '';
      const floor = Number(entry.floor);
      return Number.isFinite(floor) ? 'floor-' + floor : '';
    };
    window.thArchiveSetFloorInput = function(entry) {
      const floor = Number(entry && entry.floor);
      if (!Number.isFinite(floor)) return;
      document.querySelectorAll('[data-floor-input]').forEach(input => {
        input.value = String(floor);
      });
    };
    window.thArchiveUpdateLocationHash = function(entry) {
      const hash = window.thArchiveHashForEntry(entry);
      if (!hash) return;
      try {
        history.replaceState(null, '', '#' + hash);
      } catch (error) {
        location.hash = hash;
      }
    };
    window.thArchiveReadHashEntry = function() {
      let hash = '';
      try {
        hash = decodeURIComponent(String(location.hash || ''));
      } catch (error) {
        hash = String(location.hash || '');
      }
      const match = hash.match(/(?:floor|msg)-(\d+)/i) || hash.match(/^#(\d+)$/);
      return match ? window.thArchiveFindEntryByFloor(match[1]) : null;
    };
    window.thArchiveCopyBookmarkCode = function(entry) {
      const code = window.thArchiveBookmarkCode(entry);
      if (!code) {
        window.thArchiveSetToolStatus('还没有可复制的书签码');
        return;
      }
      const done = () => window.thArchiveSetToolStatus('已复制书签码：' + code);
      const fail = () => window.thArchiveSetToolStatus('书签码：' + code + '，可手动记下');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(fail);
        return;
      }
      try {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand && document.execCommand('copy');
        textarea.remove();
        if (ok) done();
        else fail();
      } catch (error) {
        fail();
      }
    };
    window.thArchiveCurrentEntry = function() {
      const messages = Array.from(document.querySelectorAll('.message[id]'));
      if (!messages.length) return null;
      let candidate = messages[0];
      const marker = Math.max(80, window.innerHeight * 0.22);
      for (const message of messages) {
        const rect = message.getBoundingClientRect();
        if (rect.top <= marker) candidate = message;
        if (rect.top > marker) break;
      }
      const indexed = window.thArchiveFindEntryByElementId(candidate.id);
      if (indexed) return indexed;
      const floor = Number(String(candidate.id || '').replace(/^msg-/, ''));
      return {
        id: candidate.id,
        floor: Number.isFinite(floor) ? floor : 0,
        page: Number(document.body.dataset.currentPage || '1') || 1,
        label: Number.isFinite(floor) ? '#' + floor : candidate.id,
      };
    };
    window.thArchiveRevealEntry = function(entry, options) {
      if (!entry) return false;
      const page = Number(entry.page || 1) || 1;
      if (document.body.classList.contains('th-single-file') && typeof window.thArchiveShowPage === 'function') {
        window.thArchiveShowPage(page, { updateHash: false, scroll: false });
      }
      const reveal = () => {
        const target = document.getElementById(entry.id);
        if (!target) {
          window.thArchiveSetToolStatus('没有找到 ' + (entry.label || entry.floor || '目标楼层'));
          return;
        }
        target.scrollIntoView({ block: 'start', behavior: options && options.instant ? 'auto' : 'smooth' });
        target.classList.add('th-bookmark-flash');
        setTimeout(() => target.classList.remove('th-bookmark-flash'), 1500);
        if (!options || options.updateHash !== false) window.thArchiveUpdateLocationHash(entry);
        window.thArchiveSetFloorInput(entry);
        window.thArchiveSetToolStatus('当前位置：' + (entry.label || ('#' + entry.floor)));
      };
      setTimeout(reveal, 30);
      setTimeout(reveal, 180);
      return true;
    };
    window.thArchiveSaveBookmark = function() {
      const entry = window.thArchiveCurrentEntry();
      if (!entry) {
        window.thArchiveSetToolStatus('当前没有可标记的楼层');
        return;
      }
      const bookmark = {
        id: entry.id,
        floor: entry.floor,
        page: entry.page,
        label: entry.label || ('#' + entry.floor),
        time: new Date().toLocaleString(),
      };
      window.thArchiveUpdateLocationHash(bookmark);
      window.thArchiveSetFloorInput(bookmark);
      const code = window.thArchiveBookmarkCode(bookmark);
      if (window.thArchiveWriteBookmark(bookmark)) {
        window.thArchiveSetToolStatus('书签：' + code + '（已保存）');
      } else {
        window.thArchiveSetToolStatus('书签码：' + code + '，浏览器未保存');
      }
    };
    window.thArchiveGoBookmark = function() {
      const bookmark = window.thArchiveReadBookmark() || window.thArchiveReadHashEntry();
      if (!bookmark) {
        window.thArchiveSetToolStatus('还没有书签；也可以输入楼层跳转');
        return;
      }
      window.thArchiveRevealEntry(bookmark);
    };
    window.thArchiveUpdateBookmarkStatus = function() {
      const bookmark = window.thArchiveReadBookmark() || window.thArchiveReadHashEntry();
      if (bookmark) {
        window.thArchiveSetFloorInput(bookmark);
        window.thArchiveSetToolStatus('书签：' + window.thArchiveBookmarkCode(bookmark));
      } else {
        window.thArchiveSetToolStatus('尚未标记');
      }
    };
    window.thArchiveBindReaderTools = function() {
      if (document.body.dataset.thReaderToolsBound === 'true') {
        window.thArchiveUpdateBookmarkStatus();
        return;
      }
      document.body.dataset.thReaderToolsBound = 'true';
      document.addEventListener('click', event => {
        const jumpButton = event.target.closest('[data-floor-jump]');
        if (jumpButton) {
          event.preventDefault();
          const input = document.querySelector('[data-floor-input]');
          const entry = window.thArchiveFindEntryByFloor(input ? input.value : '');
          if (!entry) {
            window.thArchiveSetToolStatus('本 HTML 里没有这个楼层');
            return;
          }
          window.thArchiveRevealEntry(entry);
          return;
        }
        if (event.target.closest('[data-bookmark-save]')) {
          event.preventDefault();
          window.thArchiveSaveBookmark();
          return;
        }
        if (event.target.closest('[data-bookmark-go]')) {
          event.preventDefault();
          window.thArchiveGoBookmark();
          return;
        }
        if (event.target.closest('[data-bookmark-copy]')) {
          event.preventDefault();
          window.thArchiveCopyBookmarkCode(window.thArchiveReadBookmark() || window.thArchiveReadHashEntry() || window.thArchiveCurrentEntry());
        }
      });
      document.addEventListener('keydown', event => {
        const input = event.target.closest && event.target.closest('[data-floor-input]');
        if (input && event.key === 'Enter') {
          event.preventDefault();
          const entry = window.thArchiveFindEntryByFloor(input.value);
          if (entry) window.thArchiveRevealEntry(entry);
          else window.thArchiveSetToolStatus('本 HTML 里没有这个楼层');
        }
      });
      window.thArchiveUpdateBookmarkStatus();
    };
    window.thArchiveOpenHashBookmark = function() {
      const entry = window.thArchiveReadHashEntry();
      if (!entry) return;
      setTimeout(() => window.thArchiveRevealEntry(entry, { instant: true, updateHash: false }), 90);
      setTimeout(() => window.thArchiveRevealEntry(entry, { instant: true, updateHash: false }), 260);
    };
    window.thArchiveRunPageStep = function(label, handler, scope) {
      if (typeof handler !== 'function') return true;
      try {
        handler(scope);
        return true;
      } catch (error) {
        console.error('HTML 分页后处理失败：' + label, error);
        const container = scope && scope.querySelector ? scope : document.querySelector('[data-page-container]');
        if (container && !container.querySelector('[data-archive-step-error="' + label + '"]')) {
          const note = document.createElement('div');
          note.className = 'archive-page-warning';
          note.dataset.archiveStepError = label;
          note.textContent = '这一页已载入，但“' + label + '”后处理失败；正文已保留，可把控制台错误发给猴猴排查。';
          container.insertBefore(note, container.firstChild);
        }
        return false;
      }
    };
    window.thArchiveLoadPage = function(page) {
      const container = document.querySelector('[data-page-container]');
      const dataNode = document.querySelector('[data-page-data="' + page + '"]');
      if (!container || !dataNode) return false;
      if (container.dataset.currentPage === String(page)) return true;
      try {
        container.innerHTML = JSON.parse(dataNode.textContent || '""');
      } catch (error) {
        container.innerHTML = '<div class="archive-page-loading">这一页载入失败，请重新导出 HTML。</div>';
        console.error('HTML 分页载入失败', error);
        return true;
      }
      container.dataset.currentPage = String(page);
      document.body.classList.add('th-lazy-pages');
      container.querySelectorAll('.message[data-page]').forEach(article => {
        article.classList.add('is-page-active');
      });
      window.thArchiveRunPageStep('清理代码围栏', window.thArchiveCleanFenceArtifacts, container);
      window.thArchiveRunPageStep('文本分段', window.thArchiveFormatPlainTextBlocks, container);
      window.thArchiveRunPageStep('首楼小组件', window.thArchiveRenderOpeningWidgets, container);
      window.thArchiveRunPageStep('HTML代码块渲染', window.thArchiveRenderHtmlCodeBlocks, container);
      window.thArchiveRunPageStep('折叠块绑定', window.thArchivePostProcessArchiveBlocks, container);
      return true;
    };
    window.thArchiveShowPage = function(page, options) {
      const body = document.body;
      if (!body) return;
      const total = Math.max(1, parseInt(body.dataset.totalPages || '1', 10) || 1);
      if (total <= 1) {
        window.thArchiveLoadPage(1);
        return;
      }
      const next = Math.min(total, Math.max(1, parseInt(page, 10) || 1));
      body.dataset.currentPage = String(next);
      body.classList.add('th-paged-ready');
      const lazyLoaded = window.thArchiveLoadPage(next);
      if (!lazyLoaded) {
        document.querySelectorAll('.message[data-page]').forEach(article => {
          article.classList.toggle('is-page-active', article.dataset.page === String(next));
        });
      }
      document.querySelectorAll('[data-page-status]').forEach(item => {
        item.textContent = '第 ' + next + ' / ' + total + ' 页';
      });
      document.querySelectorAll('[data-page-action="prev"]').forEach(button => {
        button.disabled = next <= 1;
      });
      document.querySelectorAll('[data-page-action="next"]').forEach(button => {
        button.disabled = next >= total;
      });
      document.querySelectorAll('[data-page-jump]').forEach(button => {
        button.setAttribute('aria-current', button.dataset.pageJump === String(next) ? 'page' : 'false');
      });
      document.querySelectorAll('[data-page-select]').forEach(select => {
        select.value = String(next);
      });
      if (!options || options.updateHash !== false) {
        try {
          history.replaceState(null, '', '#page-' + next);
        } catch (error) {
          location.hash = 'page-' + next;
        }
      }
      if (options && options.scroll) {
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
          window.scrollTo(0, 0);
        }
      }
      if (typeof window.bindThExportFrames === 'function') window.bindThExportFrames();
      const activeScope = document.querySelector('[data-page-container]') || document;
      window.thArchiveRunPageStep('清理代码围栏', window.thArchiveCleanFenceArtifacts, activeScope);
      window.thArchiveRunPageStep('文本分段', window.thArchiveFormatPlainTextBlocks, activeScope);
      window.thArchiveRunPageStep('首楼小组件', window.thArchiveRenderOpeningWidgets, activeScope);
      window.thArchiveRunPageStep('HTML代码块渲染', window.thArchiveRenderHtmlCodeBlocks, activeScope);
      activeScope.querySelectorAll('.message.is-page-active iframe.th-export-frame, .message.is-page-active .message-content iframe[srcdoc]').forEach(frame => {
        window.resizeThExportFrame(frame);
        window.observeThExportFrame(frame);
        setTimeout(() => window.resizeThExportFrame(frame), 120);
        setTimeout(() => window.resizeThExportFrame(frame), 420);
      });
    };
    window.thArchiveBindPager = function() {
      const body = document.body;
      if (!body) return;
      const total = Math.max(1, parseInt(body.dataset.totalPages || '1', 10) || 1);
      if (total <= 1) {
        window.thArchiveLoadPage(1);
        return;
      }
      if (body.dataset.thPagerBound !== 'true') {
        body.dataset.thPagerBound = 'true';
        document.addEventListener('click', event => {
          const actionButton = event.target.closest('[data-page-action]');
          if (actionButton) {
            event.preventDefault();
            const current = parseInt(document.body.dataset.currentPage || '1', 10) || 1;
            const direction = actionButton.dataset.pageAction === 'prev' ? -1 : 1;
            window.thArchiveShowPage(current + direction, { scroll: true });
            return;
          }
          const jumpButton = event.target.closest('[data-page-jump]');
          if (jumpButton) {
            event.preventDefault();
            window.thArchiveShowPage(jumpButton.dataset.pageJump, { scroll: true });
          }
        });
        document.addEventListener('change', event => {
          const select = event.target.closest && event.target.closest('[data-page-select]');
          if (!select) return;
          event.preventDefault();
          window.thArchiveShowPage(select.value, { scroll: true });
        });
      }
      const match = String(location.hash || '').match(/page-(\\d+)/);
      const initialPage = match ? Number(match[1]) : 1;
      window.thArchiveShowPage(initialPage, { updateHash: false, scroll: false });
    };
    window.thArchiveBoot = function() {
      window.thArchiveBindPager();
      window.thArchiveBindReaderTools();
      window.thArchiveOpenHashBookmark();
      const activeScope = document.querySelector('[data-page-container]') || document;
      window.thArchiveRunPageStep('清理代码围栏', window.thArchiveCleanFenceArtifacts, activeScope);
      window.thArchiveRunPageStep('文本分段', window.thArchiveFormatPlainTextBlocks, activeScope);
      window.thArchiveRunPageStep('首楼小组件', window.thArchiveRenderOpeningWidgets, activeScope);
      window.thArchiveRunPageStep('HTML代码块渲染', window.thArchiveRenderHtmlCodeBlocks, activeScope);
      window.thArchiveRunPageStep('折叠块绑定', window.thArchivePostProcessArchiveBlocks, activeScope);
      window.thArchiveRunPageStep('二次清理代码围栏', window.thArchiveCleanFenceArtifacts, activeScope);
      window.thArchiveRunPageStep('iframe绑定', window.bindThExportFrames, activeScope);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', window.thArchiveBoot);
    } else {
      window.thArchiveBoot();
    }
`}
  ${'</scr' + 'ipt>'}
</head>
<body${bodyAttributes}>
  <main class="archive-shell">
    <section class="archive-title">
      <div>
        <h1>${title}</h1>
      </div>
      <div class="archive-subtitle">
        <div>${escapeHtml(subtitleCharacterName)} / ${escapeHtml(subtitleChatTitle)}</div>
        <div>导出时间：${escapeHtml(new Date().toLocaleString())}</div>
      </div>
    </section>
    ${buildReaderTools(pageData)}
    ${nav}
    ${messageHtml}
    ${nav}
    ${messageIndexScript}
  </main>
</body>
</html>`;
  }

  function buildExportFiles(messages, settings, rules, diagnostics, context) {
    const baseName = resolveFilename(settings.filename, context);
    const perFile = Math.max(1, parseInt(settings.messagesPerFile, 10) || 50);
    const files = [];
    const metaContext = context || {
      characterName: getCharacterName(),
      userName: getUserName(),
      chatTitle: getChatTitle(),
    };

    if (settings.singleFilePagination) {
      const internalPages = Math.max(1, Math.ceil(messages.length / perFile));
      diagnostics.counts.files = 1;
      diagnostics.counts.internalPages = internalPages;
      const html = buildHtmlDocument(messages, {
        title: baseName,
        baseName,
        part: 1,
        totalParts: 1,
        settings,
        rules,
        diagnostics,
        characterName: metaContext.characterName,
        userName: metaContext.userName,
        chatTitle: metaContext.chatTitle,
      });
      files.push({
        name: buildSingleFileName(baseName),
        html,
      });
      return {
        baseName,
        files,
        fileCount: 1,
        internalPages,
      };
    }

    const totalParts = Math.ceil(messages.length / perFile);
    diagnostics.counts.files = totalParts;
    diagnostics.counts.internalPages = 0;
    for (let part = 1; part <= totalParts; part += 1) {
      const chunk = messages.slice((part - 1) * perFile, part * perFile);
      const html = buildHtmlDocument(chunk, {
        title: baseName,
        baseName,
        part,
        totalParts,
        settings,
        rules,
        diagnostics,
        characterName: metaContext.characterName,
        userName: metaContext.userName,
        chatTitle: metaContext.chatTitle,
      });
      files.push({
        name: buildPartName(baseName, part, totalParts),
        html,
      });
    }
    return {
      baseName,
      files,
      fileCount: totalParts,
      internalPages: 0,
    };
  }

  function createDownloadUrl(content, type) {
    const host = getHostWindow();
    const BlobCtor = host.Blob || Blob;
    const urlApi = host.URL || URL;
    const blob = new BlobCtor(['\uFEFF', content], { type: type || 'text/html;charset=utf-8' });
    return {
      blob,
      url: urlApi.createObjectURL(blob),
      urlApi,
    };
  }

  function autoDownloadFiles(files, diagnostics) {
    const hostDocument = getHostDocument();
    const entries = [];
    bumpDiagnosticCount(diagnostics, 'downloadLinks', files.length);
    bumpDiagnosticCount(diagnostics, 'autoDownloadAttempts', files.length);
    files.forEach((file, index) => {
      const entry = createDownloadUrl(file.html, 'text/html;charset=utf-8');
      entry.name = file.name;
      entries.push(entry);
      setTimeout(() => {
        try {
          const link = hostDocument.createElement('a');
          link.href = entry.url;
          link.download = entry.name || `聊天记录_${index + 1}.html`;
          link.style.display = 'none';
          hostDocument.body.appendChild(link);
          link.click();
          link.remove();
        } catch (error) {
          pushDiagnostic(diagnostics, 'warning', `自动下载 ${entry.name || `文件 ${index + 1}`} 失败：${getErrorMessage(error)}`);
        }
      }, index * 320);
      setTimeout(() => {
        try {
          if (entry.urlApi && typeof entry.urlApi.revokeObjectURL === 'function') {
            entry.urlApi.revokeObjectURL(entry.url);
          }
        } catch (error) {
          console.warn(`[${SCRIPT_NAME}] 释放聊天文件导出链接失败`, error);
        }
      }, Math.max(60000, files.length * 800));
    });
    return entries;
  }

  function getCurrentCharacterNameForChatList() {
    const host = getHostWindow();
    const hostDocument = getHostDocument();
    try {
      if (host.SillyTavern && typeof host.SillyTavern.getContext === 'function') {
        const ctx = host.SillyTavern.getContext();
        if (ctx && ctx.characters && ctx.characterId !== undefined) {
          const character = ctx.characters[ctx.characterId];
          if (character && character.name) return character.name;
        }
      }
      if (host.characters && host.this_chid !== undefined) {
        const character = host.characters[host.this_chid];
        if (character && character.name) return character.name;
      }
      const nameElement = hostDocument.querySelector('#rm_button_selected_ch .character_name, #character_name_pole, .selected_ch .ch_name');
      if (nameElement && nameElement.textContent) return nameElement.textContent.trim();
      const popupTitle = hostDocument.querySelector('#select_chat_popup .popup_title, #shadow_select_chat_popup h3');
      if (popupTitle && popupTitle.textContent) {
        const match = popupTitle.textContent.match(/^(.+?)(?:\s*的)?聊天|Chats? (?:for|of) (.+)/i);
        if (match) return (match[1] || match[2] || '').trim();
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 推断聊天列表角色名失败`, error);
    }
    return '';
  }

  function generateFolderCandidates(baseName) {
    const cleanBase = String(baseName || '').trim();
    return uniqueList([
      cleanBase,
      cleanBase ? `default_${cleanBase}` : '',
      cleanBase ? `${cleanBase}1` : '',
      cleanBase ? `${cleanBase}2` : '',
      cleanBase ? `${cleanBase}_1` : '',
      cleanBase ? cleanBase.replace(/ /g, '_') : '',
    ]);
  }

  function extractCharNameFromFileName(fileName) {
    const hostDocument = getHostDocument();
    const targetFileName = String(fileName || '').trim();
    const cleanTarget = targetFileName.replace(/\.jsonl$/i, '');
    const isBranchOrTime = cleanTarget.startsWith('Branch') || /^\d/.test(cleanTarget) || !cleanTarget.includes(' - ');
    if (!isBranchOrTime) return cleanTarget.split(' - ')[0].trim();

    const allBlocks = hostDocument.querySelectorAll('.select_chat_block');
    for (let index = 0; index < allBlocks.length; index += 1) {
      const blockName = getChatBlockFileName(allBlocks[index]).replace(/\.jsonl$/i, '');
      if (!blockName) continue;
      if (!blockName.startsWith('Branch') && !/^\d/.test(blockName) && blockName.includes(' - ')) {
        return blockName.split(' - ')[0].trim();
      }
    }
    return cleanTarget.split(' - ')[0].trim();
  }

  function getChatBlockFileName(block) {
    if (!block) return '';
    const attrNames = ['file_name', 'data-file-name', 'data-filename', 'data-name'];
    for (const attr of attrNames) {
      const value = block.getAttribute && block.getAttribute(attr);
      if (value && String(value).trim()) return String(value).trim();
    }
    const nameElement = block.querySelector && block.querySelector('.select_chat_block_filename');
    if (nameElement && nameElement.textContent) return nameElement.textContent.trim();
    return '';
  }

  function getChatFileSearchContext(block) {
    const requestedFileName = getChatBlockFileName(block);
    if (!requestedFileName) throw new Error('没有从聊天列表中读取到文件名。');
    const chatTitle = requestedFileName.replace(/\.jsonl$/i, '');
    const characterName = getCurrentCharacterNameForChatList() || extractCharNameFromFileName(requestedFileName) || getCharacterName();
    const fileVariants = uniqueList([
      requestedFileName,
      chatTitle,
      `${chatTitle}.jsonl`,
    ]);
    return {
      requestedFileName,
      chatTitle,
      characterName,
      userName: getUserName(),
      folderCandidates: generateFolderCandidates(characterName),
      fileVariants,
    };
  }

  async function requestChatFileRaw(payload) {
    const host = getHostWindow();
    const $ = host.jQuery || host.$ || window.jQuery || window.$;
    if ($ && typeof $.ajax === 'function') {
      return await new Promise((resolve) => {
        $.ajax({
          type: 'POST',
          url: '/api/chats/get',
          data: JSON.stringify(payload),
          contentType: 'application/json',
          dataType: 'text',
          success: (data) => resolve(data),
          error: () => resolve(null),
        });
      });
    }
    if (typeof host.fetch === 'function') {
      const response = await host.fetch('/api/chats/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response || !response.ok) return null;
      return await response.text();
    }
    throw new Error('没有找到可用的请求方法，无法读取聊天文件。');
  }

  function parseChatFileResponse(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text || text === '{}') return [];
    try {
      let parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.lines)) parsed = parsed.lines;
      if (parsed && Array.isArray(parsed.chat)) parsed = parsed.chat;
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      // JSONL falls through to line parsing.
    }
    const lines = [];
    text.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        lines.push(JSON.parse(trimmed));
      } catch (error) {
        // Ignore malformed rows and let the caller decide whether enough data was found.
      }
    });
    return lines;
  }

  function getChatFileMetadata(lines) {
    return (lines || []).find((line) => line && typeof line === 'object' && (
      line.user_name || line.character_name || line.ch_name || line.chat_metadata
    )) || {};
  }

  function normalizeChatFileMessages(lines, settings, context) {
    const metadata = getChatFileMetadata(lines);
    const characterName = metadata.character_name || metadata.ch_name || context.characterName || getCharacterName();
    const userName = metadata.user_name || context.userName || getUserName();
    const rawMessages = (lines || [])
      .filter((message) => message && typeof message === 'object')
      .filter((message) => String(getMessageText(message) || '').trim());

    const prepared = rawMessages.map((message, index) => {
      const copy = Object.assign({}, message);
      copy.__export_id = getMessageId(copy, index);
      return copy;
    });
    const lastId = prepared.reduce((max, message, index) => {
      const id = getMessageId(message, index);
      return Number.isFinite(id) ? Math.max(max, id) : max;
    }, Math.max(0, prepared.length - 1));

    const messages = prepared.filter((message, index) => {
      const role = getMessageRole(message);
      const hidden = isMessageHidden(message);
      if (hidden && !settings.includeHidden) return false;
      if (role === 'user' && !settings.includeUser) return false;
      if (role === 'assistant' && !settings.includeAssistant) return false;
      if (role === 'system' && !settings.includeSystem) return false;
      const id = getMessageId(message, index);
      message.__export_id = id;
      message.__export_depth = Number.isFinite(id) ? Math.max(0, lastId - id) : index;
      message.__export_file_mode = true;
      message.__export_character_name = characterName;
      message.__export_user_name = userName;
      if (!message.name || message.name === 'Unknown') {
        message.name = role === 'user' ? userName : characterName;
      }
      return true;
    });

    return {
      messages,
      metadata,
      characterName,
      userName,
      chatTitle: context.chatTitle,
    };
  }

  async function fetchChatFileMessages(searchContext, settings, diagnostics) {
    for (const folder of searchContext.folderCandidates) {
      for (const avatarUrl of ['', folder]) {
        for (const fileName of searchContext.fileVariants) {
          bumpDiagnosticCount(diagnostics, 'chatFileReadAttempts', 1);
          const raw = await requestChatFileRaw({
            ch_name: folder,
            file_name: fileName,
            avatar_url: avatarUrl,
          });
          const lines = parseChatFileResponse(raw);
          if (!lines.length) continue;
          const normalized = normalizeChatFileMessages(lines, settings, searchContext);
          if (normalized.messages.length) {
            return Object.assign(normalized, {
              folder,
              resolvedFileName: fileName,
            });
          }
        }
      }
    }
    throw new Error(`读取失败：没有找到 ${searchContext.requestedFileName} 的聊天内容。`);
  }

  function setChatExportButtonState(button, busy, label) {
    if (!button) return;
    if (!button.dataset.thOriginalHtml) button.dataset.thOriginalHtml = button.innerHTML;
    button.disabled = Boolean(busy);
    button.classList.toggle('is-busy', Boolean(busy));
    button.innerHTML = busy
      ? `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(label || '导出中')}`
      : button.dataset.thOriginalHtml;
  }

  async function exportChatFileFromBlock(block, button) {
    if (!block || button && button.disabled) return;
    let diagnostics = null;
    let settings = null;
    setChatExportButtonState(button, true, '读取中');
    try {
      settings = loadSettings();
      diagnostics = createDiagnostics(settings);
      diagnostics.source.mode = '聊天文件';
      const searchContext = getChatFileSearchContext(block);
      diagnostics.source.fileName = searchContext.requestedFileName;
      const rules = compileRules(settings);
      const fileData = await fetchChatFileMessages(searchContext, settings, diagnostics);
      diagnostics.source.folder = fileData.folder;
      diagnostics.source.fileName = fileData.resolvedFileName || searchContext.requestedFileName;
      diagnostics.counts.messages = fileData.messages.length;
      pushDiagnostic(diagnostics, 'warning', '这是未打开聊天文件导出：不会读取当前窗口 DOM，已改用酒馆渲染接口、原文和 user 保底。');
      setChatExportButtonState(button, true, '生成中');
      const exportResult = buildExportFiles(fileData.messages, settings, rules, diagnostics, {
        characterName: fileData.characterName,
        userName: fileData.userName,
        chatTitle: fileData.chatTitle,
      });
      if (exportResult.files.length > 10) {
        pushDiagnostic(diagnostics, 'warning', `本次将下载 ${exportResult.files.length} 个 HTML，浏览器可能会拦截多个下载。建议开启“整本HTML内分页”。`);
      }
      autoDownloadFiles(exportResult.files, diagnostics);
      console.log(formatDiagnostics(diagnostics, diagnostics.warnings.length ? '完成（有提示）' : '完成'));
      notify('success', `已为 ${searchContext.requestedFileName} 生成 ${exportResult.files.length} 个 HTML 下载。`);
    } catch (error) {
      if (!diagnostics) diagnostics = createDiagnostics(settings || loadSettings());
      pushDiagnostic(diagnostics, 'error', getErrorMessage(error));
      console.error(`[${SCRIPT_NAME}] 聊天文件导出失败`, error);
      console.log(formatDiagnostics(diagnostics, '失败'));
      notify('error', `聊天文件导出失败：${getErrorMessage(error)}`);
    } finally {
      setChatExportButtonState(button, false);
    }
  }

  function openChatFilePanelFromButton(button) {
    const block = button && button.closest ? button.closest('.select_chat_block') : null;
    try {
      const searchContext = getChatFileSearchContext(block);
      safeOpenPanel({ chatFileSearchContext: searchContext });
    } catch (error) {
      notify('error', `打开聊天文件导出设置失败：${getErrorMessage(error)}`);
    }
  }

  function bindChatListExportButton(button) {
    if (!button) return;
    button.onclick = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
      openChatFilePanelFromButton(button);
      return false;
    };
  }

  function addChatListExportButtons() {
    const hostDocument = getHostDocument();
    const blocks = hostDocument.querySelectorAll('.select_chat_block');
    blocks.forEach((block) => {
      const existingButton = block.querySelector('.th-chat-export-btn');
      if (existingButton) {
        existingButton.title = '不打开聊天，先设置再导出这个聊天文件';
        if (!existingButton.classList.contains('is-busy')) {
          existingButton.innerHTML = '<i class="fa-solid fa-file-export"></i> 设置导出';
          existingButton.dataset.thOriginalHtml = existingButton.innerHTML;
        }
        bindChatListExportButton(existingButton);
        return;
      }
      const fileName = getChatBlockFileName(block);
      if (!fileName) return;
      const button = hostDocument.createElement('button');
      button.type = 'button';
      button.className = 'th-chat-export-btn';
      button.title = '不打开聊天，先设置再导出这个聊天文件';
      button.innerHTML = '<i class="fa-solid fa-file-export"></i> 设置导出';
      bindChatListExportButton(button);
      const nameElement = block.querySelector('.select_chat_block_filename');
      if (nameElement) {
        nameElement.insertAdjacentElement('afterend', button);
      } else {
        block.insertBefore(button, block.firstChild);
      }
    });
  }

  function scheduleChatListExportRefresh() {
    if (chatListExportRefreshTimer) return;
    const host = getHostWindow();
    chatListExportRefreshTimer = host.setTimeout(() => {
      chatListExportRefreshTimer = null;
      addChatListExportButtons();
    }, 180);
  }

  function installChatListExportEnhancer() {
    const host = getHostWindow();
    const hostDocument = getHostDocument();
    if (!hostDocument.body) return;
    const handlerKey = '__thHtmlExporterChatListPanelClickHandler';
    if (host[handlerKey]) {
      try {
        host.removeEventListener('click', host[handlerKey], true);
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 移除旧聊天列表监听失败`, error);
      }
    }
    host[handlerKey] = (event) => {
      const button = event.target && event.target.closest && event.target.closest('.th-chat-export-btn');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      openChatFilePanelFromButton(button);
    };
    host.addEventListener('click', host[handlerKey], true);
    hostDocument.body.dataset.thHtmlExporterChatListPanelBound = SCRIPT_VERSION;
    scheduleChatListExportRefresh();
    if (!chatListExportObserver) {
      const Observer = host.MutationObserver || window.MutationObserver;
      if (Observer) {
        chatListExportObserver = new Observer(scheduleChatListExportRefresh);
        chatListExportObserver.observe(hostDocument.body, { childList: true, subtree: true });
      }
    }
  }

  function collectSettingsFromPanel($panel) {
    const settings = loadSettings();
    settings.filename = String($panel.find('[data-field="filename"]').val() || '').trim() || DEFAULT_SETTINGS.filename;
    settings.messagesPerFile = parseInt($panel.find('[data-field="messagesPerFile"]').val(), 10) || 50;
    settings.singleFilePagination = $panel.find('[data-toggle="singleFilePagination"]').attr('aria-pressed') === 'true';
    settings.panelTheme = $panel.attr('data-panel-theme') === 'day' ? 'day' : 'night';
    settings.advancedOpen = $panel.find('.th-advanced-settings').prop('open') === true;
    settings.includeUser = $panel.find('[data-toggle="includeUser"]').attr('aria-pressed') === 'true';
    settings.includeAssistant = $panel.find('[data-toggle="includeAssistant"]').attr('aria-pressed') === 'true';
    settings.includeSystem = $panel.find('[data-toggle="includeSystem"]').attr('aria-pressed') === 'true';
    settings.includeHidden = $panel.find('[data-toggle="includeHidden"]').attr('aria-pressed') === 'true';
    settings.renderRawHtml = $panel.find('[data-toggle="renderRawHtml"]').attr('aria-pressed') === 'true';
    settings.applyTavernDisplay = $panel.find('[data-toggle="applyTavernDisplay"]').attr('aria-pressed') === 'true';
    settings.forceRegexDepth = $panel.find('[data-toggle="forceRegexDepth"]').attr('aria-pressed') === 'true';
    settings.userReadableFallback = $panel.find('[data-toggle="userReadableFallback"]').attr('aria-pressed') === 'true';
    settings.userExtractTags = String($panel.find('[data-field="userExtractTags"]').val() || DEFAULT_SETTINGS.userExtractTags);
    settings.userExcludeTags = String($panel.find('[data-field="userExcludeTags"]').val() || DEFAULT_SETTINGS.userExcludeTags);
    settings.allowScripts = $panel.find('[data-toggle="allowScripts"]').attr('aria-pressed') === 'true';
    settings.renderOpeningWidget = $panel.find('[data-toggle="renderOpeningWidget"]').attr('aria-pressed') === 'true';
    settings.escapeCaptures = $panel.find('[data-toggle="escapeCaptures"]').attr('aria-pressed') === 'true';
    settings.exportTheme = String($panel.find('[data-theme][aria-pressed="true"]').attr('data-theme') || DEFAULT_SETTINGS.exportTheme);
    settings.customCss = String($panel.find('[data-field="customCss"]').val() || '');
    settings.rules = [];
    $panel.find('.th-rule').each(function () {
      const $rule = get$()(this);
      settings.rules.push({
        enabled: $rule.find('[data-rule-toggle="enabled"]').attr('aria-pressed') === 'true',
        name: String($rule.find('[data-rule-field="name"]').val() || '').trim(),
        pattern: String($rule.find('[data-rule-field="pattern"]').val() || ''),
        flags: String($rule.find('[data-rule-field="flags"]').val() || 'gs').trim(),
        replacement: String($rule.find('[data-rule-field="replacement"]').val() || ''),
      });
    });
    return normalizeSettings(settings);
  }

  function buildToggle(name, label, active) {
    return `<button type="button" class="th-toggle" data-toggle="${escapeAttr(name)}" aria-pressed="${active ? 'true' : 'false'}"><span class="th-toggle-mark"></span><span class="th-toggle-label">${escapeHtml(label)}</span><strong class="th-toggle-state">${active ? '已启用' : '已关闭'}</strong></button>`;
  }

  function getPanelTheme(settings) {
    return settings && settings.panelTheme === 'day' ? 'day' : 'night';
  }

  function buildPanelThemeButton(settings) {
    const panelTheme = getPanelTheme(settings);
    const title = panelTheme === 'day' ? '切换夜间面板' : '切换白天面板';
    const icon = panelTheme === 'day' ? 'fa-moon' : 'fa-sun';
    return `<button type="button" class="th-icon-btn th-panel-theme-toggle" data-action="toggle-panel-theme" title="${title}" aria-label="${title}"><i class="fa-solid ${icon}"></i></button>`;
  }

  function buildThemeButton(value, settings) {
    const theme = EXPORT_THEMES[value];
    const active = ((settings && settings.exportTheme) || DEFAULT_SETTINGS.exportTheme) === value;
    const swatches = theme.swatch.map((color) => `<span style="background:${escapeAttr(color)}"></span>`).join('');
    return `<button type="button" class="th-theme-option" data-theme="${escapeAttr(value)}" aria-pressed="${active ? 'true' : 'false'}"><span class="th-theme-swatch">${swatches}</span><span class="th-theme-name">${escapeHtml(theme.label)}</span><strong class="th-theme-state">${active ? '已选择' : ''}</strong></button>`;
  }

  function buildPanelTargetBanner(options) {
    const target = options && options.chatFileSearchContext;
    if (!target) return '';
    return `
        <section class="th-target-banner">
          <span><i class="fa-solid fa-folder-open"></i> 未打开聊天文件</span>
          <strong>${escapeHtml(target.requestedFileName || target.chatTitle || '未知文件')}</strong>
        </section>`;
  }

  function buildPanelHtml(settings, options) {
    const panelTheme = getPanelTheme(settings);
    return `
      <div class="th-exporter" data-panel-theme="${panelTheme}">
        <header class="th-head">
          <div>
            <div class="th-title"><i class="fa-solid fa-file-export"></i> 聊天记录 HTML 导出器 <span class="th-version">${SCRIPT_VERSION}</span></div>
            <div class="th-subtitle">当前聊天：${escapeHtml(getChatTitle())}</div>
          </div>
          <div class="th-head-actions">
            <button type="button" class="th-primary" data-action="export"><i class="fa-solid fa-download"></i> 导出HTML</button>
            ${buildPanelThemeButton(settings)}
            <button type="button" class="th-icon-btn" data-action="minimize" title="缩小成按钮" aria-label="缩小成按钮"><i class="fa-solid fa-window-minimize"></i></button>
            <button type="button" class="th-icon-btn" data-action="close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </header>
        ${buildPanelTargetBanner(options)}

        <section class="th-card">
          <div class="th-card-title">基础设置</div>
          <div class="th-grid">
            <div class="th-field">
              <span>导出文件名</span>
              <input data-field="filename" type="text" value="${escapeAttr(settings.filename)}" placeholder="{{char}}_{{chat}}">
            </div>
            <div class="th-field compact">
              <span>每页/每个 HTML 消息数</span>
              <input data-field="messagesPerFile" type="number" min="1" max="5000" step="1" value="${escapeAttr(settings.messagesPerFile)}">
            </div>
          </div>
          <div class="th-toggle-grid th-basic-toggles">
            ${buildToggle('singleFilePagination', '整本HTML内分页', settings.singleFilePagination)}
          </div>
        </section>

        <section class="th-card">
          <div class="th-card-title">导出外观</div>
          <div class="th-theme-grid">
            ${buildThemeButton('eye', settings)}
            ${buildThemeButton('white', settings)}
            ${buildThemeButton('dark', settings)}
          </div>
        </section>

        <div class="th-two-col">
          <section class="th-card">
            <div class="th-card-title">内容范围</div>
            <div class="th-toggle-grid">
              ${buildToggle('includeUser', '用户消息', settings.includeUser)}
              ${buildToggle('includeAssistant', '角色消息', settings.includeAssistant)}
              ${buildToggle('includeSystem', 'system 消息', settings.includeSystem)}
              ${buildToggle('includeHidden', '隐藏楼层', settings.includeHidden)}
            </div>
          </section>

          <section class="th-card">
            <div class="th-card-title">渲染方式</div>
            <div class="th-toggle-grid">
              ${buildToggle('applyTavernDisplay', '套用酒馆显示效果', settings.applyTavernDisplay)}
              ${buildToggle('renderRawHtml', '原文按HTML显示', settings.renderRawHtml)}
              ${buildToggle('forceRegexDepth', '强制渲染旧楼层', settings.forceRegexDepth)}
              ${buildToggle('userReadableFallback', 'user保底提取', settings.userReadableFallback)}
              ${buildToggle('escapeCaptures', '捕获内容转义', settings.escapeCaptures)}
              ${buildToggle('allowScripts', '允许脚本运行', settings.allowScripts)}
              ${buildToggle('renderOpeningWidget', '实验：首楼小组件', settings.renderOpeningWidget)}
            </div>
          </section>
        </div>

        <section class="th-card">
          <div class="th-card-title">user 楼层保底</div>
          <div class="th-grid">
            <div class="th-field">
              <span>优先提取标签</span>
              <input data-field="userExtractTags" type="text" value="${escapeAttr(settings.userExtractTags || DEFAULT_SETTINGS.userExtractTags)}" placeholder="本轮用户输入">
            </div>
            <div class="th-field">
              <span>排除标签</span>
              <input data-field="userExcludeTags" type="text" value="${escapeAttr(settings.userExcludeTags || DEFAULT_SETTINGS.userExcludeTags)}" placeholder="recall, supplement, meta:检定结果">
            </div>
          </div>
        </section>

        <details class="th-advanced-settings"${settings.advancedOpen ? ' open' : ''}>
          <summary>
            <span><i class="fa-solid fa-sliders"></i> 高级设置</span>
            <strong>正则规则 / 自定义 CSS</strong>
          </summary>

          <section class="th-card th-advanced-card">
            <div class="th-section-head">
              <div class="th-card-title"><i class="fa-solid fa-code"></i> 正则渲染规则</div>
              <button type="button" class="th-ghost" data-action="add-rule"><i class="fa-solid fa-plus"></i> 添加规则</button>
            </div>
            <div class="th-rule-list"></div>
          </section>

          <section class="th-card th-advanced-card">
            <div class="th-field">
              <span>导出 HTML 自定义 CSS</span>
              <textarea data-field="customCss" rows="4" placeholder=".my-card { color: #345995; }">${escapeHtml(settings.customCss || '')}</textarea>
            </div>
          </section>
        </details>

        <footer class="th-footer">
          <span class="th-export-status"></span>
          <button type="button" class="th-ghost danger" data-action="reset"><i class="fa-solid fa-rotate-left"></i> 重置</button>
        </footer>

        <section class="th-downloads" hidden>
          <div class="th-downloads-head">
            <div class="th-card-title"><i class="fa-solid fa-file-arrow-down"></i> 导出文件</div>
            <span class="th-downloads-note">如果没有自动下载，请点文件名保存；不支持保存窗口时会打开预览页。</span>
          </div>
          <div class="th-download-list"></div>
        </section>

        <section class="th-diagnostics" hidden>
          <div class="th-diagnostics-head">
            <div class="th-card-title"><i class="fa-solid fa-stethoscope"></i> 诊断信息</div>
            <button type="button" class="th-ghost" data-action="copy-diagnostics"><i class="fa-solid fa-copy"></i> 复制诊断</button>
          </div>
          <pre class="th-diagnostics-text"></pre>
        </section>
      </div>`;
  }

  function buildRuleHtml(rule, index) {
    return `
      <article class="th-rule" data-rule-index="${index}">
        <div class="th-rule-top">
          <button type="button" class="th-toggle th-rule-enabled" data-rule-toggle="enabled" aria-pressed="${rule.enabled ? 'true' : 'false'}"><span class="th-toggle-mark"></span><span class="th-toggle-label">规则 ${index + 1}</span><strong class="th-toggle-state">${rule.enabled ? '已启用' : '已关闭'}</strong></button>
          <div class="th-rule-actions">
            <button type="button" title="上移" data-action="rule-up"><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" title="下移" data-action="rule-down"><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" title="删除" data-action="rule-delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="th-grid rule-grid">
          <div class="th-field">
            <span>规则名</span>
            <input data-rule-field="name" type="text" value="${escapeAttr(rule.name || '')}">
          </div>
          <div class="th-field compact">
            <span>flags</span>
            <input data-rule-field="flags" type="text" value="${escapeAttr(rule.flags || 'gs')}" placeholder="gs">
          </div>
        </div>
        <div class="th-field">
          <span>正则表达式</span>
          <textarea data-rule-field="pattern" rows="3" placeholder="<tag>([\\s\\S]*?)<\\/tag>">${escapeHtml(rule.pattern || '')}</textarea>
        </div>
        <div class="th-field">
          <span>渲染 HTML</span>
          <textarea data-rule-field="replacement" rows="3" placeholder="<div class=&quot;my-card&quot;>$1</div>">${escapeHtml(rule.replacement || '')}</textarea>
        </div>
      </article>`;
  }

  function injectStyle() {
    const hostDocument = getHostDocument();
    ['th-html-exporter-style-v1'].forEach((id) => {
      const oldStyle = hostDocument.getElementById(id);
      if (oldStyle) oldStyle.remove();
    });
    let style = hostDocument.getElementById(STYLE_ID);
    if (!style) {
      style = hostDocument.createElement('style');
      style.id = STYLE_ID;
      hostDocument.head.appendChild(style);
    }
    style.textContent = `
      .th-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(7, 10, 16, 0.72);
        backdrop-filter: blur(6px);
      }
      .th-modal-overlay.th-html-exporter-minimized {
        display: none;
      }
      .th-modal-card {
        width: min(1040px, calc(100vw - 32px));
        max-height: min(92vh, 960px);
        overflow: auto;
        border: 1px solid rgba(159, 177, 194, 0.25);
        border-radius: 10px;
        background: #171c25;
        color: #f2eee8;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
      }
      .th-exporter {
        color: #f2eee8;
        font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
        text-align: left;
        padding: 18px;
      }
      .th-exporter * { box-sizing: border-box; }
      .th-exporter .th-head {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 4px 4px 16px;
        border-bottom: 1px solid rgba(159, 177, 194, 0.18);
      }
      .th-title {
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .th-version {
        display: inline-flex;
        align-items: center;
        margin-left: 8px;
        padding: 2px 7px;
        border: 1px solid rgba(105, 185, 159, 0.45);
        border-radius: 999px;
        color: #9ee5ce;
        background: rgba(105, 185, 159, 0.12);
        font-size: 11px;
        font-weight: 800;
        vertical-align: middle;
      }
      .th-subtitle {
        margin-top: 5px;
        color: #aeb8c5;
        font-size: 12px;
      }
      .th-head-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
      }
      .th-exporter .th-target-banner {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 14px;
        padding: 10px 12px;
        border: 1px solid rgba(105, 185, 159, 0.30);
        border-radius: 8px;
        background: rgba(105, 185, 159, 0.10);
        color: #dff7ee;
      }
      .th-exporter .th-target-banner span {
        display: inline-flex !important;
        align-items: center;
        gap: 6px;
        color: #9ee5ce;
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
      }
      .th-exporter .th-target-banner strong {
        min-width: 0;
        overflow: hidden;
        color: #f2eee8;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-exporter .th-card {
        margin-top: 14px;
        padding: 14px;
        border: 1px solid rgba(159, 177, 194, 0.18);
        border-radius: 8px;
        background: #202733;
      }
      .th-exporter .th-advanced-settings {
        margin-top: 14px;
        border: 1px solid rgba(159, 177, 194, 0.18);
        border-radius: 8px;
        background: #202733;
        overflow: hidden;
      }
      .th-exporter .th-advanced-settings > summary {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 44px;
        padding: 12px 14px;
        color: #f3c6b8;
        cursor: pointer;
        list-style: none;
        user-select: none;
      }
      .th-exporter .th-advanced-settings > summary::-webkit-details-marker {
        display: none;
      }
      .th-exporter .th-advanced-settings > summary::after {
        content: "+";
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border: 1px solid rgba(159, 177, 194, 0.28);
        border-radius: 999px;
        color: #9ee5ce;
        font-weight: 900;
      }
      .th-exporter .th-advanced-settings[open] > summary::after {
        content: "-";
      }
      .th-exporter .th-advanced-settings > summary span {
        display: inline-flex !important;
        align-items: center;
        gap: 7px;
        font-size: 13px;
        font-weight: 800;
      }
      .th-exporter .th-advanced-settings > summary strong {
        min-width: 0;
        overflow: hidden;
        color: #aeb8c5;
        font-size: 12px;
        font-weight: 700;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-exporter .th-advanced-card {
        margin: 0 14px 14px;
      }
      .th-card-title {
        margin-bottom: 12px;
        color: #f3c6b8;
        font-size: 13px;
        font-weight: 800;
      }
      .th-section-head .th-card-title {
        margin-bottom: 0;
      }
      .th-exporter .th-two-col {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .th-exporter .th-grid {
        display: grid !important;
        grid-template-columns: minmax(260px, 1fr) minmax(160px, 220px);
        gap: 12px;
        align-items: end;
      }
      .th-exporter .rule-grid { grid-template-columns: minmax(0, 1fr) 120px; margin-top: 12px; }
      .th-exporter .th-field {
        display: flex !important;
        flex-direction: column;
        align-items: stretch !important;
        gap: 7px;
        min-width: 0;
        width: auto !important;
        margin: 0 !important;
        text-align: left !important;
      }
      .th-exporter .th-field span {
        display: block !important;
        color: #cbd4df;
        font-size: 12px;
        font-weight: 700;
        text-align: left !important;
      }
      .th-exporter .th-field input,
      .th-exporter .th-field textarea {
        display: block !important;
        width: 100% !important;
        max-width: none !important;
        border: 1px solid rgba(159, 177, 194, 0.28);
        border-radius: 7px;
        background: #111722;
        color: #f2eee8;
        padding: 9px 10px;
        font: inherit;
        text-align: left !important;
        outline: none;
      }
      .th-exporter .th-field input:focus,
      .th-exporter .th-field textarea:focus {
        border-color: #69b99f;
        box-shadow: 0 0 0 2px rgba(105, 185, 159, 0.18);
      }
      .th-exporter .th-field textarea {
        resize: vertical;
        min-height: 84px;
        font-family: Consolas, "Cascadia Mono", monospace;
        font-size: 12px;
      }
      .th-exporter .th-toggle-grid {
        display: grid !important;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 8px;
      }
      .th-exporter .th-basic-toggles {
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        margin-top: 12px;
      }
      .th-exporter .th-toggle {
        display: grid !important;
        grid-template-columns: 16px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 38px;
        width: 100% !important;
        margin: 0 !important;
        padding: 8px 10px;
        border: 1px solid rgba(159, 177, 194, 0.28);
        border-radius: 8px;
        background: #151b25;
        color: #d7dee8;
        font: inherit;
        font-size: 13px;
        line-height: 1.25;
        text-align: left !important;
        cursor: pointer;
      }
      .th-exporter .th-toggle[aria-pressed="true"] {
        border-color: rgba(105, 185, 159, 0.75);
        background: rgba(105, 185, 159, 0.14);
        color: #f4fffb;
      }
      .th-exporter .th-toggle-mark {
        display: inline-block !important;
        width: 14px;
        height: 14px;
        border: 1px solid #8894a3;
        border-radius: 50%;
        background: transparent;
      }
      .th-exporter .th-toggle[aria-pressed="true"] .th-toggle-mark {
        border-color: #69b99f;
        background: #69b99f;
        box-shadow: inset 0 0 0 3px #172119;
      }
      .th-exporter .th-toggle-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-exporter .th-toggle-state {
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(159, 177, 194, 0.12);
        color: #9facba;
        font-size: 11px;
        font-weight: 800;
      }
      .th-exporter .th-toggle[aria-pressed="true"] .th-toggle-state {
        background: rgba(105, 185, 159, 0.22);
        color: #9ee5ce;
      }
      .th-exporter .th-theme-grid {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .th-exporter .th-theme-option {
        display: grid !important;
        grid-template-columns: 42px minmax(0, 1fr) auto;
        align-items: center;
        gap: 9px;
        width: 100% !important;
        min-height: 42px;
        margin: 0 !important;
        padding: 8px 10px;
        border: 1px solid rgba(159, 177, 194, 0.28);
        border-radius: 8px;
        background: #151b25;
        color: #d7dee8;
        font: inherit;
        font-size: 13px;
        text-align: left !important;
        cursor: pointer;
      }
      .th-exporter .th-theme-option[aria-pressed="true"] {
        border-color: rgba(105, 185, 159, 0.75);
        background: rgba(105, 185, 159, 0.14);
        color: #f4fffb;
      }
      .th-exporter .th-theme-swatch {
        display: grid !important;
        grid-template-columns: repeat(3, 1fr);
        width: 42px;
        height: 22px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 6px;
        background: #111722;
      }
      .th-exporter .th-theme-swatch span {
        display: block !important;
        min-width: 0;
        height: 100%;
      }
      .th-exporter .th-theme-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 700;
      }
      .th-exporter .th-theme-state {
        min-width: 40px;
        color: #9ee5ce;
        font-size: 11px;
        font-weight: 800;
        text-align: right;
      }
      .th-exporter .th-section-head {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }
      .th-exporter .th-rule {
        border: 1px solid rgba(159, 177, 194, 0.18);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 10px;
        background: #171d28;
      }
      .th-exporter .th-rule-top {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .th-exporter .th-rule-enabled {
        width: auto !important;
        min-width: 170px;
      }
      .th-exporter .th-rule-actions {
        display: inline-flex !important;
        gap: 6px;
      }
      .th-exporter .th-rule-actions button,
      .th-exporter .th-primary,
      .th-exporter .th-ghost,
      .th-exporter .th-icon-btn {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 34px;
        border-radius: 7px;
        border: 1px solid rgba(159, 177, 194, 0.28);
        cursor: pointer;
        color: #f2eee8;
        font: inherit;
      }
      .th-exporter .th-rule-actions button,
      .th-exporter .th-ghost,
      .th-exporter .th-icon-btn {
        background: #151b25;
      }
      .th-exporter .th-rule-actions button {
        width: 34px;
      }
      .th-exporter .th-primary {
        background: #3f8f7b;
        border-color: #57b79d;
        color: #ffffff;
        padding: 8px 14px;
        font-weight: 800;
      }
      .th-exporter .th-ghost {
        padding: 7px 11px;
      }
      .th-exporter .th-ghost.danger {
        color: #ffb8aa;
        border-color: rgba(210, 112, 96, 0.45);
      }
      .th-exporter .th-icon-btn {
        width: 36px;
        padding: 0;
      }
      .th-exporter .th-panel-theme-toggle {
        width: 34px;
        min-width: 34px;
      }
      .th-exporter .th-footer {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 14px;
        padding: 2px 4px 0;
      }
      .th-exporter .th-export-status {
        color: #aeb8c5;
        font-size: 12px;
      }
      .th-exporter .th-downloads[hidden] {
        display: none !important;
      }
      .th-exporter .th-downloads {
        margin-top: 14px;
        padding: 12px;
        border: 1px solid rgba(159, 177, 194, 0.18);
        border-radius: 8px;
        background: #151b25;
      }
      .th-exporter .th-downloads-head {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }
      .th-exporter .th-downloads-head .th-card-title {
        margin-bottom: 0;
      }
      .th-exporter .th-downloads-note {
        color: #aeb8c5;
        font-size: 12px;
      }
      .th-exporter .th-download-list {
        display: grid !important;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 8px;
      }
      .th-exporter .th-download-link {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        min-height: 38px;
        padding: 8px 10px;
        border: 1px solid rgba(105, 185, 159, 0.34);
        border-radius: 7px;
        background: rgba(105, 185, 159, 0.12);
        color: #dff7ee;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        text-decoration: none;
        text-align: left;
        cursor: pointer;
      }
      .th-exporter .th-download-link span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-exporter .th-download-link i {
        flex: 0 0 auto;
      }
      .th-exporter .th-diagnostics[hidden] {
        display: none !important;
      }
      .th-exporter .th-diagnostics {
        margin-top: 14px;
        padding: 12px;
        border: 1px solid rgba(105, 185, 159, 0.28);
        border-radius: 8px;
        background: #151b25;
      }
      .th-exporter .th-diagnostics[data-level="error"] {
        border-color: rgba(210, 112, 96, 0.5);
      }
      .th-exporter .th-diagnostics-head {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }
      .th-exporter .th-diagnostics-head .th-card-title {
        margin-bottom: 0;
      }
      .th-exporter .th-diagnostics-text {
        max-height: 240px;
        margin: 0;
        padding: 10px;
        overflow: auto;
        border: 1px solid rgba(159, 177, 194, 0.18);
        border-radius: 7px;
        background: #0f141d;
        color: #d8e2dd;
        white-space: pre-wrap;
        word-break: break-word;
        font: 12px/1.55 Consolas, "Cascadia Mono", "Microsoft YaHei", monospace;
      }
      .th-modal-card[data-panel-theme="day"] {
        border-color: rgba(78, 96, 88, 0.20);
        background: #f8faf7;
        color: #22302a;
        box-shadow: 0 24px 70px rgba(43, 57, 50, 0.18);
      }
      .th-exporter[data-panel-theme="day"] {
        color: #22302a;
      }
      .th-exporter[data-panel-theme="day"] .th-head {
        border-bottom-color: rgba(78, 96, 88, 0.18);
      }
      .th-exporter[data-panel-theme="day"] .th-title {
        color: #22302a;
      }
      .th-exporter[data-panel-theme="day"] .th-version {
        border-color: rgba(47, 111, 89, 0.36);
        color: #2f6f59;
        background: rgba(47, 111, 89, 0.10);
      }
      .th-exporter[data-panel-theme="day"] .th-subtitle,
      .th-exporter[data-panel-theme="day"] .th-field span,
      .th-exporter[data-panel-theme="day"] .th-export-status,
      .th-exporter[data-panel-theme="day"] .th-downloads-note {
        color: #66736e;
      }
      .th-exporter[data-panel-theme="day"] .th-card,
      .th-exporter[data-panel-theme="day"] .th-advanced-settings,
      .th-exporter[data-panel-theme="day"] .th-rule,
      .th-exporter[data-panel-theme="day"] .th-downloads,
      .th-exporter[data-panel-theme="day"] .th-diagnostics {
        border-color: rgba(78, 96, 88, 0.18);
        background: #ffffff;
      }
      .th-exporter[data-panel-theme="day"] .th-card-title {
        color: #805f55;
      }
      .th-exporter[data-panel-theme="day"] .th-advanced-settings > summary {
        color: #805f55;
      }
      .th-exporter[data-panel-theme="day"] .th-advanced-settings > summary strong {
        color: #66736e;
      }
      .th-exporter[data-panel-theme="day"] .th-advanced-settings > summary::after {
        border-color: rgba(78, 96, 88, 0.22);
        color: #2f6f59;
      }
      .th-exporter[data-panel-theme="day"] .th-target-banner {
        border-color: rgba(47, 111, 89, 0.26);
        background: rgba(47, 111, 89, 0.08);
        color: #245a48;
      }
      .th-exporter[data-panel-theme="day"] .th-target-banner span {
        color: #2f6f59;
      }
      .th-exporter[data-panel-theme="day"] .th-target-banner strong {
        color: #22302a;
      }
      .th-exporter[data-panel-theme="day"] .th-field input,
      .th-exporter[data-panel-theme="day"] .th-field textarea,
      .th-exporter[data-panel-theme="day"] .th-toggle,
      .th-exporter[data-panel-theme="day"] .th-theme-option,
      .th-exporter[data-panel-theme="day"] .th-rule-actions button,
      .th-exporter[data-panel-theme="day"] .th-ghost,
      .th-exporter[data-panel-theme="day"] .th-icon-btn {
        border-color: rgba(78, 96, 88, 0.22);
        background: #f3f6f1;
        color: #24372d;
      }
      .th-exporter[data-panel-theme="day"] .th-field input,
      .th-exporter[data-panel-theme="day"] .th-field textarea {
        background: #fbfcfa;
      }
      .th-exporter[data-panel-theme="day"] .th-field input:focus,
      .th-exporter[data-panel-theme="day"] .th-field textarea:focus {
        border-color: #3f8f7b;
        box-shadow: 0 0 0 2px rgba(63, 143, 123, 0.14);
      }
      .th-exporter[data-panel-theme="day"] .th-toggle[aria-pressed="true"],
      .th-exporter[data-panel-theme="day"] .th-theme-option[aria-pressed="true"] {
        border-color: rgba(47, 111, 89, 0.55);
        background: rgba(47, 111, 89, 0.11);
        color: #20392f;
      }
      .th-exporter[data-panel-theme="day"] .th-toggle-mark {
        border-color: rgba(78, 96, 88, 0.45);
      }
      .th-exporter[data-panel-theme="day"] .th-toggle[aria-pressed="true"] .th-toggle-mark {
        border-color: #3f8f7b;
        background: #3f8f7b;
        box-shadow: inset 0 0 0 3px #f8faf7;
      }
      .th-exporter[data-panel-theme="day"] .th-toggle-state {
        background: rgba(78, 96, 88, 0.08);
        color: #66736e;
      }
      .th-exporter[data-panel-theme="day"] .th-toggle[aria-pressed="true"] .th-toggle-state,
      .th-exporter[data-panel-theme="day"] .th-theme-state {
        background: rgba(47, 111, 89, 0.12);
        color: #2f6f59;
      }
      .th-exporter[data-panel-theme="day"] .th-primary {
        background: #3f8f7b;
        border-color: #3f8f7b;
        color: #ffffff;
      }
      .th-exporter[data-panel-theme="day"] .th-ghost.danger {
        color: #a54f44;
        border-color: rgba(165, 79, 68, 0.30);
      }
      .th-exporter[data-panel-theme="day"] .th-theme-swatch {
        border-color: rgba(78, 96, 88, 0.16);
        background: #ffffff;
      }
      .th-exporter[data-panel-theme="day"] .th-download-link {
        border-color: rgba(47, 111, 89, 0.30);
        background: rgba(47, 111, 89, 0.09);
        color: #245a48;
      }
      .th-exporter[data-panel-theme="day"] .th-diagnostics-text {
        border-color: rgba(78, 96, 88, 0.16);
        background: #f7f9f6;
        color: #22302a;
      }
      body .select_chat_block .th-chat-export-btn {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        gap: 5px;
        align-self: flex-start;
        width: auto !important;
        min-height: 28px;
        margin: 6px 0 0 !important;
        padding: 5px 9px !important;
        border: 1px solid rgba(105, 185, 159, 0.45) !important;
        border-radius: 7px !important;
        background: rgba(105, 185, 159, 0.16) !important;
        color: #dff7ee !important;
        font: 700 12px/1.2 "Microsoft YaHei", "PingFang SC", system-ui, sans-serif !important;
        cursor: pointer !important;
        text-decoration: none !important;
        white-space: nowrap !important;
      }
      body .select_chat_block .th-chat-export-btn:hover {
        border-color: rgba(105, 185, 159, 0.72) !important;
        background: rgba(105, 185, 159, 0.24) !important;
      }
      body .select_chat_block .th-chat-export-btn.is-busy,
      body .select_chat_block .th-chat-export-btn:disabled {
        cursor: wait !important;
        opacity: 0.72 !important;
      }
      #${FALLBACK_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 9999;
        border: none;
        border-radius: 8px;
        padding: 9px 12px;
        background: #345995;
        color: #fff;
        font-weight: 700;
        cursor: pointer;
        min-height: 42px;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        box-shadow: 0 10px 22px rgba(31, 41, 51, 0.18);
      }
      @media (max-width: 640px) {
        .th-modal-overlay {
          padding: 10px;
        }
        .th-exporter {
          padding: 14px;
        }
        .th-exporter .th-head,
        .th-exporter .th-footer,
        .th-exporter .th-rule-top {
          align-items: stretch;
          flex-direction: column;
        }
        .th-exporter .th-section-head {
          align-items: stretch;
          flex-direction: column;
        }
        .th-exporter .th-diagnostics-head {
          align-items: stretch;
          flex-direction: column;
        }
        .th-exporter .th-downloads-head {
          align-items: stretch;
          flex-direction: column;
        }
        .th-exporter .th-target-banner {
          align-items: flex-start;
          flex-direction: column;
        }
        .th-exporter .th-two-col {
          grid-template-columns: 1fr;
        }
        .th-exporter .th-grid,
        .th-exporter .rule-grid,
        .th-exporter .th-theme-grid {
          grid-template-columns: 1fr;
        }
        .th-exporter .th-head-actions {
          align-self: stretch;
          flex-direction: row;
        }
        .th-exporter .th-primary,
        .th-exporter .th-ghost,
        .th-exporter .th-icon-btn {
          width: 100%;
        }
        .th-exporter .th-head-actions .th-primary {
          flex: 1 1 auto;
          width: auto;
        }
        .th-exporter .th-head-actions .th-icon-btn {
          flex: 0 0 42px;
          width: 42px;
          min-height: 42px;
        }
        #${FALLBACK_ID} {
          right: 14px;
          bottom: 14px;
          min-height: 46px;
          padding: 10px 14px;
        }
      }
    `;
  }

  function getMinimizedButtonStyle(settings) {
    const panelTheme = getPanelTheme(settings || loadSettings());
    const dark = panelTheme !== 'day';
    const background = dark ? '#345995' : '#2f7ed8';
    const border = dark ? '#8fb8ff' : '#3f8f7b';
    const shadow = dark ? 'rgba(0, 0, 0, 0.34)' : 'rgba(30, 44, 38, 0.16)';
    return `position:fixed;right:18px;bottom:78px;z-index:100001;width:52px;height:52px;padding:0;border-radius:15px;border:1px solid ${border};background:${background};color:#ffffff;box-shadow:0 10px 26px ${shadow};font-size:20px;line-height:50px;text-align:center;font-weight:800;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;`;
  }

  function removeMinimizedButton() {
    const button = getHostDocument().getElementById(MINIMIZED_BUTTON_ID);
    if (button) button.remove();
  }

  function applyMinimizedButtonPosition(button) {
    if (!button || !minimizedButtonPosition) return;
    button.style.left = `${minimizedButtonPosition.left}px`;
    button.style.top = `${minimizedButtonPosition.top}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  }

  function restoreMinimizedPanel($overlay) {
    if (!$overlay || !$overlay.length) return;
    removeMinimizedButton();
    $overlay.removeClass('th-html-exporter-minimized');
  }

  function bindMinimizedButtonDrag(button) {
    if (!button || button.dataset.dragBound === 'true') return;
    button.dataset.dragBound = 'true';
    let dragging = false;
    let moved = false;
    let activeId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let suppressClickUntil = 0;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const viewportSize = () => {
      const host = getHostWindow();
      const doc = getHostDocument();
      return {
        width: host.innerWidth || doc.documentElement.clientWidth || 800,
        height: host.innerHeight || doc.documentElement.clientHeight || 600,
      };
    };
    const beginDrag = (clientX, clientY) => {
      const rect = button.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = clientX;
      startY = clientY;
      startLeft = rect.left;
      startTop = rect.top;
      button.style.left = `${rect.left}px`;
      button.style.top = `${rect.top}px`;
      button.style.right = 'auto';
      button.style.bottom = 'auto';
      button.style.cursor = 'grabbing';
    };
    const moveDrag = (clientX, clientY) => {
      if (!dragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const viewport = viewportSize();
      const left = clamp(startLeft + dx, 8, Math.max(8, viewport.width - button.offsetWidth - 8));
      const top = clamp(startTop + dy, 8, Math.max(8, viewport.height - button.offsetHeight - 8));
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      minimizedButtonPosition = { left, top };
    };
    const finishDrag = () => {
      if (!dragging) return false;
      dragging = false;
      activeId = null;
      button.style.cursor = 'grab';
      if (moved) {
        button.dataset.dragged = 'true';
        suppressClickUntil = Date.now() + 350;
        setTimeout(() => {
          button.dataset.dragged = 'false';
        }, 360);
      }
      return moved;
    };

    if (getHostWindow().PointerEvent) {
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        activeId = event.pointerId;
        beginDrag(event.clientX, event.clientY);
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          // Ignore unsupported pointer capture.
        }
      });
      button.addEventListener('pointermove', (event) => {
        if (!dragging || event.pointerId !== activeId) return;
        moveDrag(event.clientX, event.clientY);
      });
      const finishPointer = (event) => {
        if (!dragging || event.pointerId !== activeId) return;
        finishDrag();
        try {
          button.releasePointerCapture(event.pointerId);
        } catch (error) {
          // Ignore release failures.
        }
      };
      button.addEventListener('pointerup', finishPointer);
      button.addEventListener('pointercancel', finishPointer);
    }

    button.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      activeId = touch.identifier;
      beginDrag(touch.clientX, touch.clientY);
      event.preventDefault();
    }, { passive: false });
    button.addEventListener('touchmove', (event) => {
      if (!dragging) return;
      const touches = Array.from(event.changedTouches || []);
      const touch = touches.find((item) => item.identifier === activeId) || touches[0];
      if (!touch) return;
      moveDrag(touch.clientX, touch.clientY);
      event.preventDefault();
    }, { passive: false });
    button.addEventListener('touchend', (event) => {
      if (!dragging) return;
      const wasMoved = finishDrag();
      event.preventDefault();
      if (!wasMoved) button.click();
    }, { passive: false });
    button.addEventListener('touchcancel', () => {
      finishDrag();
    }, { passive: true });

    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || dragging) return;
      beginDrag(event.clientX, event.clientY);
      const doc = getHostDocument();
      const onMove = (moveEvent) => moveDrag(moveEvent.clientX, moveEvent.clientY);
      const onUp = () => {
        finishDrag();
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
      };
      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    });

    button.addEventListener('click', (event) => {
      if (Date.now() < suppressClickUntil || button.dataset.dragged === 'true') {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function minimizePanel($panel) {
    const $overlay = $panel.closest('.th-modal-overlay');
    if (!$overlay.length) return;
    const hostDocument = getHostDocument();
    removeMinimizedButton();
    const button = hostDocument.createElement('button');
    button.id = MINIMIZED_BUTTON_ID;
    button.type = 'button';
    button.innerHTML = '<i class="fa-solid fa-file-export"></i>';
    button.title = '恢复聊天记录 HTML 导出器';
    button.setAttribute('aria-label', '恢复聊天记录 HTML 导出器');
    button.style.cssText = getMinimizedButtonStyle(collectSettingsFromPanel($panel));
    applyMinimizedButtonPosition(button);
    bindMinimizedButtonDrag(button);
    button.addEventListener('click', () => {
      if (button.dataset.dragged === 'true') return;
      restoreMinimizedPanel($overlay);
    });
    hostDocument.body.appendChild(button);
    $overlay.addClass('th-html-exporter-minimized');
  }

  function releaseDownloadLinks($panel) {
    const entries = $panel && $panel.data ? ($panel.data('downloadEntries') || []) : [];
    entries.forEach((entry) => {
      try {
        if (entry && entry.url && entry.urlApi && typeof entry.urlApi.revokeObjectURL === 'function') {
          entry.urlApi.revokeObjectURL(entry.url);
        }
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 释放下载链接失败`, error);
      }
    });
  }

  function closeExporterOverlay($overlay) {
    if (!$overlay || !$overlay.length) return;
    releaseDownloadLinks($overlay.find('.th-exporter'));
    removeMinimizedButton();
    $overlay.remove();
  }

  function bindPanel($panel, options) {
    const $ = get$();
    const panelOptions = options || {};
    const chatFileSearchContext = panelOptions.chatFileSearchContext || null;

    function currentSettings() {
      const settings = collectSettingsFromPanel($panel);
      saveSettings(settings);
      return settings;
    }

    function renderRules(settings) {
      const $list = $panel.find('.th-rule-list').empty();
      if (!settings.rules.length) {
        settings.rules.push({ enabled: true, name: '', pattern: '', flags: 'gs', replacement: '' });
      }
      settings.rules.forEach((rule, index) => {
        $list.append(buildRuleHtml(rule, index));
      });
    }

    function rerenderRulesFromPanel(mutator) {
      const settings = currentSettings();
      mutator(settings.rules);
      saveSettings(settings);
      renderRules(settings);
    }

    function setToggleState($button, active) {
      $button.attr('aria-pressed', active ? 'true' : 'false');
      $button.find('.th-toggle-state').text(active ? '已启用' : '已关闭');
    }

    function setThemeState($button, active) {
      $button.attr('aria-pressed', active ? 'true' : 'false');
      $button.find('.th-theme-state').text(active ? '已选择' : '');
    }

    function setPanelTheme(theme) {
      const nextTheme = theme === 'day' ? 'day' : 'night';
      const title = nextTheme === 'day' ? '切换夜间面板' : '切换白天面板';
      const icon = nextTheme === 'day' ? 'fa-moon' : 'fa-sun';
      $panel.attr('data-panel-theme', nextTheme);
      $panel.closest('.th-modal-card').attr('data-panel-theme', nextTheme);
      $panel.find('[data-action="toggle-panel-theme"]')
        .attr('title', title)
        .attr('aria-label', title)
        .find('i')
        .attr('class', `fa-solid ${icon}`);
    }

    function clearDiagnostics() {
      $panel.removeData('lastDiagnostics');
      $panel.find('.th-diagnostics').attr('hidden', true).removeAttr('data-level');
      $panel.find('.th-diagnostics-text').text('');
    }

    function clearDownloadLinks() {
      const entries = $panel.data('downloadEntries') || [];
      entries.forEach((entry) => {
        try {
          if (entry && entry.url && entry.urlApi && typeof entry.urlApi.revokeObjectURL === 'function') {
            entry.urlApi.revokeObjectURL(entry.url);
          }
        } catch (error) {
          console.warn(`[${SCRIPT_NAME}] 释放下载链接失败`, error);
        }
      });
      $panel.removeData('downloadEntries');
      $panel.find('.th-download-list').empty();
      $panel.find('.th-downloads').attr('hidden', true);
    }

    function showDownloadLinks(files, diagnostics) {
      clearDownloadLinks();
      const hostDocument = getHostDocument();
      const list = $panel.find('.th-download-list').empty();
      const entries = [];

      files.forEach((file) => {
        const entry = createDownloadUrl(file.html, 'text/html;charset=utf-8');
        entry.name = file.name;
        entries.push(entry);

        const link = hostDocument.createElement('button');
        link.type = 'button';
        link.className = 'th-download-link';
        link.dataset.downloadIndex = String(entries.length - 1);
        link.title = '保存这个 HTML 文件';

        const label = hostDocument.createElement('span');
        label.textContent = file.name;
        const icon = hostDocument.createElement('i');
        icon.className = 'fa-solid fa-floppy-disk';

        link.appendChild(label);
        link.appendChild(icon);
        list[0].appendChild(link);
      });

      $panel.data('downloadEntries', entries);
      $panel.find('.th-downloads').removeAttr('hidden');
      bumpDiagnosticCount(diagnostics, 'downloadLinks', entries.length);
      return entries;
    }

    async function saveDownloadEntry(entry, diagnostics) {
      const host = getHostWindow();
      bumpDiagnosticCount(diagnostics, 'manualSaveAttempts', 1);

      if (host.showSaveFilePicker && typeof host.showSaveFilePicker === 'function') {
        bumpDiagnosticCount(diagnostics, 'savePickerAttempts', 1);
        const handle = await host.showSaveFilePicker({
          suggestedName: entry.name || '聊天记录.html',
          types: [
            {
              description: 'HTML 文件',
              accept: { 'text/html': ['.html', '.htm'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(entry.blob);
        await writable.close();
        return 'saved';
      }

      bumpDiagnosticCount(diagnostics, 'openFallbacks', 1);
      const opened = host.open(entry.url, '_blank', 'noopener,noreferrer');
      if (opened) return 'opened';

      const fallback = getHostDocument().createElement('a');
      fallback.href = entry.url;
      fallback.target = '_blank';
      fallback.rel = 'noopener noreferrer';
      getHostDocument().body.appendChild(fallback);
      fallback.click();
      fallback.remove();
      return 'opened';
    }

    function tryAutoDownloadLinks(entries, diagnostics) {
      bumpDiagnosticCount(diagnostics, 'autoDownloadAttempts', entries.length);
      entries.forEach((entry, index) => {
        setTimeout(() => {
          try {
            const link = getHostDocument().createElement('a');
            link.href = entry.url;
            link.download = entry.name || `聊天记录_${index + 1}.html`;
            link.style.display = 'none';
            getHostDocument().body.appendChild(link);
            link.click();
            link.remove();
          } catch (error) {
            pushDiagnostic(diagnostics, 'warning', `自动下载 ${entry.name || `文件 ${index + 1}`} 失败：${getErrorMessage(error)}`);
            showDiagnostics(diagnostics, '完成（自动下载有提示）');
          }
        }, index * 320);
      });
    }

    function showDiagnostics(diagnostics, status) {
      const level = diagnostics && diagnostics.errors && diagnostics.errors.length ? 'error' : 'info';
      const text = formatDiagnostics(diagnostics, status);
      $panel.data('lastDiagnostics', diagnostics);
      $panel.find('.th-diagnostics')
        .removeAttr('hidden')
        .attr('data-level', level);
      $panel.find('.th-diagnostics-text').text(text);
    }

    $panel.on('input change', 'input, textarea', function () {
      if (this.closest('.th-rule-list') || this.dataset.field) {
        saveSettings(collectSettingsFromPanel($panel));
      }
    });

    $panel.on('toggle', '.th-advanced-settings', function () {
      saveSettings(collectSettingsFromPanel($panel));
    });
    $panel.find('.th-advanced-settings').on('toggle', function () {
      saveSettings(collectSettingsFromPanel($panel));
    });

    $panel.on('click', '[data-toggle], [data-rule-toggle]', function () {
      const next = $(this).attr('aria-pressed') !== 'true';
      setToggleState($(this), next);
      saveSettings(collectSettingsFromPanel($panel));
    });

    $panel.on('click', '[data-theme]', function () {
      $panel.find('[data-theme]').each(function () {
        setThemeState($(this), false);
      });
      setThemeState($(this), true);
      saveSettings(collectSettingsFromPanel($panel));
    });

    $panel.on('click', '[data-action="toggle-panel-theme"]', () => {
      const nextTheme = $panel.attr('data-panel-theme') === 'day' ? 'night' : 'day';
      setPanelTheme(nextTheme);
      saveSettings(collectSettingsFromPanel($panel));
      const minimizedButton = getHostDocument().getElementById(MINIMIZED_BUTTON_ID);
      if (minimizedButton) {
        minimizedButton.style.cssText = getMinimizedButtonStyle(collectSettingsFromPanel($panel));
        applyMinimizedButtonPosition(minimizedButton);
      }
    });

    $panel.on('click', '[data-action="minimize"]', () => {
      minimizePanel($panel);
    });

    $panel.on('click', '[data-action="close"]', () => {
      closeExporterOverlay($panel.closest('.th-modal-overlay'));
    });

    $panel.on('click', '[data-action="add-rule"]', () => {
      rerenderRulesFromPanel((rules) => rules.push({ enabled: true, name: '', pattern: '', flags: 'gs', replacement: '' }));
    });

    $panel.on('click', '[data-action="rule-delete"]', function () {
      const index = Number($(this).closest('.th-rule').data('rule-index'));
      rerenderRulesFromPanel((rules) => rules.splice(index, 1));
    });

    $panel.on('click', '[data-action="rule-up"]', function () {
      const index = Number($(this).closest('.th-rule').data('rule-index'));
      if (index <= 0) return;
      rerenderRulesFromPanel((rules) => {
        const tmp = rules[index - 1];
        rules[index - 1] = rules[index];
        rules[index] = tmp;
      });
    });

    $panel.on('click', '[data-action="rule-down"]', function () {
      const index = Number($(this).closest('.th-rule').data('rule-index'));
      rerenderRulesFromPanel((rules) => {
        if (index >= rules.length - 1) return;
        const tmp = rules[index + 1];
        rules[index + 1] = rules[index];
        rules[index] = tmp;
      });
    });

    $panel.on('click', '[data-action="reset"]', () => {
      clearDownloadLinks();
      localStorage.removeItem(STORAGE_KEY);
      const settings = normalizeSettings(null);
      const $newPanel = $(buildPanelHtml(settings, panelOptions));
      $panel.replaceWith($newPanel);
      bindPanel($newPanel, panelOptions);
      notify('success', '已重置导出器设置');
    });

    $panel.on('click', '[data-action="copy-diagnostics"]', async () => {
      const text = String($panel.find('.th-diagnostics-text').text() || '');
      if (!text.trim()) {
        notify('warning', '当前没有可复制的诊断信息。');
        return;
      }
      try {
        const host = getHostWindow();
        if (host.navigator && host.navigator.clipboard && typeof host.navigator.clipboard.writeText === 'function') {
          await host.navigator.clipboard.writeText(text);
        } else {
          const textarea = getHostDocument().createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          getHostDocument().body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          getHostDocument().execCommand('copy');
          textarea.remove();
        }
        notify('success', '诊断信息已复制。');
      } catch (error) {
        notify('error', `复制失败：${getErrorMessage(error)}`);
      }
    });

    $panel.on('click', '[data-download-index]', async function () {
      const index = Number(this.dataset.downloadIndex);
      const entries = $panel.data('downloadEntries') || [];
      const entry = entries[index];
      const diagnostics = $panel.data('lastDiagnostics') || createDiagnostics(loadSettings());
      if (!entry) {
        notify('error', '没有找到这个导出文件，请重新导出一次。');
        return;
      }

      try {
        const mode = await saveDownloadEntry(entry, diagnostics);
        $panel.data('lastDiagnostics', diagnostics);
        showDiagnostics(diagnostics, mode === 'saved' ? '完成（已手动保存）' : '完成（已打开预览）');
        notify(
          'success',
          mode === 'saved'
            ? `已保存：${entry.name}`
            : `已打开：${entry.name}。如果需要保存，请在新页面使用 Ctrl+S。`,
        );
      } catch (error) {
        if (error && error.name === 'AbortError') {
          notify('info', '已取消保存。');
          return;
        }
        pushDiagnostic(diagnostics, 'warning', `手动保存 ${entry.name || `文件 ${index + 1}`} 失败：${getErrorMessage(error)}`);
        $panel.data('lastDiagnostics', diagnostics);
        showDiagnostics(diagnostics, '完成（手动保存失败）');
        notify('error', `保存失败：${getErrorMessage(error)}`);
      }
    });

    $panel.on('click', '[data-action="export"]', async () => {
      const $status = $panel.find('.th-export-status');
      let settings = null;
      let diagnostics = null;
      clearDiagnostics();
      clearDownloadLinks();
      try {
        settings = currentSettings();
        diagnostics = createDiagnostics(settings);
        const rules = compileRules(settings);
        let messages = [];
        let exportContext = null;
        if (chatFileSearchContext) {
          diagnostics.source.mode = '聊天文件';
          diagnostics.source.fileName = chatFileSearchContext.requestedFileName;
          $status.text(`读取聊天文件：${chatFileSearchContext.requestedFileName}...`);
          const fileData = await fetchChatFileMessages(chatFileSearchContext, settings, diagnostics);
          diagnostics.source.folder = fileData.folder;
          diagnostics.source.fileName = fileData.resolvedFileName || chatFileSearchContext.requestedFileName;
          messages = fileData.messages;
          exportContext = {
            characterName: fileData.characterName,
            userName: fileData.userName,
            chatTitle: fileData.chatTitle,
          };
          pushDiagnostic(diagnostics, 'warning', '这是未打开聊天文件导出：不会读取当前窗口 DOM，已改用酒馆渲染接口、原文和 user 保底。');
        } else {
          messages = getMessages(settings);
        }
        diagnostics.counts.messages = messages.length;
        if (!messages.length) {
          pushDiagnostic(diagnostics, 'warning', '没有符合当前筛选条件的消息可导出。');
          showDiagnostics(diagnostics, '未导出');
          notify('warning', '没有符合条件的消息可导出。');
          return;
        }

        const perFile = settings.messagesPerFile;
        const expectedFiles = settings.singleFilePagination ? 1 : Math.ceil(messages.length / perFile);
        const expectedInternalPages = settings.singleFilePagination ? Math.max(1, Math.ceil(messages.length / perFile)) : 0;
        $status.text(settings.singleFilePagination
          ? `准备导出 ${messages.length} 条消息 / 1 个 HTML / ${expectedInternalPages} 个页签...`
          : `准备导出 ${messages.length} 条消息 / ${expectedFiles} 个 HTML...`);

        const exportResult = buildExportFiles(messages, settings, rules, diagnostics, exportContext);
        const files = exportResult.files;

        if (files.length > 10) {
          pushDiagnostic(diagnostics, 'warning', `本次将下载 ${files.length} 个 HTML，浏览器可能会拦截或询问多个下载。`);
          notify('info', `将下载 ${files.length} 个文件，浏览器可能会询问是否允许多个下载。`);
        }
        const downloadEntries = showDownloadLinks(files, diagnostics);
        pushDiagnostic(diagnostics, 'warning', '已生成手动下载链接；如果浏览器没有自动下载，请点击“导出文件”里的文件名。');
        tryAutoDownloadLinks(downloadEntries, diagnostics);
        $status.text(`已生成 ${files.length} 个 HTML 下载链接，并尝试自动下载。`);
        showDiagnostics(diagnostics, diagnostics.warnings.length ? '完成（有提示）' : '完成');
        notify('success', `已生成 ${files.length} 个 HTML 下载链接。`);
      } catch (error) {
        console.error(error);
        $status.text('');
        if (!diagnostics) diagnostics = createDiagnostics(settings || loadSettings());
        pushDiagnostic(diagnostics, 'error', getErrorMessage(error));
        showDiagnostics(diagnostics, '失败');
        notify('error', `导出失败：${getErrorMessage(error)}`);
      }
    });

    renderRules(loadSettings());
    setPanelTheme(loadSettings().panelTheme);
  }

  async function openPanel(options) {
    const $ = get$();
    const hostDocument = getHostDocument();
    const panelOptions = options || {};
    if (!$) {
      getHostWindow().alert('没有找到 jQuery，无法打开导出面板。');
      return;
    }
    injectStyle();
    removeMinimizedButton();
    $(hostDocument).find('.th-modal-overlay').each(function () {
      closeExporterOverlay($(this));
    });
    const settings = loadSettings();
    const $panel = $(buildPanelHtml(settings, panelOptions));
    const $overlay = $('<div class="th-modal-overlay"></div>');
    const $card = $('<div class="th-modal-card"></div>').attr('data-panel-theme', settings.panelTheme);
    $card.append($panel);
    $overlay.append($card);
    $(hostDocument.body).append($overlay);
    bindPanel($panel, panelOptions);
    $overlay.on('click', function (event) {
      if (event.target === this) {
        closeExporterOverlay($overlay);
      }
    });
  }

  function safeOpenPanel(options) {
    Promise.resolve()
      .then(() => openPanel(options))
      .catch((error) => {
        console.error(`[${SCRIPT_NAME}] 打开面板失败`, error);
        notify('error', `打开面板失败：${getErrorMessage(error)}`);
      });
  }

  function injectFallbackButton() {
    const hostDocument = getHostDocument();
    if (hostDocument.getElementById(FALLBACK_ID)) return;
    const button = hostDocument.createElement('button');
    button.id = FALLBACK_ID;
    button.type = 'button';
    button.textContent = BUTTON_NAME;
    button.addEventListener('click', () => safeOpenPanel());
    hostDocument.body.appendChild(button);
  }

  function register() {
    try {
      injectStyle();
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 注入样式失败`, error);
    }
    try {
      installChatListExportEnhancer();
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 聊天列表导出按钮增强失败，主面板仍可使用`, error);
    }
    try {
      const handler = () => safeOpenPanel();
      let registered = false;
      if (typeof appendInexistentScriptButtons === 'function') {
        appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
      }
      if (typeof eventOnButton === 'function') {
        eventOnButton(BUTTON_NAME, handler);
        registered = true;
      }
      if (typeof getButtonEvent === 'function' && typeof eventOn === 'function') {
        eventOn(getButtonEvent(BUTTON_NAME), handler);
        registered = true;
      }
      if (!registered) {
        injectFallbackButton();
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 注册按钮失败，使用浮动按钮`, error);
      injectFallbackButton();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register);
  } else {
    register();
  }
})();
