---
status: 採用
decided: 2026-11-01
verified: 2026-11-24 @ 2e76288
code: [supabase/schema.sql, supabase/manual-migrations/20261101180000_atomic_journal_save.sql, supabase/manual-migrations/20261101180000_atomic_journal_save.test.sql, lib/journal-save.ts]
related: [README.md, ADR-0001, ADR-0003, ADR-0012, ../20-database/functions-rpc.md, ../30-features/journals.md, ../30-features/csv-import.md]
---

# ADR-0002 仕訳保存をRPCで原子化する


## 背景

仕訳のヘッダーと明細を複数のリクエストで保存すると、途中の失敗で一部だけが残り得た。CSV本登録では、失敗時に先に登録した仕訳を消す処理が訂正削除履歴にも記録された。

## 決定

作成・編集・CSV本登録をそれぞれDBのRPCで処理する。編集ではヘッダーを先に更新してから明細を入れ替える。CSV本登録は選んだ全行の仕訳作成と中間行の処理済み更新を一緒にコミットする。

## 検討して採らなかった案

ヘッダーと明細を個別のリクエストで保存し、途中で失敗したらアプリから取り消す方式を置き換えた。取り消しの通信も失敗し得るため、一貫した状態を保証できない。

## 採用理由

同一トランザクションの中で入力と既存状態を検証し、どこかで失敗したら全体を取り消せる。ヘッダーを先に更新する順序により、履歴に編集前の全明細を残せる。

## 影響・制約

通常の仕訳入力・編集とCSV本登録が対象。一覧の一括日付・摘要変更や削除は、引き続きヘッダーを直接更新・削除する。

## 根拠

変更SQLとSQLテストでは、失敗した作成・編集のほか、CSVの途中でエラーになったときに先行行や取り消しの削除ログが残らないことを確認する。 [変更SQL](../../supabase/manual-migrations/20261101180000_atomic_journal_save.sql) [SQLテスト](../../supabase/manual-migrations/20261101180000_atomic_journal_save.test.sql)
