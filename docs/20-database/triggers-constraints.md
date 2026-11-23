---
status: 現行
verified: 2026-11-24 @ 5e0e7c9
code: [supabase/schema.sql, supabase/manual-migrations/20261115120000_period_close_concurrency.md]
related: [README.md, tables.md, functions-rpc.md, security-rls.md]
---

# トリガーと制約

[スキーマ](../../supabase/schema.sql) にある行トリガーは45本。このうち3本は `DEFERRABLE INITIALLY DEFERRED` の制約トリガー。主キー・外部キー・一意制約とインデックスは [テーブルとビュー](tables.md) を参照。

## 仕訳の整合性と訂正削除履歴

- `trg_journal_entries_check_period` は期の行を `FOR SHARE` で読み、仕訳日が開始日から終了日までの範囲に入ることを確認する。`trg_fiscal_periods_check_entries` は逆に、期の日付変更で既存仕訳が範囲外にならないか検査する。
- `trg_journal_lines_guard` は明細の `entry_id` の付け替えを拒否し、親の仕訳を `FOR NO KEY UPDATE` でロックする。同じ仕訳への明細変更はこのロックで直列化する。`trg_journal_lines_z_closed_guard` はその後に走り、親仕訳が属する期を確認する。親が連鎖削除された場合は、親側の削除ガードが先に判定する。
- `trg_journal_entries_balance`（ヘッダーの挿入）と `trg_journal_lines_balance`（明細の挿入・更新・削除）は、既定ではコミット時に明細2行以上、借方・貸方各1行以上、借貸合計の一致を検査する。削除済みの仕訳は検査対象外。ヘッダーと明細の新規保存には同一トランザクションが必要。
- `trg_journal_entry_changes` はヘッダー更新・削除の直前に、ヘッダーと全明細を `before_data` に記録する。明細を変更すると `trg_lines_changes_bump_parent` が親の `updated_at` を更新する。`log_journal_entry_changes` は `pg_trigger_depth() > 1` の連鎖UPDATEを除外するため、明細だけの変更からは訂正履歴が作られない。編集RPCは明細を置き換える前にヘッダーを更新する。
- `is_opening_balance = true` の仕訳を編集RPCは拒否する。このフラグ単独で削除や一括変更を拒否するDB制約はなく、年度確定のガードは該当する期に対して働く。

## 会社・科目・期首残高

- 仕訳ヘッダー・明細、テンプレート明細、手動期首残高3表の挿入時には、未指定の `company_id` を親から補う。指定された値は複合外部キーがある参照で照合する。`accounts.company_kind` は会社マスタの値で補う。`company_id` の変更禁止が付いた表と、`companies.kind` の変更禁止は下の一覧を参照。
- 補助科目は1階層。自分自身・補助科目を親にする操作や、子を持つ科目を補助科目にする操作を拒否する。子は親の `type`・`bs_category`・`pl_category` を継承し、親の区分変更は子へ伝播する。
- 会社の繰越先には同じ会社の `type = 'EQUITY'`、`bs_category = 'EQUITY'`、`parent_id IS NULL` の科目を使う。繰越先に指定された科目の変更にもこの条件を適用する。
- 期首残高の明細用科目は、B/S区分のある資産・負債・純資産。個人の事業主貸・事業主借を除く。明細を登録・科目変更するときに科目行を `FOR SHARE` で読み、科目側のガードも既存明細と適格性を確認する。
- `trg_pob_lines_balanced` は、ヘッダーが残る期の明細の符号付き残高合計が0であることをコミット時に検査する。セットと明細の所属期は変更できない。

## 年度確定後の書き込み

- `closed_at` を更新するガードは、確定順・解除順と確定前チェックを適用し、同じトランザクションで履歴を記録する。確定日時はDBの `now()` を使い、確定日時と期間の日付の同時変更や、確定日時の上書きを拒否する。
- 確定済みの期は仕訳・明細・手動期首残高の追加、変更、削除と、期の日付変更、期の削除を拒否する。仕訳ヘッダーを別の期へ動かす更新では新旧両方の期を検査する。
- 期の新設・日付変更では、同じ会社の別の確定済み期の最大終了日以前になる開始日を拒否する。未確定期どうしの重複は確定前チェックで検出する。期名・当期フラグの変更は確定による日付変更ガードの対象外。
- 確定済みの期に仕訳明細や手動期首明細がある科目の `type`・`bs_category`・`pl_category`・`parent_id` の変更、および確定済みの期がある会社の繰越先の変更を拒否する。

## ロック取得順序

| 処理 | ロック取得順序 |
| --- | --- |
| 仕訳の新規・編集RPC | 会計期単位の採番用アドバイザリロック → 仕訳ヘッダーの書き込み・ロック → トリガーが期の行を `FOR SHARE` で参照。編集は最初の期ID取得をロックなしで行い、仕訳行を `FOR UPDATE` した後に再確認する。 |
| CSV本登録 | `import_staging` の対象行をID順に `FOR UPDATE` → 会計期単位の採番用アドバイザリロック → 仕訳の書き込み。作成順は入力配列順。 |
| 仕訳の直接更新・明細の変更 | 仕訳行 → 期の `FOR SHARE`。明細ガードは親仕訳を `FOR NO KEY UPDATE` で取得してから、対象期の確定を確認する。 |
| 手動期首残高の保存・解除 | 同じ期の期首残高RPCを期単位のアドバイザリロックで直列化。ヘッダー・明細の確定ガードが期を `FOR SHARE` で取得し、明細の科目検査は該当科目を `FOR SHARE` で取得する。 |
| 年度確定・解除 | 期の更新行 → 会社単位の排他アドバイザリロック。 |
| 期の日付変更・新設 | 日付変更では期の更新行 → 会社単位の共有アドバイザリロック。新設のガードも会社単位の共有ロックを取る。 |
| 確定済み期に関わる科目・繰越先の変更 | 更新対象行 → 会社単位の共有アドバイザリロック。 |

採番には期の行ロックを使わず、`stoic.journal_reference_number` と期IDをキーにしたトランザクション単位のアドバイザリロックを使う。採番で先に期の行を `FOR UPDATE` すると、仕訳行から期を `FOR SHARE` する直接更新と逆順になる。年度確定・解除は1トランザクションにつき1期とする。複数期をまとめて処理すると、別トランザクションによる期の日付変更との間で `40P01` が発生し得る。再現条件は [同時実行テスト C10](../../supabase/manual-migrations/20261115120000_period_close_concurrency.md) を参照。

## CHECK 制約（20件）

| 制約 | 条件 |
| --- | --- |
| `account_aliases_type_check` | `alias_type` は `KANA`、`ROMAN`、`ABBREV`、`OTHER`。 |
| `accounts_type_check` | `type` は `ASSET`、`LIABILITY`、`EQUITY`、`REVENUE`、`EXPENSE`。 |
| `accounts_bs_category_check` | `bs_category` は NULL、または `CURRENT_ASSETS`、`FIXED_ASSETS`、`DEFERRED_ASSETS`、`OWNER_DRAWINGS`、`CURRENT_LIABILITIES`、`FIXED_LIABILITIES`、`OWNER_CONTRIBUTIONS`、`EQUITY`。 |
| `accounts_pl_category_check` | `pl_category` は NULL、または `REVENUE`、`NON_OP_INCOME`、`EXTRA_INCOME`、`RESERVE_REVERSAL`、`COGS`、`SGA`、`NON_OP_EXPENSE`、`EXTRA_LOSS`、`TAX`、`RESERVE_PROVISION`。 |
| `accounts_category_by_type_check` | B/S区分がある場合、資産は流動資産・固定資産・繰延資産・事業主貸、負債は流動負債・固定負債・事業主借、純資産は `EQUITY` に限る。P/L区分がある場合、収益は `REVENUE`・`NON_OP_INCOME`・`EXTRA_INCOME`・`RESERVE_REVERSAL`、費用は残りの6区分に限る。 |
| `accounts_category_by_kind_check` | 法人では `OWNER_DRAWINGS`・`OWNER_CONTRIBUTIONS`・`RESERVE_REVERSAL`・`RESERVE_PROVISION`、個人では `NON_OP_INCOME`・`NON_OP_EXPENSE`・`EXTRA_INCOME`・`EXTRA_LOSS`・`TAX` を許さない。 |
| `accounts_default_tax_code_check` | `default_tax_code` は NULL、または `NONE`、`SALES`、`SALES_RETURN`、`PURCHASE`、`PURCHASE_RETURN`、`NON_TAXABLE_SALES`。 |
| `companies_kind_check` | `CORPORATION` または `INDIVIDUAL`。 |
| `companies_name_not_blank` | `btrim(name)` が空文字でない。 |
| `companies_tax_method_check` | `EXEMPT`、`SIMPLE`、`STANDARD_INDIVIDUAL`、`STANDARD_PROPORTIONAL`。 |
| `fiscal_period_close_logs_action_check` | `CLOSE` または `REOPEN`。 |
| `fiscal_periods_date_order` | `start_date <= end_date`。 |
| `journal_entries_reference_number_range` | 伝票番号は `NULL` または1〜999999999。 |
| `journal_entry_logs_action_check` | `UPDATE` または `DELETE`。 |
| `journal_lines_amount_positive` | `amount > 0` かつ `NaN` を除外。 |
| `journal_lines_side_check` | `DEBIT` または `CREDIT`。 |
| `journal_template_lines_side_check` | `DEBIT` または `CREDIT`。 |
| `period_opening_balance_lines_balance_check` | `balance` は0と `NaN` を除外。 |
| `period_opening_balance_logs_action_check` | `SET` または `CLEAR`。 |
| `tax_codes_tax_type_check` | `SALES`、`PURCHASE`、`BOTH`、`NONE`。 |

## 行トリガー一覧

`UPDATE OF` は指定列の更新を対象とする。制約トリガーの「遅延」は `DEFERRABLE INITIALLY DEFERRED` を表す。

### `accounts`（7本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_accounts_a_fill_company_kind` | `BEFORE INSERT OR UPDATE OF company_id` | `fill_account_company_kind` |
| `trg_accounts_b_inherit_parent` | `BEFORE INSERT OR UPDATE OF parent_id, type, bs_category, pl_category` | `inherit_parent_account_attrs` |
| `trg_accounts_c_guard_opening_lines` | `BEFORE UPDATE OF type, bs_category, parent_id` | `guard_opening_balance_line_accounts` |
| `trg_accounts_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |
| `trg_accounts_d_guard_closed_periods` | `BEFORE UPDATE OF type, bs_category, pl_category, parent_id` | `guard_account_in_closed_periods` |
| `trg_accounts_guard_carry_forward` | `BEFORE UPDATE OF type, bs_category, parent_id` | `guard_carry_forward_account` |
| `trg_accounts_propagate_to_children` | `AFTER UPDATE OF type, bs_category, pl_category`、`new.parent_id IS NULL` の場合 | `propagate_parent_account_attrs` |

### `companies`（3本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_companies_check_carry_forward` | `BEFORE INSERT OR UPDATE OF carry_forward_account_id` | `check_company_carry_forward` |
| `trg_companies_guard_closed_carry_forward` | `BEFORE UPDATE OF carry_forward_account_id` | `guard_closed_carry_forward` |
| `trg_companies_kind_immutable` | `BEFORE UPDATE OF kind` | `forbid_company_kind_change` |

### `fiscal_periods`（6本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_fiscal_periods_check_entries` | `BEFORE UPDATE OF start_date, end_date` | `check_fiscal_period_entries` |
| `trg_fiscal_periods_close_state` | `BEFORE UPDATE OF closed_at` | `guard_period_close_state` |
| `trg_fiscal_periods_closed_dates` | `BEFORE UPDATE OF start_date, end_date` | `guard_fiscal_period_dates` |
| `trg_fiscal_periods_closed_delete` | `BEFORE DELETE` | `guard_fiscal_period_delete` |
| `trg_fiscal_periods_closed_insert` | `BEFORE INSERT` | `guard_fiscal_period_insert` |
| `trg_fiscal_periods_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |

### `import_staging`（1本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_import_staging_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |

### `journal_entries`（6本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_journal_entries_a_fill_company` | `BEFORE INSERT` | `fill_journal_entry_company` |
| `trg_journal_entries_balance` | `AFTER INSERT`（遅延） | `check_journal_entry_balance` |
| `trg_journal_entries_check_period` | `BEFORE INSERT OR UPDATE OF date, period_id` | `check_journal_entry_period` |
| `trg_journal_entries_closed_guard` | `BEFORE INSERT OR DELETE OR UPDATE` | `guard_closed_period_journal_entry` |
| `trg_journal_entries_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |
| `trg_journal_entry_changes` | `BEFORE DELETE OR UPDATE` | `log_journal_entry_changes` |

### `journal_lines`（6本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_journal_lines_a_fill_company` | `BEFORE INSERT` | `fill_journal_line_company` |
| `trg_journal_lines_balance` | `AFTER INSERT OR DELETE OR UPDATE`（遅延） | `check_journal_entry_balance` |
| `trg_journal_lines_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |
| `trg_journal_lines_guard` | `BEFORE INSERT OR DELETE OR UPDATE` | `guard_journal_line_change` |
| `trg_journal_lines_z_closed_guard` | `BEFORE INSERT OR DELETE OR UPDATE` | `guard_closed_period_journal_line` |
| `trg_lines_changes_bump_parent` | `AFTER INSERT OR DELETE OR UPDATE` | `bump_parent_entry_updated_at` |

### `journal_template_lines`（2本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_journal_template_lines_a_fill_company` | `BEFORE INSERT` | `fill_template_line_company` |
| `trg_journal_template_lines_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |

### `journal_templates`（1本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_journal_templates_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |

### `mapping_rules`（1本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_mapping_rules_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |

### `period_opening_balance_lines`（6本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_pob_lines_a_fill_company` | `BEFORE INSERT` | `fill_opening_balance_company` |
| `trg_pob_lines_balanced` | `AFTER INSERT OR DELETE OR UPDATE`（遅延） | `check_opening_balance_set_balanced` |
| `trg_pob_lines_check_account` | `BEFORE INSERT OR UPDATE OF account_id` | `check_opening_balance_line_account` |
| `trg_pob_lines_closed_guard` | `BEFORE INSERT OR DELETE OR UPDATE` | `guard_closed_period_opening_balance` |
| `trg_pob_lines_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |
| `trg_pob_lines_period_immutable` | `BEFORE UPDATE OF period_id` | `forbid_opening_balance_period_change` |

### `period_opening_balance_logs`（2本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_pob_logs_a_fill_company` | `BEFORE INSERT` | `fill_opening_balance_company` |
| `trg_pob_logs_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |

### `period_opening_balance_sets`（4本）

| トリガー | 実行条件 | 関数 |
| --- | --- | --- |
| `trg_pob_sets_a_fill_company` | `BEFORE INSERT` | `fill_opening_balance_company` |
| `trg_pob_sets_closed_guard` | `BEFORE INSERT OR DELETE OR UPDATE` | `guard_closed_period_opening_balance` |
| `trg_pob_sets_company_immutable` | `BEFORE UPDATE OF company_id` | `forbid_company_id_change` |
| `trg_pob_sets_period_immutable` | `BEFORE UPDATE OF period_id` | `forbid_opening_balance_period_change` |
