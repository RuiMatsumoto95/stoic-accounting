---
status: 採用
decided: 2026-11-14
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations/20261114180000_opening_balances.sql, supabase/manual-migrations/20261114180000_opening_balances.test.sql, lib/opening-balances.ts, lib/opening-balance-impact.ts, components/opening-balances/OpeningBalanceEditor.tsx]
related: [README.md, ADR-0006, ADR-0008, ADR-0009, ../30-features/opening-balances.md, ../20-database/functions-rpc.md]
---

# ADR-0007 期首残高は自動導出し、任意の期で手動固定できる


## 背景

決算の作業中は前期の修正と翌期の入力を行き来する。前期の修正を翌期へ反映しながら、移行時などには任意の期の開始残高を固定する必要があった。

## 決定

期首残高は必要時に導出する。任意の期に手動設定があればその値を優先する。手動設定のない期は、対象期より前の直近の手動設定を起点にし、それがなければ会社の最初の期から集計する。起点から対象期首の前日までの仕訳を加え、損益と個人の事業主貸借は繰越先へ集約する。

## 検討して採らなかった案

- 残高の繰越仕訳を作り、前期を直すたびに作り直す方式。
- すべての期で過去の仕訳から導出し、手動で起点を固定できない方式。最初の自動導出案は、任意期の手動設定を加える決定で拡張した。

## 採用理由

通常は前期の修正が自動で反映され、再繰越の実行漏れを防げる。手動設定を後続期の計算起点にすれば、手動設定より前の修正をその期以降に反映させずに済む。

## 影響・制約

手動設定中は、導出値と保存値の差を画面で計算して表示する。翌期が自動導出のときは、仕訳の変更が翌期以降にも影響する旨を画面で案内する。年度確定は別の操作とする。 [年度確定の判断](ADR-0009-period-close-order.md)

## 根拠

11月13日の自動導出の決定を、11月14日に任意期の手動設定を加えて確定した。期首残高の決定記録1・2・9・14・16と現行の導出関数を照合した。 [期首残高の変更SQL](../../supabase/manual-migrations/20261114180000_opening_balances.sql) [SQLテスト](../../supabase/manual-migrations/20261114180000_opening_balances.test.sql)
