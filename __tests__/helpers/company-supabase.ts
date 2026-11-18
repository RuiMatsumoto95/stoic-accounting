import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>
type DbError = { message: string; code: string; details: string; hint: string; name: string }
type Result = { data: Row[] | Row | null; error: DbError | null; count: number | null }
type Operation = 'read' | 'insert' | 'update' | 'delete'
export type Call = { table: string; operation: Operation; filters: [string, string, unknown][]; values?: Row | Row[] }

export function companyDb(seed: Record<string, Row[]>) {
  const tables = structuredClone(seed)
  const calls: Call[] = []
  let fail: ((call: Call) => string | undefined) | undefined
  class Query implements PromiseLike<Result> {
    private filters: [string, string, unknown][] = []
    private operation: Operation = 'read'
    private values?: Row | Row[]
    private singleRow = false
    private ordering?: { column: string; ascending: boolean }
    private max?: number
    private bounds?: [number, number]
    constructor(private table: string) {}
    select() { return this }
    eq(column: string, value: unknown) { this.filters.push([column, 'eq', value]); return this }
    in(column: string, value: unknown[]) { this.filters.push([column, 'in', value]); return this }
    lt(column: string, value: unknown) { this.filters.push([column, 'lt', value]); return this }
    gt(column: string, value: unknown) { this.filters.push([column, 'gt', value]); return this }
    gte(column: string, value: unknown) { this.filters.push([column, 'gte', value]); return this }
    lte(column: string, value: unknown) { this.filters.push([column, 'lte', value]); return this }
    is(column: string, value: unknown) { return this.eq(column, value) }
    order(column: string, options?: { ascending: boolean }) { this.ordering = { column, ascending: options?.ascending ?? true }; return this }
    limit(max: number) { this.max = max; return this }
    range(from: number, to: number) { this.bounds = [from, to]; return this }
    single() { this.singleRow = true; return this }
    insert(values: Row | Row[]) { this.operation = 'insert'; this.values = values; return this }
    update(values: Row) { this.operation = 'update'; this.values = values; return this }
    delete() { this.operation = 'delete'; return this }
    then<T = Result, U = never>(resolve?: ((value: Result) => T | PromiseLike<T>) | null, reject?: ((error: unknown) => U | PromiseLike<U>) | null): Promise<T | U> {
      const call: Call = { table: this.table, operation: this.operation, filters: [...this.filters], values: this.values }
      calls.push(call)
      const message = fail?.(call)
      if (message) return Promise.resolve({ data: null, count: null, error: { message, code: 'TEST', details: '', hint: '', name: 'PostgrestError' } }).then(resolve, reject)
      const table = tables[this.table] ?? []
      let selected = table.filter(row => this.filters.every(([column, operator, value]) => {
        if (operator === 'eq') return row[column] === value
        if (operator === 'in') return (value as unknown[]).includes(row[column])
        if (operator === 'lt') return String(row[column]) < String(value)
        if (operator === 'gte') return String(row[column]) >= String(value)
        if (operator === 'lte') return String(row[column]) <= String(value)
        return String(row[column]) > String(value)
      }))
      if (this.ordering) {
        const { column, ascending } = this.ordering
        selected.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1))
      }
      if (this.bounds) selected = selected.slice(this.bounds[0], this.bounds[1] + 1)
      if (this.max !== undefined) selected = selected.slice(0, this.max)
      if (this.operation === 'insert') {
        selected = (Array.isArray(this.values) ? this.values : [this.values!]).map((row, index) => ({ id: `created-${index}`, ...row }))
        tables[this.table] = [...table, ...selected]
      }
      if (this.operation === 'update') selected.forEach(row => Object.assign(row, this.values))
      if (this.operation === 'delete') tables[this.table] = table.filter(row => !selected.includes(row))
      const error = this.singleRow && selected.length !== 1 ? { message: 'not single', code: 'PGRST116', details: '', hint: '', name: 'PostgrestError' } : null
      return Promise.resolve({ data: error ? null : structuredClone(this.singleRow ? selected[0] : selected), error, count: selected.length }).then(resolve, reject)
    }
  }
  const client = { from: (table: string) => new Query(table) } as unknown as SupabaseClient
  return { client, tables, calls, failWith: (callback: (call: Call) => string | undefined) => { fail = callback } }
}
