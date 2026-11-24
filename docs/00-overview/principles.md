---
status: 現行
verified: 2026-11-24 @ 1e6a903
code: [components/journals/InlineJournalForm.tsx, lib/ime-free-input.ts, lib/journal-save.ts, lib/csv-import.ts, lib/financial-statements.ts, supabase/schema.sql, README.md, LICENSE]
related: [README.md, glossary.md, ../40-decisions/README.md, ../70-ideas/backlog.md]
---

# 理念と設計の変遷

## 対象と目標

日常的に複式簿記を使う担当者が、入力と確認にかける時間を減らし、誤りを見つけやすくし、必要なデータを手元に持ち出せることを目指します。開発当初は作者自身の記帳を起点とし、その後の資料では、小さな利用者層が継続して使える正確さと保守性を目標に据えました。

対象とする作業は、仕訳の入力・訂正、帳簿・決算書の確認、CSVによるデータの受け渡しです。請求・営業管理、給与計算、申告書作成や電子申告、銀行・カードのリアルタイム連携、証憑原本の保管は製品の対象外とする方針です。明細CSVの取り込みや、外部で保管した証憑への参照は、必要に応じて検討します。 [アイデアのバックログ](../70-ideas/backlog.md)

## 理念が形になるまで

| 時期 | その時点の考え方と変更 |
| --- | --- |
| 初期設計・2026年4月の計画 | 作者が使い慣れた記帳の流れをブラウザーで実現する構想。日々使う機能に絞り、仕訳日記帳を中心に元帳と試算表を組み立て、外部データはCSVで受け渡す方針を置いた。期首残高や自動繰越の記録に通常仕訳を使う案もあった。 |
| 2026年11月1日 | 保存の成否が仕訳全体でそろうよう、画面の分割更新を保存RPCにまとめた。貸借一致などはDBで検証し、訂正・削除の記録には変更前の明細を残す方式を採用した。 [保存](../40-decisions/ADR-0002-atomic-journal-save.md)・[貸借一致](../40-decisions/ADR-0001-deferred-journal-balance.md)・[変更履歴](../40-decisions/ADR-0012-journal-change-history.md) |
| 2026年11月3日以降 | 簿記を知る実務者が迷わず操作できるよう、見慣れた用語、キーボードで完結する記帳、入力結果とエラーの明示を方針として整理した。CSVの設定とルールによる候補作成は将来案として記録し、仕訳入力では日本語入力を有効にしたまま日付・科目・金額を扱う方式を採用した。 [仕訳入力の設計判断](../40-decisions/ADR-0011-ime-independent-journal-input.md) |
| 2026年11月12〜15日 | 複数会社と法人・個人を扱うため、科目や仕訳の会社の一致をDBでも検証するようにした。期首残高は過去の仕訳などから導出し、手動設定は専用の表に保存する方式に決めた。年度の確定順序と、確定後の変更制限をDBに加えた。 [会社の一致](../40-decisions/ADR-0004-company-composite-foreign-keys.md)・[期首残高の導出](../40-decisions/ADR-0007-derive-opening-balances.md)・[手動設定](../40-decisions/ADR-0008-opening-balances-separate-storage.md)・[年度の確定順序](../40-decisions/ADR-0009-period-close-order.md) |
| 2026年11月18日 | Apache License 2.0でソースを先に公開し、認証や公開デモは後の段階に置く方針を選んだ。 [ライセンス](../40-decisions/ADR-0013-apache-license.md)・[公開の順序](../40-decisions/ADR-0015-source-before-hosted-demo.md) |

## 現在の設計原則

- **記帳の流れを短くする。** 日付や科目をキーボードで入力し、仕訳日記帳の一覧で確認・訂正できる。画面は入力形式、保存結果、エラーの理由をその場で伝えることを重視する。 [仕訳日記帳](../30-features/journals.md)・[エラー処理](../10-architecture/error-handling.md)
- **帳簿の根拠をたどれるようにする。** 帳票は仕訳明細と期首残高を根拠に集計する。CSVの確認中データと本登録済みの仕訳は分けて扱う。貸借一致、対象期、確定済みの期への変更制限をDBでも検証する。 [DB関数とRPC](../20-database/functions-rpc.md)・[トリガーと制約](../20-database/triggers-constraints.md)
- **会計項目の意味を保つ。** 日付・科目・借貸・金額・会計期・税区分を明示して扱う。取引先などの追加属性を検討する場合は、入力の手間と持ち出し時の互換性も評価する。 [テーブルとビュー](../20-database/tables.md)・[取込とデータのバックログ](../70-ideas/backlog.md#csv取込とデータの持ち出し)
- **持ち出しや再現性を重視する。** 現在の出力は仕訳CSVと帳票PDF。将来の出力形式は、利用者が他の道具でデータを再利用できるか、移行や復元を検証できるかで評価する。 [仕訳日記帳の出力](../30-features/journals.md#出力)・[PDF](../10-architecture/pdf.md)

CSVから取引を分類する機能を検討するときは、列の割り当てや再現可能なルールから始めます。AIを使う案でも出力は仕訳候補とし、確定には人の確認と既存の会計上の検証を通す、というのが旧資料に記録された方針です。 [CSV取込のバックログ](../70-ideas/backlog.md#csv取込とデータの持ち出し)
