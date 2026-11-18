-- 先に 20261112150000_company_archive.sql を SQL Editor で実行する。
-- このファイル全体を実行し、ERROR: TEST RESULT: ALL PASSED を確認する。
-- 最後の意図的な例外により、作った会社・科目・期間をすべてロールバックする（ZZARCH で始まる架空データ）。
-- ALL PASSED 以外のエラー（FAILED を含む）は成功と判断しない。
-- 確認できないもの: 既存の会社の値（_apply.md の SQL で確認）、アプリ側の制限（選択中の会社は不可など）。

create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end;
$f$;

do $test$
declare
  v_total integer := 0;
  v_fails text[] := '{}';
  v_res jsonb;
  c1 uuid;
  v_flag boolean;
  v_n integer;
  v_txt text;
  v_name text := 'ZZARCH' || replace(gen_random_uuid()::text, '-', '');
begin
  -- A1: 列の定義（boolean・NOT NULL・DEFAULT false）
  v_total := v_total + 1;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'companies' and column_name = 'is_archived'
       and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'
  ) then
    v_fails := array_append(v_fails, 'A1: is_archived が boolean NOT NULL DEFAULT false であること');
  end if;

  -- A2: create_company で作った会社は未アーカイブ
  v_res := public.create_company(v_name, 'CORPORATION', 'EXEMPT', '2026-04-01', '2027-03-31');
  c1 := (v_res->>'company_id')::uuid;
  v_total := v_total + 1;
  select is_archived into v_flag from public.companies where id = c1;
  if v_flag is distinct from false then
    v_fails := array_append(v_fails, 'A2: create_company 直後は is_archived = false であること');
  end if;

  -- A3: anon ロールでアーカイブできる（UPDATE 権限）
  v_total := v_total + 1;
  begin
    set local role anon;
    update public.companies set is_archived = true where id = c1;
    get diagnostics v_n = row_count;
    reset role;
    select is_archived into v_flag from public.companies where id = c1;
    if v_n <> 1 or v_flag is distinct from true then
      v_fails := array_append(v_fails, format('A3: anon でアーカイブできること（更新行数 %s・値 %s）', v_n, v_flag));
    end if;
  exception when others then
    reset role;
    v_fails := array_append(v_fails, 'A3: anon でアーカイブできること: ' || sqlerrm);
  end;

  -- A4: アーカイブしても会社名は使用中のまま（同名の会社は作れない）
  v_total := v_total + 1;
  v_txt := pg_temp.err(format(
    'select public.create_company(%L, %L, %L, %L, %L)',
    v_name, 'CORPORATION', 'EXEMPT', '2026-04-01', '2027-03-31'));
  if left(v_txt, 5) <> '23505' then
    v_fails := array_append(v_fails, 'A4: アーカイブ済みの会社名でも重複エラー（23505）になること: ' || v_txt);
  end if;

  -- A5: アーカイブしてもデータは変わらない（初期科目 181 件・期間 1 件）
  v_total := v_total + 1;
  select count(*) into v_n from public.accounts where company_id = c1;
  if v_n <> 181 then
    v_fails := array_append(v_fails, format('A5: 科目が 181 件のまま（実際 %s 件）', v_n));
  end if;
  select count(*) into v_n from public.fiscal_periods where company_id = c1;
  if v_n <> 1 then
    v_fails := array_append(v_fails, format('A5: 期間が 1 件のまま（実際 %s 件）', v_n));
  end if;

  -- A6: NULL にはできない
  v_total := v_total + 1;
  v_txt := pg_temp.err(format('update public.companies set is_archived = null where id = %L', c1));
  if left(v_txt, 5) <> '23502' then
    v_fails := array_append(v_fails, 'A6: is_archived を NULL にすると NOT NULL 違反（23502）になること: ' || v_txt);
  end if;

  -- A7: 戻せる
  v_total := v_total + 1;
  update public.companies set is_archived = false where id = c1;
  select is_archived into v_flag from public.companies where id = c1;
  if v_flag is distinct from false then
    v_fails := array_append(v_fails, 'A7: アーカイブを戻せること');
  end if;

  -- 結果（意図的な例外ですべてロールバックする）
  if array_length(v_fails, 1) is null then
    raise exception 'TEST RESULT: ALL PASSED (% checks)', v_total;
  else
    raise exception 'TEST RESULT: FAILED (% of % checks): %', array_length(v_fails, 1), v_total, array_to_string(v_fails, E'\n');
  end if;
end;
$test$;
