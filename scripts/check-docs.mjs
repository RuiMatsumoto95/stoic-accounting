#!/usr/bin/env node
// docs/ の形式チェック。新しい npm パッケージは使わない。
//   node scripts/check-docs.mjs          ヘッダー形式・code パス・related・相対リンクを検査
//   node scripts/check-docs.mjs --drift  verified のコミット以降に code が変わった docs を一覧
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const DOCS = join(ROOT, 'docs')
const STATUS = ['現行', '参照のみ', '廃止', '採用', '提案', '置換']
const NO_HEADER_DIRS = ['70-ideas', '90-notes', '_templates']
const drift = process.argv.includes('--drift')

const errors = []
const warns = []
const err = (f, m) => errors.push(`${relative(ROOT, f)}: ${m}`)
const warn = (f, m) => warns.push(`${relative(ROOT, f)}: ${m}`)

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []
  })
}

function parseHeader(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!m) return null
  const h = {}
  for (const line of m[1].split(/\r?\n/)) {
    const k = line.match(/^([a-z]+):\s*(.*?)\s*(#.*)?$/)
    if (!k) continue
    let v = k[2]
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
    }
    h[k[1]] = v
  }
  return h
}

const files = walk(DOCS)
const adrIds = new Set(
  files.map((f) => relative(DOCS, f)).filter((r) => r.startsWith('40-decisions' + sep))
    .map((r) => r.match(/(ADR-\d{4})/)?.[1]).filter(Boolean),
)

const driftList = []

for (const f of files) {
  const rel = relative(DOCS, f)
  const top = rel.split(sep)[0]
  const text = readFileSync(f, 'utf8')

  // リンク（相対パスのみ。コードブロック内は除外）
  const body = text.replace(/```[\s\S]*?```/g, '')
  for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1].split('#')[0]
    if (!href || /^[a-z]+:/i.test(href) || href.startsWith('#')) continue
    if (!existsSync(resolve(dirname(f), href))) err(f, `リンク切れ: ${m[1]}`)
  }

  if (NO_HEADER_DIRS.includes(top)) continue
  const h = parseHeader(text)
  if (!h) { err(f, 'ヘッダー（---で囲んだ front-matter）がありません'); continue }

  if (!STATUS.includes(h.status)) err(f, `status が不正: "${h.status}"（${STATUS.join(' / ')}）`)
  if (top === '40-decisions' && rel !== '40-decisions/README.md') {
    if (!/^ADR-\d{4}/.test(rel.split(sep).pop())) err(f, 'ADR のファイル名は ADR-0001-xxx.md の形式')
    if (!h.decided) err(f, 'ADR には decided（決定日）が必要')
  }

  const v = h.verified ?? ''
  const vm = String(v).match(/^(\d{4}-\d{2}-\d{2}) @ ([0-9a-f]{7,40})$/)
  if (!vm) {
    if (/xx|<|未/.test(String(v)) || !v) warn(f, `verified が未記入（"${v}"）`)
    else err(f, `verified の形式が不正: "${v}"（YYYY-MM-DD @ <hash>）`)
  }

  const code = Array.isArray(h.code) ? h.code : h.code ? [h.code] : null
  if (code === null) err(f, 'code がありません（空なら []）')
  else for (const c of code) {
    if (!existsSync(join(ROOT, c))) err(f, `code のパスが存在しません: ${c}`)
  }

  const related = Array.isArray(h.related) ? h.related : []
  for (const r of related) {
    if (/^ADR-\d{4}$/.test(r)) { if (!adrIds.has(r)) err(f, `related の ${r} が見つかりません`) }
    else if (!existsSync(resolve(dirname(f), r)) && !existsSync(join(ROOT, r))) err(f, `related のパスが存在しません: ${r}`)
  }

  if (drift && vm && code?.length) {
    try {
      const out = execFileSync('git', ['log', '--name-only', '--pretty=format:', `${vm[2]}..HEAD`, '--', ...code],
        { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
      const changed = [...new Set(out)]
      if (changed.length) driftList.push(`${rel}（verified ${vm[1]} @ ${vm[2]}）: ${changed.join(', ')}`)
    } catch {
      warn(f, `verified のコミット ${vm[2]} を git で解決できません`)
    }
  }
}

if (warns.length) console.log(`警告 ${warns.length} 件\n` + warns.map((w) => '  ' + w).join('\n'))
if (drift) {
  console.log(`\nずれの可能性（verified 以降に code が変更）: ${driftList.length} 件`)
  for (const d of driftList) console.log('  ' + d)
}
if (errors.length) {
  console.error(`\nエラー ${errors.length} 件\n` + errors.map((e) => '  ' + e).join('\n'))
  process.exit(1)
}
console.log(`\nOK: ${files.length} ファイルを検査しました`)
