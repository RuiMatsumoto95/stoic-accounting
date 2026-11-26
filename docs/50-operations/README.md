---
status: 現行
verified: 2026-11-26 @ 361f869
code: [README.md, CLAUDE.md, .github/workflows/test.yml, supabase/schema.sql, supabase/manual-migrations]
related: [db-change-procedure.md, backup-restore.md, self-host.md, release.md, ../60-testing/README.md]
---

# 運用手順

| 作業 | 手順 |
| --- | --- |
| 既存DBの定義を変更する | [DB変更の手順](db-change-procedure.md) |
| データを保全し、戻せるか確かめる | [バックアップと復元](backup-restore.md) |
| 試用環境を準備する | [自己ホストの前提と確認範囲](self-host.md) |
| ソースの公開・リリースを準備する | [ソースを公開する手順](release.md) |

現行アプリは架空データによる手元での試用が対象です。認証・利用者ごとのアクセス制御は未実装です。試用環境の準備や復元では、接続先とデータの範囲を先に確認してください。 [セキュリティの現状](../10-architecture/security.md)・[利用上の注意](../../README.md)

変更内容に応じた検証は [テストの考え方](../60-testing/README.md) を参照してください。
