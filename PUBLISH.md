# 发布清单

本地已完成的部分：

- 仓库已初始化并提交（`feat: 统一的删除对话插件 v1.0.0`），分支 `main`
- 发布产物已生成并校验：`dist/@liubaibuliuyan/dsh-session-delete/`（9 个文件）
- 可安装的 tarball 已打好：`dist/@liubaibuliuyan/dsh-session-delete/liubaibuliuyan-dsh-session-delete-1.0.0.tgz`
- 广场索引条目已生成：`dist/market-entry.json`

卡住的两步需要凭据，本机目前都没有（无 token、无 SSH key、无 `gh` CLI、npm 未登录）。

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
