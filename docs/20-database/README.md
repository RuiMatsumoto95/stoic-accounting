---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [supabase/schema.sql, supabase/manual-migrations]
related: [../README.md, tables.md, functions-rpc.md, triggers-constraints.md, security-rls.md, migrations.md]
---

# データベース

[スキーマ](../../supabase/schema.sql) は2026-11-15の本番適用後に取得した `public` スキーマの定義。17表、1ビュー、57関数、45の行トリガー、15のRLSポリシーを収録する。下の各ページは、このスキーマとアプリの実装をもとに仕様を記載する。

| ページ | 内容 |
| --- | --- |
| [テーブルとビュー](tables.md) | 17表の列・キー・インデックス、会社をまたぐ参照の制約、`ledger_view` |
| [DB関数とRPC](functions-rpc.md) | 仕訳保存と採番、会社作成、期首残高、年度確定・解除、関数一覧とエラーコード |
| [トリガーと制約](triggers-constraints.md) | 借貸一致、履歴、確定後の変更ガード、CHECK、ロック順序とトリガー一覧 |
| [RLS と権限](security-rls.md) | RLSの有効状態、全ポリシー、ロールへの付与とビューの権限 |
| [手動マイグレーション](migrations.md) | 変更SQL10本の適用順、本番適用履歴、テストと適用手順への索引 |

全体の構成は [ドキュメント索引](../README.md) を参照。
