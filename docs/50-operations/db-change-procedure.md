---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations, CLAUDE.md, lib/journal-save.ts]
related: [README.md, backup-restore.md, ../20-database/migrations.md, ../20-database/security-rls.md, ../60-testing/sql-tests.md]
---

# DB変更の手順

既存のSupabase DBに対する変更は、`supabase/manual-migrations/` のSQLを対象環境のSQL Editorで手動適用します。適用状況はリポジトリの記録で管理します。現行ダンプから再現したDBには、反映済みの変更を再適用する必要はありません。 [変更SQLの順序と適用履歴](../20-database/migrations.md#変更sqlの順序と本番適用履歴)

## 適用前

1. 影響する表・関数・トリガー・権限と、アプリを切り替える順序を確認します。例として、仕訳保存ではRPCを追加し、アプリを切り替えてから貸借一致の遅延制約を適用しました。 [適用順の前提](../20-database/migrations.md#適用順の前提)
2. 変更SQLを `YYYYMMDDHHMMSS_<変更内容>.sql` に保存し、対応する `.test.sql` を用意します。変更によって確認事項が増える場合は `_apply.md` に事前条件、適用順、確認方法、戻す条件を記録します。 [年度確定の適用手順](../../supabase/manual-migrations/20261115120000_period_close_apply.md)
3. 架空データの検証DBで、変更対象のSQLと関係する既存テストを実行します。権限は管理者での成功に加え、アプリが使うロールからの呼び出しを確認します。ロックや制約の変更では、実際のコミットと複数接続での結果も確認します。 [SQLテスト](../60-testing/sql-tests.md)
4. 適用対象のDBを確認し、`public` の定義・データのバックアップを取得します。対象の列や関数の有無、影響するテーブルの件数などを変更前の確認値として記録します。 [バックアップと復元](backup-restore.md)

## 適用と確認

1. 個別の `_apply.md` に従い、対象の変更SQLをSQL Editorで適用します。アプリとDBを段階的に変える場合は、各段階の確認を済ませてから次へ進みます。
2. 適用後の定義、件数、権限を変更前の記録と比較します。データを変更しないSQLでは、対象テーブルの件数が保たれることを確かめます。アプリから使うRPCを変更した場合は、呼び出しと結果を確認します。
3. 対応するSQLテストと回帰テストの結果を確認します。期待値と違う場合は次の変更を止め、適用済みの定義と失敗した項目を確認します。戻す操作には個別の手順の事前条件を適用します。たとえば年度確定のロールバックSQLは確定済みの期がないことが前提です。 [年度確定のロールバック条件](../../supabase/manual-migrations/20261115120000_period_close_apply.md#3-ロールバックsql適用後に戻す場合)
4. 適用後の `public` の定義をダンプし、次の手順で `supabase/schema.sql` を更新します。マイグレーション履歴と影響する仕様に適用結果を反映します。ローカル、本番、ブラウザーなど、どの環境で何を確認したかを記録します。 [マイグレーション履歴](../20-database/migrations.md)

### 定義ダンプをリポジトリへ収録する

1. 変更を適用したDBから、`pg_dump` で `public` の定義だけをプレーンテキスト形式で取得します。現行のダンプは `--schema=public --schema-only --no-owner` で取得しています。
2. 最近のマイナー版の `pg_dump` は、先頭付近に `restrict`、末尾に `unrestrict` の psql メタコマンドを出力します。両方に同じランダムなトークンが付きます。これはダンプを読む間に別のメタコマンドが実行されるのを防ぐ仕組みです。トークンはDBの認証情報とは無関係です。 [PostgreSQLの psql](https://www.postgresql.org/docs/17/app-psql.html)・[PostgreSQLの pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
3. 自分で取得し、内容を確認したダンプを `schema.sql` として収録するときは、このメタコマンド2行を対で除きます。ダンプごとに変わるトークンによる差分を避け、SQL Editor が扱わない psql 固有の行を公開ファイルに含めないためです。入手元が異なるダンプには、元の制限を残します。
4. 差分で、除いたメタコマンド2行と隣接する空行を確認します。空のSupabaseでダンプ全体を適用できるかは、初期スキーマや設定の差も含めて検証が必要です。 [自己ホストの前提](self-host.md)

## 権限変更で確認する点

- 新しい表を追加したら、RLSの状態、ポリシー、実際の付与権限を調べます。現行の運用では、既定権限から付く `TRUNCATE`・`REFERENCES`・`TRIGGER` を `anon` と `authenticated` から再度取り消します。 `MAINTAIN` はこの取り消しの対象外です。 [テーブル・ビューの権限](../20-database/security-rls.md#テーブルビューの権限)
- 関数を追加するときは、呼び出し元ごとに必要な `EXECUTE` を明記します。`SECURITY INVOKER` の経路では、RPCやトリガーが内部で呼ぶ補助関数も確認します。期首残高の導入時には、この補助関数の付与漏れによりアプリからの保存に失敗し、追加のSQLで修正しました。 [修正SQL](../../supabase/manual-migrations/20261114190000_grant_opening_balance_account_ok.sql)
