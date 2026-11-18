-- 1a（20261112120000_company_support.sql）適用後のDBが前提。
-- 先に 20261104180000_add_entry_supplement.sql をSQL Editorで実行する。
-- このファイル全体を実行し、ERROR: TEST RESULT: ALL PASSED を確認する。
-- 最後の意図的な例外により、期間・科目・仕訳・履歴をすべてロールバックする。
-- ALL PASSED 以外のエラーは成功と判断しない。

do $test$
declare
  v_company uuid;
  v_period uuid;
  v_cash uuid;
  v_sales uuid;
  v_entry uuid;
  v_empty_entry uuid;
  v_lines jsonb;
  v_text text;
  v_count integer;
  v_before_count integer;
  v_total integer := 0;
  v_fails text[] := '{}';
  v_function text;
  v_signature text;
  v_role text;
  v_oid oid;
begin
  -- 既存会社・当期を使わず、このDOブロック内の架空の会社だけで準備する。
  insert into public.companies (name, kind, tax_method)
  values ('ZZSUPP' || replace(gen_random_uuid()::text, '-', ''), 'CORPORATION', 'EXEMPT')
  returning id into v_company;

  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current)
  values (v_company, 'ZZSUPP 2100年3月期', '2099-04-01', '2100-03-31', false)
  returning id into v_period;

  insert into public.accounts (company_id, code, name, type)
  values (v_company, 'ZZSUPP-CASH', '補足テスト現金', 'ASSET') returning id into v_cash;
  insert into public.accounts (company_id, code, name, type)
  values (v_company, 'ZZSUPP-SALES', '補足テスト売上', 'REVENUE') returning id into v_sales;

  v_lines := jsonb_build_array(
    jsonb_build_object('side', 'DEBIT', 'account_id', v_cash, 'amount', '1000', 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', v_sales, 'amount', '1000', 'tax_code', null)
  );

  v_total := v_total + 1;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'journal_entries'
      and column_name = 'supplement' and data_type = 'text' and is_nullable = 'YES'
  ) then
    v_fails := array_append(v_fails, 'COLUMN: supplement は nullable text であること');
  end if;

  -- 旧5引数呼び出しは、6番目の引数の DEFAULT NULL で動く。
  v_total := v_total + 1;
  v_empty_entry := (public.create_journal_entry(v_period, '2099-05-01', 'ZZSUPP 旧新規', null, v_lines)->>'id')::uuid;
  select supplement into v_text from public.journal_entries where id = v_empty_entry;
  if v_text is not null then
    v_fails := array_append(v_fails, 'CREATE-5: 旧5引数で補足なしの仕訳を作成できること');
  end if;

  v_total := v_total + 1;
  v_entry := (public.create_journal_entry(v_period, '2099-05-01', 'ZZSUPP NULL', null, v_lines, null)->>'id')::uuid;
  select supplement into v_text from public.journal_entries where id = v_entry;
  if v_text is not null then
    v_fails := array_append(v_fails, 'CREATE-NULL: NULL は NULL で保存されること');
  end if;

  v_total := v_total + 1;
  v_entry := (public.create_journal_entry(v_period, '2099-05-01', 'ZZSUPP 空文字', null, v_lines, '')->>'id')::uuid;
  select supplement into v_text from public.journal_entries where id = v_entry;
  if v_text is not null then
    v_fails := array_append(v_fails, 'CREATE-EMPTY: 空文字は NULL で保存されること');
  end if;

  v_total := v_total + 1;
  v_entry := (public.create_journal_entry(v_period, '2099-05-01', 'ZZSUPP 補足あり', 1000, v_lines, '補足 A')->>'id')::uuid;
  select supplement into v_text from public.journal_entries where id = v_entry;
  select count(*) into v_count from public.journal_entry_logs where entry_id = v_entry;
  if v_text is distinct from '補足 A' or v_count <> 0 then
    v_fails := array_append(v_fails, 'CREATE-TEXT: 補足 A が保存され、新規作成の訂正履歴は0件であること');
  end if;

  v_total := v_total + 1;
  perform public.update_journal_entry(v_entry, '2099-05-02', 'ZZSUPP NULL更新', 1000, v_lines, null);
  select supplement into v_text from public.journal_entries where id = v_entry;
  if v_text is distinct from '補足 A' then
    v_fails := array_append(v_fails, 'UPDATE-NULL: NULL で既存の補足 A が保たれること');
  end if;

  v_total := v_total + 1;
  perform public.update_journal_entry(v_entry, '2099-05-03', 'ZZSUPP 旧更新', 1000, v_lines);
  select supplement into v_text from public.journal_entries where id = v_entry;
  if v_text is distinct from '補足 A' then
    v_fails := array_append(v_fails, 'UPDATE-5: 旧5引数で既存の補足 A が保たれること');
  end if;

  select count(*) into v_before_count from public.journal_entry_logs where entry_id = v_entry;
  v_total := v_total + 1;
  perform public.update_journal_entry(v_entry, '2099-05-04', 'ZZSUPP Bへ更新', 1000, v_lines, '補足 B');
  select supplement into v_text from public.journal_entries where id = v_entry;
  if v_text is distinct from '補足 B' then
    v_fails := array_append(v_fails, 'UPDATE-TEXT: 補足 A を補足 B に変更できること');
  end if;

  v_total := v_total + 1;
  select count(*) into v_count from public.journal_entry_logs where entry_id = v_entry;
  if v_count <> v_before_count + 1 or not exists (
    select 1 from public.journal_entry_logs
    where entry_id = v_entry and action = 'UPDATE'
      and before_data->'entry'->>'description' = 'ZZSUPP 旧更新'
      and before_data->'entry'->>'supplement' = '補足 A'
      and jsonb_array_length(before_data->'lines') = 2
  ) then
    v_fails := array_append(v_fails, 'LOG: A→B の変更前の補足 A と全明細が、1件の履歴に残ること');
  end if;

  v_total := v_total + 1;
  perform public.update_journal_entry(v_entry, '2099-05-05', 'ZZSUPP 補足削除', 1000, v_lines, '');
  select supplement into v_text from public.journal_entries where id = v_entry;
  if v_text is not null then
    v_fails := array_append(v_fails, 'UPDATE-EMPTY: 空文字で既存の補足が消えること');
  end if;

  v_total := v_total + 1;
  perform public.update_journal_entry(v_empty_entry, '2099-05-02', 'ZZSUPP 補足追加', null, v_lines, '新しい補足');
  select supplement into v_text from public.journal_entries where id = v_empty_entry;
  if v_text is distinct from '新しい補足' then
    v_fails := array_append(v_fails, 'UPDATE-ADD: 補足なしの仕訳に補足を追加できること');
  end if;

  foreach v_function in array array['create_journal_entry', 'update_journal_entry'] loop
    v_signature := 'public.' || v_function || '(uuid,date,text,integer,jsonb,text)';
    v_oid := to_regprocedure(v_signature);

    v_total := v_total + 1;
    if to_regprocedure('public.' || v_function || '(uuid,date,text,integer,jsonb)') is not null
       or not exists (
         select 1 from pg_proc
         where oid = v_oid and not prosecdef
           and proconfig @> array['search_path=public']
           and pronargdefaults = 1 and proargnames[6] = 'p_supplement'
       ) then
      v_fails := array_append(v_fails, v_function || ': 旧定義を削除し、INVOKER・search_path・末尾の省略可能引数を維持すること');
    end if;

    foreach v_role in array array['anon', 'authenticated'] loop
      v_total := v_total + 1;
      if v_oid is null or not has_function_privilege(v_role, v_oid, 'EXECUTE') then
        v_fails := array_append(v_fails, v_function || ': ' || v_role || ' に EXECUTE 権限があること');
      end if;
    end loop;

    v_total := v_total + 1;
    if v_oid is null or exists (
      select 1 from pg_proc p,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      v_fails := array_append(v_fails, v_function || ': PUBLIC に EXECUTE 権限を付けないこと');
    end if;
  end loop;

  -- 最後の例外では COMMIT されないため、遅延制約もここで確認する。
  v_total := v_total + 1;
  begin
    set constraints trg_journal_lines_balance, trg_journal_entries_balance immediate;
  exception when others then
    v_fails := array_append(v_fails, 'BALANCE: ' || sqlerrm);
  end;

  if cardinality(v_fails) = 0 then
    raise exception 'TEST RESULT: ALL PASSED (%/%) — この例外はテストデータを消すための意図的なものです', v_total, v_total;
  else
    raise exception 'TEST RESULT: FAILED (%/%)', cardinality(v_fails), v_total
      using detail = array_to_string(v_fails, E'\n');
  end if;
end;
$test$;
