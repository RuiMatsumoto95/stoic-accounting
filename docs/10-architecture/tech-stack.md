---
status: 現行
verified: 2026-11-24 @ 95645b1
code: [package.json, package-lock.json, next.config.ts, tsconfig.json, postcss.config.mjs, eslint.config.mjs, vitest.config.mts, .github/workflows/test.yml, .env.example, components.json, app/globals.css, lib/supabase.ts, lib/toast.tsx, lib/csv-export.ts, components/csv-import/CsvUploader.tsx, supabase/schema.sql]
related: [README.md, directory-structure.md, pdf.md, security.md, ../20-database/migrations.md]
---

# 技術スタック

Next.jsの画面からSupabase上のPostgreSQLを読み書きする。会社や会計期の状態はアプリで管理し、仕訳保存や年度確定などの整合性はDBの関数・制約で検査する。

## 主な依存関係

バージョンは [ロックファイル](../../package-lock.json) の解決結果。Node.jsはCIの指定、PostgreSQLはスキーマダンプに記録されたバージョン。

| 用途 | 技術・バージョン | 参照元 |
| --- | --- | --- |
| 実行環境 | Node.js 22、npm | [CI](../../.github/workflows/test.yml) |
| Webアプリ | Next.js 16.4.6（App Router）、React／React DOM 19.2.4 | [依存定義](../../package.json)、[ルートレイアウト](../../app/layout.tsx) |
| 型チェック | TypeScript 5.9.3。`strict`、`@/*` はリポジトリのルートを参照する。 | [TypeScript設定](../../tsconfig.json) |
| UIとスタイル | Tailwind CSS 4.2.4、shadcn/uiの `radix-nova`、Radix UI 1.4.3、Lucide React 1.14.0 | [UI設定](../../components.json)、[共通CSS](../../app/globals.css) |
| DBクライアント | `@supabase/supabase-js` 2.105.1 | [Supabaseクライアント](../../lib/supabase.ts) |
| データベース | Supabase（PostgreSQL）。ダンプ元は17.6、`pg_dump` は17.12。 | [スキーマ](../../supabase/schema.sql) |
| CSV | Papa Parse 5.5.3でブラウザー側の取り込みを解析。出力は共通関数でCSV文字列を組み立てる。 | [取り込み](../../components/csv-import/CsvUploader.tsx)、[出力](../../lib/csv-export.ts) |
| PDF | `@react-pdf/renderer` 4.5.1と同梱の日本語フォント | [PDF生成](pdf.md) |
| 開発時の検証 | Vitest 5.0.5（Node環境）、ESLint 9.39.4、Next.jsのESLint設定 16.4.6 | [Vitest設定](../../vitest.config.mts)、[ESLint設定](../../eslint.config.mjs) |

`@supabase/ssr` 0.10.2 は依存定義にある。現行のアプリのSupabaseクライアントは `@supabase/supabase-js` の `createClient` で作る。トースト通知はReact Contextを使う [共通実装](../../lib/toast.tsx) が提供する。

## 開発と検証

| コマンド | 実行内容 |
| --- | --- |
| `npm run dev` | `next dev --webpack` で開発サーバーを起動する。 |
| `npm run build`／`npm start` | `next build`／`next start`。 |
| `npm test` | `vitest run`。`__tests__/**/*.test.ts` をNode環境で実行する。 |
| `npm run typecheck` | `next typegen` に続いて `tsc --noEmit` を実行する。 |
| `npm run lint` | `eslint` を実行する。 |

CIは `main` へのpushとプルリクエストで `npm ci`、`npm test`、`npm run typecheck` を実行する。ビルド、lint、手動SQLテストはこのワークフローの対象外。

画面とPDFは [.env.example](../../.env.example) に掲載したSupabase URLとanonキーを使って設定先のDBに接続する。スキーマダンプには税区分マスタの行データは含まれない。DB構築の現状は [ルートREADMEの動かし方](../../README.md#動かし方) と [手動マイグレーション](../20-database/migrations.md) を参照。
