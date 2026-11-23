---
status: 現行
verified: 2026-11-24 @ b69542c
code: [app/pl-trial-balance/page.tsx, app/api/pdf/pl-trial-balance/route.ts, lib/reports/trial-balance.ts, components/pdf/documents/TrialBalanceDocument.tsx, lib/balance-calculator.ts]
related: [README.md, trial-balance.md, income-statement.md]
---

# 残高試算表（損益）

`/pl-trial-balance` は、当期の収益・費用を科目別に確認する画面。当期が設定されていない場合はメッセージを表示する。

## 表とタブ

- 「科目別」は親科目の行を表示し、補助科目の仕訳明細を親科目に合算する。「補助科目」は親科目行の下にその内訳を表示する。補助科目の内訳はタブを開いた時に取得する。期が変わると「科目別」に戻る。
- 期首残高の欄は「-」。期末残高の元になる増減は、収益では貸方－借方、費用では借方－貸方。区分内の小計と全体の合計は親科目単位で集計する。
- 借方・貸方の両方が0の科目は表示しない。借方・貸方が相殺して残高が0になった科目は、取引があれば表示する。

## 印刷・PDF

「印刷」は選択中のタブを印刷する。PDFは損益の区分を固定し、選択中のタブに応じて補助科目の内訳を表示する。
