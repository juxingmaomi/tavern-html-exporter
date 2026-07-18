import {
  BUTTON_NAME,
  SCRIPT_NAME,
  SCRIPT_VERSION,
  STORAGE_KEY,
  compileRules,
  normalizeMessage,
  normalizeSettings,
  parseJsonChat,
  shouldIncludeMessage,
} from './core.js';
import { buildExportFiles } from './archive.js';
import { renderCurrentMessage, renderImportedMessage } from './render.js';

const GLOBAL_KEY = '__TH_CHAT_HTML_EXPORTER_V1__';
const STYLE_ID = 'th-chat-html-exporter-v1-style';
const FALLBACK_ID = 'th-chat-html-exporter-v1-button';

function getHostWindow() {
  try {
    if (window.parent && window.parent !== window && window.parent.document) return window.parent;
  } catch {}
  return window;
}

function getHostDocument() {
  return getHostWindow().document;
}

function getTavernHelper() {
  const host = getHostWindow();
  return window.TavernHelper || host.TavernHelper || null;
}

function getSillyTavern() {
  const host = getHostWindow();
  return host.SillyTavern?.getContext?.() || host.SillyTavern || null;
}

function notify(type, message) {
  const host = getHostWindow();
  const toastr = host.toastr || window.toastr;
  if (toastr && typeof toastr[type] === 'function') toastr[type](message);
  else if (type === 'error') host.alert(message);
  else console.log(`[${SCRIPT_NAME}] ${message}`);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadSettings() {
  try {
    const raw = getHostWindow().localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeSettings({});
  }
}

function saveSettings(settings) {
  getHostWindow().localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
}

function getCurrentContext() {
  const st = getSillyTavern();
  const character = st?.characters?.[st?.characterId];
  let chatTitle = '当前聊天';
  try {
    chatTitle = st?.getCurrentChatId?.() || st?.chatId || chatTitle;
  } catch {}
  return {
    characterName: character?.name || st?.name2 || '角色',
    userName: st?.name1 || '用户',
    chatTitle: String(chatTitle).split(/[\\/]/).pop().replace(/\.jsonl?$/i, '') || '当前聊天',
  };
}

function createDiagnostics() {
  return { snapshots: 0, formatted: 0, plain: 0, frontends: 0, warnings: [] };
}

function injectStyle() {
  const document = getHostDocument();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .thx-export-overlay{position:fixed;inset:0;z-index:100500;background:rgba(8,12,16,.78);display:flex;align-items:center;justify-content:center;padding:18px}
    .thx-export-panel{width:min(920px,100%);max-height:min(900px,96vh);overflow:auto;background:#101820;color:#edf3ef;border:1px solid #40515c;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.42);font-family:"Microsoft YaHei","PingFang SC",sans-serif;contain:layout paint}
    .thx-export-head{position:sticky;top:0;z-index:4;display:flex;justify-content:space-between;gap:14px;align-items:center;padding:16px 18px;background:#14202a;border-bottom:1px solid #344650}.thx-export-head h2{margin:0;font-size:20px}.thx-export-head small{color:#9fb2aa}.thx-export-close{border:0;background:transparent;color:#fff;font-size:26px;cursor:pointer}
    .thx-export-body{padding:18px;display:grid;gap:16px}.thx-export-section{border:1px solid #344650;background:#121d25;padding:14px;border-radius:10px}.thx-export-section h3{margin:0 0 12px;font-size:16px}.thx-export-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.thx-export-field{display:grid;gap:6px}.thx-export-field>span{font-size:13px;color:#b9c8c1}.thx-export-panel input,.thx-export-panel select,.thx-export-panel textarea{width:100%;border:1px solid #435763;background:#0b141b;color:#edf3ef;border-radius:7px;padding:9px;font:inherit}.thx-export-panel textarea{resize:vertical}.thx-export-checks{display:flex;flex-wrap:wrap;gap:12px}.thx-export-checks label{display:flex;align-items:center;gap:6px}.thx-export-checks input{width:auto}
    .thx-rule-list{display:grid;gap:10px}.thx-rule{display:grid;grid-template-columns:1fr 2fr 90px 2fr auto;gap:8px;align-items:start}.thx-rule button,.thx-export-actions button,.thx-downloads button{border:1px solid #506773;background:#1f3540;color:#eef5f0;border-radius:7px;padding:9px 12px;cursor:pointer;font:inherit}.thx-rule button:hover,.thx-export-actions button:hover,.thx-downloads button:hover{background:#2a4855}.thx-export-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.thx-export-primary{background:#34735f!important;border-color:#5eaa8f!important;font-weight:700}.thx-export-status{color:#b9c8c1;font-size:13px}.thx-export-status.is-error{color:#ffaca2}.thx-downloads{display:grid;gap:8px}.thx-downloads a{display:block;color:#9fe1c6;overflow-wrap:anywhere}.thx-export-note{color:#aebeb6;font-size:13px;line-height:1.65}.thx-export-file[hidden]{display:none}.thx-export-fallback{position:fixed;right:18px;bottom:88px;z-index:10000;border:1px solid #6a8177;border-radius:999px;background:#29483e;color:white;padding:10px 14px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.3)}
    @media(max-width:720px){.thx-export-grid{grid-template-columns:1fr}.thx-rule{grid-template-columns:1fr}.thx-export-overlay{padding:6px}.thx-export-panel{max-height:98vh}}
  `;
  document.head.appendChild(style);
}

function panelMarkup(settings) {
  return `
    <div class="thx-export-panel" role="dialog" aria-modal="true" aria-label="聊天记录 HTML 导出器">
      <header class="thx-export-head"><div><h2>${SCRIPT_NAME}</h2><small>${SCRIPT_VERSION} · 安全重写版</small></div><button class="thx-export-close" type="button" aria-label="关闭">×</button></header>
      <div class="thx-export-body">
        <section class="thx-export-section">
          <h3>导出来源</h3>
          <div class="thx-export-grid">
            <label class="thx-export-field"><span>来源</span><select data-field="sourceMode"><option value="current"${settings.sourceMode === 'current' ? ' selected' : ''}>当前聊天（使用酒馆显示管线）</option><option value="jsonl"${settings.sourceMode === 'jsonl' ? ' selected' : ''}>本地 JSON / JSONL（安全离线模式）</option></select></label>
            <label class="thx-export-field thx-export-file" data-file-row><span>聊天文件</span><input type="file" accept=".json,.jsonl,.txt" data-field="chatFile"></label>
            <label class="thx-export-field"><span>文件名模板</span><input data-field="filename" value="${escapeHtml(settings.filename)}"><small>{{char}} {{user}} {{chat}} {{date}}</small></label>
            <label class="thx-export-field"><span>每个 HTML 的消息数</span><input type="number" min="10" max="500" data-field="messagesPerFile" value="${settings.messagesPerFile}"></label>
            <label class="thx-export-field"><span>主题</span><select data-field="exportTheme"><option value="paper"${settings.exportTheme === 'paper' ? ' selected' : ''}>纸张白</option><option value="eye"${settings.exportTheme === 'eye' ? ' selected' : ''}>护眼绿</option><option value="dark"${settings.exportTheme === 'dark' ? ' selected' : ''}>深色</option></select></label>
          </div>
          <div class="thx-export-checks">
            <label><input type="checkbox" data-field="includeUser"${settings.includeUser ? ' checked' : ''}>用户消息</label>
            <label><input type="checkbox" data-field="includeAssistant"${settings.includeAssistant ? ' checked' : ''}>角色消息</label>
            <label><input type="checkbox" data-field="includeSystem"${settings.includeSystem ? ' checked' : ''}>系统/旁白</label>
            <label><input type="checkbox" data-field="includeHidden"${settings.includeHidden ? ' checked' : ''}>隐藏楼层</label>
            <label><input type="checkbox" data-field="preferDisplayedSnapshot"${settings.preferDisplayedSnapshot ? ' checked' : ''}>优先保存已显示界面快照</label>
          </div>
          <p class="thx-export-note">当前聊天只调用一次酒馆格式化；已显示的复杂界面会保存为禁止脚本的静态快照。未打开的 JSONL 不会伪造酒馆楼层上下文。</p>
        </section>
        <section class="thx-export-section">
          <h3>自定义正则</h3>
          <div class="thx-rule-list" data-rule-list></div>
          <div class="thx-export-actions"><button type="button" data-add-rule>增加规则</button></div>
          <p class="thx-export-note">支持 <code>$0</code>、<code>$&</code>、<code>$1</code>、<code>$&lt;name&gt;</code>、<code>${'${name}'}</code> 和 <code>{{match}}</code>。启用自定义规则时，该楼层使用标准酒馆格式而不是现成 DOM 快照。</p>
        </section>
        <section class="thx-export-section">
          <h3>自定义 CSS</h3>
          <textarea rows="5" data-field="customCss" placeholder=".thx-message { ... }">${escapeHtml(settings.customCss)}</textarea>
          <p class="thx-export-note">CSS 会通过 <code>textContent</code> 安全写入导出页，不能闭合标签或注入脚本。</p>
        </section>
        <section class="thx-export-section">
          <div class="thx-export-actions"><button type="button" class="thx-export-primary" data-export>生成 HTML</button><span class="thx-export-status" data-status>准备好了。</span></div>
          <div class="thx-downloads" data-downloads></div>
        </section>
      </div>
    </div>`;
}

function createRuleElement(document, rule = {}) {
  const row = document.createElement('div');
  row.className = 'thx-rule';
  row.innerHTML = `
    <input data-rule="name" placeholder="规则名" value="${escapeHtml(rule.name || '')}">
    <input data-rule="pattern" placeholder="正则，例如 /<tag>(.*?)<\\/tag>/gs" value="${escapeHtml(rule.pattern || '')}">
    <input data-rule="flags" placeholder="flags" value="${escapeHtml(rule.flags || 'gs')}">
    <textarea rows="2" data-rule="replacement" placeholder="替换 HTML">${escapeHtml(rule.replacement || '')}</textarea>
    <button type="button" data-delete-rule>删除</button>`;
  row.querySelector('[data-delete-rule]').addEventListener('click', () => row.remove());
  return row;
}

function collectSettings(panel) {
  const get = name => panel.querySelector(`[data-field="${name}"]`);
  return normalizeSettings({
    sourceMode: get('sourceMode').value,
    filename: get('filename').value,
    messagesPerFile: get('messagesPerFile').value,
    exportTheme: get('exportTheme').value,
    includeUser: get('includeUser').checked,
    includeAssistant: get('includeAssistant').checked,
    includeSystem: get('includeSystem').checked,
    includeHidden: get('includeHidden').checked,
    preferDisplayedSnapshot: get('preferDisplayedSnapshot').checked,
    customCss: get('customCss').value,
    rules: Array.from(panel.querySelectorAll('.thx-rule')).map((row, index) => ({
      enabled: true,
      name: row.querySelector('[data-rule="name"]').value || `规则 ${index + 1}`,
      pattern: row.querySelector('[data-rule="pattern"]').value,
      flags: row.querySelector('[data-rule="flags"]').value,
      replacement: row.querySelector('[data-rule="replacement"]').value,
    })),
  });
}

function setStatus(panel, message, error = false) {
  const node = panel.querySelector('[data-status]');
  node.textContent = message;
  node.classList.toggle('is-error', error);
}

async function yieldToBrowser() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function prepareCurrentExport(document, settings, rules, diagnostics) {
  const helper = getTavernHelper();
  if (!helper || typeof helper.getChatMessages !== 'function' || typeof helper.getLastMessageId !== 'function') {
    throw new Error('没有找到酒馆助手聊天 API，请确认酒馆助手已启用。');
  }
  const lastId = helper.getLastMessageId();
  if (lastId === null || lastId < 0) throw new Error('当前聊天没有消息。');
  const context = getCurrentContext();
  const rawMessages = helper.getChatMessages(`0-${lastId}`, { role: 'all', hide_state: 'all', include_swipes: false }) || [];
  const messages = rawMessages.map((message, index) => normalizeMessage(message, index, context)).filter(message => shouldIncludeMessage(message, settings));
  const records = [];
  for (let index = 0; index < messages.length; index += 1) {
    records.push(await renderCurrentMessage({ document, tavernHelper: helper, message: messages[index], rules, settings, diagnostics }));
    if (index > 0 && index % 20 === 0) await yieldToBrowser();
  }
  return { records, context };
}

async function prepareFileExport(document, file, settings, rules, diagnostics) {
  if (!file) throw new Error('请选择 JSON 或 JSONL 文件。');
  const parsed = parseJsonChat(await file.text());
  diagnostics.warnings.push(...parsed.warnings);
  const context = {
    characterName: parsed.metadata.character_name || parsed.metadata.ch_name || parsed.metadata.name || '角色',
    userName: parsed.metadata.user_name || '用户',
    chatTitle: file.name.replace(/\.(?:jsonl?|txt)$/i, ''),
  };
  const messages = parsed.messages.map((message, index) => normalizeMessage(message, index, context)).filter(message => shouldIncludeMessage(message, settings));
  const records = messages.map(message => renderImportedMessage({ document, message, rules, diagnostics }));
  return { records, context };
}

function showDownloads(panel, files, diagnostics) {
  const document = panel.ownerDocument;
  const container = panel.querySelector('[data-downloads]');
  const urls = files.map(file => ({
    name: file.name,
    url: URL.createObjectURL(new Blob(['\uFEFF', file.html], { type: 'text/html;charset=utf-8' })),
  }));
  container.innerHTML = `<p class="thx-export-note">已生成 ${files.length} 个文件。酒馆快照 ${diagnostics.snapshots} 条，酒馆格式 ${diagnostics.formatted} 条，前端静态界面 ${diagnostics.frontends} 个，安全文本 ${diagnostics.plain} 条。</p>`;
  if (diagnostics.warnings.length) {
    const details = document.createElement('details');
    details.innerHTML = `<summary>查看 ${diagnostics.warnings.length} 条提示</summary><pre>${escapeHtml(diagnostics.warnings.join('\n'))}</pre>`;
    container.appendChild(details);
  }
  urls.forEach(file => {
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    link.textContent = `下载 ${file.name}`;
    container.appendChild(link);
  });
  if (urls.length > 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '依次下载全部文件';
    button.addEventListener('click', () => urls.forEach((file, index) => setTimeout(() => {
      const link = document.createElement('a');
      link.href = file.url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, index * 450)));
    container.appendChild(button);
  }
  panel.__thxUrls = urls.map(file => file.url);
}

function closePanel(overlay) {
  const panel = overlay.querySelector('.thx-export-panel');
  for (const url of panel?.__thxUrls || []) URL.revokeObjectURL(url);
  if (panel) {
    panel.__thxUrls = [];
    panel.querySelector('[data-downloads]')?.replaceChildren();
  }
  overlay.remove();
}

export function openExporterPanel() {
  injectStyle();
  const document = getHostDocument();
  const existing = document.querySelector('.thx-export-overlay');
  if (existing) closePanel(existing);
  const settings = loadSettings();
  const overlay = document.createElement('div');
  overlay.className = 'thx-export-overlay';
  overlay.innerHTML = panelMarkup(settings);
  document.body.appendChild(overlay);
  const panel = overlay.querySelector('.thx-export-panel');
  const ruleList = panel.querySelector('[data-rule-list]');
  settings.rules.forEach(rule => ruleList.appendChild(createRuleElement(document, rule)));
  const updateSource = () => {
    panel.querySelector('[data-file-row]').hidden = panel.querySelector('[data-field="sourceMode"]').value !== 'jsonl';
  };
  updateSource();
  panel.querySelector('[data-field="sourceMode"]').addEventListener('change', updateSource);
  panel.querySelector('[data-add-rule]').addEventListener('click', () => ruleList.appendChild(createRuleElement(document, { flags: 'gs' })));
  panel.querySelector('.thx-export-close').addEventListener('click', () => closePanel(overlay));
  overlay.addEventListener('click', event => { if (event.target === overlay) closePanel(overlay); });
  panel.querySelector('[data-export]').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const nextSettings = collectSettings(panel);
      saveSettings(nextSettings);
      const rules = compileRules(nextSettings.rules);
      const diagnostics = createDiagnostics();
      setStatus(panel, '正在读取并渲染消息…');
      const prepared = nextSettings.sourceMode === 'current'
        ? await prepareCurrentExport(document, nextSettings, rules, diagnostics)
        : await prepareFileExport(document, panel.querySelector('[data-field="chatFile"]').files?.[0], nextSettings, rules, diagnostics);
      if (!prepared.records.length) throw new Error('筛选后没有可以导出的消息。');
      setStatus(panel, '正在生成 HTML 文件…');
      const files = buildExportFiles(prepared.records, nextSettings, prepared.context);
      for (const url of panel.__thxUrls || []) URL.revokeObjectURL(url);
      showDownloads(panel, files, diagnostics);
      setStatus(panel, `完成：${prepared.records.length} 条消息，${files.length} 个 HTML。`);
      notify('success', `${SCRIPT_NAME} 已生成 ${files.length} 个文件。`);
    } catch (error) {
      console.error(`[${SCRIPT_NAME}] 导出失败`, error);
      setStatus(panel, `导出失败：${error.message || error}`, true);
      notify('error', `导出失败：${error.message || error}`);
    } finally {
      button.disabled = false;
    }
  });
}

function injectFallbackButton() {
  const document = getHostDocument();
  if (document.getElementById(FALLBACK_ID)) return;
  injectStyle();
  const button = document.createElement('button');
  button.id = FALLBACK_ID;
  button.className = 'thx-export-fallback';
  button.type = 'button';
  button.textContent = BUTTON_NAME;
  button.addEventListener('click', openExporterPanel);
  document.body.appendChild(button);
}

function registerButton() {
  const runtime = window;
  try {
    runtime.appendInexistentScriptButtons?.([{ name: BUTTON_NAME, visible: true }]);
    if (typeof runtime.eventOnButton === 'function') {
      runtime.eventOnButton(BUTTON_NAME, openExporterPanel);
      return;
    }
    if (typeof runtime.getButtonEvent === 'function' && typeof runtime.eventOn === 'function') {
      runtime.eventOn(runtime.getButtonEvent(BUTTON_NAME), openExporterPanel);
      return;
    }
  } catch (error) {
    console.warn(`[${SCRIPT_NAME}] 酒馆助手按钮注册失败`, error);
  }
  injectFallbackButton();
}

export function startExporter() {
  const host = getHostWindow();
  if (host[GLOBAL_KEY]?.version === SCRIPT_VERSION) return host[GLOBAL_KEY];
  const api = { version: SCRIPT_VERSION, open: openExporterPanel };
  host[GLOBAL_KEY] = api;
  const register = () => {
    injectStyle();
    registerButton();
    console.info(`[${SCRIPT_NAME}] ${SCRIPT_VERSION} loaded.`);
  };
  if (getHostDocument().readyState === 'loading') getHostDocument().addEventListener('DOMContentLoaded', register, { once: true });
  else register();
  return api;
}
