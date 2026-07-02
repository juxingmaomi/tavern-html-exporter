# Tavern HTML Exporter

聊天记录 HTML 导出器的 GitHub 发布版。

## 当前版本

- `v0.31`

## 酒馆入口壳

导入 `聊天记录HTML导出器-GitHub入口壳.json` 后，脚本会从 jsDelivr 加载指定版本：

```js
https://gcore.jsdelivr.net/gh/juxingmaomi/tavern-html-exporter@v0.31/index.js
```

以后更新版本时，只需要在入口壳里修改：

```js
const VERSION = 'v0.31';
```

例如改成：

```js
const VERSION = 'v0.32';
```

然后保存脚本即可。

## 发布说明

每个稳定版都会打一个 Git tag，例如 `v0.31`。入口壳通过 tag 固定版本，避免 GitHub 最新代码变化后影响已经在用的版本。
