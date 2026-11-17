# 发布清单

## 已完成

- ✅ GitHub 仓库已创建并推送：https://github.com/liubaibuliuyan/dsh-session-delete
  （public、默认分支 `main`、话题 `dsh-plugin / deepseek-harness / cordis / dsh / session / trash / delete`）
- ✅ 分支已跟踪 `origin/main`，提交历史：`49e1cb5` → `5780148`
- ✅ 发布产物已生成并校验：`dist/@liubaibuliuyan/dsh-session-delete/`（9 个文件，71 KB）
- ✅ 可安装 tarball：`dist/@liubaibuliuyan/dsh-session-delete/liubaibuliuyan-dsh-session-delete-1.0.0.tgz`
- ✅ 广场索引条目：`dist/market-entry.json`（图标走 GitHub 直链，不依赖 npm 是否已发布）
- ✅ 打 tag 自动发布的工作流：`.github/workflows/publish.yml`

## 唯一剩下的：npm 认证

本机没有任何 npm 凭据（无 `~/.npmrc`、无凭据管理器条目，`npm whoami` 返回 `ENEEDAUTH`）。
两种任选其一：

### 方案 A：本地登录后发布（最快）

```bash
cd D:\aitest\plugins\dsh-session-delete\dist\@liubaibuliuyan\dsh-session-delete
npm login
npm publish --access public
```

### 方案 B：交给 GitHub Actions（一次配置，以后打 tag 即发）

1. 在 npm 生成 Automation token：https://www.npmjs.com/settings/~/tokens
2. 仓库 Settings → Secrets and variables → Actions → New repository secret，
   名字 **`NPM_TOKEN`**，值粘贴 token。
3. 打 tag 触发：

```bash
cd D:\aitest\plugins\dsh-session-delete
git tag v1.0.0 && git push --tags
```

工作流会先跑 `node test/selftest.mjs`（32 项断言），通过后才 `npm publish`。

## 发布后：提交到插件广场

1. 给 `dist/market-entry.json` 的 `versions[0]` 补 `publishTimestamp`（Unix 秒，如 `1794950400`）。
2. 把该条目 PR 到广场索引仓库（顶层格式 `{format, title, description, metadata, plugins[]}`，
   本条目放进 `plugins` 数组）。分类 `session` = 「会话与消息」。

## 发布前的本地验证（可选，不需要 npm）

```bash
dsh plugin --profile desktop remove @local/dsh-session-delete     # 先卸开发版，避免两个入口并存
dsh plugin --profile desktop add ./dist/@liubaibuliuyan/dsh-session-delete/liubaibuliuyan-dsh-session-delete-1.0.0.tgz
```

重启桌面后确认：会话行垃圾桶、菜单「删除对话…」、设置页「删除对话」。

回滚：

```bash
dsh plugin --profile desktop remove @liubaibuliuyan/dsh-session-delete
dsh plugin --profile desktop add D:\aitest\plugins\dsh-session-delete   # 装回开发版（link）
```


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
