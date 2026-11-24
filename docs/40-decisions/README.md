---
status: 現行
verified: 2026-11-24 @ 2e76288
code: []
related: [../README.md, ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0012, ADR-0013, ADR-0014, ADR-0015]
---

# 設計判断（ADR）

採用した案、検討した別案、採用理由、実装への影響を1件ずつ記録する。日付は決定記録の日付を使い、決定日そのものが確認できない場合は、採用を確認できる報告・実装記録の日付を使う。

| ADR | 判断 | 決定・記録日 |
| --- | --- | --- |
| [ADR-0001](ADR-0001-deferred-journal-balance.md) | 借貸一致を遅延制約で保証する | 2026-11-01 |
| [ADR-0002](ADR-0002-atomic-journal-save.md) | 仕訳保存をRPCで原子化する | 2026-11-01 |
| [ADR-0003](ADR-0003-journal-numbering-lock.md) | 伝票番号を会計期単位で採番する | 2026-11-10 |
| [ADR-0004](ADR-0004-company-composite-foreign-keys.md) | 会社をまたぐ参照を複合外部キーで防ぐ | 2026-11-12 |
| [ADR-0005](ADR-0005-incorporation-new-company.md) | 法人成りでは法人を別会社として作る | 2026-11-13 |
| [ADR-0006](ADR-0006-owner-accounts-carry-forward.md) | 事業主貸借は区分、繰越先は会社の参照で持つ | 2026-11-12 |
| [ADR-0007](ADR-0007-derive-opening-balances.md) | 期首残高は自動導出し、任意の期で手動固定できる | 2026-11-14 |
| [ADR-0008](ADR-0008-opening-balances-separate-storage.md) | 手動期首残高は専用テーブルに保存する | 2026-11-14 |
| [ADR-0009](ADR-0009-period-close-order.md) | 年度確定は期単位で古い期から進める | 2026-11-15 |
| [ADR-0010](ADR-0010-period-close-trigger-checks.md) | 確定前の必須チェックをDBトリガーで強制する | 2026-11-15 |
| [ADR-0011](ADR-0011-ime-independent-journal-input.md) | 日付・科目・金額をIMEに依存せず入力する | 2026-11-07 |
| [ADR-0012](ADR-0012-journal-change-history.md) | 仕訳の訂正削除履歴に変更前の明細を残す | 2026-11-01 |
| [ADR-0013](ADR-0013-apache-license.md) | ソースコードにApache-2.0を採用する | 2026-11-18 |
| [ADR-0014](ADR-0014-clean-public-repository.md) | 公開用リポジトリを新規に作り、旧履歴と内部資料を非公開で保管する | 2026-11-18 |
| [ADR-0015](ADR-0015-source-before-hosted-demo.md) | ソース公開を先に進め、認証・デモは後の段階に置く | 2026-11-18 |

現行の実装仕様は [データベース](../20-database/README.md)、[画面別の機能](../30-features/README.md)、[アーキテクチャ](../10-architecture/README.md) を参照。
