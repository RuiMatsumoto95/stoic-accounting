---
status: 現行
verified: 2026-11-24 @ 95645b1
code: [app/api/pdf, lib/reports, lib/financial-statements.ts, lib/report-pagination.ts, lib/individual-statement-rows.ts, lib/pdf, components/pdf, components/print/PrintButton.tsx, app/globals.css, public/fonts, __tests__/report-scope-pdf-d.test.ts, __tests__/financial-pdf-render-d.test.ts]
related: [README.md, tech-stack.md, company-scope.md, error-handling.md, security.md, ../30-features/README.md]
---

# PDF生成

PDFは帳票の条件をもとにサーバーで仕訳などを取得し、Node.jsランタイムで生成する。ブラウザーの「印刷」は `window.print()` を呼び、画面と印刷用CSSを使う。

## 生成の流れ

1. 画面が会計期・科目・日付範囲などの条件をURLに組み立てる。`PDFButton` はそのURLを `fetch` し、生成中はボタンを無効にする。
2. `app/api/pdf/` の各GETルートが必須パラメーターを確認する。[帳票の所属確認](../../lib/reports/scope.ts) で対象期の会社を求め、渡された比較期と科目がその会社に属することを確認する。期名はDBから取得する。
3. `lib/reports/` の処理が帳票のデータを組み立てる。損益計算書・貸借対照表は、対象期の会社が法人か個人かで計算と文書定義を切り替える。個人の財務諸表は見出し・科目行・小計を画面とPDFで共用する。
4. `lib/pdf/fonts.ts` が同梱のNoto Sans CJK JP Regular 2.004を登録する。フォントは `public/fonts/NotoSansJP-Regular.otf` から読み込み、モジュール内で重複登録を防ぐ。ライセンスは [SIL Open Font License 1.1](../../public/fonts/OFL.txt)。
5. `components/pdf/documents/` の文書を `renderToBuffer()` でPDFに変換し、`application/pdf` と `Content-Disposition: attachment` を返す。`PDFButton` は応答をBlobにしてブラウザーでダウンロードし、ページから渡されたファイル名を使う。

## ルート一覧

全ルートで `periodId` が必須。下表は帳票の生成条件で、共通の所属確認は、比較期の `prevPeriodId` や科目の `accountId` が指定されたときに全ルートで実行する。

| PDFのルート | 期ID以外の生成条件 | 文書 |
| --- | --- | --- |
| [`/api/pdf/journal`](../../app/api/pdf/journal/route.ts) | 任意の `dateFrom`、`dateTo`、`keyword`、`accountId`、`amountMin`、`amountMax` | `JournalDocument` |
| [`/api/pdf/ledger`](../../app/api/pdf/ledger/route.ts) | `accountId`、`accountType` が必須 | `LedgerDocument` |
| [`/api/pdf/trial-balance`](../../app/api/pdf/trial-balance/route.ts) | `filterTypes=bs` で資産・負債・純資産に限定。`tab` で補助科目の表示を切り替え | `TrialBalanceDocument` |
| [`/api/pdf/pl-trial-balance`](../../app/api/pdf/pl-trial-balance/route.ts) | 収益・費用に固定。`tab` で補助科目の表示を切り替え | `TrialBalanceDocument` |
| [`/api/pdf/subsidiary-ledger`](../../app/api/pdf/subsidiary-ledger/route.ts) | `accountId`、`accountType` が必須 | `SubsidiaryLedgerDocument` |
| [`/api/pdf/subsidiary-balance`](../../app/api/pdf/subsidiary-balance/route.ts) | 追加条件なし | `SubsidiaryBalanceDocument` |
| [`/api/pdf/tax-summary`](../../app/api/pdf/tax-summary/route.ts) | `startDate`、`endDate` が必須 | `TaxSummaryDocument` |
| [`/api/pdf/income-statement`](../../app/api/pdf/income-statement/route.ts) | 任意の `prevPeriodId`。`showPrev=true`、`hideZero=true` で表示を切り替え | `PLDocument`／`IndividualPLDocument` |
| [`/api/pdf/balance-sheet`](../../app/api/pdf/balance-sheet/route.ts) | 任意の `prevPeriodId`。`showPrev=true`、`hideZero=true` で表示を切り替え | `BSDocument`／`IndividualBSDocument` |

## 表示と制約

- 文書はA4。仕訳日記帳・総勘定元帳・補助元帳は横向き。共通ヘッダーは表題と期名を、共通フッターはページ番号と総ページ数を表示する。
- 仕訳日記帳は表題・期名・検索条件・列見出しを各ページに繰り返し、各表示行を改ページで分断しない。金額範囲は検索に適用するが、検索条件欄には印字しない。補足もPDFには含まない。
- 総勘定元帳と補助元帳は、レスポンスヘッダーのファイル名に使う科目名を `encodeURIComponent` でエンコードする。他のルートは固定ファイル名を返す。
- 仕訳日記帳の金額範囲は `Number()` で変換する。ルートと集計処理には、その値が有限かを明示的に検証する処理がない。元帳2ルートの `accountType` は、必須確認後にクエリの値を集計へ渡す。
- 入力不足は400。別会社の比較期は400、存在しない期や対象期の会社にない科目は404。捕捉したエラーはその内容をJSONの `error` で返す。描画時のエラーをJSONに変換する処理は一部のルートにあり、損益計算書・貸借対照表・残高試算表2本には専用の捕捉処理がない。

[ルートの所属確認テスト](../../__tests__/report-scope-pdf-d.test.ts) は描画器を差し替えて9本を確認する。[描画のテスト](../../__tests__/financial-pdf-render-d.test.ts) は、同梱フォントで法人・個人の損益計算書と貸借対照表を生成する。
