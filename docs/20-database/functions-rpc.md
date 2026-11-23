---
status: 現行
verified: 2026-11-24 @ 5e0e7c9
code: [supabase/schema.sql, lib/journal-save.ts, lib/company-operations.ts, lib/opening-balances.ts, lib/fiscal-period-operations.ts, lib/errors.ts, lib/supabase-error-handler.ts]
related: [README.md, triggers-constraints.md, security-rls.md, tables.md]
---

# DB関数とRPC

[スキーマ](../../supabase/schema.sql) の `public` には57関数がある。通常関数26本、行トリガー関数30本、イベントトリガー用関数1本。通常関数は呼び出したロールの権限で動く（`SECURITY INVOKER`）。マイグレーションの適用当時の引数・戻り値から変わった関数があるため、以下はダンプの定義に合わせている。

## 仕訳保存と伝票番号

- `create_journal_entry` は明細を検証し、期単位の採番ロックの下で伝票番号を確定する。ヘッダーと明細を同じトランザクションで保存し、`{id, reference_number}` を返す。`p_reference_number` がNULLなら自動採番し、値があれば検証して採用する。`p_supplement` の既定はNULLで、空文字もNULLとして保存する。
- `update_journal_entry` は仕訳を行ロックした後に所属期を再確認し、`is_opening_balance = true` の仕訳を拒否する。ヘッダー更新 → 既存明細削除 → 新明細挿入の順で処理する。`p_reference_number = NULL` は番号を維持する。補足はNULLで維持、空文字で削除、その他で上書きする。
- `p_lines` は明細オブジェクトのJSON配列。`side` は `DEBIT`／`CREDIT`、`account_id` はUUID文字列、`amount` は正の数の文字列（整数部1〜13桁、小数部は最大2桁）。任意の `tax_code` は文字列またはNULL。2行以上かつ借方・貸方各1行以上を要求し、合計の一致を確認する。明細の `line_number` は配列順の1始まり。
- `import_staging_entries` は指定IDの重複・NULL・欠落・処理済みを拒否し、取り込み行と登録先の期の会社が一致することを確認する。日付は `YYYY-MM-DD` の実在日。金額は負数を拒否し、片側が正ならその値を両方に使う。両側が正で値が異なる場合は拒否する。入力配列順に採番して保存し、全件成功時に `is_processed` を更新して登録件数を返す。途中の失敗は全件を取り消す。
- 自動採番は、同じ期の非NULLの最大番号に1を足す（番号がなければ1）。途中の欠番は埋めず、最大番号の仕訳を削除すると番号を再利用し得る。手入力の範囲は1〜999999999。直接INSERTではNULLを許し、非NULL番号の重複と範囲外は一意インデックス・CHECKが拒否する。取得順は [ロック取得順序](triggers-constraints.md#ロック取得順序) を参照。

## 会社作成

`create_company` は会社名の前後の空白を除き、空名・不正な会社の区分・課税方式・日付範囲を拒否する。課税方式にNULLを渡すと `EXEMPT`。個人の最初の期は同じ年の1月1日〜12月31日を要求する。会社と初期科目・別名を登録し、法人は科目コード `540`、個人は `400` を繰越先に設定する。終了日から期名を作って当期にし、`{company_id, period_id, account_count}` を返す。

## 期首残高の取得・手動設定

- `get_opening_balances_for_period` は対象期に手動設定のヘッダーがあればその明細を返す。明細0件の手動設定も有効。ヘッダーがなければ `get_derived_opening_balances_for_period` に委ねる。
- 導出は対象期より前で最新の手動設定を基準にし、前に設定がなければ会社の最初の期を基準にする。基準日から対象期首の前日までの仕訳を、借方を正、貸方を負として集計する。損益と事業主貸借の動きの合計は繰越先へ集約する。基準と仕訳を合算し、残高0の行は返さない。手動設定がない会社で最初の期より前の仕訳がある場合や、集約額が0以外で繰越先がない場合はエラーになる。
- `save_period_opening_balances` は `{account_id, balance}` の配列を受け取る。科目IDの重複・他社科目を拒否し、残高は小数第2位までの値で絶対値が10兆未満。合計が0にならない場合、`p_auto_balance = true` なら繰越先に差額を加える。繰越先が未設定ならエラーになる。0の明細を除いて保存し、`SET` 履歴に変更前後を記録して `{period_id, line_count, auto_balanced, adjustment}` を返す。
- `clear_period_opening_balances` は手動設定があれば `CLEAR` 履歴に変更前を記録し、ヘッダーを削除する。明細は連鎖削除され、次回取得は導出値に戻る。

## 年度確定・解除

| RPC | 結果 |
| --- | --- |
| `get_period_close_check` | `{closed, errors, warnings}`。E1〜E5が確定を止める条件。W1・W3は警告。 |
| `close_fiscal_period` | 直前の期が未確定なら拒否し、E1〜E5をトリガーで再検査する。成功時に確定日時と `CLOSE` 履歴を保存し、`{period_id, closed_at, warnings}` を返す。 |
| `reopen_fiscal_period` | 直後の期が確定済みなら拒否する。成功時に確定日時をNULLに戻して `REOPEN` 履歴を保存し、`{period_id, closed_at}` を返す。 |

| 項目 | 条件 |
| --- | --- |
| E1 | 直前の期が未確定。 |
| E2 | 期首残高の自動導出が `OPENING_BASE_UNDETERMINED` または `CARRY_FORWARD_NOT_SET` を返す。手動設定がある期も導出の可否を確認する。 |
| E3 | 期末までの損益・事業主貸借の繰越額が0以外で、繰越先が未設定。 |
| E4 | 財務諸表区分が未設定の科目に期末日以前の仕訳明細がある。 |
| E5 | 同じ会社の別の期と日付範囲が重なる。 |
| W1 | 会社全体に未処理のCSV取り込み行がある。 |
| W3 | 対象期に仕訳がない。 |

確定前チェックの5関数（`get_period_close_check`、`period_close_errors`、`period_close_prev_open`、`period_close_warnings`、`period_carry_forward_amount`）は `VOLATILE`。確定・解除は1トランザクションにつき1期を処理する。仕訳や期首残高への影響は [年度確定後の書き込み](triggers-constraints.md#年度確定後の書き込み) を参照。

## エラーコード

独自エラーはSQLSTATE `P0001` を使い、`MESSAGE` に業務コード、必要に応じて `DETAIL` に補足を入れる。CSV本登録は行内のエラーのSQLSTATEとメッセージを保ち、補足に配列内の行番号と摘要を付ける。

| 処理 | `P0001` の業務コード |
| --- | --- |
| 仕訳・期間の日付 | `INVALID_JOURNAL_LINES`、`DEBIT_CREDIT_MISMATCH`、`OUT_OF_PERIOD`、`PERIOD_HAS_OUTSIDE_ENTRIES`、`ENTRY_NOT_FOUND`、`PERIOD_NOT_FOUND`、`OPENING_BALANCE_EDIT_FORBIDDEN`、`ENTRY_PERIOD_CHANGED` |
| 採番・CSV | `DUPLICATE_REFERENCE_NUMBER`、`INVALID_REFERENCE_NUMBER`、`INVALID_STAGING_ROWS`、`INVALID_DATE`、`COMPANY_MISMATCH` |
| 会社・科目 | `INVALID_COMPANY`、`COMPANY_KIND_IMMUTABLE`、`COMPANY_ID_IMMUTABLE`、`INVALID_ACCOUNT_HIERARCHY`、`INVALID_CARRY_FORWARD_ACCOUNT` |
| 期首残高 | `OPENING_BALANCE_INVALID_LINES`、`OPENING_BALANCE_INVALID_ACCOUNT`、`OPENING_BALANCE_UNBALANCED`、`OPENING_BASE_UNDETERMINED`、`CARRY_FORWARD_NOT_SET`、`REFERENCE_NOT_FOUND_OR_OTHER_COMPANY` |
| 年度確定・解除 | `PERIOD_CLOSED`、`PERIOD_CLOSE_PREVIOUS_OPEN`、`PERIOD_REOPEN_NEXT_CLOSED`、`PERIOD_CLOSE_CHECK_FAILED`、`ACCOUNT_IN_CLOSED_PERIOD`、`CARRY_FORWARD_LOCKED`、`PERIOD_CLOSED_FIELDS`、`PERIOD_OVERLAPS_CLOSED`、`PERIOD_ALREADY_CLOSED`、`PERIOD_NOT_CLOSED` |

アプリの [エラー変換](../../lib/supabase-error-handler.ts) は `P0001` の `MESSAGE` を [エラー定義](../../lib/errors.ts) に照合し、`AccountingError`・`ValidationError`・`NotFoundError` に変換する。コードによって補足を表示文に加える。SQLSTATEと制約名で変換するものもある。

| SQLSTATE | アプリでの変換 |
| --- | --- |
| `23505` | `uq_journal_entries_period_reference_number` → `DUPLICATE_REFERENCE_NUMBER`、`companies_name_key` → `DUPLICATE_COMPANY_NAME`、それ以外 → `DUPLICATE_ACCOUNT_CODE`。 |
| `23514` | `journal_entries_reference_number_range` → `INVALID_REFERENCE_NUMBER`。他のCHECK違反は既定の `DB_QUERY_FAILED`。 |
| `23503` | 手動期首設定の期参照 → `OPENING_BALANCE_MANUAL_SET_EXISTS`、同明細の科目参照 → `OPENING_BALANCE_ACCOUNT_IN_USE`。仕訳の期、仕訳明細の仕訳、テンプレート明細の親への参照 → `REFERENCE_NOT_FOUND_OR_OTHER_COMPANY`。それ以外 → `ACCOUNT_NOT_FOUND`。 |
| `42501` | `PERMISSION_DENIED`。 |

## 通常関数一覧（26本）

引数名はRPCで使う名前。`uuid`・`date` などの型はDB定義に従う。実行権限は [RLS と権限](security-rls.md#関数の実行権限) を参照。

### 仕訳・伝票番号

| 関数と引数 | 戻り値 | 役割 |
| --- | --- | --- |
| `create_journal_entry(p_period_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text DEFAULT NULL)` | `jsonb` | 新規のヘッダーと明細を保存する。 |
| `update_journal_entry(p_entry_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text DEFAULT NULL)` | `void` | ヘッダーを更新し、明細を全置換する。 |
| `import_staging_entries(p_period_id uuid, p_staging_ids uuid[])` | `integer` | 指定した中間行を仕訳へ一括登録する。 |
| `validate_journal_lines(p_lines jsonb)` | `void` | 仕訳明細の形式・借貸を検証する（`STABLE`）。 |
| `insert_journal_lines(p_entry_id uuid, p_lines jsonb)` | `void` | 明細を再検証し、配列順の行番号を付けて挿入する。 |
| `lock_period_for_numbering(p_period_id uuid)` | `void` | 期別の採番用アドバイザリロックを取得し、期の存在を確認する。 |
| `next_reference_number(p_period_id uuid)` | `integer` | 採番ロック下でその期の最大伝票番号に1を足す。 |
| `check_reference_number(p_period_id uuid, p_reference_number integer, p_exclude_entry_id uuid DEFAULT NULL)` | `void` | 手入力番号の範囲と期内重複を確認する。編集時は自分の仕訳を除外できる。 |

### 会社作成

| 関数と引数 | 戻り値 | 役割 |
| --- | --- | --- |
| `create_company(p_name text, p_kind text, p_tax_method text, p_start_date date, p_end_date date)` | `jsonb` | 会社、初期科目・別名、繰越先、当初の会計期間を登録する。 |
| `company_seed_accounts(p_kind text)` | `jsonb` | 会社の区分別の初期科目と別名のJSON配列を返す（`IMMUTABLE`）。 |

### 期首残高・集計

| 関数と引数 | 戻り値 | 役割 |
| --- | --- | --- |
| `get_opening_balances_for_period(target_period_id uuid)` | `TABLE(account_id uuid, balance numeric)` | 指定期の手動設定を優先し、なければ導出する。 |
| `get_derived_opening_balances_for_period(target_period_id uuid)` | `TABLE(account_id uuid, balance numeric)` | 対象期間より前の手動設定と仕訳から期首残高を導出する。 |
| `save_period_opening_balances(p_period_id uuid, p_lines jsonb, p_memo text DEFAULT NULL, p_auto_balance boolean DEFAULT false)` | `jsonb` | 手動設定のヘッダーを保存し、明細を置き換えて履歴を記録する。 |
| `clear_period_opening_balances(p_period_id uuid)` | `void` | 手動設定の解除を記録してヘッダーを削除する。 |
| `opening_balance_account_ok(p_type text, p_bs_category text, p_company_kind text)` | `boolean` | 種別・B/S区分・会社の区分から使用できる科目か判定する（`IMMUTABLE`）。 |
| `get_pl_data(target_period_id uuid)` | `TABLE(account_id uuid, total_debit numeric, total_credit numeric)` | 指定期について `is_opening_balance = false` の仕訳明細を科目別に借方・貸方集計する（`STABLE`）。 |

### 年度確定・解除

| 関数と引数 | 戻り値 | 役割 |
| --- | --- | --- |
| `get_period_close_check(p_period_id uuid)` | `jsonb` | 確定状態と確定前チェックを返す。 |
| `close_fiscal_period(p_period_id uuid, p_memo text DEFAULT NULL)` | `jsonb` | 対象期の `closed_at` を設定する。検査・履歴の書き込みはトリガーで行う。 |
| `reopen_fiscal_period(p_period_id uuid, p_memo text DEFAULT NULL)` | `jsonb` | 対象期の `closed_at` をNULLに戻す。順序の検査・履歴の書き込みはトリガーで行う。 |
| `period_close_errors(p_period_id uuid)` | `text[]` | 確定を拒否する理由（E1〜E5）を集める。 |
| `period_close_prev_open(p_period_id uuid)` | `boolean` | 開始日順で直前の期が未確定か調べる。 |
| `period_close_warnings(p_period_id uuid)` | `text[]` | 会社全体の未処理取込行と対象期の仕訳の有無を調べる。 |
| `period_carry_forward_amount(p_company_id uuid, p_target_start date)` | `numeric` | 損益・事業主貸借から繰越先に集約する金額を計算する。 |
| `period_lock_company(p_company_id uuid, p_exclusive boolean)` | `void` | 会社単位の共有または排他アドバイザリロックを取得する。 |
| `guard_period_range(p_company_id uuid, p_period_id uuid, p_start date)` | `void` | 確定済みの期の終了日以前に始まる別の期の作成・変更を拒否する。 |
| `period_assert_open(p_period_id uuid)` | `void` | 期の行を `FOR SHARE` で読み、確定済みなら拒否する。 |

## 行トリガー関数一覧（30本）

すべて引数なし、戻り値は `trigger`。同じ関数を複数の表で使う場合がある。個別の発火条件は [行トリガー一覧](triggers-constraints.md#行トリガー一覧) を参照。

| 関数 | 使用する表 |
| --- | --- |
| `bump_parent_entry_updated_at` | `journal_lines` |
| `check_company_carry_forward` | `companies` |
| `check_fiscal_period_entries` | `fiscal_periods` |
| `check_journal_entry_balance` | `journal_entries`、`journal_lines` |
| `check_journal_entry_period` | `journal_entries` |
| `check_opening_balance_line_account` | `period_opening_balance_lines` |
| `check_opening_balance_set_balanced` | `period_opening_balance_lines` |
| `fill_account_company_kind` | `accounts` |
| `fill_journal_entry_company` | `journal_entries` |
| `fill_journal_line_company` | `journal_lines` |
| `fill_opening_balance_company` | `period_opening_balance_lines`、`period_opening_balance_logs`、`period_opening_balance_sets` |
| `fill_template_line_company` | `journal_template_lines` |
| `forbid_company_id_change` | `accounts`、`fiscal_periods`、`import_staging`、`journal_entries`、`journal_lines`、`journal_template_lines`、`journal_templates`、`mapping_rules`、`period_opening_balance_lines`、`period_opening_balance_logs`、`period_opening_balance_sets` |
| `forbid_company_kind_change` | `companies` |
| `forbid_opening_balance_period_change` | `period_opening_balance_lines`、`period_opening_balance_sets` |
| `guard_account_in_closed_periods` | `accounts` |
| `guard_carry_forward_account` | `accounts` |
| `guard_closed_carry_forward` | `companies` |
| `guard_closed_period_journal_entry` | `journal_entries` |
| `guard_closed_period_journal_line` | `journal_lines` |
| `guard_closed_period_opening_balance` | `period_opening_balance_lines`、`period_opening_balance_sets` |
| `guard_fiscal_period_dates` | `fiscal_periods` |
| `guard_fiscal_period_delete` | `fiscal_periods` |
| `guard_fiscal_period_insert` | `fiscal_periods` |
| `guard_journal_line_change` | `journal_lines` |
| `guard_opening_balance_line_accounts` | `accounts` |
| `guard_period_close_state` | `fiscal_periods` |
| `inherit_parent_account_attrs` | `accounts` |
| `log_journal_entry_changes` | `journal_entries` |
| `propagate_parent_account_attrs` | `accounts` |

## イベントトリガー用関数（1本）

`rls_auto_enable() → event_trigger` は `SECURITY DEFINER`、`search_path = pg_catalog`。対象のDDLイベントから `public` のテーブル作成を拾い、RLSを有効化する定義。イベントトリガー自体の登録は [ダンプの範囲](security-rls.md#rlsを自動で有効にする関数) を参照。
