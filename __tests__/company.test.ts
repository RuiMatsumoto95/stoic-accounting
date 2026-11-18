import { afterEach, describe, expect, it } from 'vitest'
import { createRequestGeneration, isCurrentGeneration, resolveActiveCompany, type Company } from '@/lib/company'
import { COMPANY_COOKIE_OPTIONS, readCompanyCookie } from '@/lib/company-cookie'
import { assertActiveCompany, assertCompanyMatches, registerActiveCompany } from '@/lib/company-guard'

const a: Company = { id: 'a', name: 'A社', kind: 'CORPORATION', tax_method: 'EXEMPT', is_archived: false }
const b: Company = { ...a, id: 'b', name: 'B社' }

afterEach(() => registerActiveCompany(null))

describe('会社の解決（会社数 × cookie の全組合せ）', () => {
  it.each([
    [[], 'no-company'], [[a], 'ready'], [[a, b], 'needs-selection'],
  ] as const)('アーカイブ済み cookie を候補 %j から解決する', (active, status) => {
    const result = resolveActiveCompany('archived', [...active, { ...a, id: 'archived', is_archived: true }])
    expect(result.status).toBe(status)
    if (result.status === 'ready') expect(result).toMatchObject({ company: a, needsCookie: true })
  })
  it.each([
    [[], 'a', 'no-company', undefined], [[], 'invalid', 'no-company', undefined], [[], null, 'no-company', undefined],
    [[a], 'a', 'ready', false], [[a], 'invalid', 'ready', true], [[a], null, 'ready', true],
    [[a, b], 'b', 'ready', false], [[a, b], 'invalid', 'needs-selection', undefined], [[a, b], null, 'needs-selection', undefined],
  ] as const)('会社 %j / cookie %j', (companies, cookie, status, needsCookie) => {
    const result = resolveActiveCompany(cookie, [...companies])
    expect(result.status).toBe(status)
    if (result.status === 'ready') {
      expect(result.company.id).toBe(cookie === 'b' ? 'b' : 'a')
      expect(result.needsCookie).toBe(needsCookie)
    }
  })
})

describe('cookie と保存直前の照合', () => {
  it('cookie の名前・境界・エンコード・欠落を処理する', () => {
    expect(readCompanyCookie('other=1; sa_company_id=a%20b; x=2')).toBe('a b')
    expect(readCompanyCookie('xsa_company_id=a')).toBeNull()
    expect(readCompanyCookie('sa_company_id=')).toBeNull()
    expect(readCompanyCookie('sa_company_id=%')).toBeNull()
  })
  it('Path=/、Lax、1年、クライアントで読める cookie', () => {
    expect(COMPANY_COOKIE_OPTIONS).toEqual({ path: '/', sameSite: 'lax', maxAge: 31536000, httpOnly: false })
  })
  it('登録会社と cookie が同じなら保存できる', () => {
    registerActiveCompany('a')
    expect(() => assertActiveCompany(undefined, () => 'sa_company_id=a')).not.toThrow()
  })
  it.each(['sa_company_id=b', '', 'sa_company_id=%'])('異なる・欠落・壊れた cookie を拒否: %s', cookie => {
    registerActiveCompany('a')
    expect(() => assertActiveCompany(undefined, () => cookie)).toThrow(expect.objectContaining({ code: 'STALE_COMPANY' }))
  })
  it('登録前も拒否する（先頭の会社へ保存しない）', () => {
    expect(() => assertActiveCompany(undefined, () => 'sa_company_id=a')).toThrow(expect.objectContaining({ code: 'STALE_COMPANY' }))
  })
  it('旧画面の期待会社はモジュールの登録が変わっても拒否する', () => {
    registerActiveCompany('b')
    expect(() => assertActiveCompany('a', () => 'sa_company_id=b')).toThrow(expect.objectContaining({ code: 'STALE_COMPANY' }))
    expect(() => assertActiveCompany('a', () => 'sa_company_id=a')).toThrow(expect.objectContaining({ code: 'STALE_COMPANY' }))
  })
  it('node でブラウザ照合はしない。サーバー照合は明示して行う', () => {
    expect(() => assertActiveCompany('a')).not.toThrow()
    expect(() => assertCompanyMatches('a', 'b')).toThrow(expect.objectContaining({ code: 'STALE_COMPANY' }))
    expect(() => assertCompanyMatches('a', 'a')).not.toThrow()
  })
})

describe('古い通信の破棄', () => {
  it('現在の世代だけを反映する', () => {
    expect(isCurrentGeneration(1, 2)).toBe(false)
    expect(isCurrentGeneration(2, 2)).toBe(true)
  })
  it('再取得と境界の破棄で未完了の結果を無効にする', async () => {
    const generation = createRequestGeneration()
    const old = generation.next()
    const latest = generation.next()
    const applied: string[] = []
    await Promise.all([Promise.resolve().then(() => { if (generation.isCurrent(latest)) applied.push('B') }), Promise.resolve().then(() => { if (generation.isCurrent(old)) applied.push('A') })])
    expect(applied).toEqual(['B'])
    generation.invalidate()
    expect(generation.isCurrent(latest)).toBe(false)
    expect(generation.isCurrent(generation.next())).toBe(true)
  })
})
