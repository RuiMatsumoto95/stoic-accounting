---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [package.json, vitest.config.mts, .github/workflows/test.yml, __tests__, supabase/manual-migrations, scripts/check-docs.mjs]
related: [vitest-and-ci.md, sql-tests.md, manual-verification.md, ../50-operations/db-change-procedure.md]
---

# テストの考え方

変更した挙動に合わせて検証方法を選びます。型や自動テストの結果に加え、DBが保証する整合性と、ブラウザーでの操作結果を対象にします。

| 確かめたいこと | 検証 |
| --- | --- |
| 入力値の解釈、集計、保存の引数、エラー変換、会社の範囲 | [VitestとCI](vitest-and-ci.md) |
| 貸借一致、参照制約、権限、失敗時の取り消し、ロック | [SQLテスト](sql-tests.md) |
| キー入力、フォーカス、会社・会計期の切り替え、画面と出力 | [ブラウザーでの確認](manual-verification.md) |
| ドキュメントのヘッダー・参照と、確認以降のコード更新 | [ドキュメントの確認](../README.md#書き方の約束) |

不具合を修正するときは、正常な経路と拒否すべき経路の期待結果を確認します。既存テストが失敗したときは、変更前の挙動と比較して原因を調べます。期待値を変更した場合は、対象と仕様上の理由を残します。テスト結果には実行したコマンド、環境、結果、未確認の項目を記載し、架空データを使います。
