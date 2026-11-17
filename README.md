# 删除对话 · dsh-session-delete

给 DeepSeek Harness 补上「删除对话」。会话日志、投影缓存、工作区记账、前端列表在**同一步**里一起干净，
删掉的先进回收站，随时能还原。

> **English**: DSH ships no *delete* verb for conversations — sessions can be archived, never removed.
> This plugin performs the whole delete in one step (log directory → recoverable trash, projection cache,
> workspace bookkeeping, front-end list) and refuses only when a turn is actually running.

## 为什么需要它

核心不是"忘了做"，而是明确不做：`sessionPersistence` 只有 `create / open / flush / stat / list`，
`sessionProjectionCache` 只有读写、没有 evict，两个包的文档都写着清理属于带外维护
（"same stance as session persistence itself"）。归档只是一个可逆的隐藏标记，磁盘上什么都没少。

所以这个插件做的不是"加个按钮"，而是把缺失的那条链路补齐，并且保证它可以撤销。

## 四个动作，一步完成

| # | 动作 | 落点 |
|---|---|---|
| 1 | 会话日志目录移入回收站 | `$DSH_HOME/.trash/session-delete/<entryId>/payload` |
| 2 | 投影缓存同步删除（含 `.bak.<stamp>`） | `$DSH_HOME/storages/session_projcache/sessions/<id>.json` |
| 3 | 工作区记账 / 归档集合 / 置顶集合拆干净 | 公开 API：`detachSession` / `unarchiveSession` / `unpinSession` |
| 4 | 前端列表立即消失，无需重启 | 补发 `api-session/removed`；还原时补 `api-session/added` |

派生子会话按 `header.parentSession` 级联，父会话与它的分叉一起处理。

## 怎么用

三个入口，都是就地确认，不弹对话框：

| 入口 | 位置 |
|---|---|
| 会话「…」菜单 | 删除对话… |
| 会话行悬停 | 右上角垃圾桶图标 |
| 设置 → 删除对话 | 回收站列表：还原 / 彻底删除 / 残留扫描清理 |

点垃圾桶后，按钮原地变成 **✓ / ✕**：✓ 红色确认、✕ 取消，✓ 自动获取焦点（**回车确认、Esc 取消**）。

结果在右下角以小弹窗报告：

| 结果 | 表现 |
|---|---|
| 成功 | 一条回执，2 秒后自动消失，不拦点击 |
| 失败 / 部分失败 | 常驻不消失，写明原因（正在运行 / 文件被占用 / 磁盘上找不到），右侧 × 可关，Esc 也能关 |

## 安装

```bash
dsh plugin --profile desktop add @liubaibuliuyan/dsh-session-delete
```

装完**重启 DSH Desktop**（Host 半边只在启动时加载）。侧边栏会话行的垃圾桶图标出现即成功。

> 从源码本地安装（开发用）：
> `dsh plugin --profile desktop add /path/to/dsh-session-delete`

## 安全边界

- **只有真正在跑才拒绝**：判据是 `agents.turnBoundaryOf(session).openTurnStartSeq` —— 存在未结束的
  turn 才拒绝。**"有活 Agent"不算运行中**：会话只要被打开过，Agent 就会常驻到进程结束，
  用 Agent 是否存在判断会把当前正开着的对话全部误判（这正是早期版本删不掉"刚打开的对话"的原因）。
  宿主不提供该能力时退回保守策略：按运行中处理，宁可不删也不打断。
- **只搬不抹**：删除 = `rename` 到回收站；「彻底删除」才 `rm`，且要二次确认。
- **只动两处目录**：`sessions/` 与 `.trash/session-delete/`。不动工作目录里的任何文件，
  也不碰其他插件的存储结构。
- **还原防覆盖**：`meta.originalPath` 必须位于 `sessions/` 根下；目标被占用就拒绝（`target-exists`）。
- **HTTP 通路栅栏**：只接受回环 + 同源请求，`sec-fetch-site: cross-site` 一律拒绝；
  非回环交由宿主能力栅栏判定，判不了就拒绝。
- **不向 Agent 开放删除工具**：删除是不可逆的破坏性动作，入口只留给人。

## 回收站长什么样

```
$DSH_HOME/.trash/session-delete/
  1794900340803-session-867336a9-.../
    payload/            ← 原会话目录（session.v4.jsonl.zstd 在里面）
    meta.json           ← 还原所需的一切
```

`meta.json`：

```json
{
  "sessionId": "session-...",
  "originalPath": "C:\\Users\\<you>\\.dsh\\sessions\\--D-workspace--\\session-...",
  "cwd": "D:\\workspace",
  "title": "会话标题",
  "deletedAt": 1794900340803,
  "root": true
}
```

还原 = 把 `payload` 搬回 `originalPath`，再重新挂回原工作区并补发 `added` 事件。

## 兼容性

- 在本仓库验证于 **DSH 0.2.2-rc.3（桌面 2.0.23-next）**；面向 0.2.x 线。
- 插件**不解析会话内容**：只按目录名与 `session.*.jsonl(.zstd)` 文件名工作。
  日志格式升版（v4 → v5）、投影缓存版本升版（7 → 8）都不影响删除；只有目录路径改名才会失效。
- Host 侧所有服务访问都走 `ctx.get()` + `typeof` 判空，缺服务只降级不崩溃。

升级 DSH 后自查：

1. 会话「…」菜单里还有「删除对话…」吗？
2. 设置里还有「删除对话」这一页吗？
3. 拿一条无关紧要的会话走一遍 删除 → 回收站 → 还原，看它是否回到 `sessions\` 原位。

任一项不通过：看 `~/.dsh/logs/desktop-next.log` 有没有 bundle 加载错误，并在本仓库提 issue。

## 与 npm 上两个同类插件的区别

npm 上已经有 `dsh-session-delete`（vtxf）和 `dsh-session-trash`（qingyu321），都做会话删除。
本插件是独立实现（加载行 id 用 `dsh-session-delete-trash` 避开撞车），差异在这里：

| | 本插件 | dsh-session-delete (vtxf) | dsh-session-trash (qingyu321) |
|---|---|---|---|
| 删掉之后 | 进回收站，可还原 | 永久删除，不可恢复 | 进回收站，可还原 |
| 运行中/已打开的会话 | 只有**真的有一轮在跑**才拒绝；打开着但空闲可以删，删完自动退回新对话页 | 一律跳过 | 一律拒收，要求重启后再删 |
| 同步清理 | 日志 + 投影缓存 + 工作区记账 + 前端列表，一步完成 | 只处理日志目录 | 只处理日志目录 |
| 入口方式 | 官方 Slot 注册（菜单项 500 / 行按钮 150 / 设置页 41） | DOM 注入菜单 | 包装 primitives 的 HoverCard 注入菜单 |
| 桌面 | Windows 上对文件占用做退避重试 | 沙箱内 `rm`/`Remove-Item` | — |

**为什么不学它们那样一律拒收"打开着"的会话**：DSH 里会话只要被打开过，Agent 就常驻到进程结束，
按"有没有活 Agent"判断会让"当前正开着的那条"永远删不掉——这恰恰是最常想删的那条。
所以本插件改用 turn 边界（`openTurnStartSeq`）判断，只拦真正在生成的那一条。

**为什么删完要退回新对话页**：持久层的追加写入用 `open(path, "a")`，如果删掉正开着的那条后
还停在里面继续发消息，日志会在原路径被重建，回收站里就会多出一条与新建副本重复的条目。
所以插件在删除成功后调用 `uiWorkspace.startSession()`（等价于点侧边栏的 New Session）退回新对话页——
空白的 New Session 在发出第一条消息前不落盘，因此这个动作本身不会留下垃圾会话。
判断"是否需要退回"用的是 `sessions.binding(id)`：会话只有在主视图里被物化时才存在绑定，
删的是别的对话（冷会话）就不会把你踢出当前对话。

## 卸载

```bash
dsh plugin --profile desktop remove @liubaibuliuyan/dsh-session-delete
```

卸载**不会**删除回收站里的内容。要一并清掉，先彻底删除回收站条目，或手动删除
`$DSH_HOME/.trash/session-delete/`。

## 开发

```bash
node test/selftest.mjs     # 在临时 DSH_HOME 上跑完整流水线，32 项断言，不碰真实会话
node scripts/pack.mjs      # 生成可发布产物到 dist/（含 package.json 与 market-entry.json）
```

自测覆盖：级联删除 / 运行中拒绝 / 常驻空闲可删 / 投影缓存同步清理 / 工作区拆账 / 事件补发 /
还原与重新挂回 / 彻底删除 / 残留扫描与 `.bak` 清理 / 空选择 / 跨站与非回环拒绝。

## 已知不做

- **`%TEMP%\dsh-spill-*` 不清理**：那里的目录名是会话 id 的截断哈希（实测 `session-eeec87966eac`）
  对不上完整 id，没有可靠的逐会话映射，宁可不碰也不误删别的会话的临时文件。
- **不删工作目录里的文件**：删除对话不等于删项目。
- **不做批量多选删除**：唯一的多选在设置页的回收站里（彻底删除 / 还原）。

## 许可

MIT
