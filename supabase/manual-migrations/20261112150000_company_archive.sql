-- 会社のアーカイブ（最小構成）【ステップ1b 段階B の前提・DB】
--
-- 変更内容
--   companies.is_archived boolean NOT NULL DEFAULT false を追加する（これだけ）。
--
-- 意味
--   アーカイブは「通常の会社選択の候補から隠す」ための印であって、アクセス制御ではない。
--   データ（科目・期間・仕訳など）は一切変わらず、会社名もアーカイブ後は使用中のまま（companies_name_key）。
--   「選択中の会社はアーカイブできない」などの制限は、アプリ側（Server Action）で行う。
--
-- 影響
--   - 既存の会社はすべて is_archived = false になる。
--   - 定数 DEFAULT の列追加は PostgreSQL 11 以降、表の書き換えなし（メタデータのみ）。本番は PostgreSQL 17。
--   - companies には既に SELECT / INSERT / UPDATE が anon, authenticated に表単位で付与されているため、権限の追加は不要。
--   - create_company は変更不要（列の DEFAULT で false になる）。
--   - 旧アプリ（ステップ1b 段階A まで）はこの列を読まないので、適用しても動作は変わらない。
--
-- 適用: 20261112150000_company_archive_apply.md を参照。適用後は .test.sql を SQL Editor で実行し、
--   ERROR: TEST RESULT: ALL PASSED を確認する。
begin;

alter table public.companies
  add column is_archived boolean not null default false;

commit;
