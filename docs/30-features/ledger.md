---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [app/ledger/page.tsx, app/api/pdf/ledger/route.ts, lib/reports/ledger.ts, components/ledger/LedgerTable.tsx, components/pdf/documents/LedgerDocument.tsx, lib/balance-calculator.ts, supabase/schema.sql]
related: [README.md, subsidiary-ledger.md, opening-balances.md, ../20-database/tables.md]
---

# 総勘定元帳

`/ledger` では、選択中の会社の当期について、選んだ親科目とその補助科目の仕訳明細・残高を確認できる。

## 科目の選択と明細

- 勘定科目欄の候補は親科目のみ。コード順に「コード 科目名」で表示し、選択すると該当科目と直下の補助科目をまとめて取得する。
- `ledger_view` を期IDと対象科目IDで絞り、日付 → 仕訳IDの昇順に取得する。日付、伝票番号、実際に仕訳に使った科目、相手科目、仕訳ヘッダーの摘要、借方、貸方、残高を表示する。
- 残高は資産・費用では借方を加算し、負債・純資産・収益では貸方を加算する。反対側は減算する。

## 期首残高と出力

- 資産・負債・純資産では、親と補助科目の期首残高を合算して累積の開始値にする。0以外の場合は、会計期の開始日で「前期繰越」行を表示する。仕訳がなくても期首残高があれば表示する。
- 画面とPDFの「合計」の借方・貸方には前期繰越を含め、残高欄には最後の明細の残高を表示する。明細がなければ期首残高を表示する。
- 「印刷」は表示中の表を印刷する。PDFは期と科目を選択するとダウンロードでき、対象期・対象科目でサーバー側から明細を取り直す。
