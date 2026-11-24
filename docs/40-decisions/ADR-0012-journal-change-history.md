---
status: 採用
decided: 2026-11-01
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations/20261101000000_suppress_chained_update_logs.sql, supabase/manual-migrations/20261101180000_atomic_journal_save.test.sql, lib/journal-save.ts]
related: [README.md, ADR-0002, ../20-database/triggers-constraints.md, ../20-database/security-rls.md]
---

# ADR-0012 仕訳の訂正削除履歴に変更前の明細を残す


## 背景

従来は明細が変わるたびに親ヘッダーの `updated_at` が更新され、その連鎖更新も訂正履歴に記録された。新規仕訳でも履歴が増え、編集時には明細の入れ替え途中の状態が変更前の記録として混ざった。

## 決定

`journal_entries` の更新・削除の直前に、変更前のヘッダーと明細を `journal_entry_logs.before_data` にJSONで記録する。明細トリガーから連鎖したヘッダーのUPDATEは履歴から除く。編集RPCはヘッダーを先に更新してから明細を置き換える。

## 検討して採らなかった案

従来どおり、明細の変更に伴うヘッダーの時刻更新もすべて履歴に残す方式。一度の編集に複数の途中状態が混ざり、変更前の状態を特定しづらかった。

## 採用理由

ヘッダーを変更する直前を記録点にすると、標準の編集経路では1仕訳につき1件の履歴に編集前の全体を残せる。削除時も削除前の全体を記録できる。

## 影響・制約

明細だけを直接変更した場合は、連鎖更新を除外するため履歴が作られない。履歴への追加権限があり、操作者IDを記録する仕組みもないため、改ざん防止を保証する監査証跡としては使えない。

## 根拠

2026-11-01の訂正削除履歴の修正記録。SQLテストに、新規入力の履歴件数と編集前のスナップショットの検証がある。 [履歴の変更SQL](../../supabase/manual-migrations/20261101000000_suppress_chained_update_logs.sql) [保存のSQLテスト](../../supabase/manual-migrations/20261101180000_atomic_journal_save.test.sql)
