import { applyRulesWithTokens, restoreRuleTokens } from './core.js';

const REMOVE_SELECTORS = [
  'script', 'noscript', 'object', 'embed', 'base', 'meta[http-equiv]', 'link[rel="modulepreload"]',
  '.mes_buttons', '.extraMesButtons', '.mes_edit_buttons', '.mes_timer', '.tokenCounterDisplay',
  '.mesIDDisplay', '.code-copy', '.copy-code-button', '.TH-collapse-code-block-button',
].join(',');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(value, attribute) {
  const url = String(value || '').trim();
  if (!url || url.startsWith('#') || url.startsWith('/')) return true;
  if (/^(?:https?:|mailto:|tel:|blob:)/i.test(url)) return true;
  if (attribute === 'src' && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(url)) return true;
  return false;
}

function cleanStyleText(value) {
  return String(value || '')
    .replace(/@import[\s\S]*?;/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript):[\s\S]*?\)/gi, 'none');
}

function sanitizeTree(root, options = {}) {
  const document = root.ownerDocument || root;
  root.querySelectorAll(REMOVE_SELECTORS).forEach(node => node.remove());
  root.querySelectorAll('*').forEach(node => {
    for (const attribute of Array.from(node.attributes || [])) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name.startsWith('on')) {
        node.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'srcdoc' && !(options.keepSnapshotFrames && node.matches('iframe.thx-rich-frame'))) {
        node.removeAttribute(attribute.name);
        continue;
      }
      if (['href', 'src', 'action', 'formaction', 'poster', 'xlink:href'].includes(name) && !isSafeUrl(value, name)) {
        node.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'style') node.setAttribute('style', cleanStyleText(value));
    }
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.tagName === 'FORM') node.replaceWith(...node.childNodes);
    if (node.tagName === 'IFRAME') {
      if (options.keepSnapshotFrames && node.classList.contains('thx-rich-frame') && node.getAttribute('srcdoc')) {
        node.removeAttribute('src');
        node.setAttribute('sandbox', 'allow-same-origin');
        node.setAttribute('referrerpolicy', 'no-referrer');
        node.setAttribute('title', node.getAttribute('title') || '静态界面快照');
      } else {
        const note = document.createElement('div');
        note.className = 'thx-frame-note';
        note.textContent = '此动态界面没有可离线保存的内容，已安全移除。';
        node.replaceWith(note);
      }
    }
  });
  root.querySelectorAll('style').forEach(style => {
    style.textContent = cleanStyleText(style.textContent);
  });
  return root;
}

export function sanitizeFragment(document, html, options = {}) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  sanitizeTree(template.content, options);
  return template.innerHTML.trim();
}

export function sanitizeDocument(document, html) {
  const Parser = document.defaultView?.DOMParser || DOMParser;
  const parsed = new Parser().parseFromString(String(html || ''), 'text/html');
  sanitizeTree(parsed, { keepSnapshotFrames: false });
  parsed.querySelectorAll('link').forEach(node => node.remove());
  if (!parsed.querySelector('meta[charset]')) {
    const meta = parsed.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    parsed.head.prepend(meta);
  }
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

function buildIsolatedFrame(document, html, title = '静态富文本') {
  const frameDocument = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:transparent;color:inherit;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.65;overflow-wrap:anywhere}*{box-sizing:border-box}img,video{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow:auto}</style></head><body class="mes_text">${html}</body></html>`;
  const iframe = document.createElement('iframe');
  iframe.className = 'thx-rich-frame';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('title', title);
  iframe.setAttribute('srcdoc', frameDocument);
  return iframe.outerHTML;
}

function isRichHtml(html) {
  return /<(?:style|iframe|svg|canvas)\b|\bTH-render\b/i.test(String(html || ''));
}

function hasMeaningfulContent(document, html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  if (template.content.querySelector('img,video,audio,iframe,svg,canvas,table,details,pre')) return true;
  return Boolean(String(template.content.textContent || '').trim());
}

function captureFrameDocument(frame) {
  try {
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (doc?.documentElement?.outerHTML && String(doc.body?.textContent || doc.body?.innerHTML || '').trim()) {
      return `<!doctype html>${doc.documentElement.outerHTML}`;
    }
  } catch {}
  return frame.getAttribute('srcdoc') || '';
}

export function snapshotDisplayedMessage(document, tavernHelper, messageId) {
  let sourceNode = document.querySelector(`#chat > .mes[mesid="${messageId}"] .mes_text`);
  if (!sourceNode && tavernHelper && typeof tavernHelper.retrieveDisplayedMessage === 'function') {
    try {
      const displayed = tavernHelper.retrieveDisplayedMessage(messageId);
      sourceNode = displayed?.get?.(0) || displayed?.[0];
    } catch {}
  }
  if (!sourceNode) return null;
  const clone = sourceNode.cloneNode(true);
  clone.querySelectorAll('.mes_buttons,.extraMesButtons,.mes_edit_buttons,.mes_timer,.tokenCounterDisplay,.mesIDDisplay').forEach(node => node.remove());
  const sourceFrames = Array.from(sourceNode.querySelectorAll('iframe'));
  const clonedFrames = Array.from(clone.querySelectorAll('iframe'));
  clonedFrames.forEach((frame, index) => {
    const captured = captureFrameDocument(sourceFrames[index]);
    if (!captured) {
      const note = document.createElement('div');
      note.className = 'thx-frame-note';
      note.textContent = '动态界面尚未完成渲染，已保留正文但移除失效框架。';
      frame.replaceWith(note);
      return;
    }
    frame.className = 'thx-rich-frame';
    frame.removeAttribute('src');
    frame.setAttribute('srcdoc', sanitizeDocument(document, captured));
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', '酒馆界面静态快照');
  });
  const sanitized = sanitizeFragment(document, clone.innerHTML, { keepSnapshotFrames: true });
  if (!hasMeaningfulContent(document, sanitized)) return null;
  return buildIsolatedFrame(document, sanitized, `楼层 ${messageId} 酒馆显示快照`);
}

function renderPlainText(document, value, rules) {
  const processed = applyRulesWithTokens(value, rules);
  let html = escapeHtml(processed.text).replace(/\r\n|\r|\n/g, '<br>');
  html = restoreRuleTokens(html, processed.tokens, replacement => sanitizeFragment(document, replacement));
  const sanitized = sanitizeFragment(document, html, { keepSnapshotFrames: true });
  return isRichHtml(sanitized) ? buildIsolatedFrame(document, sanitized) : sanitized;
}

export async function renderCurrentMessage({ document, tavernHelper, message, rules, settings, diagnostics }) {
  if (settings.preferDisplayedSnapshot && rules.length === 0) {
    const snapshot = snapshotDisplayedMessage(document, tavernHelper, message.id);
    if (snapshot) {
      diagnostics.snapshots += 1;
      return { ...message, html: snapshot, source: '酒馆快照' };
    }
  }

  const processed = applyRulesWithTokens(message.text, rules);
  const preparedText = restoreRuleTokens(processed.text, processed.tokens);
  if (tavernHelper && typeof tavernHelper.formatAsDisplayedMessage === 'function') {
    try {
      const formatted = tavernHelper.formatAsDisplayedMessage(preparedText, { message_id: message.id });
      const sanitized = sanitizeFragment(document, formatted, { keepSnapshotFrames: false });
      diagnostics.formatted += 1;
      return {
        ...message,
        html: isRichHtml(sanitized) ? buildIsolatedFrame(document, sanitized, `楼层 ${message.id} 富文本`) : sanitized,
        source: '酒馆格式',
      };
    } catch (error) {
      diagnostics.warnings.push(`#${message.id} 酒馆格式化失败：${error.message || error}`);
    }
  }
  diagnostics.plain += 1;
  return { ...message, html: renderPlainText(document, message.text, rules), source: '安全文本' };
}

export function renderImportedMessage({ document, message, rules, diagnostics }) {
  diagnostics.plain += 1;
  return { ...message, html: renderPlainText(document, message.text, rules), source: 'JSONL 安全文本' };
}
