---
status: 採用
decided: 2026-11-10
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations/20261110170000_auto_reference_number.sql, supabase/manual-migrations/20261110170000_auto_reference_number.test.sql, lib/journal-save.ts, lib/reference-number.ts, app/journals/page.tsx]
related: [README.md, ADR-0001, ADR-0002, ../20-database/triggers-constraints.md, ../20-database/functions-rpc.md]
---

# ADR-0003 伝票番号を会計期単位で採番する


## 背景

新規仕訳とCSV本登録に番号を自動で付け、手入力も認めるには、同じ期の並行保存が同じ番号を選ばないようにする必要があった。

## 決定

保存RPCで期ごとの最大番号に1を足し、番号がなければ1から始める。`integer` の範囲を1〜999999999に制限し、非NULLの番号は期内で一意とする。採番と番号検証は会計期単位のトランザクション用アドバイザリロックで直列化する。ロックは仕訳行より先に取り、CSVでは中間行のロックをその前に取る。

## 検討して採らなかった案

初版は会計期間の行を `FOR UPDATE` でロックしていた。一括日付変更は仕訳行を先にロックしてから期を `FOR SHARE` で確認するため、編集RPCと逆順になり、検証環境でデッドロックした。

## 採用理由

採番に専用のロックを使うと、期の行を先に押さえずに同じ期の採番を直列化できる。一括日付変更の既存のロック順序も維持できる。

## 影響・制約

採番は保存RPC経由で行う。導入前のNULL番号は埋めず、番号に欠番があっても途中から詰めない。編集時の空欄は番号を維持する。この変更で採番と一括日付変更の間にあった循環待ちを解消した。一括変更同士には既存の競合が残る。

## 根拠

適用記録には、期の行ロックから方式を変更した経緯、変更前後の並行実行結果がある。 [適用・検証記録](../../supabase/manual-migrations/20261110170000_auto_reference_number_apply.md) [SQLテスト](../../supabase/manual-migrations/20261110170000_auto_reference_number.test.sql)
