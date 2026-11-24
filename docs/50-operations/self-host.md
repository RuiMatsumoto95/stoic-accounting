---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [README.md, .env.example, package.json, lib/supabase.ts, lib/yayoi-tax.ts, lib/tax-codes.ts, app/settings/page.tsx, supabase/schema.sql]
related: [README.md, backup-restore.md, ../10-architecture/security.md, ../20-database/migrations.md, ../60-testing/README.md]
---

# 自己ホストの前提と確認範囲

空のSupabaseプロジェクトから画面を使える状態まで構築する手順は未整備です。先にコードやテストを確認する場合は、DB接続なしで実行できる手順を使えます。 [VitestとCI](../60-testing/vitest-and-ci.md)

## 試用DBを用意済みの場合

現行の定義と税区分マスタを用意した、架空データでの試用専用のSupabase環境が前提です。アプリを手元で起動しても、この接続先にデータを保存します。現在の利用範囲は [リポジトリのREADME](../../README.md) を参照してください。

1. リポジトリのルートで `npm ci` を実行します。
2. `.env.example` を `.env.local` としてコピーし、試用環境の `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定します。`.env.local` はGitの追跡対象外です。 [ブラウザーとサーバーの接続](../10-architecture/security.md#ブラウザーとサーバーの接続)
3. `npm run dev` を実行し、ターミナルに表示された手元のURLで `/journals` を開きます。架空データで、会社の作成、当期の選択、仕訳保存、元帳やPDFでの確認を行います。CSVと税区分を使う場合は、税区分の候補、CSV本登録、税区分別の集計も確認します。 [ブラウザーでの確認](../60-testing/manual-verification.md)

## 空の環境から再現するときに残っていること

| 項目 | 残っている確認・整備 |
| --- | --- |
| 税区分マスタ | `schema.sql` には表の定義を収録しています。`tax_codes` の初期データの投入は未整備です。マスタが空だと仕訳の候補や消費税集計に出ず、税区分を指定するCSVは参照制約に従って拒否されます。 |
| スキーマの適用 | `schema.sql` は、psqlの制限開始・解除のメタコマンド2行を除いた定義ダンプです。定義ダンプの適用はpsqlを前提とします。初期状態の `public`、ダンプが参照するロール、既定権限の差を考慮し、環境に合った適用方法が必要です。 [ダンプの収録手順](db-change-procedure.md#定義ダンプをリポジトリへ収録する) |
| Supabaseでの再確認 | 新規プロジェクトの設定によるRLS・権限の差を確認し、アプリが使うロールから会社作成・保存・帳票を検証する作業が残っています。 |

旧検証記録では、隔離したPostgreSQLとAPI層を使い、会社作成・仕訳保存・主要帳票まで確認しました。新規Supabaseへの適用は未確認です。 [RLSと権限](../20-database/security-rls.md)・[手動マイグレーション](../20-database/migrations.md)
