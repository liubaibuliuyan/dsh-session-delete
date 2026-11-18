/**
 * dsh-session-delete — Host 半边
 *
 * 统一「删除对话」这一个动作，一次做完四件事，不再依赖别的插件收尾：
 *   1. 会话日志目录      → 搬进回收站（可还原，不直接抹掉）
 *   2. 投影缓存记录      → 同一步删掉（session_projcache/sessions/<id>.json）
 *   3. 工作区记账/归档/置顶 → 走公开 registry API 拆干净（不留 ghost id）
 *   4. 前端会话列表      → 补发 api-session/removed（无需重启即消失）
 *
 * 设计约束（对齐宿主现状）：
 *   - 宿主核心没有 delete 动词，持久化层只有 create/open/flush/stat/list，
 *     所以「删」= 把目录搬走 + 用公开 API 拆记账，绝不改写别的插件的存储。
 *   - 正在运行的会话（turn / 子代理 / 后台任务）拒绝删除，交回用户先停。
 *   - 会话日志目录按 sessionId 反查，不重写持久化后端的 cwd 编码规则。
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions')
const PROJCACHE_ROOT = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const TRASH_ROOT = path.join(DSH_HOME, '.trash', 'session-delete')
const API_PATH = '/dsh-session-delete'
/** 一次操作的上限：防止误传超大数组把事件循环堵死。 */
const MAX_BATCH = 500
const LOG_FILE = /^session\..+\.jsonl(\.zstd)?$/

// ── 小工具 ────────────────────────────────────────────────────────────────

async function readdirSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function fileBytes(file) {
  try {
    return (await fs.stat(file)).size
  } catch {
    return 0
  }
}

async function dirBytes(dir) {
  let total = 0
  for (const entry of await readdirSafe(dir)) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await dirBytes(full)
    else if (entry.isFile()) total += await fileBytes(full)
  }
  return total
}

/**
 * 建 sessionId → 会话目录 索引。
 * 只认目录里真的有会话日志的，避免把同名目录当成会话。
 */
async function indexSessionDirs() {
  const index = new Map()
  for (const cwdDir of await readdirSafe(SESSIONS_ROOT)) {
    if (!cwdDir.isDirectory()) continue
    const cwdPath = path.join(SESSIONS_ROOT, cwdDir.name)
    for (const sessionDir of await readdirSafe(cwdPath)) {
      if (!sessionDir.isDirectory()) continue
      const dir = path.join(cwdPath, sessionDir.name)
      const files = await readdirSafe(dir)
      if (!files.some((f) => f.isFile() && LOG_FILE.test(f.name))) continue
      index.set(sessionDir.name, dir)
    }
  }
  return index
}

/**
 * 真正在跑的会话 id 集合（= 不能删）。
 *
 * 注意：「有活 Agent」不等于「正在跑」。一个会话只要被打开过，Agent 就会常驻到进程结束，
 * 而用户想删的往往正是当前开着的那条——按 Agent 是否存在判断会把它们全部误判成运行中。
 * 所以这里读 turn 边界：只有存在未结束的 turn（openTurnStartSeq 非 null）才算运行中。
 * 若宿主没提供 turnBoundaryOf（版本差异），退回保守策略：按运行中处理，宁可不删也不打断。
 */
function liveSessionIds(ctx) {
  const out = new Set()
  const agents = ctx.get('agents')
  if (!agents || typeof agents.list !== 'function') return out
  const sessions = ctx.get('sessions')
  let list = []
  try {
    list = agents.list() ?? []
  } catch {
    return out
  }
  for (const agent of list) {
    const id = String(agent?.session?.id ?? agent?.id ?? '')
    if (!id) continue
    let openTurn = true
    try {
      if (typeof agents.turnBoundaryOf === 'function') {
        const session = (typeof sessions?.get === 'function' ? sessions.get(id) : undefined) ?? agent?.session
        const boundary = session ? agents.turnBoundaryOf(session) : undefined
        openTurn = boundary ? boundary.openTurnStartSeq !== null && boundary.openTurnStartSeq !== undefined : true
      }
    } catch {
      openTurn = true
    }
    if (openTurn) out.add(id)
  }
  return out
}

/** 持久化层的会话快照（拿 header：cwd / parentSession / origin）。 */
async function listSnapshots(ctx) {
  const persistence = ctx.get('sessionPersistence')
  if (!persistence || typeof persistence.list !== 'function') return []
  try {
    return await persistence.list()
  } catch {
    return []
  }
}

async function titleOf(ctx, ids) {
  const out = new Map()
  const query = ctx.get('sessionQuery')
  if (!query || typeof query.readTitleSnapshots !== 'function') return out
  try {
    for (const result of await query.readTitleSnapshots(ids)) {
      if (result.status === 'fulfilled') {
        out.set(String(result.sessionId), result.value?.title?.title ?? '')
      }
    }
  } catch {}
  return out
}

/**
 * 让前端会话列表重新对齐一次。
 * 各版本服务形状不同，按能力探测：refresh → reload → list；都没有就用 sessionQuery。
 */
async function refreshSessionList(ctx) {
  const sessions = ctx.get('sessions')
  if (sessions) {
    for (const method of ['refresh', 'reload', 'list']) {
      if (typeof sessions[method] !== 'function') continue
      try {
        await sessions[method]()
        return true
      } catch {}
    }
  }
  const query = ctx.get('sessionQuery')
  if (query && typeof query.listSessions === 'function') {
    try {
      await query.listSessions()
      return true
    } catch {}
  }
  return false
}

// ── 投影缓存（这原本是「另一个插件」的活，这里一次做完）────────────────────

/** 一条会话的投影缓存文件（含 .bak.<stamp> 备份）。 */
async function projectionCacheFiles(sessionId) {
  const out = []
  const prefix = `${sessionId}.json`
  for (const entry of await readdirSafe(PROJCACHE_ROOT)) {
    if (!entry.isFile()) continue
    if (entry.name === prefix || entry.name.startsWith(`${prefix}.bak.`)) {
      out.push(path.join(PROJCACHE_ROOT, entry.name))
    }
  }
  return out
}

async function dropProjectionCache(sessionId) {
  let removed = 0
  let bytes = 0
  for (const file of await projectionCacheFiles(sessionId)) {
    try {
      bytes += await fileBytes(file)
      await fs.rm(file, { force: true })
      removed += 1
    } catch {}
  }
  return { removed, bytes }
}

// ── 补扫：删完之后又冒出来的尾巴 ──────────────────────────────────────────
//
// 删掉一条**正开着**的会话时，客户端/宿主会把它仍在内存里的快照重新 flush 出来，
// 于是刚删掉的投影缓存（有时连日志目录）在一两秒内又出现在原位。
// 缓存里带着完整快照，所以这条会话还能被列出来、还能被打开——必须补扫干净。

const SWEEP_DELAYS = [300, 1200, 3000, 6000, 12000]

/**
 * 扫一次：清掉重新出现的投影缓存；日志目录若被应用写回来，
 * 搬进同一个回收站条目（`payload-reborn-<stamp>`），绝不直接抹掉用户数据。
 */
async function sweepDeleted(ctx, entries) {
  let touched = false
  for (const entry of entries) {
    const sessionId = String(entry?.sessionId ?? '')
    if (!sessionId) continue
    const cache = await dropProjectionCache(sessionId)
    if (cache.removed > 0) touched = true

    const index = await indexSessionDirs()
    const dir = index.get(sessionId)
    if (dir && entry.entryId) {
      const target = path.join(TRASH_ROOT, entry.entryId, `payload-reborn-${Date.now()}`)
      try {
        await fs.rename(dir, target)
        touched = true
        try {
          ctx.logger?.warn?.(`dsh-session-delete: ${sessionId} 被重新写回，已再次移入回收站`)
        } catch {}
      } catch {}
    }
    if (cache.removed > 0 || dir) {
      // 让列表再落一次地：客户端可能刚把这条从缓存里读了回来
      try {
        ctx.emit('api-session/removed', sessionId)
      } catch {}
    }
  }
  return touched
}

const sweepTimers = new Set()

function scheduleSweep(ctx, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return
  for (const delay of SWEEP_DELAYS) {
    const timer = setTimeout(() => {
      sweepTimers.delete(timer)
      void sweepDeleted(ctx, entries).catch(() => {})
    }, delay)
    if (typeof timer?.unref === 'function') timer.unref()
    sweepTimers.add(timer)
  }
}

function clearSweeps() {
  for (const timer of sweepTimers) clearTimeout(timer)
  sweepTimers.clear()
}

// ── 常驻看守：删除之后的任何时刻都可能被写回来 ────────────────────────────
//
// 实测到的第二种复发路径（比删除时的竞态更常见）：
//   - 5 个已删会话的缓存被应用在同一秒（16:12:57）批量写回；
//   - 另 1 个在重启那一刻（16:31:24）被写回。
// 也就是说「删除后补扫 12 秒」这个窗口抓不到它们。所以再加三层：
//   ① 启动时扫一遍回收站        —— 抓住重启时被写回的那批
//   ② 监听投影缓存目录（fs.watch）—— 任何时刻有人写已删会话的缓存就立刻清
//   ③ 每 5 分钟兜一次全量        —— 兜住监听失效/路径后出现的情况
const JANITOR_INTERVAL_MS = 5 * 60 * 1000

const trashIds = new Set()
let trashWatcher = null

async function refreshTrashIds() {
  try {
    const trash = await listTrash()
    trashIds.clear()
    for (const entry of trash) if (entry.sessionId) trashIds.add(entry.sessionId)
    return trash
  } catch {
    return []
  }
}

async function janitorPass(ctx) {
  const trash = await refreshTrashIds()
  if (trash.length === 0) return
  await sweepDeleted(ctx, trash.map((entry) => ({ sessionId: entry.sessionId, entryId: entry.entryId })))
}

/** 单一文件事件：写回来的如果属于回收站里的会话，立刻清掉。 */
function watchCacheDir(ctx) {
  if (trashWatcher) return
  try {
    trashWatcher = fsSync.watch(PROJCACHE_ROOT, (eventType, filename) => {
      const name = typeof filename === 'string' ? filename : ''
      const match = /^(session-[0-9a-f-]+)\.json(\.bak\..*)?$/.exec(name)
      if (!match) return
      const sessionId = match[1]
      if (!trashIds.has(sessionId)) return
      void dropProjectionCache(sessionId).catch(() => {})
    })
    if (typeof trashWatcher?.unref === 'function') trashWatcher.unref()
  } catch {
    // 目录还不存在或平台不支持：交给 5 分钟的兜底轮询
    trashWatcher = null
  }
}

function startJanitor(ctx) {
  void janitorPass(ctx).then(() => watchCacheDir(ctx)).catch(() => {})
  const timer = setInterval(() => {
    void janitorPass(ctx).then(() => watchCacheDir(ctx)).catch(() => {})
  }, JANITOR_INTERVAL_MS)
  if (typeof timer?.unref === 'function') timer.unref()
  sweepTimers.add(timer)
}

function stopJanitor() {
  clearSweeps()
  try {
    trashWatcher?.close?.()
  } catch {}
  trashWatcher = null
  trashIds.clear()
}

// ── 工作区记账 ────────────────────────────────────────────────────────────

/**
 * 把会话从所有工作区记账、归档集合、置顶集合里摘干净。
 * 全部走公开 API：detachSession / unarchiveSession / unpinSession。
 */
async function dropBookkeeping(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return { detached: 0, workspaceIds: [] }
  let detached = 0
  const workspaceIds = []
  if (typeof registry.list === 'function') {
    for (const workspace of registry.list()) {
      if (!workspace?.sessionIds?.includes(sessionId)) continue
      // 记下它原本属于哪个工作区：拆账之后这个信息就没了，
      // 而「删除后退回新对话」必须回到用户当时所在的那个工作区
      const workspaceId = String(workspace?.id ?? '')
      if (workspaceId) workspaceIds.push(workspaceId)
      try {
        await workspace.detachSession(sessionId)
        detached += 1
      } catch {}
    }
  }
  for (const method of ['unarchiveSession', 'unpinSession']) {
    if (typeof registry[method] !== 'function') continue
    try {
      await registry[method](sessionId)
    } catch {}
  }
  return { detached, workspaceIds }
}

// ── 回收站 ────────────────────────────────────────────────────────────────

async function listTrash() {
  const out = []
  for (const entry of await readdirSafe(TRASH_ROOT)) {
    if (!entry.isDirectory()) continue
    const dir = path.join(TRASH_ROOT, entry.name)
    let meta = null
    try {
      meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
    } catch {}
    const payload = path.join(dir, 'payload')
    out.push({
      entryId: entry.name,
      sessionId: meta?.sessionId ?? entry.name,
      title: meta?.title ?? '',
      cwd: meta?.cwd ?? '',
      deletedAt: Number(meta?.deletedAt) || 0,
      children: Array.isArray(meta?.children) ? meta.children : [],
      bytes: existsSync(payload) ? await dirBytes(payload) : 0,
    })
  }
  out.sort((a, b) => b.deletedAt - a.deletedAt)
  return out
}

const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

/**
 * Windows 上重命名一个日志文件正被读写的会话目录会以 EPERM/EBUSY 失败，
 * 而占用往往只持续几十毫秒（预览/水合正在读同一个 .zstd）。退避重试几次再判失败。
 */
async function renameWithRetry(from, to, attempts = 4) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      lastError = error
      if (!LOCK_CODES.has(String(error?.code ?? ''))) throw error
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)))
    }
  }
  throw lastError
}

/** 把底层错误翻译成可解释、可照做的原因。 */
function moveFailureReason(error) {
  const code = String(error?.code ?? '')
  if (code === 'ENOENT') return 'not-found'
  if (LOCK_CODES.has(code)) return 'in-use'
  return String(error?.message ?? error)
}

async function moveToTrash(sessionId, dir, meta) {
  const entryId = `${Date.now()}-${sessionId}`
  const entryDir = path.join(TRASH_ROOT, entryId)
  await fs.mkdir(entryDir, { recursive: true })
  await renameWithRetry(dir, path.join(entryDir, 'payload'))
  await fs.writeFile(path.join(entryDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return entryId
}

// ── 主操作：删除 ──────────────────────────────────────────────────────────

/**
 * 删除一批会话（可选级联它们派生的子会话）。
 *
 * 每个 id 的处置结果都会说明白：moved / failed(reason)。
 * 拒绝理由只有三种，且都可解释：running（还在跑）、not-found（磁盘上没这个会话）。
 */
async function deleteSessions(ctx, requested, options = {}) {
  const cascade = options.cascade !== false
  const ids = [...new Set((Array.isArray(requested) ? requested : []).map(String))]
    .filter(Boolean)
    .slice(0, MAX_BATCH)

  const index = await indexSessionDirs()
  const snapshots = await listSnapshots(ctx)
  const parentOf = new Map()
  const cwdOf = new Map()
  for (const snapshot of snapshots) {
    const id = String(snapshot?.header?.id ?? '')
    if (!id) continue
    cwdOf.set(id, snapshot.header?.cwd ?? '')
    if (snapshot.header?.parentSession) parentOf.set(id, String(snapshot.header.parentSession))
  }
  const live = liveSessionIds(ctx)

  // 先展开级联目标，保证子会话和父会话在同一个批次里被处理
  const targets = []
  const failed = []
  const seen = new Set()
  const queue = [...ids]
  while (queue.length > 0) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    if (live.has(id)) {
      failed.push({ sessionId: id, reason: 'running' })
      continue
    }
    const dir = index.get(id)
    if (!dir) {
      failed.push({ sessionId: id, reason: 'not-found' })
      continue
    }
    targets.push({ id, dir })
    if (cascade) {
      for (const [childId, parentId] of parentOf) {
        if (parentId === id) queue.push(childId)
      }
    }
  }

  if (targets.length === 0) {
    return { moved: [], failed, entries: [], cascade: [], truncated: requested.length > ids.length }
  }

  const titles = await titleOf(ctx, targets.map((t) => t.id))
  await fs.mkdir(TRASH_ROOT, { recursive: true })

  const moved = []
  const entries = []
  const failures = [...failed]
  // 根会话与级联子会话分开记账：还原时也知道它们原本是一组
  const rootId = String(ids[0] ?? '')
  for (const target of targets) {
    try {
      const entryId = await moveToTrash(target.id, target.dir, {
        sessionId: target.id,
        originalPath: target.dir,
        cwd: cwdOf.get(target.id) ?? '',
        title: titles.get(target.id) ?? '',
        deletedAt: Date.now(),
        root: target.id === rootId,
      })
      moved.push(target.id)
      entries.push({ sessionId: target.id, entryId })
      const cache = await dropProjectionCache(target.id)
      const bookkeeping = await dropBookkeeping(ctx, target.id)
      try {
        ctx.emit('api-session/removed', target.id)
      } catch {}
      const entry = entries[entries.length - 1]
      entry.cache = cache
      // 前端据此把「退回新对话」落到用户当时所在的工作区，而不是最近活跃的那个
      entry.workspaceId = bookkeeping.workspaceIds[0] ?? null
      entry.workspaceIds = bookkeeping.workspaceIds
    } catch (error) {
      const reason = moveFailureReason(error)
      failures.push({ sessionId: target.id, reason })
      try {
        ctx.logger?.warn?.(`dsh-session-delete: 未能把 ${target.id} 移入回收站 (${reason})`)
      } catch {}
    }
  }

  if (moved.length > 0) {
    // 立刻补扫一次（同一秒内应用就可能把缓存写回来），再排后续几轮
    await sweepDeleted(ctx, entries)
    scheduleSweep(ctx, entries)
    await refreshSessionList(ctx)
  }
  return {
    moved,
    entries,
    failed: failures,
    cascade: moved.filter((id) => !ids.includes(id)),
    truncated: requested.length > ids.length,
  }
}

// ── 还原 ──────────────────────────────────────────────────────────────────

async function restoreSessions(ctx, entryIds) {
  const restored = []
  const failed = []
  for (const entryId of (Array.isArray(entryIds) ? entryIds : []).map(String)) {
    const entryDir = path.join(TRASH_ROOT, entryId)
    const payload = path.join(entryDir, 'payload')
    try {
      const meta = JSON.parse(await fs.readFile(path.join(entryDir, 'meta.json'), 'utf8'))
      const originalPath = String(meta.originalPath ?? '')
      if (!originalPath || !originalPath.startsWith(SESSIONS_ROOT)) {
        failed.push({ entryId, reason: 'bad-meta' })
        continue
      }
      if (existsSync(originalPath)) {
        failed.push({ entryId, reason: 'target-exists' })
        continue
      }
      await fs.mkdir(path.dirname(originalPath), { recursive: true })
      await fs.rename(payload, originalPath)
      await fs.rm(entryDir, { recursive: true, force: true })

      const sessionId = String(meta.sessionId ?? '')
      restored.push({ entryId, sessionId })
      if (sessionId) {
        // 还原后重新登记到工作区：让会话回到它原本归属的分组
        await reattachBookkeeping(ctx, sessionId, originalPath)
        await announceRestored(ctx, sessionId, meta)
      }
    } catch (error) {
      failed.push({ entryId, reason: String(error?.message ?? error) })
    }
  }
  if (restored.length > 0) await refreshSessionList(ctx)
  return { restored, failed }
}

/** 还原后把会话重新挂回它原路径所属的工作区（找不到就留给宿主按 cwd 归组）。 */
async function reattachBookkeeping(ctx, sessionId, originalPath) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry || typeof registry.list !== 'function') return
  let cwd = ''
  try {
    const snapshots = await listSnapshots(ctx)
    cwd = String(snapshots.find((s) => String(s?.header?.id ?? '') === sessionId)?.header?.cwd ?? '')
  } catch {}
  if (!cwd) return
  for (const workspace of registry.list()) {
    if (String(workspace?.path ?? '').toLowerCase() !== cwd.toLowerCase()) continue
    if (workspace.sessionIds?.includes(sessionId)) return
    try {
      await workspace.attachSession(sessionId)
    } catch {}
    return
  }
}

/** 让前端把还原的会话重新加回列表（对称于删除时的 removed）。 */
async function announceRestored(ctx, sessionId, meta) {
  let header = null
  try {
    const snapshots = await listSnapshots(ctx)
    header = snapshots.find((s) => String(s?.header?.id ?? '') === sessionId)?.header ?? null
  } catch {}
  const summary = {
    sessionId,
    updatedAt: Number(header?.createdAt) || Number(meta?.deletedAt) || Date.now(),
    agentAvailable: false,
    running: false,
    blank: false,
    formatStatus: 'current',
    ...(header?.cwd ? { cwd: header.cwd } : {}),
    ...(header?.parentSession ? { parentSessionId: String(header.parentSession) } : {}),
    ...(header?.origin ? { origin: header.origin } : {}),
  }
  try {
    ctx.emit('api-session/added', summary)
  } catch {}
}

// ── 彻底删除 ──────────────────────────────────────────────────────────────

async function purgeTrash(entryIds) {
  const targets =
    Array.isArray(entryIds) && entryIds.length > 0
      ? entryIds.map(String)
      : (await readdirSafe(TRASH_ROOT)).filter((e) => e.isDirectory()).map((e) => e.name)
  const purged = []
  const failed = []
  for (const entryId of targets) {
    try {
      await fs.rm(path.join(TRASH_ROOT, entryId), { recursive: true, force: true })
      purged.push(entryId)
    } catch (error) {
      failed.push({ entryId, reason: String(error?.message ?? error) })
    }
  }
  return { purged, failed }
}

// ── 残留扫描（投影缓存孤儿）──────────────────────────────────────────────

/**
 * 找「日志已经不在、投影缓存还留着」的记录。
 * 这就是把清理拆成两个插件的根源，这里并进同一个插件。
 */
async function scanResidue(ctx) {
  const index = await indexSessionDirs()
  // 只要磁盘上没有这条会话的日志目录，缓存就是孤立/过期数据——包括已进回收站的那些：
  // 回收站里带着日志，还原时会重新生成缓存，旧的这份只会让已删的会话还能被列出来、被打开。
  const trashed = new Set((await listTrash()).map((entry) => entry.sessionId))
  const bySession = new Map()
  for (const entry of await readdirSafe(PROJCACHE_ROOT)) {
    if (!entry.isFile()) continue
    const match = /^(session-[0-9a-f-]+)\.json(\.bak\..*)?$/.exec(entry.name)
    if (!match) continue
    const sessionId = match[1]
    if (index.has(sessionId)) continue
    const bytes = await fileBytes(path.join(PROJCACHE_ROOT, entry.name))
    const current = bySession.get(sessionId)
    if (current) {
      current.bytes += bytes
      current.files.push(entry.name)
    } else {
      // 一个会话的缓存可能同时存在 .json 与 .bak.<stamp>：按会话归并成一行
      bySession.set(sessionId, { sessionId, file: entry.name, files: [entry.name], bytes, trashed: trashed.has(sessionId) })
    }
  }
  const orphans = [...bySession.values()]
  const totalBytes = orphans.reduce((sum, entry) => sum + entry.bytes, 0)
  return { orphans, totalBytes }
}

async function cleanResidue(ctx, sessionIds) {
  const scan = await scanResidue(ctx)
  const wanted = Array.isArray(sessionIds) && sessionIds.length > 0 ? new Set(sessionIds.map(String)) : null
  const removed = []
  let bytes = 0
  for (const orphan of scan.orphans) {
    if (wanted && !wanted.has(orphan.sessionId)) continue
    try {
      for (const file of await projectionCacheFiles(orphan.sessionId)) {
        bytes += await fileBytes(file)
        await fs.rm(file, { force: true })
      }
      removed.push(orphan.sessionId)
    } catch {}
  }
  return { removed, bytes }
}

// ── HTTP 通路 ─────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * 信任栅栏：只允许本机回环 + 同源。
 * Host/Origin 被伪造（DNS rebinding）或跨站请求一律拒。
 */
function rejectRequest(ctx, req) {
  let authority
  try {
    authority = new URL(`http://${String(req.headers.host ?? '')}`)
  } catch {
    return 403
  }
  const hostname = authority.hostname.toLowerCase()
  const isLoopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin && origin !== 'null') {
    let originUrl
    try {
      originUrl = new URL(origin)
    } catch {
      return 403
    }
    if (originUrl.host.toLowerCase() !== authority.host.toLowerCase()) return 403
  }
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 403
  if (!isLoopback) {
    // 非回环：交给宿主自己的能力栅栏判；判不了就默认拒绝，不给远程开后门。
    const connection = ctx.get('connection')
    const fence = connection && connection.requestRejection
    if (typeof fence === 'function') {
      try {
        const code = fence.call(connection, req)
        if (code === undefined || code === null || code === false) return null
        return typeof code === 'number' ? code : 403
      } catch {
        return 403
      }
    }
    return 403
  }
  return null
}

export function apply(ctx, options) {
  ctx.inject(['webServer'], (c) => {
    const handler = async (req, res) => {
      const rejected = rejectRequest(ctx, req)
      if (rejected !== null) return sendJson(res, rejected, { ok: false, error: 'forbidden' })

      const method = String(req.method ?? 'GET').toUpperCase()
      const body = method === 'POST' ? await readBody(req) : {}
      const action = String(
        body.action ?? new URL(req.url ?? '/', 'http://x').searchParams.get('action') ?? 'list',
      )
      const mutating =
        action === 'delete' || action === 'restore' || action === 'purge' || action === 'cleanResidue' || action === 'sweep'
      if (mutating && method !== 'POST') return sendJson(res, 405, { ok: false, error: 'post-required' })

      try {
        switch (action) {
          case 'list': {
            const [trash, residue] = await Promise.all([listTrash(), scanResidue(ctx)])
            return sendJson(res, 200, {
              ok: true,
              trash,
              residue,
              home: DSH_HOME,
              trashRoot: TRASH_ROOT,
            })
          }
          case 'delete': {
            const ids = Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : []
            if (ids.length === 0) return sendJson(res, 400, { ok: false, error: 'empty-selection' })
            const result = await deleteSessions(ctx, ids, { cascade: body.cascade !== false })
            const status = result.moved.length === 0 ? 409 : 200
            return sendJson(res, status, { ok: result.moved.length > 0, ...result })
          }
          case 'restore': {
            const entryIds = Array.isArray(body.entryIds) ? body.entryIds.map(String) : []
            if (entryIds.length === 0) return sendJson(res, 400, { ok: false, error: 'empty-selection' })
            const result = await restoreSessions(ctx, entryIds)
            const status = result.restored.length === 0 ? 409 : 200
            return sendJson(res, status, { ok: result.restored.length > 0, ...result })
          }
          case 'purge': {
            const entryIds = Array.isArray(body.entryIds) ? body.entryIds.map(String) : []
            const result = await purgeTrash(entryIds)
            return sendJson(res, 200, { ok: true, ...result })
          }
          case 'scanResidue': {
            const residue = await scanResidue(ctx)
            return sendJson(res, 200, { ok: true, residue })
          }
          case 'cleanResidue': {
            const result = await cleanResidue(ctx, body.sessionIds)
            return sendJson(res, 200, { ok: true, ...result })
          }
          case 'sweep': {
            // 手动补扫：把「已删但又冒出来」的缓存/日志再清一遍（设置页与命令行都用得到）
            const ids = Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : []
            const trash = await listTrash()
            const entries = ids.length > 0
              ? ids.map((sessionId) => {
                  const hit = trash.find((entry) => entry.sessionId === sessionId)
                  return { sessionId, entryId: hit?.entryId }
                })
              : trash.map((entry) => ({ sessionId: entry.sessionId, entryId: entry.entryId }))
            const touched = await sweepDeleted(ctx, entries)
            return sendJson(res, 200, { ok: true, swept: entries.length, touched })
          }
          default:
            return sendJson(res, 400, { ok: false, error: `unknown-action:${action}` })
        }
      } catch (error) {
        ctx.logger?.warn?.('dsh-session-delete: %s', String(error?.message ?? error))
        return sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    }

    c.effect(
      () => c.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => void handler(req, res) }),
      'dsh-session-delete: route',
    )

    // 补扫定时器与看守随插件卸载一起清掉
    try {
      c.effect(() => stopJanitor, 'dsh-session-delete: janitor')
    } catch {}

    // 启动即扫一遍：重启那一刻应用会把已删会话的缓存写回来，只有常驻看守能抓住
    if (options?.janitor !== false) startJanitor(ctx)
  })
}
