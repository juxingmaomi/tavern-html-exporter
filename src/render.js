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

function materializeTxPackFrontends(parsed) {
  parsed.querySelectorAll('.tx-pack-wrapper').forEach(wrapper => {
    const raw = wrapper.querySelector('.tx-pack-raw');
    const interfaceNode = wrapper.querySelector('.tx-pack-interface');
    const viewport = wrapper.querySelector('.tx-pack-viewport');
    if (!raw || !interfaceNode || !viewport) return;

    const source = parsed.createElement('div');
    source.innerHTML = raw.innerHTML;
    const sections = [];
    ['snapshot', 'abstract', 'todo', 'seeds', 'events'].forEach(tag => {
      const node = source.querySelector(tag);
      const content = String(node?.innerHTML || '').trim();
      if (content) sections.push({ tag, content });
    });
    if (!sections.length) return;

    interfaceNode.style.display = 'block';
    interfaceNode.style.marginTop = '1em';
    wrapper.querySelector('.tx-pack-tabs')?.remove();
    viewport.replaceChildren();
    viewport.style.height = 'auto';
    viewport.style.maxHeight = 'none';
    viewport.style.overflow = 'visible';
    sections.forEach((section, index) => {
      const panel = parsed.createElement('details');
      panel.className = 'thx-static-section';
      panel.open = index === 0;
      panel.style.cssText = 'display:block;margin-bottom:1em;border-bottom:1px dashed currentColor;padding-bottom:.75em';
      const heading = parsed.createElement('summary');
      heading.textContent = section.tag.toUpperCase();
      heading.style.cssText = 'cursor:pointer;margin:0 0 .55em;font-size:.85em;font-weight:700;letter-spacing:.12em;opacity:.75';
      const content = parsed.createElement('div');
      content.innerHTML = section.content;
      panel.append(heading, content);
      viewport.appendChild(panel);
    });
    wrapper.querySelector('.tx-pack-toggle')?.remove();
    wrapper.querySelector('.theme-switch')?.remove();
    raw.remove();
    wrapper.dataset.parsed = 'static';
  });
}

function materializeStaticFrontends(parsed) {
  materializeTxPackFrontends(parsed);
}

export function sanitizeDocument(document, html) {
  const Parser = document.defaultView?.DOMParser || DOMParser;
  const parsed = new Parser().parseFromString(String(html || ''), 'text/html');
  materializeStaticFrontends(parsed);
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
  const frameDocument = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:transparent;color:inherit;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.65;overflow-wrap:anywhere}*{box-sizing:border-box}img,video{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow:auto}.hidden\\!{display:none!important}.TH-render>iframe,iframe.thx-rich-frame{display:block;width:100%;min-height:420px;border:0}</style></head><body class="mes_text">${html}</body></html>`;
  const iframe = createStaticFrame(document, frameDocument, title);
  return iframe.outerHTML;
}

function createStaticFrame(document, frameDocument, title, height = 720) {
  const iframe = document.createElement('iframe');
  iframe.className = 'thx-rich-frame';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('title', title);
  iframe.setAttribute('srcdoc', frameDocument);
  iframe.style.cssText = `display:block;width:100%;height:${height}px;border:0`;
  return iframe;
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

function getFrameHeight(frame) {
  if (!frame) return 720;
  const inlineHeight = Number.parseFloat(frame.style?.height || '');
  if (Number.isFinite(inlineHeight) && inlineHeight > 0) return Math.min(Math.max(inlineHeight, 180), 2400);
  try {
    const doc = frame.contentDocument || frame.contentWindow?.document;
    const height = Math.max(doc?.body?.scrollHeight || 0, doc?.documentElement?.scrollHeight || 0, frame.getBoundingClientRect?.().height || 0);
    if (height > 0) return Math.min(Math.max(height + 8, 180), 2400);
  } catch {}
  return 720;
}

function isFrontendSource(value) {
  const content = String(value || '');
  return ['html>', '<head>', '<body'].some(tag => content.includes(tag));
}

function replaceFrontendCodeBlocks(document, root, title) {
  let count = 0;
  Array.from(root.querySelectorAll('pre')).forEach(pre => {
    if (!root.contains(pre)) return;
    const code = pre.querySelector('code') || pre;
    const source = String(code.textContent || '').trim();
    if (!isFrontendSource(source)) return;
    count += 1;
    const frame = createStaticFrame(document, sanitizeDocument(document, source), `${title} 前端界面 ${count}`);
    const renderRoot = pre.closest('.TH-render');
    if (renderRoot && root.contains(renderRoot)) renderRoot.replaceWith(frame);
    else pre.replaceWith(frame);
  });
  return count;
}

function renderFrontendHtml(document, html, title) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const count = replaceFrontendCodeBlocks(document, template.content, title);
  return { html: template.innerHTML.trim(), count };
}

export function snapshotDisplayedMessage(document, tavernHelper, messageId, diagnostics) {
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
    const sourceFrame = sourceFrames[index];
    const captured = captureFrameDocument(sourceFrame);
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
    frame.style.cssText = `display:block;width:100%;height:${getFrameHeight(sourceFrame)}px;border:0`;
  });
  let frontendCount = 0;
  clone.querySelectorAll('.TH-render').forEach((renderRoot, index) => {
    const frame = renderRoot.querySelector('iframe.thx-rich-frame');
    if (frame) {
      frontendCount += 1;
      Array.from(renderRoot.children).forEach(child => { if (child !== frame) child.remove(); });
      return;
    }
    frontendCount += replaceFrontendCodeBlocks(document, renderRoot, `楼层 ${messageId} 快照 ${index + 1}`);
  });
  const sanitized = sanitizeFragment(document, clone.innerHTML, { keepSnapshotFrames: true });
  if (!hasMeaningfulContent(document, sanitized)) return null;
  if (diagnostics) diagnostics.frontends += frontendCount;
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
    const snapshot = snapshotDisplayedMessage(document, tavernHelper, message.id, diagnostics);
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
      const rendered = renderFrontendHtml(document, sanitized, `楼层 ${message.id}`);
      diagnostics.frontends += rendered.count;
      diagnostics.formatted += 1;
      return {
        ...message,
        html: isRichHtml(rendered.html) ? buildIsolatedFrame(document, rendered.html, `楼层 ${message.id} 富文本`) : rendered.html,
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
