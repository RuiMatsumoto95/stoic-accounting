---
status: 現行
verified: 2026-11-26 @ 361f869
code: [supabase/schema.sql, supabase/manual-migrations]
related: [README.md, functions-rpc.md, triggers-constraints.md, security-rls.md]
---

# 手動マイグレーション

[手動マイグレーション](../../supabase/manual-migrations/) には28ファイルがある。変更SQLが10本、テストSQLが9本（うち1本はローカル専用）、適用手順・同時実行手順・検証報告が9本。

変更SQLは既存DBに対して Supabase SQL Editor で手動適用した履歴で、Supabase CLI のマイグレーション履歴には登録されない。[スキーマ](../../supabase/schema.sql) は2026-11-15の年度確定適用後に取得した `public` の定義のみの `pg_dump` 出力で、psqlの制限開始・解除のメタコマンド2行を除いて収録する。psqlで定義ダンプを読み込んだDBでは、反映済みの変更SQLを再実行しない。 [定義ダンプの更新手順](../50-operations/db-change-procedure.md#定義ダンプをリポジトリへ収録する)

## 変更SQLの順序と本番適用履歴

変更SQLを適用順に並べる。テスト・手順・検証報告を含め、格納されている全28ファイルを掲載する。適用日と結果は下の表に記録する。変更内容や検証方法は各SQL・適用手順・検証報告を参照。ファイル名の時刻は適用日時の証跡としては扱わない。 [DB変更の手順](../50-operations/db-change-procedure.md)

| 順 | 変更SQL | 変更内容 | 本番での適用・確認 | 関連ファイル |
| --- | --- | --- | --- | --- |
| 1 | [20261101000000_suppress_chained_update_logs.sql](../../supabase/manual-migrations/20261101000000_suppress_chained_update_logs.sql) | 仕訳明細による連鎖UPDATEを訂正履歴から除外し、既存表から不要な権限を剥奪。 | 2026-11-01。訂正履歴の修正と権限の剥奪が完了。 | — |
| 2 | [20261101180000_atomic_journal_save.sql](../../supabase/manual-migrations/20261101180000_atomic_journal_save.sql) | 仕訳の新規・編集・CSV本登録をRPC化。仕訳明細の金額・期の範囲を検査。 | 2026-11-01。適用後にアプリをRPC呼び出しへ切り替え。 | [テストSQL](../../supabase/manual-migrations/20261101180000_atomic_journal_save.test.sql) |
| 3 | [20261101180100_enforce_journal_balance.sql](../../supabase/manual-migrations/20261101180100_enforce_journal_balance.sql) | 借貸を検査する遅延制約トリガーと同一仕訳への明細変更の直列化。 | 2026-11-01。アプリの保存経路をRPCに切り替えた後に適用。 | [テストSQL](../../supabase/manual-migrations/20261101180100_enforce_journal_balance.test.sql)・[同時実行](../../supabase/manual-migrations/20261101180100_concurrency_test.md) |
| 4 | [20261104180000_add_entry_supplement.sql](../../supabase/manual-migrations/20261104180000_add_entry_supplement.sql) | 仕訳補足列と新規・編集RPCの末尾引数を追加。 | 2026-11-04。テスト20項目が通過。 | [テストSQL](../../supabase/manual-migrations/20261104180000_add_entry_supplement.test.sql) |
| 5 | [20261110170000_auto_reference_number.sql](../../supabase/manual-migrations/20261110170000_auto_reference_number.sql) | 伝票番号を整数に変更し、会計期単位の採番・一意性を追加。元帳のビューを再作成。 | 2026-11-11までに適用。本番テスト45項目が通過。 | [テストSQL](../../supabase/manual-migrations/20261110170000_auto_reference_number.test.sql)・[適用・同時実行](../../supabase/manual-migrations/20261110170000_auto_reference_number_apply.md) |
| 6 | [20261112120000_company_support.sql](../../supabase/manual-migrations/20261112120000_company_support.sql) | 会社・初期科目・複合外部キーを追加し、既存データに所属会社を設定。 | 2026-11-12。本番適用時のテスト135項目が通過。 | [テストSQL](../../supabase/manual-migrations/20261112120000_company_support.test.sql)・[適用](../../supabase/manual-migrations/20261112120000_company_support_apply.md) |
| 7 | [20261112150000_company_archive.sql](../../supabase/manual-migrations/20261112150000_company_archive.sql) | 会社のアーカイブフラグを追加。 | 2026-11-13の本番ダンプ照合で列を確認。11-14の本番再検証でテスト7項目が通過。 | [テストSQL](../../supabase/manual-migrations/20261112150000_company_archive.test.sql)・[適用](../../supabase/manual-migrations/20261112150000_company_archive_apply.md) |
| 8 | [20261114180000_opening_balances.sql](../../supabase/manual-migrations/20261114180000_opening_balances.sql) | 手動期首残高3表、導出・繰越・手動設定のRPCを追加。 | 2026-11-14。本番適用時のテスト52項目が通過。 | [テストSQL](../../supabase/manual-migrations/20261114180000_opening_balances.test.sql)・[適用](../../supabase/manual-migrations/20261114180000_opening_balances_apply.md)・[同時実行](../../supabase/manual-migrations/20261114180000_opening_balances_concurrency.md) |
| 9 | [20261114190000_grant_opening_balance_account_ok.sql](../../supabase/manual-migrations/20261114190000_grant_opening_balance_account_ok.sql) | 明細トリガーから呼ぶ `opening_balance_account_ok` の `EXECUTE` を `anon`／`authenticated` に付与。 | 2026-11-14。付与漏れの修正として本番へ手動適用。本体の変更SQLにも反映済み。 | — |
| 10 | [20261115120000_period_close.sql](../../supabase/manual-migrations/20261115120000_period_close.sql) | 年度確定・解除、確定前チェック、変更ガードと確定履歴を追加。 | 2026-11-15。本番テスト165項目が通過し、同日の本番ダンプで定義を確認。 | [テストSQL](../../supabase/manual-migrations/20261115120000_period_close.test.sql)・[ローカル専用テストSQL](../../supabase/manual-migrations/20261115120000_period_close.test_local.sql)・[適用](../../supabase/manual-migrations/20261115120000_period_close_apply.md)・[同時実行](../../supabase/manual-migrations/20261115120000_period_close_concurrency.md)・[SQL検証報告](../../supabase/manual-migrations/step3-sql-report.md) |

## 適用順の前提

- 仕訳の変更は、連鎖UPDATEのログ除外 → 原子化（A） → アプリの全保存経路をRPCに切り替えて確認 → 借貸一致の遅延制約（B）の順。Bの適用後、ヘッダーだけの挿入はコミットできない。
- 会社のアーカイブは会社対応の後、期首残高は繰越先を持つ会社対応後のスキーマに適用する。初回の期首残高適用後、補助関数の実行権限不足で `anon` の保存に失敗したため、同日に追加の `GRANT` を適用した。期首残高の更新版テスト66項目は、11-15の年度確定適用後にも本番で通過した。
- 年度確定は期首残高と繰越の導入後に適用する。11-15の記録では適用前後の件数を照合し、年度確定に加えて会社対応・アーカイブ・期首残高のテストが通過した。SQL検証報告にある本番適用保留の記載は、適用前の検証段階の記録。

## テストSQLと同時実行確認

- 通常の `.test.sql` はDOブロックで検証し、最後に意図的に例外を発生させてロールバックする。成功の判定は例外メッセージ内の `ALL PASSED`。遅延制約の対象テストは `SET CONSTRAINTS … IMMEDIATE` で判定を前倒しする。
- 年度確定の `.test_local.sql` はローカル検証用。`session_replication_role = replica` を使うため、本番では通常の `.test.sql` を使う。
- 同時実行の手順は、通常のテストSQLと別に複数接続で確認する。年度確定の同時実行手順はローカル検証の記録があり、本番では未実施と記録されている。
