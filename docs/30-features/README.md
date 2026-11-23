---
status: 現行
verified: 2026-11-24 @ b69542c
code: [app, components/layout/NavLinks.tsx, components/layout/CompanySwitcher.tsx, contexts/CompanyContext.tsx, contexts/FiscalPeriodContext.tsx, components/print/PrintButton.tsx, components/pdf/PDFButton.tsx, lib/reports/scope.ts]
related: [../README.md, ../20-database/README.md, journals.md, ledger.md, trial-balance.md, pl-trial-balance.md, subsidiary-ledger.md, subsidiary-balance.md, tax-summary.md, income-statement.md, balance-sheet.md, csv-import.md, opening-balances.md, settings.md, accounts.md]
---

# 画面別の機能

## 画面一覧

| 画面 | パス | 主な操作・表示 |
| --- | --- | --- |
| [仕訳日記帳](journals.md) | `/journals` | 入力・検索・訂正・複製・一括操作・出力 |
| [総勘定元帳](ledger.md) | `/ledger` | 親と補助科目を合わせた明細・残高 |
| [残高試算表（貸借）](trial-balance.md) | `/trial-balance` | 資産・負債・純資産の残高 |
| [残高試算表（損益）](pl-trial-balance.md) | `/pl-trial-balance` | 収益・費用の残高 |
| [補助元帳](subsidiary-ledger.md) | `/subsidiary-ledger` | 指定した補助科目の明細・残高 |
| [補助残高一覧表](subsidiary-balance.md) | `/subsidiary-balance` | 補助科目別の残高と親科目別の小計 |
| [消費税集計表](tax-summary.md) | `/tax-summary` | 指定日付範囲の税区分別・借貸別の金額 |
| [損益計算書](income-statement.md) | `/income-statement` | 法人・個人別の損益と前期比較 |
| [貸借対照表](balance-sheet.md) | `/balance-sheet` | 法人・個人別の期末残高と前期比較 |
| [CSVインポート](csv-import.md) | `/csv-import` | CSVの読み込み・未処理データの確認・本登録 |
| [期首残高](opening-balances.md) | `/opening-balances` | 期別の自動導出・手動設定・解除 |
| [設定](settings.md) | `/settings` | 会社・表示・事業者タイプ・会計期間・年度確定 |
| [勘定科目マスタ](accounts.md) | `/accounts` | 親科目・補助科目・別名の管理 |

## 会社と会計期間

画面の対象会社はヘッダーの「作業中の会社」で切り替える。当期は [設定](settings.md#会計期間の作成と変更) の「現在期」で選択する。[期首残高](opening-balances.md) は画面内で別の期を選べる。

## 印刷とPDF

仕訳日記帳と8つの帳票に「印刷」と「PDF」がある。「印刷」は表示中の画面をブラウザーで印刷する。「PDF」は対象期などの条件を送信し、サーバーで帳票を作成してダウンロードする。PDFの会社と期名は対象期から決まり、別会社の比較期は400、存在しないか別会社の科目は404を返す。

データ構造、書き込みの制約、権限については [データベース](../20-database/README.md) を参照する。
