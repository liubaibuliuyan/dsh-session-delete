# 变更记录

## 1.0.0

首个可发布版本。把「删除对话」做成一个动作，而不是「删日志 + 清残留」两个插件。

### 一次做四件事

- 会话日志目录移入回收站（`rename`，可还原）
- 投影缓存同步删除（含 `.bak.<stamp>`）
- 工作区记账、归档集合、置顶集合通过公开 API 拆干净
- 补发 `api-session/removed`，前端列表即刻消失；还原时补 `api-session/added`

### 入口

- 会话「…」菜单 → 删除对话…（`sidebar.workspaces.session.menu.item`，order 500）
- 会话行悬停垃圾桶（`sidebar.workspaces.session.row.action`，order 150）
- 设置 → 删除对话（`settings.section`，order 41）：回收站还原 / 彻底删除 / 残留清理

### 修复

- **运行中判定**：改用 `agents.turnBoundaryOf(session).openTurnStartSeq`，只有存在未结束的回合才拒绝。
  旧实现把「有活 Agent」当成「运行中」，而会话只要被打开过 Agent 就常驻，
  导致「当前正开着的对话」永远删不掉。
- **Windows 文件占用**：`fs.rename` 命中 `EPERM/EBUSY` 时退避重试（Host 4 次、客户端 3 次），
  并把这类失败映射成明确的 `in-use`，不再抛原始错误串。
- **失败原因可见**：Host 用 409 表达「一条都没成功」时，前端会读取 `failed[]` 并翻译成人话，
  不再只显示 `HTTP 409`。
- **残量扫描**：同一会话的 `session-x.json` 与 `session-x.json.bak.*` 归并成一行统计。

### 交互

- 行内 ✓ / ✕ 确认，替换模态弹窗；✓ 自动获取焦点（回车确认、Esc 取消）。
- 结果用右下角小弹窗：成功 2 秒自动消失；失败常驻并写明原因，带 × 与 Esc 关闭。
- 全部配色改用真实主题 token（`bg-overlay` / `label-primary` / `border-l1` 等），
  不再使用臆造的 `--dsw-alias-bg-elevated`（该变量不存在，会回落到硬编码深色）。

### 已知限制

- 不解压、不解析会话内容，只按目录与文件名工作；因此日志格式升版不影响，目录改名才会失效。
- `%TEMP%\dsh-spill-*` 不在清理范围：那里的目录名是会话 id 的截断哈希，没有可靠的逐会话映射。
- 不向 Agent 开放删除工具，破坏性动作保持用户专属。
