# 聊天记录 HTML 导出器 GitHub 版使用说明

## 第一次使用

导入这个文件：

`D:\Codex\UserFiles\outputs\聊天记录HTML导出器-GitHub入口壳.json`

导入以后，酒馆会从 GitHub 加载：

`https://gcore.jsdelivr.net/gh/juxingmaomi/tavern-html-exporter@v0.31/index.js`

## 以后更新版本

打开酒馆助手脚本，找到入口壳里的这一行：

```js
const VERSION = 'v0.31';
```

把版本号改成新版本，例如：

```js
const VERSION = 'v0.32';
```

保存后刷新页面即可。

## 重要提醒

- GitHub 上必须真的发布了对应 tag，例如 `v0.31`，入口壳才能加载成功。
- 如果刚发布后加载失败，可能是 jsDelivr 缓存还没刷新，等一两分钟再试。
- 如果想回退旧版本，把版本号改回旧 tag 即可。
