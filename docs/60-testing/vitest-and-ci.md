---
status: 現行
verified: 2026-11-24 @ 47e0a78
code: [package.json, package-lock.json, vitest.config.mts, .github/workflows/test.yml, __tests__]
related: [README.md, sql-tests.md, manual-verification.md]
---

# VitestとCI

GitHub Actionsの `test` は、`main` へのプッシュとプルリクエストで実行されます。Ubuntu・Node.js 22 で依存をインストールし、Vitestを実行してから型を検査します。ローカルで同じ手順を実行する場合も、CIと同じNode.jsのメジャー版を使えます。

```sh
npm ci
npm test
npm run typecheck
```

`npm test` は `vitest run`、`npm run typecheck` は `next typegen` に続けて `tsc --noEmit` を実行します。DB接続やアプリ用の環境変数は不要です。2026-11-24にNode.js 24.14.1で再計測し、52ファイル・1,297件の成功と型チェックの完了を確認しました。

## 確認している範囲

`vitest.config.mts` はNode環境で `__tests__/**/*.test.ts` を実行します。入力・変換・集計のテストに加え、DBクライアントなどを模擬した処理のテストがあります。

| 観点 | 確認の例 |
| --- | --- |
| 入力・操作の判定 | 日付・金額・科目のキー処理、借貸金額のコピー、一覧の並び順と表示範囲。 [キー入力のテスト](../../__tests__/ime-free-input.test.ts) |
| CSV | 独自形式・弥生形式の解析、金額と税区分、保存用の値、エクスポート。 [独自形式のテスト](../../__tests__/csv-import.test.ts)・[弥生形式のテスト](../../__tests__/csv-import-yayoi.test.ts) |
| 会社と会計期 | 取得や書き込みの対象会社、帳票の所属会社エラー、確定済みの期の保存エラー。 [会社の書き込みガード](../../__tests__/company-write-guard.test.ts)・[年度確定のエラー](../../__tests__/period-close-write-errors.test.ts) |
| 帳票とPDF | 法人・個人の損益計算書・貸借対照表の集計と、同梱フォントを使ったNode上のPDF生成。 [集計のテスト](../../__tests__/financial-statements-d.test.ts)・[PDF生成のテスト](../../__tests__/financial-pdf-render-d.test.ts) |

`現行挙動・要改善` などの名前が付いたテストは、変更前の挙動を記録するものです。改善時は、修正する範囲の期待結果とテスト名を新しい仕様に合わせます。 [CSVの日付・照合テスト](../../__tests__/csv-import-helpers.test.ts)

## 別途確認する項目

CIの対象はVitestと型チェックです。接続設定を使う `npm run build`、`npm run lint`、DBに対するSQL、実際のブラウザーでの操作は、必要な環境で実行します。PDF生成のテストはPDFバッファの生成を確認するもので、レイアウトや印刷の見た目はブラウザーやPDFビューアーで確認します。 [CI設定](../../.github/workflows/test.yml)・[SQLテスト](sql-tests.md)・[ブラウザーでの確認](manual-verification.md)
