#!/usr/bin/env node
/**
 * 生成可发布产物：
 *   dist/<name>/             —— 可直接 npm publish 的包
 *   dist/market-entry.json   —— 提交到 DSH 插件广场索引的条目
 *
 * 只读本目录的源码，不改动开发用的 package.json（它保持 private 与 @local 名字，
 * 因此本地 link 安装不会被影响）。发布名、作者、仓库等全部来自 publish.config.json。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const pkg = readJson(path.join(ROOT, 'package.json'))
const config = readJson(path.join(ROOT, 'publish.config.json'))

const problems = []
const todos = []

function require_(condition, message) {
  if (!condition) problems.push(message)
}

// ── 校验发布名（允许 @scope/name）────────────────────────────────────────
const name = String(config.name || '')
require_(
  /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name),
  `发布名不合法：${JSON.stringify(name)}（小写字母/数字/._-，可带 @scope/）`,
)
require_(!name.startsWith('@local'), '发布名不能用 @local 前缀（那是本地开发用的私有 scope）')

for (const key of ['author', 'repository', 'homepage']) {
  if (String(config[key] || '').includes('TODO')) todos.push(`publish.config.json → ${key}`)
}

if (problems.length > 0) {
  console.error('✗ 无法生成发布产物：')
  for (const problem of problems) console.error('  -', problem)
  process.exit(1)
}

// ── 收集要复制的文件（支持 files 里的 dir/*.json 通配）────────────────────
function expand(pattern) {
  if (!pattern.includes('*')) return [pattern]
  const dir = path.dirname(pattern)
  const suffix = path.basename(pattern).replace('*', '')
  return fs
    .readdirSync(path.join(ROOT, dir))
    .filter((entry) => entry.endsWith(suffix))
    .map((entry) => path.join(dir, entry).replace(/\\/g, '/'))
}

const files = [...new Set((pkg.files || []).flatMap(expand))]
const missing = files.filter((rel) => !fs.existsSync(path.join(ROOT, rel)))
if (missing.length > 0) {
  console.error('✗ package.json 的 files 里有不存在的文件：', missing.join(', '))
  process.exit(1)
}

// ── 产出 dist/<name> ─────────────────────────────────────────────────────
const outDir = path.join(DIST, name)
// 整棵 dist 重来：改名后旧目录不该留着误导人
fs.rmSync(DIST, { recursive: true, force: true })
for (const rel of files) {
  const target = path.join(outDir, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(ROOT, rel), target)
}

const rewrite = (rel, from, to) => {
  const file = path.join(outDir, rel)
  const text = fs.readFileSync(file, 'utf8')
  const count = text.split(from).length - 1
  if (count !== 1) {
    console.error(`✗ ${rel} 里期望出现 1 次 ${JSON.stringify(from)}，实际 ${count} 次——改名逻辑需要更新`)
    process.exit(1)
  }
  fs.writeFileSync(file, text.split(from).join(to), 'utf8')
}

const publicPkg = {
  ...pkg,
  name,
  author: config.author,
  repository: { type: 'git', url: config.repository },
  homepage: config.homepage,
  keywords: config.keywords || pkg.keywords,
  publishConfig: { registry: 'https://registry.npmjs.org/', access: 'public' },
  engines: { ...pkg.engines, ...(config.enginesDsh ? { dsh: config.enginesDsh } : {}) },
}
delete publicPkg.private
delete publicPkg.scripts

fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(publicPkg, null, 2)}\n`, 'utf8')

// 源码本身就是发布身份，这里只做一致性校验：patch 行名与客户端模块 id 必须和包名一致，
// 否则装上去会是另一个身份（改名漏一处就会静默失效）。
const assertOnce = (rel, needle) => {
  const text = fs.readFileSync(path.join(outDir, rel), 'utf8')
  const count = ([text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))] || []).length
  if (count !== 1) {
    console.error(`✗ ${rel} 里期望出现 1 次 ${JSON.stringify(needle)}，实际 ${count} 次`)
    process.exit(1)
  }
}
assertOnce('cordis.patch.yml', `name: "${name}"`)
assertOnce('client.js', `id: '${name}'`)

// ── 广场索引条目 ─────────────────────────────────────────────────────────
// 图标用 GitHub 直链：不依赖 npm 是否已发布，也不用等 CDN 缓存
const repoSlug = String(config.repository || '')
  .replace(/^https:\/\/github\.com\//, '')
  .replace(/\.git$/, '')
const icon = /^[\w.-]+\/[\w.-]+$/.test(repoSlug)
  ? `https://raw.githubusercontent.com/${repoSlug}/main/icon.svg`
  : `https://cdn.jsdelivr.net/npm/${name}@${pkg.version}/icon.svg`

const entry = {
  name,
  title: config.title || name,
  description: config.description,
  icon,
  author: config.author,
  homepage: config.homepage,
  repository: { url: config.repository },
  metadata: {
    category: config.category,
    keywords: config.keywords || pkg.keywords,
    labels: config.labels || [],
  },
  versions: [
    {
      version: pkg.version,
      source: { type: 'npm' },
      ...(config.enginesDsh ? { engines: { dsh: config.enginesDsh } } : {}),
    },
  ],
}
fs.writeFileSync(path.join(DIST, 'market-entry.json'), `${JSON.stringify(entry, null, 2)}\n`, 'utf8')

// ── 报告 ─────────────────────────────────────────────────────────────────
const bytes = files.reduce((sum, rel) => sum + fs.statSync(path.join(outDir, rel)).size, 0)
console.log(`✓ dist/${name}/  (${files.length} 个文件, ${(bytes / 1024).toFixed(1)} KB)`)
console.log(`✓ dist/market-entry.json  (分类 ${config.category}，版本 ${pkg.version})`)

if (todos.length > 0) {
  console.log('\n还差这些占位符（改 publish.config.json 后重跑）：')
  for (const todo of todos) console.log('  -', todo)
}

console.log(`
下一步：
  1. cd dist/${name} && npm publish --access public
  2. 把 dist/market-entry.json 里的 versions[0] 补上 publishTimestamp（毫秒时间戳/秒，按广场要求）
  3. 提交到插件广场索引仓库（PR 本条目）
`)
