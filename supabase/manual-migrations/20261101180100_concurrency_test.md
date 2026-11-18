# Migration B: COMMIT経路と同時更新の確認手順

`*.test.sql` は最後に全体をロールバックするため、**実際の COMMIT 時の検証**と**別接続どうしの競合**は確認できない。
この2つを本番相当の DB で確認する手順をまとめる。

1a（`20261112120000_company_support.sql`）適用後のDBが前提。以下は既存の会社・当期を使わず、ランダム名の架空の法人会社で準備する。ローカル検証では現行 `schema.sql` を読み込むだけでよく、適用済みの旧マイグレーションを再実行しない。

> 開発時の確認（2026-11-01）: ローカルの PostgreSQL 16 に `schema.sql` → 既存 migration → A → B を適用し、
> 独立した2接続（psycopg2）で手順 0〜5 に相当する 16 ケースがすべて期待どおりになることを確認済み。
> 明示ロック（`trg_journal_lines_guard`）だけでも、`updated_at` 連鎖更新 Trigger だけでも直列化されることも確認した。
> Supabase は PostgreSQL 17 のため、本番では最低限 **手順 0** と **手順 1** を実施する。

---

## 手順 0: COMMIT 経路（SQL Editor でよい・B 適用後）

SQL Editor は1回の実行を1トランザクションとしてコミットするので、そのまま COMMIT 経路の確認になる。

```sql
with c as (
  insert into companies (name, kind, tax_method)
  values ('ZZCOMMIT' || replace(gen_random_uuid()::text, '-', ''), 'CORPORATION', 'EXEMPT')
  returning id
), p as (
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current)
  select c.id, 'ZZTEST commit-path', '2099-04-01'::date, '2100-03-31'::date, false from c
  returning id, start_date
)
insert into journal_entries (period_id, date, description)
select p.id, p.start_date, 'ZZTEST commit-path' from p
returning id, period_id, company_id;
```

- 期待: `ERROR: INVALID_JOURNAL_LINES`（DETAIL: 明細が不足しています（0 行））
- 確認: `select count(*) from journal_entries where description = 'ZZTEST commit-path';` → **0**
- 会社・期・仕訳は同じ文のトランザクションに含まれるので、期待どおり拒否されればすべてロールバックされる。
- 万一コミットされた場合（= B が効いていない）は、返った `company_id` を `COMPANY` として保存し、下の「後片付け」を実行する（削除で増える訂正履歴も対象会社だけを削除する）。

---

## 手順 1〜3: 同時更新（独立した2接続が必要）

SQL Editor はタブを分けても同じ接続が維持される保証がないため、**psql を2つ起動**して行う。

- 接続文字列: Supabase ダッシュボード → Connect → **Session pooler**（または Direct connection）。
  Transaction pooler（ポート 6543）は使わない。
- 以下、ターミナル A / B と呼ぶ。`\set` の値は準備で表示された ID に置き換える。

### 準備（どちらか片方で1回・コミットされる）

```sql
insert into companies (name, kind, tax_method)
values ('ZZCONCURRENT' || replace(gen_random_uuid()::text, '-', ''), 'CORPORATION', 'EXEMPT')
returning id as "COMPANY" \gset
insert into fiscal_periods (company_id, name, start_date, end_date, is_current)
values (:'COMPANY', 'ZZTEST 並行', '2099-04-01', '2100-03-31', false)
returning id as "P" \gset
insert into accounts (company_id, code, name, type, bs_category)
values (:'COMPANY', 'ZZTEST-C1', 'テスト現金', 'ASSET', 'CURRENT_ASSETS')
returning id as "CASH" \gset
insert into accounts (company_id, code, name, type, pl_category)
values (:'COMPANY', 'ZZTEST-C2', 'テスト売上', 'REVENUE', 'REVENUE')
returning id as "SALES" \gset
\echo COMPANY :COMPANY P :P CASH :CASH SALES :SALES
-- \gset はpsqlの変数設定。journal_entries / journal_linesの会社はトリガーが設定する。
-- 明細4行（D100/C100/D50/C50）の仕訳
with e as (insert into journal_entries (period_id, date, description) values (:'P', '2099-05-01', 'ZZTEST skew') returning id)
insert into journal_lines (entry_id, line_number, side, account_id, amount)
select e.id, v.n, v.s, v.a::uuid, v.m from e,
  (values (1, 'DEBIT', :'CASH', 100), (2, 'CREDIT', :'SALES', 100), (3, 'DEBIT', :'CASH', 50), (4, 'CREDIT', :'SALES', 50)) as v(n, s, a, m)
returning entry_id;                                                                                                        -- → :E
```

両方のターミナルで `\set COMPANY '...'` `\set P '...'` `\set CASH '...'` `\set SALES '...'` `\set E '...'` を実行しておく（準備した側のCOMPANY/P/CASH/SALESは設定済み）。

### 手順 1: 同じ仕訳の明細を同時に変更（write skew）

| 順 | ターミナル A | ターミナル B | 期待 |
|---|---|---|---|
| 1 | `begin;` | `begin;` | |
| 2 | `delete from journal_lines where entry_id = :'E' and amount = 50;` | | 即完了 |
| 3 | | `delete from journal_lines where entry_id = :'E' and amount = 100;` | **待たされる** |
| 4 | `commit;` | | 成功 → B の手順3が完了 |
| 5 | | `commit;` | **`ERROR: INVALID_JOURNAL_LINES`**（明細 0 行） |

確認: `select count(*) from journal_lines where entry_id = :'E';` → **2**（A の変更だけが残る）

### 手順 2: 仕訳登録と期間短縮の競合

| 順 | ターミナル A | ターミナル B | 期待 |
|---|---|---|---|
| 1 | `begin;` | `begin;` | |
| 2 | `select create_journal_entry(:'P', '2100-03-31', 'ZZTEST last', null, jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',:'CASH','amount','1'), jsonb_build_object('side','CREDIT','account_id',:'SALES','amount','1')));` | | 即完了 |
| 3 | | `update fiscal_periods set end_date = '2100-03-30' where id = :'P';` | **待たされる** |
| 4 | `commit;` | | B の手順3が **`ERROR: PERIOD_HAS_OUTSIDE_ENTRIES`** |
| 5 | | `rollback;` | |

（逆順 = B が先に期間を短縮し A が後から登録 → A が待たされ、B のコミット後に `OUT_OF_PERIOD` になる。こちらも同様に確認できる）

### 手順 3: CSV 本登録の二重実行（任意）

次の準備で `import_staging` に1行入れ、A・B の両方で `begin;` → `select import_staging_entries(:'P', array['<staging id>']::uuid[]);` を実行。

```sql
insert into import_staging (company_id, raw_date, raw_debit_amount, raw_description, predicted_account_id, counter_account_id)
values (:'COMPANY', '2099-05-01', 100, 'ZZTEST concurrent CSV', :'CASH', :'SALES') returning id;
```

B が待たされ、A の `commit;` 後に B が **`INVALID_STAGING_ROWS`**（登録済みの取込データが 1 件）になれば OK。

### 後片付け（必須）

```sql
begin;
delete from journal_entries where company_id = :'COMPANY';
delete from journal_entry_logs where before_data->'entry'->>'company_id' = :'COMPANY';
delete from import_staging where company_id = :'COMPANY';
delete from fiscal_periods where company_id = :'COMPANY';
delete from accounts where company_id = :'COMPANY';
delete from companies where id = :'COMPANY';
commit;
```

> 作成した会社IDでのみ後片付けする。訂正履歴も対象会社のJSONで絞る。会社・ログの削除にはpostgres等の管理権限が必要で、REST/anonでは実行しない。
