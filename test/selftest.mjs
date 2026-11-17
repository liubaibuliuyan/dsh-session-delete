/**
 * dsh-session-delete 自测：在临时 DSH_HOME 上跑完整流水线，
 * 不碰真实会话目录。验证 级联 / 运行中拒绝 / 投影缓存同步清理 /
 * 工作区拆账 / 事件补发 / 还原 / 彻底删除 / 残留扫描。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SANDBOX = path.join(os.tmpdir(), `sd-selftest-${process.pid}`)
process.env.DSH_HOME = SANDBOX

const SESSIONS = path.join(SANDBOX, 'sessions')
const CACHE = path.join(SANDBOX, 'storages', 'session_projcache', 'sessions')
const TRASH = path.join(SANDBOX, '.trash', 'session-delete')

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

async function makeSession(cwdKey, id, bytes = 64) {
  const dir = path.join(SESSIONS, cwdKey, id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.alloc(bytes, 1))
  return dir
}

async function setup() {
  await fs.rm(SANDBOX, { recursive: true, force: true })
  await makeSession('--proj-a--', 'session-aaa')
  await makeSession('--proj-a--', 'session-bbb')
  await makeSession('--proj-b--', 'session-ccc')
  await fs.mkdir(CACHE, { recursive: true })
  for (const id of ['session-aaa', 'session-bbb', 'session-ccc', 'session-ffff']) {
    await fs.writeFile(path.join(CACHE, `${id}.json`), JSON.stringify({ version: 7, id }))
  }
  await fs.writeFile(path.join(CACHE, 'session-ffff.json.bak.20260101'), '{"old":true}')
}

// ── 服务替身 ──────────────────────────────────────────────────────────────
const events = []
const workspaces = [
  {
    id: 'ws-1',
    path: 'D:\\proj-a',
    sessionIds: ['session-aaa', 'session-bbb'],
    async detachSession(id) {
      this.sessionIds = this.sessionIds.filter((x) => x !== id)
    },
    async attachSession(id) {
      if (!this.sessionIds.includes(id)) this.sessionIds.push(id)
    },
  },
]
const archived = new Set(['session-aaa'])
const pinned = new Set(['session-bbb'])
let live = []
const openTurns = new Set()

const snapshots = [
  { header: { id: 'session-aaa', cwd: 'D:\\proj-a', createdAt: 1000 } },
  { header: { id: 'session-bbb', cwd: 'D:\\proj-a', createdAt: 2000, parentSession: 'session-aaa' } },
  { header: { id: 'session-ccc', cwd: 'D:\\proj-b', createdAt: 3000 } },
]

const services = {
  sessionPersistence: { async list() { return snapshots } },
  workspaceRegistry: {
    list() { return workspaces },
    async unarchiveSession(id) { archived.delete(id) },
    async unpinSession(id) { pinned.delete(id) },
  },
  agents: {
    list() { return live.map((id) => ({ session: { id } })) },
    // Agent 常驻 ≠ 正在跑：只有 openTurns 里的会话有未结束的 turn
    turnBoundaryOf(session) { return { openTurnStartSeq: openTurns.has(session.id) ? 5 : null } },
  },
  sessionQuery: { async readTitleSnapshots(ids) { return ids.map((id) => ({ status: 'fulfilled', sessionId: id, value: { title: { title: `${id} title` } } })) } },
  sessions: { async refresh() { return true }, get(id) { return live.includes(id) ? { id } : undefined } },
}
const deletedIds = new Set()

const routes = []
const ctx = {
  get: (key) => services[key],
  inject: (deps, cb) => {
    const child = {
      effect: (fn) => {
        const off = fn()
        return typeof off === 'function' ? off : () => {}
      },
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    }
    cb(child)
  },
  emit: (name, payload) => {
    events.push({ name, payload })
    if (name === 'api-session/removed') deletedIds.add(payload)
    if (name === 'api-session/added') deletedIds.delete(payload)
  },
  logger: { warn: (...args) => console.warn('  [host warn]', ...args) },
}

// ── HTTP 替身 ─────────────────────────────────────────────────────────────
function fakeReq(method, body) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
  req.method = method
  req.headers = { host: '127.0.0.1:51949', 'content-type': 'application/json' }
  req.url = '/dsh-session-delete'
  return req
}

function fakeRes() {
  const chunks = []
  let settle
  const done = new Promise((resolve) => {
    settle = resolve
  })
  const res = {
    statusCode: 200,
    setHeader() {},
    end(text) {
      chunks.push(text)
      settle()
    },
    async wait() {
      await done
      return { status: res.statusCode, body: JSON.parse(chunks.join('') || '{}') }
    },
  }
  return res
}

async function call(action, payload, method = 'POST') {
  const handler = routes[0].handler
  const res = fakeRes()
  handler(fakeReq(method, method === 'POST' ? { action, ...(payload || {}) } : undefined), res)
  return res.wait()
}

// ── 跑测试 ────────────────────────────────────────────────────────────────
await setup()
await import(pathToFileURL(path.join(HERE, '..', 'index.js')).href).then((mod) => mod.apply(ctx))

check('注册了恰好一条 HTTP 路由', routes.length === 1 && routes[0].path === '/dsh-session-delete', `path=${routes[0]?.path}`)

// 运行中的会话必须被拒绝（Agent 常驻 + 有未结束的 turn）
live = ['session-ccc']
openTurns.add('session-ccc')
let r = await call('delete', { sessionIds: ['session-aaa', 'session-ccc'] })
if (r.body.moved === undefined) console.log('  debug delete response:', JSON.stringify(r))
check('级联：父会话 + 子会话一起删除', r.body.moved?.length === 2 && r.body.cascade?.length === 1, `moved=${r.body.moved}`)
check('运行中的会话被拒绝', r.body.failed?.some((f) => f.sessionId === 'session-ccc' && f.reason === 'running'), JSON.stringify(r.body.failed))
check('日志目录已离开原位置', !(await fs.stat(path.join(SESSIONS, '--proj-a--', 'session-aaa')).catch(() => null)))
check('子会话日志也已离开', !(await fs.stat(path.join(SESSIONS, '--proj-a--', 'session-bbb')).catch(() => null)))
check('运行中会话的日志原封不动', !!(await fs.stat(path.join(SESSIONS, '--proj-b--', 'session-ccc')).catch(() => null)))
check('投影缓存同步删除（父）', !(await fs.stat(path.join(CACHE, 'session-aaa.json')).catch(() => null)))
check('投影缓存同步删除（子）', !(await fs.stat(path.join(CACHE, 'session-bbb.json')).catch(() => null)))
check('未涉及会话的缓存不受影响', !!(await fs.stat(path.join(CACHE, 'session-ccc.json')).catch(() => null)))
check('工作区记账已拆干净', workspaces[0].sessionIds.length === 0, `sessionIds=${JSON.stringify(workspaces[0].sessionIds)}`)
check('归档集合已摘掉', !archived.has('session-aaa'))
check('置顶集合已摘掉', !pinned.has('session-bbb'))
check('补发了 removed 事件', events.filter((e) => e.name === 'api-session/removed').length === 2)
check('回收站里有 2 个条目', (await fs.readdir(TRASH)).length === 2)

// 还原
const entries = (await call('list', {}, 'GET')).body.trash
r = await call('restore', { entryIds: entries.map((e) => e.entryId) })
check('还原成功 2 条', r.body.restored?.length === 2, JSON.stringify(r.body.failed ?? []))
check('日志回到原位置', !!(await fs.stat(path.join(SESSIONS, '--proj-a--', 'session-aaa')).catch(() => null)))
check('还原后重新挂回工作区', workspaces[0].sessionIds.includes('session-aaa'), JSON.stringify(workspaces[0].sessionIds))
check('补发了 added 事件', events.filter((e) => e.name === 'api-session/added').length === 2)
check('回收站已清空', (await fs.readdir(TRASH)).length === 0)

// 重复删除 -> 彻底删除
live = []
r = await call('delete', { sessionIds: ['session-aaa'] })
if (r.body.moved === undefined) console.log('  debug second delete:', JSON.stringify(r))
check('不再有运行中阻塞', r.body.moved?.length === 2)
const entries2 = (await call('list', {}, 'GET')).body.trash
r = await call('purge', { entryIds: entries2.map((e) => e.entryId) })
check('彻底删除 2 条', r.body.purged?.length === 2)
check('回收站目录已空', (await fs.readdir(TRASH)).length === 0)
check('日志不可恢复（已被彻底删除）', !(await fs.stat(path.join(SESSIONS, '--proj-a--', 'session-aaa')).catch(() => null)))

// 残留扫描：zzz 的缓存与备份都在，且没有对应会话
const residue = (await call('list', {}, 'GET')).body.residue
check('残留扫描找到孤儿缓存', residue.orphans.some((o) => o.sessionId === 'session-ffff'), JSON.stringify(residue.orphans.map((o) => o.file)))
r = await call('cleanResidue', {})
check('清理残留成功', r.body.removed?.length === 1, JSON.stringify(r.body))
check('.bak 备份也被清掉', !(await fs.stat(path.join(CACHE, 'session-ffff.json.bak.20260101')).catch(() => null)))

// 路径安全：恶意 meta 不允许把文件搬出 sessions 根
r = await call('delete', { sessionIds: [] })
check('空选择被拒绝', r.status === 400)

// 非回环 Host 头必须拒绝
const resA = fakeRes()
routes[0].handler(Object.assign(Readable.from([]), { method: 'GET', headers: { host: 'evil.example.com' }, url: '/dsh-session-delete' }), resA)
const outA = await resA.wait()
check('非回环 Host 被拒绝', outA.status === 403, `status=${outA.status}`)

// 跨站 Origin 必须拒绝
const resB = fakeRes()
routes[0].handler(
  Object.assign(Readable.from([]), { method: 'GET', headers: { host: '127.0.0.1:51949', origin: 'http://evil.example.com' }, url: '/dsh-session-delete' }),
  resB,
)
const outB = await resB.wait()
check('跨站 Origin 被拒绝', outB.status === 403, `status=${outB.status}`)

// 常驻但空闲（只是被打开、没有未结束的 turn）的会话必须可以删
const idleDir = await makeSession('--proj-b--', 'session-dddd')
await fs.writeFile(path.join(CACHE, 'session-dddd.json'), JSON.stringify({ version: 7, id: 'session-dddd' }))
live = ['session-dddd']
openTurns.delete('session-dddd')
r = await call('delete', { sessionIds: ['session-dddd'] })
check('常驻但空闲的会话可以删除', r.body.moved?.length === 1, JSON.stringify(r.body))
check('它的日志已离开原位', !(await fs.stat(idleDir).catch(() => null)))
check('它的缓存也一起清掉', !(await fs.stat(path.join(CACHE, 'session-dddd.json')).catch(() => null)))

// 补扫：删完之后应用又把缓存/日志写回来，必须能被清掉（这就是「删了还在列表里、还能打开」的根因）
const rebornId = 'session-eeee'
await makeSession('--proj-b--', rebornId)
await fs.writeFile(path.join(CACHE, `${rebornId}.json`), JSON.stringify({ version: 7, id: rebornId }))
r = await call('delete', { sessionIds: [rebornId] })
check('补扫用例：先正常删除', r.body.moved?.length === 1, JSON.stringify(r.body))
const rebornEntry = r.body.entries?.[0]?.entryId

// 模拟「会话还挂在内存里，flush 把日志目录与投影缓存又写了回来」
await makeSession('--proj-b--', rebornId)
await fs.writeFile(path.join(CACHE, `${rebornId}.json`), JSON.stringify({ version: 7, id: rebornId, reborn: true }))
r = await call('sweep', { sessionIds: [rebornId] })
check('补扫报告有改动', r.body.touched === true, JSON.stringify(r.body))
check('补扫清掉重新出现的缓存', !(await fs.stat(path.join(CACHE, `${rebornId}.json`)).catch(() => null)))
check('补扫把重新出现的日志搬回回收站', !(await fs.stat(path.join(SESSIONS, '--proj-b--', rebornId)).catch(() => null)))
check(
  '回收站里留下了 reborn 副本（不直接抹掉用户数据）',
  (await fs.readdir(path.join(TRASH, rebornEntry))).some((name) => name.startsWith('payload-reborn')),
)

// 已进回收站的会话，其残留缓存也要被扫到——否则它还能从缓存里被列出来、被打开
await fs.writeFile(path.join(CACHE, `${rebornId}.json`), JSON.stringify({ version: 7, id: rebornId }))
const residue2 = (await call('list', {}, 'GET')).body.residue
check(
  '回收站会话的残留缓存也能被扫到',
  residue2.orphans.some((o) => o.sessionId === rebornId && o.trashed === true),
  JSON.stringify(residue2.orphans.map((o) => o.sessionId)),
)
r = await call('cleanResidue', {})
check('清理残留能把它清掉', !(await fs.stat(path.join(CACHE, `${rebornId}.json`)).catch(() => null)))

const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
await fs.rm(SANDBOX, { recursive: true, force: true })
process.exit(failed.length === 0 ? 0 : 1)
