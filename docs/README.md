---
status: 現行
verified: 2026-11-xx @ <コミットの短縮ハッシュ>
code: []
related: []
---

# Stoic Accounting ドキュメント索引

このフォルダが仕様・設計・判断の正本です（日本語のみ）。

| フォルダ | 内容 |
|---|---|
| [00-overview](./00-overview/) | 理念・全体像・用語 |
| [10-architecture](./10-architecture/) | 技術構成・会社スコープ・エラー処理・PDF・セキュリティの現状 |
| [20-database](./20-database/) | 表・関数・トリガー・権限・マイグレーション |
| [30-features](./30-features/) | 画面・機能ごとの仕様 |
| [40-decisions](./40-decisions/) | 設計判断の記録（ADR） |
| [50-operations](./50-operations/) | DB変更・バックアップ・リリースの手順 |
| [60-testing](./60-testing/) | テストの考え方・実機確認の範囲 |
| [70-ideas](./70-ideas/) | 未実装のアイデア |
| [90-notes](./90-notes/) | 未検証のメモ（公開してよい内容のみ） |
| [roadmap.md](./roadmap.md) | 公開ロードマップ（状態表） |

## 書き方の約束

- 00〜60 のファイルは先頭にヘッダー（`status` / `verified` / `code` / `related`）を付ける。雛形は [_templates](./_templates/)。
- `verified` は「その内容をコードで確認した日とコミット」。コードが変わったら更新する。
- `code` には根拠のファイルを書く。コード変更時に、影響する docs を逆引きできる。
- 版管理は Git で行う（ファイル名に版を付けない）。
- 70・90 は未検証でよい。私的な内容・個人情報・パスは書かない。
- 確認コマンド: `node scripts/check-docs.mjs`（ずれの検出は `--drift`）
