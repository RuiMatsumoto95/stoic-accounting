---
status: 採用
decided: 2026-11-13
verified: 2026-11-24 @ 2e76288
code: [supabase/schema.sql, supabase/manual-migrations/20261112120000_company_support.sql, lib/company-operations.ts, components/settings/CompanyCreateForm.tsx, lib/opening-balances.ts]
related: [README.md, ADR-0004, ADR-0006, ADR-0007, ../30-features/settings.md, ../30-features/opening-balances.md]
---

# ADR-0005 法人成りでは法人を別会社として作る


## 背景

法人と個人では初期科目セット、財務諸表の区分、繰越先が異なる。個人の元入金や事業主貸借は法人の科目に一対一で対応しない。

## 決定

会社区分 `companies.kind` は作成後に固定する。法人成りでは個人の帳簿を残し、法人の会社と当初の会計期を別に作成する。

## 検討して採らなかった案

既存の個人会社の区分を法人へ切り替え、科目や残高を自動変換する案。残高の引き継ぎを専用機能として実装する案も、この段階では採らなかった。

## 採用理由

法人用の科目体系を別に作ると、過去の仕訳と帳票を個人の会社区分のまま保てる。対応が一意に決まらない残高は、利用者が法人側で必要な開始残高を判断できる。

## 影響・制約

個人と法人の仕訳や残高は別々に集計する。新しい会社に必要な開始残高は、後から実装された期首残高画面で手動設定できる。

## 根拠

日付はステップ1完了報告で決定1-6を確認できる日。残高の対応が一意でない点は期首残高の引継ぎ検討にも記録されている。現行のSQLでは会社作成と会社区分の変更拒否を実装する。 [会社対応の変更SQL](../../supabase/manual-migrations/20261112120000_company_support.sql)
