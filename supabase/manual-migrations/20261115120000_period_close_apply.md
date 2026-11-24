# ステップ3: 年度の確定・ロック — 適用手順

対象: `20261115120000_period_close.sql`（変更）／`20261115120000_period_close.test.sql`（テスト）。
設計: ステップ3・DB（年度確定）。ローカルでの検証結果は `supabase/manual-migrations/step3-sql-report.md`。

> 認証がないため、**確定の解除は誰でもできます**。履歴は操作の記録であり、改ざん防止ではありません（下の「既知の制限」）。

## 0. 適用前（必ずやる）

1. バックアップ（public スキーマ・データ込み）。パスワードは貼らず、環境変数で渡す。
   ```
   pg_dump "$SUPABASE_DB_URL" -n public -Fc -f stoic_before_step3.dump
   ```
   Free プランは自動バックアップがない。取得できたことを確認してから進む。
2. SQL Editor で、次の**確認クエリ**を1つずつ実行して結果を控える。

```sql
-- (a) 件数（適用前後で一致すること）
select
  (select count(*) from companies)        as companies,
  (select count(*) from fiscal_periods)   as periods,
  (select count(*) from accounts)         as accounts,
  (select count(*) from journal_entries)  as entries,
  (select count(*) from journal_lines)    as lines,
  (select count(*) from import_staging)   as staging,
  (select count(*) from period_opening_balance_sets)  as pob_sets,
  (select count(*) from period_opening_balance_lines) as pob_lines,
  (select count(*) from period_opening_balance_logs)  as pob_logs;

-- (b) 会社内で期間が重なる期（0行であること。あると E5 で確定できない）
select a.company_id, a.name, a.start_date, a.end_date, b.name, b.start_date, b.end_date
from fiscal_periods a join fiscal_periods b
  on a.company_id = b.company_id and a.id < b.id
 and a.start_date <= b.end_date and b.start_date <= a.end_date;

-- (c) 繰越先が未設定の会社（0行が望ましい。あると、損益の動きがある期は E3 で確定できない）
select id, name, kind from companies where carry_forward_account_id is null and not is_archived;

-- (d) 財務諸表区分が未設定の科目に仕訳がある（0行が望ましい。あると E4 で確定できない）
select a.company_id, a.code, a.name, a.type, count(*) as lines
from accounts a join journal_lines l on l.account_id = a.id
where (a.type in ('ASSET','LIABILITY','EQUITY') and a.bs_category is null)
   or (a.type in ('REVENUE','EXPENSE') and a.pl_category is null)
group by 1,2,3,4;

-- (e) 既に closed_at 列・履歴表がないこと（0・0であること）
select
  (select count(*) from information_schema.columns where table_name='fiscal_periods' and column_name='closed_at') as has_col,
  (select count(*) from information_schema.tables  where table_name='fiscal_period_close_logs') as has_log;
```

## 1. 適用順序

1. `20261115120000_period_close.sql` を SQL Editor に**全体を貼って実行**（1回の実行＝1トランザクション。途中で失敗すれば全体が取り消される）。末尾の `NOTIFY pgrst, 'reload schema'` まで流れること。
2. 上の確認クエリ(a)を再実行し、件数が適用前と一致することを確認する（このSQLは既存の行を書き換えない。`closed_at` は全期 NULL＝未確定のまま）。
3. `20261115120000_period_close.test.sql` を貼って実行。最後に意図的な ERROR として **`TEST RESULT: ALL PASSED (165 checks)`** が出ること。`FAILED -> …` が出たら、列挙された項目名を控えて中止する（データは残らない）。
3b. **`*.test_local.sql` は本番では実行しない**（ローカル検証専用。`session_replication_role = replica` を使うため）。
4. 既存のSQLテスト（ステップ2の `20261114180000_opening_balances.test.sql` など）を再実行して、通ることを確認する。
5. 同時実行の確認（任意だが推奨）: `20261115120000_period_close_concurrency.md` の手順（psql 2接続）。SQL Editor は自動コミットのため使えない。
6. 本番ダンプ（schema-only・public・`--no-owner`）を取り直し、`supabase/schema.sql` を置き換える。`CLAUDE.md` の更新は別作業。

## 2. 適用後の確認クエリ

```sql
select count(*) filter (where closed_at is not null) as closed_periods, count(*) as periods from fiscal_periods;  -- 0 / 全期
select count(*) from fiscal_period_close_logs;                                                                       -- 0
select tgname from pg_trigger where not tgisinternal and tgname like any (array['%closed%','%close_state%']) order by 1; -- 10本
```

## 3. ロールバックSQL（適用後に戻す場合）

`closed_at` を持つ期が1つもないこと（全期未確定）を確認してから実行する。確定済みの期があると、戻した後も確定の意味が失われる。

```sql
begin;
drop trigger if exists trg_journal_entries_closed_guard on journal_entries;
drop trigger if exists trg_journal_lines_z_closed_guard on journal_lines;
drop trigger if exists trg_pob_sets_closed_guard on period_opening_balance_sets;
drop trigger if exists trg_pob_lines_closed_guard on period_opening_balance_lines;
drop trigger if exists trg_fiscal_periods_closed_insert on fiscal_periods;
drop trigger if exists trg_fiscal_periods_closed_dates on fiscal_periods;
drop trigger if exists trg_fiscal_periods_closed_delete on fiscal_periods;
drop trigger if exists trg_fiscal_periods_close_state on fiscal_periods;
drop trigger if exists trg_accounts_d_guard_closed_periods on accounts;
drop trigger if exists trg_companies_guard_closed_carry_forward on companies;
drop function if exists get_period_close_check(uuid), close_fiscal_period(uuid, text), reopen_fiscal_period(uuid, text),
  period_close_errors(uuid), period_close_warnings(uuid), period_carry_forward_amount(uuid, date),
  period_close_prev_open(uuid), period_assert_open(uuid), period_lock_company(uuid, boolean),
  guard_period_range(uuid, uuid, date), guard_closed_period_journal_entry(), guard_closed_period_journal_line(),
  guard_closed_period_opening_balance(), guard_fiscal_period_insert(), guard_fiscal_period_dates(),
  guard_fiscal_period_delete(), guard_period_close_state(), guard_account_in_closed_periods(), guard_closed_carry_forward();
drop table if exists fiscal_period_close_logs;
alter table fiscal_periods drop column if exists closed_at;
notify pgrst, 'reload schema';
commit;
```
（履歴表を消すと確定・解除の記録が失われる。必要なら先に `pg_dump -t fiscal_period_close_logs` で退避する。）

## 4. 既知の制限

- **認証がない**ため、確定の解除は誰でもできる。履歴（`fiscal_period_close_logs`）は操作の記録であり、改ざん防止ではない（anon に INSERT が許可されており、偽造できる）。`changed_by` はない。
- 「確定」が保証するのは、**会計上の残高が動かないこと**（仕訳・期首残高・科目の種別／区分／親・繰越先・期間）。税区分マスタ・`tax_method`・科目名・補助科目の追加などは固定されない（補助科目の追加は許可。名前の変更も許可）。帳票の完全な再現性までは保証しない。
- **確定・解除は1トランザクションにつき1期**。複数期を同じトランザクションで確定・解除すると、他の期の更新と循環待ち（デッドロック、`40P01`）になり得る（C10・ローカルで再現。片方が中断されるだけでデータは壊れない）。
- 期の連続性（空白・重複）の一般的な DB 強制はしない。確定済みの期との関係（重なり・前方への挿入の禁止）と、確定時の E5 だけ。
- `ledger_view`・RLS・grant の最小化は従来どおり未対応。
- 一括変更どうしのデッドロック（行ロックの順序が不定）は従来からあり、今回は変えていない。
- 確認系の関数（`period_close_errors` など5本）は、意図して `VOLATILE`。`STABLE` にすると、同じトランザクション内の PL/pgSQL（DO ブロックなど）で式の中から呼んだとき、直前に同じブロックが書いた行が見えない。
- Claude のローカル検証は PostgreSQL 16.15。PostgreSQL 17.12 で回帰・同時実行を確認済み。pgbench（C6）は PG16 のみ。通常テストの本番適用時の結果は、適用履歴を参照。 [SQLテストの記録](../../docs/60-testing/sql-tests.md#記録にある検証範囲)
