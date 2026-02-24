import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Cloudflare's nodejs_compat provides a `process` object with getters that use
 * private fields. Some bundled shims wrap that object in a Proxy and call
 * `Reflect.get(target, prop, receiver)` with `receiver` set to the Proxy.
 * That breaks private-field access inside getters (receiver is not an instance
 * of the declaring class) and crashes with:
 *   "Cannot read private member #... from an object whose class did not declare it"
 *
 * Fix: when forwarding existing properties, do not override the receiver.
 */

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist/_worker.js')

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) yield* walk(p)
    else yield p
  }
}

const fileFilter = (p) =>
  (p.endsWith('.mjs') || p.endsWith('.js')) &&
  // Avoid patching sourcemaps or binary assets.
  !p.endsWith('.map')

// Reflect.has(a,b)?Reflect.get(a,b,c):Reflect.get(d,b,c)
const PROXY_REFLECT_GET_RE =
  /Reflect\.has\(([^,]+),([^)]+)\)\?Reflect\.get\(\1,\2,([^)]+)\):Reflect\.get\(([^,]+),\2,\3\)/g

let totalReplacements = 0
const patchedFiles = []

try {
  await fs.access(ROOT)
} catch {
  console.error(`[patch-cf-process-proxy] Not found: ${ROOT}`)
  process.exit(1)
}

for await (const p of walk(ROOT)) {
  if (!fileFilter(p)) continue
  const src = await fs.readFile(p, 'utf8')
  let count = 0
  const out = src.replace(PROXY_REFLECT_GET_RE, (_m, a, b, _c, d) => {
    count++
    return `Reflect.has(${a},${b})?Reflect.get(${a},${b}):Reflect.get(${d},${b})`
  })
  if (count > 0) {
    await fs.writeFile(p, out, 'utf8')
    totalReplacements += count
    patchedFiles.push(p)
  }
}

if (totalReplacements === 0) {
  console.log(`[patch-cf-process-proxy] No matches under ${ROOT}; nothing to patch.`)
} else {
  console.log(
    `[patch-cf-process-proxy] Patched ${patchedFiles.length} file(s), ${totalReplacements} replacement(s).`
  )
}

