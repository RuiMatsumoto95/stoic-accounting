---
status: 現行
verified: 2026-11-24 @ b69542c
code: [app/balance-sheet/page.tsx, app/api/pdf/balance-sheet/route.ts, lib/reports/balance-sheet.ts, lib/financial-statements.ts, lib/financial-statement-calculations.ts, lib/individual-financial-statements.ts, lib/individual-statement-rows.ts, lib/balance-calculator.ts, components/financial-statements/BSTable.tsx, components/financial-statements/IndividualStatementTable.tsx]
related: [README.md, income-statement.md, trial-balance.md, opening-balances.md, accounts.md]
---

# 貸借対照表

`/balance-sheet` は、当期末の資産・負債と純資産または資本の内訳を表示する。選択中の会社の区分に応じて法人用・個人用の様式を使う。

## 集計と表示

- 期首残高と当期仕訳の動きを合算し、補助科目分は親科目へまとめて、親科目のB/S区分に従って集計する。期首残高は手動設定があればその値、なければ導出された値を使う。
- 法人では純資産の部に当期純損益を含める。個人では事業主貸を資産、事業主借を負債として表示し、資本合計は元入金と控除前所得金額を合計する。
- 当期の資産合計と負債・純資産側の合計が一致しない場合は、画面に差額を表示する。
- 「前期比較」は、同じ会社で対象期の開始日より前に終了する期のうち、終了日が最も新しい期を表示する。該当期がなければ切り替えは無効。「ゼロ残高科目を隠す」は当期額0の科目を隠し、比較中は前期額も0の科目だけを隠す。

## 印刷・PDF

画面の印刷とPDFに対応する。PDFは指定した対象期の会社に合わせて集計・様式を切り替え、比較表示とゼロ科目の設定を反映する。期首残高の取得・導出に失敗した場合は読み込みエラーを表示し、PDFのデータ取得もエラーになる。
