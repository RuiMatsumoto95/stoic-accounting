---
status: 採用
decided: 2026-11-15
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations/20261115120000_period_close.sql, supabase/manual-migrations/20261115120000_period_close.test.sql, lib/fiscal-period-operations.ts, components/settings/FiscalPeriodSettings.tsx]
related: [README.md, ADR-0009, ../20-database/functions-rpc.md, ../20-database/triggers-constraints.md, ../30-features/settings.md]
---

# ADR-0010 確定前の必須チェックをDBトリガーで強制する


## 背景

設定画面では確定前に結果を見せる必要がある。チェック後に状況が変わる場合や、保存RPCを通さずに確定状態を更新する場合にも、同じ必須条件を適用する必要があった。

## 決定

`get_period_close_check` が確定前のエラーと警告を返す。`closed_at` を確定状態に変更する際は、`BEFORE UPDATE` トリガーが条件を再検査する。直前の期が未確定、期首残高を導出できない、繰越額が0以外で繰越先が未設定、財務諸表区分が未設定の科目に期末までの明細がある、同じ会社の期と日付範囲が重なる場合をエラーとする。会社全体に未処理の取込行がある場合と、対象期の仕訳が0件の場合は警告とする。

## 検討して採らなかった案

画面の確認だけで確定させる案を採らなかった。保存RPCだけに検査を置いても、`closed_at` への直接更新には適用されない。警告の項目は判断材料として表示し、確定を妨げる条件には加えなかった。

## 採用理由

期の状態が変わるDB上の箇所で検査すれば、書き込み経路にかかわらず必須条件を統一できる。確定と期間の日付変更を同じ更新に含める操作も拒否し、検査に使った期間と確定される期間が一致するようにする。

## 影響・制約

確定ダイアログは確認時点の結果を表示し、確定時には新たなエラーが返る場合がある。解除時は、直後の期が確定済みかをトリガーで判定する。

## 根拠

DBでロックする期首残高の決定10と、年度確定の決定25・27。SQLテストは確定RPCと直接更新の両方を検査する。 [年度確定の変更SQL](../../supabase/manual-migrations/20261115120000_period_close.sql) [SQLテスト](../../supabase/manual-migrations/20261115120000_period_close.test.sql)
