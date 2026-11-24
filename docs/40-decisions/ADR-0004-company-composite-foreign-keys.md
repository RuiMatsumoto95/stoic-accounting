---
status: 採用
decided: 2026-11-12
verified: 2026-11-24 @ 2e76288
code: [supabase/schema.sql, supabase/manual-migrations/20261112120000_company_support.sql, supabase/manual-migrations/20261112120000_company_support.test.sql, lib/company-scope.ts, lib/journal-save.ts]
related: [README.md, ADR-0005, ADR-0006, ../10-architecture/company-scope.md, ../20-database/tables.md]
---

# ADR-0004 会社をまたぐ参照を複合外部キーで防ぐ


## 背景

1つのDBで複数会社の帳簿を持つと、期・仕訳・科目・テンプレートを関連付ける際に会社の一致を確認する必要がある。

## 決定

仕訳ヘッダー・明細にも `company_id` を持たせ、`(参照先ID, company_id)` で参照する。たとえば仕訳は同じ会社の期を、明細は同じ会社の仕訳と科目を参照する。挿入時に親から会社IDを補う処理と、所属会社の変更を拒否する処理にはトリガーを使う。

## 検討して採らなかった案

仕訳ヘッダーの会社を期からのみ求め、他社参照を個別のトリガーで照合する案を検討した。

## 採用理由

参照先の存在と会社の一致を一つの外部キーで宣言できる。画面、RPC、直接書き込みの経路に共通して適用でき、仕訳や明細の所属も各行から確認できる。

## 影響・制約

参照される表には `(id, company_id)` の一意制約が必要。任意の科目参照を削除時に解除する場合、`SET NULL` の対象は科目ID列だけとする。DBの制約が保証するのはデータの所属の一致で、利用者の会社へのアクセス権は未実装。

## 根拠

会社単位の設計記録と完了報告の決定1-2。SQLテストには他社の科目・期を指定した保存が拒否される項目がある。 [会社対応の変更SQL](../../supabase/manual-migrations/20261112120000_company_support.sql) [SQLテスト](../../supabase/manual-migrations/20261112120000_company_support.test.sql)
