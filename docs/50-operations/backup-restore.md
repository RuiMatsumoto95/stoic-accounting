---
status: 現行
verified: 2026-11-24 @ 47e0a78
code: [supabase/schema.sql, supabase/manual-migrations/20261115120000_period_close_apply.md, supabase/manual-migrations]
related: [README.md, db-change-procedure.md, self-host.md, ../20-database/tables.md, ../60-testing/sql-tests.md]
---

# バックアップと復元

DB変更前に `public` スキーマを定義・データ込みで取得し、別のDBに復元できることを確かめます。リポジトリの `supabase/schema.sql` は定義のみです。以下は、架空データを入れたDBを対象にした取得・復元の手順です。 [年度確定の適用前の手順](../../supabase/manual-migrations/20261115120000_period_close_apply.md#0-適用前必ずやる)・[PostgreSQLの pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)

## 取得と保管

1. 対象DBを確認し、PostgreSQLの接続設定を用意します。以下の例の `stoic-backup-source` と `stoic-restore-test` は、接続元と復元先に個別に割り当てる接続サービス名です。接続サービスファイルで、接続先・DB名・ユーザーをそれぞれ設定します。認証情報やダンプは公開リポジトリに置かず、ダンプは暗号化してアクセスを制限した場所に保管します。 [PostgreSQLの接続サービスの設定](https://www.postgresql.org/docs/17/libpq-pgservice.html)
2. `pg_dump` でカスタム形式のファイルを作成します。終了コードとファイルを確認し、`pg_restore --list` で対象テーブルの定義・データと権限の項目があることを確認します。

   ```sh
   pg_dump --dbname="service=stoic-backup-source" --schema=public --format=custom --file=stoic-backup.dump
   pg_restore --list stoic-backup.dump
   ```

3. 暗号化して保管したファイルを保管先から取り出せることを確認します。取得・保管・復元それぞれの結果を記録します。

## 別のDBでの復元

1. 検証専用の空のPostgreSQLを別に用意します。取得したアーカイブが参照するロールと、権限を復元するための権限を確認します。現行の定義では `anon`・`authenticated`・`service_role`・`supabase_admin` が参照されます。復元先に存在しないロールは、その検証環境でログイン不可のロールとして作成します。
2. 目録に `public` スキーマの作成が含まれると、復元先に同名のスキーマがある場合に衝突します。**復元専用に作った空のDB**で、対象と中身を確認したうえで、空の `public` を `DROP SCHEMA public;` で取り除きます。復元時に元の所有者は引き継がない設定を使い、付与権限は復元の対象にします。

   ```sh
   pg_restore --exit-on-error --no-owner --dbname="service=stoic-restore-test" stoic-backup.dump
   ```

3. 終了コードを確認します。失敗した場合はエラーの原因を調べ、次の試行は空の検証DBからやり直します。成功時は表の件数・内容、制約、RLSポリシー、付与権限を取得時の記録と照合し、仕訳保存、期首残高、年度確定・解除のSQLテストを実行します。 [PostgreSQLの pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)・[SQLテスト](../60-testing/sql-tests.md)

## 確認できた範囲

2026-11-16の復元記録では、取得したアーカイブを別のPostgreSQL 17に復元し、17表の件数と内容を照合し、通常のSQLテスト8本が通過しました。ブラウザー上の帳票の照合および新規Supabaseへの復元は、この試験では未実施です。

`public` を対象とする取得範囲には、`auth` スキーマのアカウント、Supabase側の設定、DB全体に設定されるイベントトリガーは含まれません。環境全体を復旧する場合は、これらの設定とアプリの接続設定を別途用意し、復元後に確認します。 [自己ホストの前提と確認範囲](self-host.md)
