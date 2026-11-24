---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations/20261110170000_auto_reference_number.sql, supabase/manual-migrations/20261114190000_grant_opening_balance_account_ok.sql, lib/supabase.ts, lib/company-operations.ts, lib/reports/ledger.ts, lib/reports/subsidiary-ledger.ts]
related: [README.md, tables.md, functions-rpc.md, migrations.md]
---

# RLS と権限

[スキーマのダンプ](../../supabase/schema.sql) では17表のうち12表で RLS（行レベルセキュリティ）が有効、5表で無効。ポリシーは15件。ポリシーの式には会社や利用者による絞り込みがなく、行に対して使える操作は下記のポリシーとテーブル権限で決まる。

アプリの [Supabaseクライアント](../../lib/supabase.ts) は公開用の anon キーで初期化される。会社の選択やアーカイブはアプリの表示・操作対象を切り替える。複合外部キーは書き込む参照同士の所属会社を一致させる。いずれの仕組みも、DBへのアクセス時に利用者と会社の所属を照合する機能は持たない。

## RLSとポリシー

| RLS | 対象表 |
| --- | --- |
| 有効（12表） | `accounts`、`companies`、`fiscal_period_close_logs`、`fiscal_periods`、`import_staging`、`journal_entries`、`journal_entry_logs`、`journal_lines`、`mapping_rules`、`period_opening_balance_lines`、`period_opening_balance_logs`、`period_opening_balance_sets` |
| 無効（5表） | `account_aliases`、`journal_template_lines`、`journal_templates`、`system_settings`、`tax_codes` |

全15件で `TO` を省略しており、適用先は `PUBLIC`。通常の9件は `FOR ALL`（既定値）で `USING (true) WITH CHECK (true)`。履歴表3つは `SELECT` の `USING (true)` と `INSERT` の `WITH CHECK (true)` を1件ずつ持つ。

| 表 | ポリシー |
| --- | --- |
| `accounts` | `allow_all_accounts` |
| `companies` | `allow_all_companies` |
| `fiscal_period_close_logs` | `allow_insert_fiscal_period_close_logs`、`allow_select_fiscal_period_close_logs` |
| `fiscal_periods` | `allow_all_fiscal_periods` |
| `import_staging` | `allow_all_import_staging` |
| `journal_entries` | `allow_all_journal_entries` |
| `journal_entry_logs` | `allow_insert_journal_entry_logs`、`allow_select_journal_entry_logs` |
| `journal_lines` | `allow_all_journal_lines` |
| `mapping_rules` | `allow_all_mapping_rules` |
| `period_opening_balance_lines` | `allow_all_period_opening_balance_lines` |
| `period_opening_balance_logs` | `allow_insert_period_opening_balance_logs`、`allow_select_period_opening_balance_logs` |
| `period_opening_balance_sets` | `allow_all_period_opening_balance_sets` |

## テーブル・ビューの権限

`anon` と `authenticated` には `public` スキーマの `USAGE` があり、次の表レベル権限が共通で付与されている。ここでの区分はダンプに記録された対象オブジェクトの付与内容。

| 付与 | 対象 |
| --- | --- |
| `SELECT`、`INSERT`、`UPDATE`、`DELETE`、`MAINTAIN` | `account_aliases`、`accounts`、`fiscal_periods`、`import_staging`、`journal_entries`、`journal_lines`、`journal_template_lines`、`journal_templates`、`mapping_rules`、`system_settings`、`tax_codes` |
| `SELECT`、`INSERT`、`UPDATE`、`MAINTAIN` | `companies` |
| `SELECT`、`INSERT`、`UPDATE`、`DELETE` | `period_opening_balance_lines`、`period_opening_balance_sets` |
| `SELECT`、`INSERT`、`MAINTAIN` | `journal_entry_logs` |
| `SELECT`、`INSERT` | `fiscal_period_close_logs`、`period_opening_balance_logs` |
| `SELECT`、`MAINTAIN` | `ledger_view` |

- `accounts.pl_category` と `accounts.bs_category` には、表の `SELECT` に加えて列単位の `SELECT` も記録されている。
- 現存する17表とビューのACLには、`anon`／`authenticated` に対する `TRUNCATE`・`REFERENCES`・`TRIGGER` の付与がない。`service_role` には17表とビューに対する `REFERENCES`・`TRIGGER`・`TRUNCATE`・`MAINTAIN` が明示される。
- `postgres` が今後 `public` に作る表の既定権限には、`anon`／`authenticated`／`service_role` への `REFERENCES`・`TRIGGER`・`TRUNCATE`・`MAINTAIN` が含まれる。新規表では、表そのもののACLとRLSポリシーを確認する。
- 履歴3表は `anon`／`authenticated` に `INSERT` を許す。履歴の追加自体から操作の真正性を保証することはできない。`journal_entry_logs.changed_by` の既定値は `'user'` で、トリガーは操作者IDを設定しない。

## 関数の実行権限

仕訳保存、採番、会社作成、期首残高、年度確定・解除のRPCと、そこから呼ぶ通常の補助関数には、ダンプで `PUBLIC` への `REVOKE ALL` と `anon`／`authenticated` への実行権限の付与がある。これは呼び出し側の権限で動く `SECURITY INVOKER` の関数が、内側の補助関数を呼ぶ際にも必要になる。`opening_balance_account_ok` の [追加付与](migrations.md) がその例。

ダンプには `anon`／`authenticated` に対する関数の明示的な付与が27本分ある。通常関数26本に加え、イベントトリガー用の `rls_auto_enable` が含まれる。通常関数のうち `get_pl_data` と、イベントトリガー用の `rls_auto_enable` には `PUBLIC` への明示的な `REVOKE` が記録されていない。個別の関数は [DB関数とRPC](functions-rpc.md) を参照。

## `ledger_view`

`ledger_view` の定義に `security_invoker = true` はない。基表への権限とRLSはビュー所有者側で評価される。ダンプは所有者情報を含まないため、所有者ロール名はこの定義から特定できない。`anon`／`authenticated` に `SELECT` が付与されており、ビューには `company_id` 列や会社・利用者による絞り込み条件がない。元帳で使う期・科目の絞り込みはアプリのクエリで指定する。

採番の [変更SQL](../../supabase/manual-migrations/20261110170000_auto_reference_number.sql) は伝票番号の型変更に合わせてビューを `DROP VIEW` してから作り直し、`SELECT` を付け直している。

## RLSを自動で有効にする関数

`rls_auto_enable()` は `SECURITY DEFINER` のイベントトリガー用関数。`CREATE TABLE`・`CREATE TABLE AS`・`SELECT INTO` のうち `public` の対象テーブルにRLSを有効化する処理を定義する。ダンプには、この関数を呼ぶ `CREATE EVENT TRIGGER` 文は含まれていない。
