---
status: 採用
decided: 2026-11-12
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations/20261112120000_company_support.sql, supabase/manual-migrations/20261112120000_company_support.test.sql, lib/account-master-options.ts, lib/individual-financial-statements.ts]
related: [README.md, ADR-0004, ADR-0005, ADR-0007, ../20-database/tables.md, ../30-features/balance-sheet.md]
---

# ADR-0006 事業主貸借は区分、繰越先は会社の参照で持つ


## 背景

個人の事業主貸・事業主借はB/Sの表示区分であり、期をまたぐと損益とともに繰越先に集約する。法人と個人では初期の繰越先が異なる。

## 決定

個人の事業主貸は資産の `OWNER_DRAWINGS`、事業主借は負債の `OWNER_CONTRIBUTIONS` として `accounts.bs_category` に持つ。繰越先は `companies.carry_forward_account_id` に保存し、同じ会社の純資産の親科目に限る。会社作成時は法人の繰越利益、個人の元入金を初期値にする。

## 検討して採らなかった案

`accounts.system_role` に事業主貸・事業主借・元入金・繰越利益の役割を持たせる案。設計時には、科目名やコードを固定の判定条件にする方法も、変更に弱いとして避けた。

## 採用理由

事業主貸借は財務諸表の区分そのものなので既存の `bs_category` で表せる。繰越先を会社の列にすると、会社につき最大1件であることと、参照する科目が同じ会社にあることをDBで保証できる。作成後の繰越計算はこの参照を使うため、科目コードや名称の変更に依存しない。

## 影響・制約

繰越先は未設定も許す。繰越額が0以外で繰越先がなければ、期首残高の導出はエラーになる。参照されている科目を削除したり、指定条件を満たさない科目に変えたりする操作はDBが拒否する。

## 根拠

会社単位の設計方針と完了報告の決定1-1、および繰越先を会社に置く設計。 [会社対応の変更SQL](../../supabase/manual-migrations/20261112120000_company_support.sql) [科目と会社の定義](../20-database/tables.md)
