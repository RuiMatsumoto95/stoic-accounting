---
status: 採用
decided: 2026-11-15
verified: 2026-11-24 @ 2e76288
code: [supabase/schema.sql, supabase/manual-migrations/20261115120000_period_close.sql, supabase/manual-migrations/20261115120000_period_close.test.sql, lib/period-close-state.ts, lib/fiscal-period-operations.ts, components/settings/FiscalPeriodSettings.tsx]
related: [README.md, ADR-0007, ADR-0010, ../30-features/settings.md, ../20-database/triggers-constraints.md]
---

# ADR-0009 年度確定は期単位で古い期から進める


## 背景

翌期の期首は過去の仕訳から導出される。決算作業中は前期を見直せる状態が必要で、確定後は仕訳・期首残高・集計に使う区分の変更から結果を守る必要があった。

## 決定

`fiscal_periods.closed_at` で期ごとの確定を表す。確定は古い期から進め、直前の期が未確定なら拒否する。解除は新しい期から進め、直後の期が確定済みなら拒否する。操作は1トランザクションに1期とし、確定・解除を専用履歴に記録する。

## 検討して採らなかった案

- 月次の締めも最初の実装に含める案。
- 手動期首残高のある期を順序の例外にする案と、確定した期の補助科目振り分けを専用操作で許す案。
- 確定時の残高をスナップショットとして保存する案。

## 採用理由

後の期の期首が前の期に依存するため、確定も解除も依存関係に沿った順序にする。手動設定や補助科目の変更に別の経路を設けず、変更が必要な場合は関係する期の確定を解除する手順に揃える。

## 影響・制約

DBは対象期の仕訳・期首残高などの書き込み、期間の変更・削除、確定済み期で使われる科目の区分変更、繰越先の変更を制限する。科目名など編集可能な項目が残るため、確定時の帳票表示を完全には再現しない。確定を解除する利用者の認可は未実装。

## 根拠

年度確定の完了記録の決定19〜24・28。SQL検証報告にロック、保護する更新、確定・解除の検証がある。 [年度確定の変更SQL](../../supabase/manual-migrations/20261115120000_period_close.sql) [SQL検証報告](../../supabase/manual-migrations/step3-sql-report.md)
