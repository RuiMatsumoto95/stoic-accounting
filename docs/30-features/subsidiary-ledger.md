---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [app/subsidiary-ledger/page.tsx, app/api/pdf/subsidiary-ledger/route.ts, lib/reports/subsidiary-ledger.ts, components/pdf/documents/SubsidiaryLedgerDocument.tsx, lib/balance-calculator.ts, supabase/schema.sql]
related: [README.md, ledger.md, subsidiary-balance.md, opening-balances.md, ../20-database/tables.md]
---

# 補助元帳

`/subsidiary-ledger` では、選択中の会社の当期から補助科目を1つ選び、仕訳明細と残高を確認できる。

## 補助科目の選択と明細

- 候補は補助科目のみ。「親科目 › 補助科目」の形式で表示する。`ledger_view` を期IDと選択した補助科目IDで絞り、日付 → 仕訳IDの昇順に取得する。
- 日付・伝票番号・相手科目・仕訳ヘッダーの摘要・借方・貸方・残高を表示する。資産と費用は借方を加算し、負債・純資産・収益は貸方を加算する。反対側は減算する。
- 資産・負債・純資産の期首残高は該当の補助科目分を使う。0以外なら、当期仕訳がない場合も「前期繰越」行を表示する。

## 印刷・PDF

画面とPDFの借方・貸方の「合計」は当期明細の合計。残高欄は期首残高から累積した最終残高で、当期明細がなければ期首残高を表示する。印刷とPDFに対応し、PDFは期と補助科目を選択するとダウンロードできる。
