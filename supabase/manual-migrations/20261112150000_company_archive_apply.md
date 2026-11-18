# 会社のアーカイブ: 適用手順

対象: `20261112150000_company_archive.sql`（変更）／ `.test.sql`（テスト・7項目）
前提: `20261112120000_company_support.sql`（ステップ1a）が適用済みであること。

## いつ適用するか
**ステップ1b 段階B の実機確認の前**（アプリが `is_archived` を読むため）。段階Aまでのアプリには影響しないので、今すぐ適用してよい。

## 手順（SQL Editor。1文ずつ実行する）
1. （任意）事前の確認:
```sql
select count(*) from companies;
```
2. `20261112150000_company_archive.sql` を**全体**実行する。途中でエラーが出れば何も変わらない。
3. `20261112150000_company_archive.test.sql` を**全体**実行し、`ERROR: TEST RESULT: ALL PASSED (7 checks)` を確認する。
   **これ以外の表示は成功と判断しない。** テストは何も残さない（最後に意図的な例外でロールバックする）。
4. 適用後の確認:
```sql
select name, kind, is_archived from companies order by created_at;
```
   すべての会社が `is_archived = false` であること。

## 戻し方（必要になった場合のみ）
```sql
alter table public.companies drop column is_archived;
```
（段階B以降のアプリを動かしている間は実行しない。アプリが読めなくなる。）

## 注意
- アーカイブは「選択の候補から隠す」だけで、アクセス制御ではない。
- 会社名はアーカイブ後も使用中のまま。同名の会社は作れない。
