---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [app/journals/page.tsx, app/settings/page.tsx, app/csv-import/page.tsx, app/opening-balances/page.tsx, lib/financial-statements.ts, lib/csv-export.ts, lib/supabase.ts, supabase/schema.sql]
related: [principles.md, glossary.md, ../30-features/README.md, ../10-architecture/security.md]
---

# ストイック会計の概要

ストイック会計は、複式簿記を使う会計実務者が、ブラウザーで仕訳を入力し、帳簿を確認し、記録を持ち出すための会計ソフトの試作です。法人と個人事業の科目・決算書の様式を扱い、同じ環境で作業中の会社を切り替えます。

## 日々の記帳から年度の確定まで

| 作業 | できること |
| --- | --- |
| 記帳 | 仕訳日記帳で単純・複合仕訳を入力・訂正・複製します。CSVは独自形式と弥生形式の単純仕訳を確認してから本登録します。 [仕訳日記帳](../30-features/journals.md)・[CSVインポート](../30-features/csv-import.md) |
| 確認 | 元帳、残高試算表、補助残高、税区分別の集計、損益計算書・貸借対照表を確認します。損益計算書・貸借対照表には前期比較があります。 [画面一覧](../30-features/README.md#画面一覧) |
| 年度 | 期首残高は過去の仕訳などから導出し、必要に応じて期ごとに手動設定します。年度を確定すると仕訳と期首残高の変更が止まります。 [期首残高](../30-features/opening-balances.md)・[設定](../30-features/settings.md#年度の確定と解除) |
| 出力 | 仕訳日記帳の一覧をCSVで出力し、帳簿・決算書はPDFで確認・保存できます。仕訳CSVの出力列は取込用の独自形式と異なり、税区分を含みません。 [仕訳日記帳の出力](../30-features/journals.md#出力)・[PDF](../10-architecture/pdf.md) |

認証と利用者ごとのアクセス制御は未実装です。試用には架空データを使い、アプリを公開URLに配置しないでください。ブラウザーを手元で開いても、データは接続先のSupabaseに保存されます。利用範囲は [リポジトリのREADME](../../README.md) と [セキュリティの現状](../10-architecture/security.md) で確認できます。

## 関連文書

- [理念と設計の変遷](principles.md)
- [用語集](glossary.md)
- [設計判断の記録](../40-decisions/README.md)
- [アイデアのバックログ](../70-ideas/backlog.md)
