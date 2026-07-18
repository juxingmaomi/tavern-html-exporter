import { SCRIPT_NAME, SCRIPT_VERSION, chunk, resolveFilename } from './core.js';

const THEMES = {
  paper: {
    label: '纸张白', background: '#ece8df', paper: '#fffdf8', ink: '#28241f', muted: '#746c62',
    line: '#d7cfc3', user: '#e8f2ef', assistant: '#f7f0df', system: '#ece9e4', accent: '#476f64',
  },
  eye: {
    label: '护眼绿', background: '#dfe9dc', paper: '#eef6ea', ink: '#26372e', muted: '#62766c',
    line: '#b9cbbd', user: '#d5e9e1', assistant: '#e4efdc', system: '#e8e5d8', accent: '#3f705d',
  },
  dark: {
    label: '深色', background: '#0c1116', paper: '#141c23', ink: '#e8ede8', muted: '#9aa9a1',
    line: '#34434a', user: '#183a3b', assistant: '#352f2b', system: '#292c2e', accent: '#8fcdb8',
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildPartName(baseName, part, total) {
  if (total <= 1) return `${baseName}_${SCRIPT_VERSION}.html`;
  return `${baseName}_${SCRIPT_VERSION}_${String(part).padStart(2, '0')}.html`;
}

function buildNavigation(baseName, part, total) {
  if (total <= 1) return '';
  const previous = part > 1
    ? `<a href="${escapeHtml(buildPartName(baseName, part - 1, total))}">上一页</a>`
    : '<span aria-disabled="true">上一页</span>';
  const next = part < total
    ? `<a href="${escapeHtml(buildPartName(baseName, part + 1, total))}">下一页</a>`
    : '<span aria-disabled="true">下一页</span>';
  return `<nav class="thx-nav">${previous}<strong>第 ${part} / ${total} 页</strong>${next}</nav>`;
}

function buildMessages(records) {
  return records.map(record => `
    <article class="thx-message thx-${escapeHtml(record.role)}${record.hidden ? ' is-hidden' : ''}" id="msg-${escapeHtml(record.id)}" data-floor="${escapeHtml(record.id)}">
      <header>
        <strong>${escapeHtml(record.name)}</strong>
        <span>#${escapeHtml(record.id)} · ${escapeHtml(record.role)} · ${escapeHtml(record.source)}</span>
      </header>
      <section class="thx-content mes_text">${record.html}</section>
    </article>`).join('');
}

export function buildArchiveDocument(records, meta) {
  const theme = THEMES[meta.settings.exportTheme] || THEMES.paper;
  const navigation = buildNavigation(meta.baseName, meta.part, meta.totalParts);
  const customCssJson = escapeJsonForHtml(String(meta.settings.customCss || ''));
  const title = escapeHtml(meta.title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root{color-scheme:${meta.settings.exportTheme === 'dark' ? 'dark' : 'light'};--bg:${theme.background};--paper:${theme.paper};--ink:${theme.ink};--muted:${theme.muted};--line:${theme.line};--user:${theme.user};--assistant:${theme.assistant};--system:${theme.system};--accent:${theme.accent}}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;line-height:1.72;padding:24px}.thx-shell{width:min(980px,100%);margin:auto}.thx-title,.thx-tools,.thx-nav,.thx-message{background:var(--paper);border:1px solid var(--line);box-shadow:0 10px 28px rgba(0,0,0,.07)}.thx-title{padding:20px;margin-bottom:18px}.thx-title h1{margin:0 0 8px;font-size:clamp(24px,4vw,36px)}.thx-title p{margin:0;color:var(--muted)}.thx-tools{position:sticky;top:8px;z-index:20;display:flex;flex-wrap:wrap;gap:8px;padding:10px;margin-bottom:18px}.thx-tools input{flex:1;min-width:180px}.thx-tools input,.thx-tools button{border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:8px 10px;font:inherit}.thx-tools button{cursor:pointer}.thx-message{margin:0 0 16px;overflow:hidden}.thx-message>header{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line)}.thx-message>header span{color:var(--muted);font-size:12px}.thx-content{padding:16px;overflow-wrap:anywhere}.thx-user{background:linear-gradient(var(--user),var(--user))}.thx-assistant{background:linear-gradient(var(--assistant),var(--assistant))}.thx-system{background:linear-gradient(var(--system),var(--system))}.thx-message.is-hidden{border-style:dashed}.thx-content img,.thx-content video{max-width:100%;height:auto}.thx-content pre{white-space:pre-wrap;overflow:auto}.thx-content table{max-width:100%;border-collapse:collapse}.thx-content td,.thx-content th{border:1px solid var(--line);padding:6px}.thx-rich-frame{display:block;width:100%;height:420px;border:1px solid var(--line);background:white}.thx-frame-note{padding:10px;border:1px dashed var(--line);color:var(--muted)}.thx-nav{display:flex;justify-content:center;align-items:center;gap:18px;padding:12px;margin:18px 0}.thx-nav a{color:var(--accent);font-weight:700}.thx-nav span{color:var(--muted)}.thx-hidden-by-search{display:none!important}@media(max-width:640px){body{padding:10px}.thx-message>header{flex-direction:column}.thx-tools{top:0}}
  </style>
  <script type="application/json" id="thx-custom-css">${customCssJson}</script>
</head>
<body>
  <main class="thx-shell">
    <header class="thx-title">
      <h1>${title}</h1>
      <p>${escapeHtml(meta.characterName)} / ${escapeHtml(meta.chatTitle)} · ${records.length} 条 · ${escapeHtml(theme.label)} · ${SCRIPT_NAME} ${SCRIPT_VERSION}</p>
    </header>
    <section class="thx-tools">
      <input type="search" data-thx-search placeholder="搜索当前文件中的文字">
      <input type="number" min="0" step="1" data-thx-floor placeholder="楼层号">
      <button type="button" data-thx-jump>跳转</button>
      <button type="button" data-thx-bookmark>标记当前位置</button>
      <button type="button" data-thx-return>回到标记</button>
    </section>
    ${navigation}
    ${buildMessages(records)}
    ${navigation}
  </main>
  <script>
    (() => {
      const cssNode = document.getElementById('thx-custom-css');
      if (cssNode) {
        try {
          const style = document.createElement('style');
          style.textContent = JSON.parse(cssNode.textContent || '""');
          document.head.appendChild(style);
        } catch (error) {
          console.warn('自定义 CSS 无法读取', error);
        }
      }
      const resizeFrame = (frame, depth = 0) => {
        try {
          const doc = frame.contentDocument;
          if (!doc) return;
          doc.querySelectorAll('iframe.thx-rich-frame').forEach(innerFrame => {
            if (!innerFrame.dataset.thxResizeBound) {
              innerFrame.dataset.thxResizeBound = '1';
              innerFrame.addEventListener('load', () => resizeFrame(innerFrame, depth + 1));
            }
            resizeFrame(innerFrame, depth + 1);
          });
          const height = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0, 180);
          const maxHeight = depth === 0 ? 50000 : 12000;
          frame.style.height = Math.min(height + 8, maxHeight) + 'px';
        } catch {}
      };
      document.querySelectorAll('iframe.thx-rich-frame').forEach(frame => {
        frame.addEventListener('load', () => resizeFrame(frame));
        setTimeout(() => resizeFrame(frame), 80);
        setTimeout(() => resizeFrame(frame), 500);
        setTimeout(() => resizeFrame(frame), 1500);
      });
      const messages = Array.from(document.querySelectorAll('.thx-message'));
      document.querySelector('[data-thx-search]')?.addEventListener('input', event => {
        const query = event.target.value.trim().toLowerCase();
        messages.forEach(message => message.classList.toggle('thx-hidden-by-search', query && !message.textContent.toLowerCase().includes(query)));
      });
      const jump = () => {
        const value = document.querySelector('[data-thx-floor]')?.value;
        const target = document.querySelector('[data-floor="' + CSS.escape(String(value || '')) + '"]');
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      document.querySelector('[data-thx-jump]')?.addEventListener('click', jump);
      document.querySelector('[data-thx-floor]')?.addEventListener('keydown', event => { if (event.key === 'Enter') jump(); });
      const key = 'thx-bookmark:' + location.pathname;
      document.querySelector('[data-thx-bookmark]')?.addEventListener('click', () => {
        try { localStorage.setItem(key, String(window.scrollY)); } catch {}
      });
      document.querySelector('[data-thx-return]')?.addEventListener('click', () => {
        try { window.scrollTo({ top: Number(localStorage.getItem(key) || 0), behavior: 'smooth' }); } catch {}
      });
    })();
  </script>
</body>
</html>`;
}

export function buildExportFiles(records, settings, context) {
  const baseName = resolveFilename(settings.filename, context);
  const groups = chunk(records, settings.messagesPerFile);
  const totalParts = groups.length;
  return groups.map((group, index) => ({
    name: buildPartName(baseName, index + 1, totalParts),
    html: buildArchiveDocument(group, {
      title: totalParts > 1 ? `${baseName} · ${index + 1}` : baseName,
      baseName,
      part: index + 1,
      totalParts,
      settings,
      characterName: context.characterName,
      chatTitle: context.chatTitle,
    }),
  }));
}
