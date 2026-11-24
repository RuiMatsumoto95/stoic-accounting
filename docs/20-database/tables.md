---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, lib/reports/ledger.ts, lib/reports/subsidiary-ledger.ts]
related: [README.md, triggers-constraints.md, security-rls.md]
---

# テーブルとビュー

`public` には17表と `ledger_view` がある。列・キーの定義は [スキーマ](../../supabase/schema.sql) に基づく。CHECK の許容値やトリガーの検査は [トリガーと制約](triggers-constraints.md) を参照。

列の「可」は `NULL` を許すことを表す。既定値の「—」は明示の既定値がない列。外部キーの削除時動作は、個別に記載したもの以外は `NO ACTION`。

## 会社・会計期間

### `companies`

法人・個人の会社マスタ。会社名は全体で一意。繰越先は同じ会社の純資産の親科目を参照する。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `name` | `text` | 不可 | — |
| `kind` | `text` | 不可 | — |
| `tax_method` | `text` | 不可 | `'EXEMPT'::text` |
| `carry_forward_account_id` | `uuid` | 可 | — |
| `created_at` | `timestamp with time zone` | 不可 | `now()` |
| `is_archived` | `boolean` | 不可 | `false` |

- 主キー `(id)`
- 一意制約 `(id, kind)`
- 一意制約 `(name)`
- 外部キー `(carry_forward_account_id, id)` → `accounts(id, company_id)`

### `fiscal_periods`

開始日と終了日は両端を含む。`closed_at` が `NULL` なら未確定。`is_current` は会社ごとに真が最大1件。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `name` | `text` | 不可 | — |
| `start_date` | `date` | 不可 | — |
| `end_date` | `date` | 不可 | — |
| `is_current` | `boolean` | 不可 | `false` |
| `company_id` | `uuid` | 不可 | — |
| `closed_at` | `timestamp with time zone` | 可 | — |

- 主キー `(id)`
- 一意制約 `(id, company_id)`
- 外部キー `(company_id)` → `companies(id)`
- 部分一意インデックス `idx_fiscal_periods_single_current` `(company_id) WHERE (is_current = true)`

### `fiscal_period_close_logs`

確定と解除の履歴。`company_id` は会社を参照し、`period_id` は操作時点の期IDを保持する。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `company_id` | `uuid` | 不可 | — |
| `period_id` | `uuid` | 不可 | — |
| `action` | `text` | 不可 | — |
| `memo` | `text` | 可 | — |
| `changed_at` | `timestamp with time zone` | 不可 | `now()` |

- 主キー `(id)`
- 外部キー `(company_id)` → `companies(id)`
- インデックス `fiscal_period_close_logs_period_idx` `(period_id, changed_at)`

## 科目・税区分

### `accounts`

勘定科目と補助科目。`parent_id` がある補助科目は、同じ会社の親から `type`・`bs_category`・`pl_category` を引き継ぐ。`default_tax_code` は税区分グループの文字列。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `code` | `text` | 不可 | — |
| `name` | `text` | 不可 | — |
| `type` | `text` | 不可 | — |
| `parent_id` | `uuid` | 可 | — |
| `default_tax_code` | `text` | 可 | — |
| `pl_category` | `text` | 可 | — |
| `bs_category` | `text` | 可 | — |
| `company_id` | `uuid` | 不可 | — |
| `company_kind` | `text` | 不可 | — |

- 主キー `(id)`
- 一意制約 `(company_id, code)`
- 一意制約 `(id, company_id)`
- 外部キー `(company_id)` → `companies(id)`
- 外部キー `(company_id, company_kind)` → `companies(id, kind)`
- 外部キー `(parent_id, company_id)` → `accounts(id, company_id)`

### `account_aliases`

科目検索用の別名。同一科目の正規化済み別名は一意。所属会社は参照先の科目から決まる。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `account_id` | `uuid` | 不可 | — |
| `alias` | `text` | 不可 | — |
| `normalized_alias` | `text` | 不可 | — |
| `alias_type` | `text` | 不可 | `'OTHER'::text` |
| `sort_order` | `integer` | 不可 | `0` |
| `created_at` | `timestamp with time zone` | 不可 | `now()` |

- 主キー `(id)`
- 一意制約 `(account_id, normalized_alias)`
- 外部キー `(account_id)` → `accounts(id)`、削除時 `CASCADE`
- インデックス `idx_account_aliases_account_id` `(account_id)`
- インデックス `idx_account_aliases_normalized` `(normalized_alias)`

### `tax_codes`

税区分マスタ。CSV取り込みの中間表がIDを参照する。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `text` | 不可 | — |
| `name` | `text` | 不可 | — |
| `short_name` | `text` | 可 | — |
| `search_key` | `text` | 可 | — |
| `tax_type` | `text` | 不可 | — |
| `rate` | `numeric(6,4)` | 可 | — |
| `applies_to` | `text[]` | 不可 | `'{ALL}'::text[]` |
| `is_current` | `boolean` | 不可 | `true` |
| `sort_order` | `integer` | 不可 | `0` |

- 主キー `(id)`

## 仕訳・訂正削除履歴

### `journal_entries`

仕訳ヘッダー。伝票番号の一意性は同じ期の非NULLの番号に適用する。補足は仕訳単位。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `period_id` | `uuid` | 不可 | — |
| `date` | `date` | 不可 | — |
| `description` | `text` | 不可 | — |
| `reference_number` | `integer` | 可 | — |
| `is_opening_balance` | `boolean` | 可 | `false` |
| `created_at` | `timestamp with time zone` | 可 | `now()` |
| `updated_at` | `timestamp with time zone` | 可 | `now()` |
| `supplement` | `text` | 可 | — |
| `company_id` | `uuid` | 不可 | — |

- 主キー `(id)`
- 一意制約 `(id, company_id)`
- 外部キー `(period_id, company_id)` → `fiscal_periods(id, company_id)`
- インデックス `idx_journal_entries_date` `(date)`
- インデックス `idx_journal_entries_period_company` `(period_id, company_id)`
- 部分一意インデックス `uq_journal_entries_period_reference_number` `(period_id, reference_number) WHERE (reference_number IS NOT NULL)`

### `journal_lines`

仕訳明細。所属会社は仕訳・科目と一致する。`tax_code` は外部キーのない文字列。`(entry_id, line_number)` に一意制約はない。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `entry_id` | `uuid` | 不可 | — |
| `line_number` | `integer` | 不可 | — |
| `side` | `text` | 不可 | — |
| `account_id` | `uuid` | 不可 | — |
| `amount` | `numeric(15,2)` | 不可 | — |
| `tax_code` | `text` | 可 | — |
| `description` | `text` | 可 | — |
| `company_id` | `uuid` | 不可 | — |

- 主キー `(id)`
- 外部キー `(account_id, company_id)` → `accounts(id, company_id)`
- 外部キー `(entry_id, company_id)` → `journal_entries(id, company_id)`、削除時 `CASCADE`
- インデックス `idx_journal_lines_account_id` `(account_id)`
- インデックス `idx_journal_lines_amount` `(amount)`
- インデックス `idx_journal_lines_entry_id` `(entry_id)`

### `journal_entry_logs`

ヘッダー更新・削除時の変更前スナップショット。`before_data` は `entry` と `lines` を持つ。`entry_id` は仕訳を削除した後も保持する。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `entry_id` | `uuid` | 不可 | — |
| `action` | `text` | 不可 | — |
| `changed_at` | `timestamp with time zone` | 可 | `now()` |
| `changed_by` | `text` | 可 | `'user'::text` |
| `before_data` | `jsonb` | 不可 | — |

- 主キー `(id)`
- インデックス `idx_journal_entry_logs_changed_at` `(changed_at)`
- インデックス `idx_journal_entry_logs_entry_id` `(entry_id)`

## 期首残高

### `period_opening_balance_sets`

手動設定のヘッダー。1期に最大1件で、明細が0件でもヘッダーがあれば手動設定が有効になる。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `company_id` | `uuid` | 不可 | — |
| `period_id` | `uuid` | 不可 | — |
| `memo` | `text` | 可 | — |
| `created_at` | `timestamp with time zone` | 不可 | `now()` |
| `updated_at` | `timestamp with time zone` | 不可 | `now()` |

- 主キー `(id)`
- 一意制約 `(period_id, company_id)`
- 一意制約 `(period_id)`
- 外部キー `(company_id)` → `companies(id)`
- 外部キー `(period_id, company_id)` → `fiscal_periods(id, company_id)`

### `period_opening_balance_lines`

手動設定の明細。1期・1科目につき1行。借方を正、貸方を負で保存する。残高の合計は遅延制約で検査する。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `period_id` | `uuid` | 不可 | — |
| `account_id` | `uuid` | 不可 | — |
| `company_id` | `uuid` | 不可 | — |
| `balance` | `numeric(15,2)` | 不可 | — |

- 主キー `(period_id, account_id)`
- 外部キー `(account_id, company_id)` → `accounts(id, company_id)`
- 外部キー `(period_id, company_id)` → `period_opening_balance_sets(period_id, company_id)`、削除時 `CASCADE`

### `period_opening_balance_logs`

手動設定・解除の履歴。`before_data` と `after_data` は、該当する設定があればメモと明細を保持する。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `company_id` | `uuid` | 不可 | — |
| `period_id` | `uuid` | 不可 | — |
| `action` | `text` | 不可 | — |
| `before_data` | `jsonb` | 可 | — |
| `after_data` | `jsonb` | 可 | — |
| `changed_at` | `timestamp with time zone` | 不可 | `now()` |

- 主キー `(id)`
- 外部キー `(company_id)` → `companies(id)`
- インデックス `period_opening_balance_logs_period_idx` `(period_id, changed_at)`

## テンプレート・CSV取り込み・設定

### `journal_templates`

会社別の仕訳テンプレートのヘッダー。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `name` | `text` | 不可 | — |
| `default_description` | `text` | 可 | — |
| `sort_order` | `integer` | 不可 | `0` |
| `created_at` | `timestamp with time zone` | 不可 | `now()` |
| `updated_at` | `timestamp with time zone` | 不可 | `now()` |
| `company_id` | `uuid` | 不可 | — |

- 主キー `(id)`
- 一意制約 `(id, company_id)`
- 外部キー `(company_id)` → `companies(id)`

### `journal_template_lines`

テンプレートの明細。科目未指定・金額未指定を許す。テンプレート内で行番号が一意。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `template_id` | `uuid` | 不可 | — |
| `line_number` | `integer` | 不可 | — |
| `side` | `text` | 不可 | — |
| `account_id` | `uuid` | 可 | — |
| `amount` | `numeric` | 可 | — |
| `tax_code` | `text` | 可 | — |
| `description` | `text` | 可 | — |
| `company_id` | `uuid` | 不可 | — |

- 主キー `(id)`
- 一意制約 `(template_id, line_number)`
- 外部キー `(account_id, company_id)` → `accounts(id, company_id)`、削除時 `SET NULL (account_id)`
- 外部キー `(template_id, company_id)` → `journal_templates(id, company_id)`、削除時 `CASCADE`

### `import_staging`

CSV取り込みの中間データ。元の文字列、科目・税区分の照合結果、警告、処理済みフラグを保持する。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `raw_date` | `text` | 可 | — |
| `raw_debit_amount` | `numeric(15,2)` | 可 | — |
| `raw_credit_amount` | `numeric(15,2)` | 可 | — |
| `raw_description` | `text` | 可 | — |
| `predicted_account_id` | `uuid` | 可 | — |
| `counter_account_id` | `uuid` | 可 | — |
| `is_processed` | `boolean` | 可 | `false` |
| `raw_debit_account` | `text` | 可 | — |
| `raw_debit_sub_account` | `text` | 可 | — |
| `raw_debit_tax_code` | `text` | 可 | — |
| `raw_credit_account` | `text` | 可 | — |
| `raw_credit_sub_account` | `text` | 可 | — |
| `raw_credit_tax_code` | `text` | 可 | — |
| `debit_sub_account_id` | `uuid` | 可 | — |
| `credit_sub_account_id` | `uuid` | 可 | — |
| `debit_tax_code_id` | `text` | 可 | — |
| `credit_tax_code_id` | `text` | 可 | — |
| `parse_warnings` | `text[]` | 可 | — |
| `company_id` | `uuid` | 不可 | — |

- 主キー `(id)`
- 外部キー `(company_id)` → `companies(id)`
- 外部キー `(counter_account_id, company_id)` → `accounts(id, company_id)`
- 外部キー `(credit_sub_account_id, company_id)` → `accounts(id, company_id)`、削除時 `SET NULL (credit_sub_account_id)`
- 外部キー `(credit_tax_code_id)` → `tax_codes(id)`、削除時 `SET NULL`
- 外部キー `(debit_sub_account_id, company_id)` → `accounts(id, company_id)`、削除時 `SET NULL (debit_sub_account_id)`
- 外部キー `(debit_tax_code_id)` → `tax_codes(id)`、削除時 `SET NULL`
- 外部キー `(predicted_account_id, company_id)` → `accounts(id, company_id)`

### `mapping_rules`

CSVの科目マッピングに使う会社別のルール。`priority` の既定値は `0`。`keyword` に一意制約はない。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `id` | `uuid` | 不可 | `gen_random_uuid()` |
| `keyword` | `text` | 不可 | — |
| `account_id` | `uuid` | 不可 | — |
| `priority` | `integer` | 可 | `0` |
| `company_id` | `uuid` | 不可 | — |

- 主キー `(id)`
- 外部キー `(account_id, company_id)` → `accounts(id, company_id)`
- 外部キー `(company_id)` → `companies(id)`

### `system_settings`

キーと値を文字列で保持する設定。

| 列 | 型 | NULL | 既定値 |
| --- | --- | --- | --- |
| `key` | `text` | 不可 | — |
| `value` | `text` | 不可 | — |

- 主キー `(key)`

## 会社をまたぐ参照の制約

複合外部キーは参照先IDと `company_id` を組にして、別会社の会計期間・仕訳・科目・テンプレートなどへの参照を拒否する。例えば `journal_lines` は `(entry_id, company_id)` と `(account_id, company_id)` の両方を照合する。`accounts` の `(company_id, company_kind)` は会社マスタの区分とも一致する。科目への任意参照で `SET NULL` を使う場合は科目ID列だけを空にし、明細や取込行の `company_id` を保持する。

`journal_entry_logs.entry_id` と、`period_opening_balance_logs.period_id`・`fiscal_period_close_logs.period_id` は外部キーを持たない。後者2表は `company_id` の外部キーを持つ。アクセス権は [RLS と権限](security-rls.md) を参照。

## `ledger_view`

`journal_lines.entry_id = journal_entries.id` で結合する総勘定元帳・補助元帳向けのビュー。行は仕訳明細単位。

| 参照元 | ビューの列 |
| --- | --- |
| 明細 | `id`、`entry_id`、`line_number`、`side`、`account_id`、`amount`、`tax_code`、`line_description`（明細の `description`） |
| ヘッダー | `date`、`entry_description`（ヘッダーの `description`）、`reference_number`、`period_id`、`is_opening_balance` |
| 相手科目 | `counter_account_name`。反対側の明細が1行ならその科目名、複数行なら反対側の先頭行（`line_number` 順）の科目名に「 ほか」を付ける。該当行がなければ `NULL`。 |

ビューに `company_id` 列はない。元帳の取得処理は `period_id` と対象の `account_id` で絞り込む。権限については [ビューの実行権限](security-rls.md#ledger_view) を参照。
