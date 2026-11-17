import os from 'node:os'
import path from 'node:path'

process.env.DSH_HOME = path.join(os.tmpdir(), `sd-smoke-${Date.now()}`)
const target = process.argv[2]
const mod = await import(new URL(`file:///${target.replace(/\\/g, '/')}`).href)
console.log('exports:', Object.keys(mod).join(', ') || '(none)')
console.log('apply 类型:', typeof mod.apply)
if (typeof mod.apply !== 'function') process.exit(1)
