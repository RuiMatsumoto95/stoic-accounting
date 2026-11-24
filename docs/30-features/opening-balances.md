---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [app/opening-balances/page.tsx, components/opening-balances/OpeningBalanceEditor.tsx, lib/opening-balances.ts, lib/opening-balance-impact.ts, components/OpeningBalanceImpactNotice.tsx, components/PeriodClosedNotice.tsx, lib/fiscal-period.ts, supabase/schema.sql]
related: [README.md, settings.md, journals.md, csv-import.md, ledger.md, balance-sheet.md, ../20-database/functions-rpc.md]
---

# 期首残高

`/opening-balances` では、選択中の会社の指定期について、自動導出された期首残高を確認し、必要に応じて手動で設定する。初期選択は当期、当期がなければ開始日の新しい期。

## 表示と入力

- 資産・負債・純資産でB/S区分のある科目を表示する。個人の事業主貸・事業主借は手動設定の対象外。親科目と補助科目を別行にし、親科目の入力欄は補助科目に割り当てない金額に使う。
- 表では科目の正常残高を正で入力する。資産なら借方、負債・純資産なら貸方の残高にあたる。反対側の残高は負で入力する。空欄は0。金額は整数部13桁まで、小数第2位まで。
- 通常は導出値を表示する。「手動設定を開始」で表示中の金額を編集できる。手動設定のある期では手動値と導出値、差額、相違した科目の件数を確認できる。
- 未保存のまま期を切り替えると破棄を確認する。保存・解除・確認ダイアログの間は期の切り替えを無効にする。確定済みの期は参照できるが編集・保存・解除は無効になる。

## 保存と解除

- 借方・貸方の合計と差額を表示する。貸借が一致していれば「保存」で反映する。不一致の場合は、繰越先への差額の追加を確認してから保存する。繰越先が未設定の場合、DBは差額の自動調整を拒否する。メモは任意。
- 手動設定を保存した期では、仕訳を直してもその期の設定値は自動更新されない。明細が0件でも手動設定は有効になる。「手動設定を解除」で確認すると、その期は自動計算に戻る。
- 期首残高は仕訳明細とは別に保存する。通常の帳票は手動設定があればそれを優先し、なければ過去の仕訳から導出する。導出や繰越の計算は [DB関数とRPC](../20-database/functions-rpc.md#期首残高の取得手動設定) を参照。
