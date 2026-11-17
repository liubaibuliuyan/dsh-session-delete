# 投稿文件（待提 PR）

这里放的是提交给 [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的
条目文件。DSH 插件广场（`realguan/dsh-plugin-market`）的条目数据来自那个列表，索引每天
03:17 UTC 自动重建，所以**进列表是出现在广场里的第一步**。

## 怎么提交

把 `liubaibuliuyan__dsh-session-delete.yml` 放到上游仓库的 `data/plugins/` 目录下，
文件名必须是 `<owner>__<repo>.yml`，然后开 PR。一个文件就是全部投稿，README 由上游脚本生成。

## 上游的硬性条件（逐条对照）

| 条件 | 我们的状态 |
|---|---|
| `package.json` 声明 `dsh.bundle` manifest | ✅ `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` |
| 仓库有真实可用的代码 | ✅ Host + Client 合计约 60 KB，含 39 项自测 |
| 仓库创建满 **1 天** | ⏳ 仓库建于 2026-11-17，**次日**才满足；提前提交会被 CI 自动拒 |
| 打上 `dsh-plugin` topic | ✅ 已设置 |
| `description.en` 必填、以句号结尾 | ✅ 已写；含 `: ` 已按规则加引号 |
| `icon` 可选，须是 GitHub 托管的**位图** | ✅ `assets/icon-180.png`（SVG 不被接受） |

## 时间线

1. 仓库满 1 天后开 PR（`data/plugins/liubaibuliuyan__dsh-session-delete.yml`）
2. 合并后上游自动重新生成 README
3. 广场索引下次重建（每天 03:17 UTC）后，在 DSH 的 **插件 → 发现** 里就能搜到
4. 若同时发布了 npm 包，卡片会带上推荐版本与 `engines.dsh` 兼容性标注
