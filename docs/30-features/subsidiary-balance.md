---
status: 現行
verified: 2026-11-24 @ b69542c
code: [app/subsidiary-balance/page.tsx, app/api/pdf/subsidiary-balance/route.ts, lib/reports/subsidiary-balance.ts, components/pdf/documents/SubsidiaryBalanceDocument.tsx, lib/balance-calculator.ts]
related: [README.md, subsidiary-ledger.md, trial-balance.md, opening-balances.md]
---

# 補助残高一覧表

`/subsidiary-balance` は、当期の補助科目の残高を親科目ごとに一覧表示する。

## 表の読み方

- 補助科目ごとに期首残高・当期借方・当期貸方・期末残高を表示する。親科目に直接入った明細は集計対象外。親科目ごとの小計と、全補助科目の合計を表示する。
- 資産・負債・純資産には補助科目の期首残高を使う。収益と費用のグループの期首欄は「-」。期末残高は期首残高と当期の増減の合計。資産・費用の増減は借方－貸方、負債・純資産・収益は貸方－借方。
- 期首残高が0で当期借方と当期貸方も0の補助科目は表示しない。期首残高だけがある科目は表示する。

## 印刷・PDF

印刷では表示中の一覧を使う。当期が設定されていれば、同じ集計処理を使うPDFをダウンロードできる。
