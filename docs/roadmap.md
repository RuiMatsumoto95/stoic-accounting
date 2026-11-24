---
status: 現行
verified: 2026-11-24 @ 577ae8c
code: [README.md, SECURITY.md, CONTRIBUTING.md, LICENSE, package.json, .github/workflows/test.yml, app, lib, supabase/schema.sql, supabase/manual-migrations]
related: [README.md, ../CHANGELOG.md, 40-decisions/ADR-0015-source-before-hosted-demo.md, 50-operations/release.md, 70-ideas/backlog.md]
---

# 公開ロードマップ

ソースの公開を先に進め、公開デモ、帳票の拡充、自己ホストと共同利用を段階的に検討します。表は現段階の状態と次の目標を示します。公開日や着手日は未定です。 [ソース公開とデモの設計判断](40-decisions/ADR-0015-source-before-hosted-demo.md)

| 段階 | 状態 | 現在地・次の目標 |
| --- | --- | --- |
| ソース公開 | 準備中 | Apache License 2.0、利用範囲、報告窓口、CI、仕様・設計判断・手順を用意。ソースの公開前点検を進める。現段階の利用範囲は架空データでの試用。 [公開の手順](50-operations/release.md) |
| 閲覧専用デモ | 未実装 | 架空データで仕訳や帳票を閲覧できる環境と、DBまで含めた読み取り専用の権限を整える。初回の画面案内、訂正・削除履歴の閲覧、決算書CSVも候補。 [バックログ](70-ideas/backlog.md) |
| 帳票とデータ持ち出し | 一部実装 | 損益計算書と貸借対照表の前期比較、仕訳CSV、帳票PDFは実装済み。帳簿チェック、月次推移、比較対象・帳票の拡大、会社単位と弥生形式のエクスポートを検討する。 [会計期と帳票](70-ideas/backlog.md#会計期と帳票)・[CSV取込とデータの持ち出し](70-ideas/backlog.md#csv取込とデータの持ち出し) |
| 自己ホスト | 構築手順を準備中 | 既存の試用DBに接続する方法を記載済み。空のSupabaseでの定義と税区分マスタの初期化、アプリでの一連の確認、SQLテストの自動実行が残る。 [自己ホストの前提](50-operations/self-host.md) |
| 認証と共同利用 | 未実装 | 利用者ごとの会社と操作の権限、PDFのアクセス制御、履歴に残す操作者と変更の扱いを整える。招待制で入力できる環境はこれらの検証後の候補。 [セキュリティの現状](10-architecture/security.md) |
| 試用・公開デモの環境構成 | 提案・未承認 | 試用と公開デモをそれぞれ別のSupabaseプロジェクトに分ける2プロジェクト構成は検討案。 |

決算整理仕訳、既存CSVの取り込み精度、大量データを扱う帳票の検証などの候補は、現行実装との差分とともにバックログに記録します。実装・変更済みの内容は変更履歴を参照してください。 [アイデアのバックログ](70-ideas/backlog.md)・[変更履歴](../CHANGELOG.md)
