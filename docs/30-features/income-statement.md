---
status: 現行
verified: 2026-11-24 @ b69542c
code: [app/income-statement/page.tsx, app/api/pdf/income-statement/route.ts, lib/reports/income-statement.ts, lib/financial-statements.ts, lib/financial-statement-calculations.ts, lib/individual-financial-statements.ts, lib/individual-statement-rows.ts, lib/balance-calculator.ts, components/financial-statements/PLTable.tsx, components/financial-statements/IndividualStatementTable.tsx]
related: [README.md, balance-sheet.md, pl-trial-balance.md, accounts.md]
---

# 損益計算書

`/income-statement` は、当期の収益・費用を財務諸表区分で集計し、選択中の会社の区分に応じた損益計算書を表示する。

## 集計と表示

- 補助科目の動きは親科目へ合算し、親科目のP/L区分で集計する。
- 法人では、売上総利益、営業損益、経常損益、税引前当期損益、当期純損益を表示する。
- 個人では、収入金額・売上原価から売上総損益を出し、経費を引いた差引金額に繰戻額等と繰入額等を反映して控除前所得金額を表示する。青色申告特別控除や控除後所得の行は表示しない。
- 「前期比較」を有効にすると前期・増減額・増減率を表示する。比較対象は同じ会社で対象期の開始日より前に終了する期のうち、終了日が最も新しい期。前期がなければ切り替えは無効。「ゼロ残高科目を隠す」は当期額0の科目を隠し、比較中は前期額も0の科目だけを隠す。

## 印刷・PDF

画面の印刷とPDFに対応する。PDFには比較表示・ゼロ科目の設定を渡す。PDFで使う法人・個人の様式は対象期の会社から決まり、個人の科目行と小計の表示定義は画面とPDFで共用する。
