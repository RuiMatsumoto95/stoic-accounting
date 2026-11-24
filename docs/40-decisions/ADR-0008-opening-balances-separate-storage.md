---
status: 採用
decided: 2026-11-14
verified: 2026-11-24 @ 2e76288
code: [supabase/schema.sql, supabase/manual-migrations/20261114180000_opening_balances.sql, supabase/manual-migrations/20261114180000_opening_balances.test.sql, lib/opening-balances.ts, lib/journal-save.ts]
related: [README.md, ADR-0001, ADR-0006, ADR-0007, ../30-features/opening-balances.md, ../20-database/tables.md]
---

# ADR-0008 手動期首残高は専用テーブルに保存する


## 背景

期首残高を通常の仕訳に入れると、当期の動きと期首時点の金額を区別する必要がある。すべて0で手動固定した期も、自動導出の期とは区別する必要があった。

## 決定

手動期首残高を期ごとのヘッダーと科目ごとの明細に保存し、設定・解除の履歴は別表に記録する。ヘッダーがあれば手動設定と判定する。DBは明細の符号付き残高の合計が0であることを遅延制約で検査する。

## 検討して採らなかった案

- 期首日付の `is_opening_balance` 仕訳を作り、当期の集計から各帳票で除外する方式。帳票ごとに除外処理が必要になる。
- 期首日付の仕訳を当期の取引として集計する方式。仕訳に含めた金額が試算表の当期借方・貸方に入り、期首の欄に現れない。

## 採用理由

専用表なら期首残高を当期の取引額に混ぜず、元帳や試算表に期首として反映できる。ヘッダーの有無を使うと、全額0の設定でも固定の意図が残る。

## 影響・制約

既存の `is_opening_balance` 列とフラグ付き仕訳の編集制限は保持する。手動残高の保存はこのフラグの仕訳を作らない。個人の事業主貸・事業主借や損益科目は手動残高の対象外。

## 根拠

期首残高の決定記録4・7・13・15。専用3表、貸借の遅延検査と保存・解除のRPCは変更SQLにまとまっている。 [期首残高の変更SQL](../../supabase/manual-migrations/20261114180000_opening_balances.sql) [SQLテスト](../../supabase/manual-migrations/20261114180000_opening_balances.test.sql)
