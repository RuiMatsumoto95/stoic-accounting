---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations, .github/workflows/test.yml]
related: [README.md, ../20-database/migrations.md, ../20-database/triggers-constraints.md, ../50-operations/db-change-procedure.md]
---

# SQLテスト

`supabase/manual-migrations/` には通常の `.test.sql` が8本、ローカル専用の `.test_local.sql` が1本あります。通常のテストは、仕訳保存と貸借一致、補足、伝票番号、会社の範囲、アーカイブ、期首残高、年度確定を確認します。CIでは実行せず、対象の変更を適用した検証DBで手動実行します。 [変更とテストSQLの一覧](../20-database/migrations.md)

## 通常のテスト

1. 架空データを使える検証DBを用意し、対象テストの冒頭に記された前提を確認します。現行スキーマを使う場合は、ダンプに含まれる変更の再適用は不要です。
2. `.test.sql` のファイル全体を一度に実行します。検証に `DO` ブロックを使い、意図的な例外でテストの変更を取り消します。年度確定のテストでは `BEGIN` で開始し、記録用の表と関数も同じトランザクションで作成します。
3. 結果に `TEST RESULT: ALL PASSED` が含まれ、チェック数が対象の版と一致すれば成功です。`FAILED` や途中のエラーが出た場合は、項目名とエラーを確認します。成功時にも例外を返す形式なので、SQLクライアントの終了コードだけでは判定できません。
4. 年度確定の `.test_local.sql` は `session_replication_role = replica` を使うローカル専用テストです。本番DBでは通常の `.test.sql` を使用します。 [年度確定のテスト](../../supabase/manual-migrations/20261115120000_period_close.test.sql)・[ローカル専用テスト](../../supabase/manual-migrations/20261115120000_period_close.test_local.sql)

### RLSの自動有効化と記録用テーブル

`rls_auto_enable()` をイベントトリガーに登録した環境では、`public` に作るテスト用の表にもRLSが有効になります。ポリシーがないと、アプリと同じ `anon` ロールでテストの結果を書き込めません。年度確定のテストでは、トランザクション内の記録専用表 `public.t_results` だけRLSを無効にし、ロールを切り替えても記録できるようにします。SQLは通常の `CREATE TABLE` で `t_results` を作成し、最後のロールバックで取り消します。業務テーブルのRLSは維持します。 [年度確定のテスト](../../supabase/manual-migrations/20261115120000_period_close.test.sql)・[RLSの自動有効化](../20-database/security-rls.md#rlsを自動で有効にする関数)

## DBの保証を確かめる

- 貸借不一致、会社の異なる参照、確定後の変更など、拒否される条件ではエラーと保存されなかったことを確認します。意図した失敗は例外処理を持つ内側のブロックで受けます。遅延制約は、通常のテスト内で `SET CONSTRAINTS … IMMEDIATE` により検査を前倒しできます。
- ロールによって可否が変わる処理は、アプリが使うロールでも試します。テストのために設けた記録用テーブルと、アプリが使う表のRLS・権限はそれぞれ確認します。
- 実際のコミット時の制約や同時実行は、独立したDB接続を使って検証します。待機が起きたこと、コミット・取り消し後の成功または拒否、最終状態まで確認します。 [貸借一致のコミット確認](../../supabase/manual-migrations/20261101180100_concurrency_test.md)・[年度確定の同時実行手順](../../supabase/manual-migrations/20261115120000_period_close_concurrency.md)
- 制約を検査するテストが実際に失敗を検出するかは、別の使い捨てDBで対象の仕組みを一時的に変え、該当テストが失敗することを確かめる方法があります。年度確定ではこの変異テストも実施されています。 [年度確定のSQL検証報告](../../supabase/manual-migrations/step3-sql-report.md)

## 記録にある検証範囲

- 伝票番号の通常テストは本番適用時に45項目が通過しました。本番での同時実行テスト T1〜T5 は、確認できた検証記録では未実施です。 [本番適用履歴](../20-database/migrations.md#変更sqlの順序と本番適用履歴)・[採番の検証手順](../../supabase/manual-migrations/20261110170000_auto_reference_number_apply.md)
- ローカルのPostgreSQL 17.12では、既存7本の380項目が年度確定の適用前後で通過。年度確定の通常テスト165項目とローカル専用4項目、同時実行の17シナリオとC10、変異テスト5種も確認しました。負荷試験のC6はPostgreSQL 16でのみ実施しました。 [SQL検証報告](../../supabase/manual-migrations/step3-sql-report.md)
- 2026-11-15の本番適用では、年度確定の165項目に加え、更新版の期首残高66項目、会社対応、アーカイブのテストが通過しました。本番の複数接続の検証は未実施と記録されています。 [本番適用履歴](../20-database/migrations.md#変更sqlの順序と本番適用履歴)
