# 发布清单

## 已完成

- ✅ GitHub 仓库：https://github.com/liubaibuliuyan/dsh-session-delete
  （public、默认分支 `main`、话题 `dsh-plugin / deepseek-harness / cordis / dsh / session / trash / delete`）
- ✅ Release：`v1.0.0` 与 **`v1.1.0`**（后者含 tgz 附件与中文说明）
- ✅ 分发方式：Git（`dsh plugin add github:liubaibuliuyan/dsh-session-delete`）、Release tgz、clone
- ✅ 插件广场投稿 PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/17080
  —— 文件 `data/plugins/liubaibuliuyan__dsh-session-delete.yml`，分类 `session`
- ✅ 广场索引条目（备查）：`dist/market-entry.json`

## 不需要 npm

本项目走 GitHub 分发，`npm publish` 不是必需步骤。若将来想上 npm：

```bash
cd dist/@liubaibuliuyan/dsh-session-delete
npm login && npm publish --access public
```

或配置 `NPM_TOKEN` 后在 Actions 页面手动触发 `.github/workflows/publish.yml`。

## 广场收录时间线

1. PR 合并到 `awesome-dsh-plugin`（维护者审阅；CI 会校验 `dsh.bundle`、仓库年龄、`dsh-plugin` topic）
2. 上游 README 自动重新生成
3. `realguan/dsh-plugin-market` 次日 **03:17 UTC** 重建索引
4. DSH 里 **插件 → 发现** 可搜到（自定义插件市场默认关闭时需先在「实验性插件」里打开）

## 发布前的本地验证（可选，不需要 npm）

```bash
dsh plugin --profile desktop remove @liubaibuliuyan/dsh-session-delete
dsh plugin --profile desktop add ./dist/@liubaibuliuyan/dsh-session-delete/liubaibuliuyan-dsh-session-delete-1.1.0.tgz
```

重启桌面后确认：会话行垃圾桶、菜单「删除对话…」、设置页「删除对话」。



## 第 1 步：在 GitHub 建仓库

打开 https://github.com/new ，仓库名填 **`dsh-session-delete`**，**不要**勾选
"Add a README / .gitignore / license"（本地已有），然后 Create。

或者用 API（有 token 时）：

```bash
curl -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user/repos \
  -d '{"name":"dsh-session-delete","description":"Delete conversations in DeepSeek Harness, with a restorable trash","private":false}'
```

## 第 2 步：推送

仓库建好后：

```bash
cd D:\aitest\plugins\dsh-session-delete
git push -u origin main
```

首次推送会要求认证。任一即可：

- 用 PAT 覆盖 URL 一次性推送：
  `git push https://<你的PAT>@github.com/liubaibuliuyan/dsh-session-delete.git main`
- 或先 `git config --global credential.helper manager`（Windows 会弹窗登录）

## 第 3 步：发布到 npm

```bash
cd D:\aitest\plugins\dsh-session-delete\dist\@liubaibuliuyan\dsh-session-delete
npm login          # 只有第一次需要
npm publish --access public
```

`publish.config.json` 里已经配好 `publishConfig.access = public`，scoped 包必须带 `--access public`。

## 第 4 步：提交到插件广场

1. 给 `dist/market-entry.json` 的 `versions[0]` 补 `publishTimestamp`（Unix 秒，例如 `1794900000`）。
2. 把该条目 PR 到广场索引仓库（索引格式：顶层 `{format, title, description, metadata, plugins[]}`，
   本条目放进 `plugins` 数组）。分类 `session` = 「会话与消息」。

## 发布前的本地验证（可选）

想先确认"改名后的身份"能正常挂载，可以不发布就试装：

```bash
dsh plugin --profile desktop remove @local/dsh-session-delete     # 先卸掉开发版，避免两个入口并存
dsh plugin --profile desktop add ./dist/@liubaibuliuyan/dsh-session-delete/liubaibuliuyan-dsh-session-delete-1.0.0.tgz
```

重启桌面后看侧边栏会话行有没有垃圾桶图标、设置里有没有「删除对话」页。

回滚：

```bash
dsh plugin --profile desktop remove @liubaibuliuyan/dsh-session-delete
dsh plugin --profile desktop add D:\aitest\plugins\dsh-session-delete   # 装回开发版（link）
```
