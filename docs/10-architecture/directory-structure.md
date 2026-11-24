---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [app, actions, contexts, components, lib, public, supabase, __tests__, scripts, next.config.ts, tsconfig.json, vitest.config.mts, .github/workflows/test.yml]
related: [README.md, tech-stack.md, company-scope.md, pdf.md, ../30-features/README.md, ../20-database/README.md]
---

# ディレクトリ構成

構成はGitの追跡ファイルに基づく。`node_modules/` と `.next/` などの生成物は含めない。

```text
app/
  layout.tsx, globals.css      共通レイアウトとスタイル
  各画面/page.tsx              画面の入口（13画面）
  api/pdf/*/route.ts           PDFの取得先（9本）
actions/                       会社・会計期間のServer Actions
contexts/                      表示設定・作業中の会社・当期のContext
components/
  journals/, csv-import/       仕訳とCSV取り込みのUI
  settings/, opening-balances/ 設定と期首残高のUI
  ledger/, tax-summary/        元帳と消費税集計表のUI
  financial-statements/        法人・個人の財務諸表のUI
  layout/, ui/                 ナビゲーションと汎用UI部品
  print/, pdf/                 印刷・PDFボタンとPDF文書
lib/
  reports/                     帳票の取得・集計と所属確認
  pdf/                         フォント登録とPDF向け表示関数
  直下のモジュール               DB接続、業務ロジック、入力処理など
public/fonts/                  PDF用の同梱フォントとライセンス
supabase/
  schema.sql                   publicスキーマの定義
  manual-migrations/           手動適用SQL・テストSQL・適用記録
__tests__/                     Vitestのテストと補助ファイル
.github/workflows/test.yml     CIのテスト・型チェック
scripts/check-docs.mjs         文書のヘッダー・リンク・コードのずれを検査
docs/                          仕様・設計・運用などの文書
```

## 処理を追う入口

| 変更・調査の対象 | 主に見るファイル |
| --- | --- |
| 画面やナビゲーション | `app/<画面>/page.tsx` と `components/<機能>/`。ナビゲーションは [NavLinks.tsx](../../components/layout/NavLinks.tsx)。ルート `/` は [Next.js設定](../../next.config.ts) で `/journals` へリダイレクトする。 |
| ブラウザーで共有する状態 | [app/layout.tsx](../../app/layout.tsx) が、表示設定 → 会社 → 会計期 → トースト通知の順でProviderを組み立てる。 |
| 書き込み | `actions/` は会社選択・作成・アーカイブと会計期間管理のServer Actions。仕訳保存・CSV本登録・期首残高の処理は `lib/` の関数からSupabaseのRPCを呼ぶ。保存の制約は [データベース](../20-database/README.md)。 |
| 帳票とPDF | `lib/reports/` の取得・集計処理、`app/api/pdf/` のルート、`components/pdf/` の文書定義を追う。画面ごとの入口は [画面別の機能](../30-features/README.md)。 |
| テンプレート | DB定義と [journal-templates.ts](../../lib/journal-templates.ts) が残る。現在の仕訳入力と設定にテンプレート画面はない。 |

ルートの `package.json` と `package-lock.json` が実行コマンドと依存関係を定義する。`next.config.ts`、`tsconfig.json`、`postcss.config.mjs`、`eslint.config.mjs`、`vitest.config.mts` はそれぞれの実行・開発設定。
