---
status: 現行
verified: 2026-11-24 @ b69542c
code: [app/trial-balance/page.tsx, app/api/pdf/trial-balance/route.ts, lib/reports/trial-balance.ts, components/pdf/documents/TrialBalanceDocument.tsx, lib/balance-calculator.ts]
related: [README.md, pl-trial-balance.md, subsidiary-balance.md, opening-balances.md]
---

# 残高試算表（貸借）

`/trial-balance` は、当期の資産・負債・純資産を、期首残高と当期の借方・貸方の合計から確認する画面。当期が設定されていない場合はメッセージを表示する。

## 表とタブ

- 「科目別」は親科目行を表示する。補助科目の期首残高と当期明細は対応する親科目に合算する。
- 「補助科目」は同じ親科目行の下に、内訳として補助科目を表示する。内訳はタブを開いた時に取得する。会計期が変わると「科目別」に戻る。小計・合計は親科目行を集計するため、内訳は二重計上しない。
- コード、勘定科目、期首残高、当期借方、当期貸方、期末残高を表示する。期末残高は期首残高に、資産なら借方－貸方、負債・純資産なら貸方－借方を加えた値。期首残高・当期借方・当期貸方がすべて0の科目は表示しない。

## 印刷・PDF

「印刷」は選択中のタブを印刷する。PDFは会計期と選択中のタブに応じて、貸借の区分と補助科目の表示を指定して生成する。
