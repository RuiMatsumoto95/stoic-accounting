---
status: 現行
verified: 2026-11-24 @ 95645b1
code: [README.md, SECURITY.md, CLAUDE.md, .env.example, .gitignore, app, actions, contexts/CompanyContext.tsx, lib/supabase.ts, lib/company-cookie.ts, lib/company-guard.ts, lib/reports/scope.ts, supabase/schema.sql, supabase/manual-migrations/20261115120000_period_close.sql]
related: [README.md, company-scope.md, error-handling.md, pdf.md, ../20-database/security-rls.md, ../20-database/triggers-constraints.md]
---

# セキュリティの現状

現行のアプリには利用者のログインや利用者ごとのアクセス制御がない。ルートREADMEで案内している利用範囲は、手元でのアプリ起動と架空データによる試用。アプリを手元で動かす場合も、データの保存先は設定したSupabaseのDB。公開URLへの配置と実データの投入は利用範囲外。 [利用上の警告](../../README.md)

## ブラウザーとサーバーの接続

- `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を `lib/supabase.ts` が読み、ブラウザーとサーバーで使うSupabaseクライアントを作る。会計期間のServer Actionsにも同じ環境変数から作るクライアントがある。いずれもanonキーを使用する。
- `.env.example` には環境変数のひな形がある。`.gitignore` は `.env.example` を除く `.env*` を追跡対象から除外する。開発ルールでは、機密値を `NEXT_PUBLIC_` 変数・コミット・ログに含めない。 [環境変数のひな形](../../.env.example) [開発ルール](../../CLAUDE.md#環境変数秘密情報)
- 画面の会社選択用Cookieは作業対象を管理する。PDFのGETルートは期と比較期・科目の所属を照合する。どちらも利用者の本人確認や所属権限を確認する処理は持たない。 [会社スコープ](company-scope.md)

## DB上の境界

| 項目 | 現行ダンプの定義 |
| --- | --- |
| RLS | 17表のうち有効12表・無効5表。15ポリシーは対象操作を許可し、利用者IDや会社IDで行を制限する条件がない。 |
| 表の権限 | `anon`／`authenticated` に業務データの読み書きが付与されている。実行できる操作は表の付与・ポリシー・制約に従う。 |
| 元帳ビュー | `ledger_view` に `security_invoker = true` の指定がなく、基表のアクセスとRLSはビュー所有者側で評価される。元帳画面は会計期と科目で絞り込む。 |
| 会社間の参照 | 複合外部キーなどで、仕訳と会計期・明細と科目の会社が一致することを検査する。 |
| 年度確定・履歴 | 確定済みの期の対象データをトリガーで保護する。確定解除のRPCにはanonの実行権限がある。履歴3表はanonのINSERTを許し、履歴の追加から操作者の真正性を保証することはできない。 |

付与内容、ポリシー名、ビューの制限は [RLS と権限](../20-database/security-rls.md) を参照。ダンプには自動RLS用の関数があるが、イベントトリガー自体の登録は含まれない。

## 入力とエラーの扱い

- 画面からの通常のDB操作はSupabaseのクエリビルダーとRPCを使う。仕訳の借貸、会計期間、年度確定状態などの保存条件は、DBの関数・制約・トリガーでも検査する。 [トリガーと制約](../20-database/triggers-constraints.md)
- CSVの解析はブラウザーで行い、中間表へ取り込み行を保存する。一部の失敗経路は例外やPostgRESTのエラーを `console.error` に渡す。エラーの表示と詳細の扱いは呼び出し元ごとに決まる。 [エラー処理](error-handling.md)
- セキュリティ上の問題の連絡方法と対応対象は、リポジトリの報告方針に記載する。 [SECURITY.md](../../SECURITY.md)
