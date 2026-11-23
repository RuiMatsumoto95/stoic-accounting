---
status: 現行
verified: 2026-11-24 @ b69542c
code: [app/tax-summary/page.tsx, app/api/pdf/tax-summary/route.ts, lib/reports/tax-summary.ts, lib/tax-codes.ts, components/tax-summary/TaxSummaryTable.tsx]
related: [README.md, journals.md, settings.md, ../20-database/tables.md]
---

# 消費税集計表

`/tax-summary` は、当期の指定日付範囲にある仕訳明細を、税区分と借方・貸方ごとに集計する。

## 集計と表示

- 開始日と終了日を指定し、「表示」で更新する。両端の日付を含み、当期に属する仕訳を対象とする。初期値は開始日が `2024-01-01`、終了日が `2024-12-31`。
- 税区分マスタを表示順に並べ、各税区分について借方金額合計と貸方金額合計を別々に表示する。末尾は表示した行の合計。マスタにある税区分は該当する明細がなくても0で表示する。
- 税区分の照合は明細の `tax_code` とマスタのIDで行う。税区分なし・マスタにないIDは表示行や表示合計に含まれない。表の金額は仕訳明細の金額の合計で、税率からの税額計算は行わない。

## 印刷・PDF

「印刷」は画面上の集計結果を印刷する。PDFは入力欄の開始日・終了日と当期IDを送って、サーバーで税区分マスタと仕訳を取得し直す。日付を入力した直後は「表示」を押すまで画面の集計表は更新されない。
