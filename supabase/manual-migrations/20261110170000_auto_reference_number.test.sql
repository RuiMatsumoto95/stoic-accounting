-- 1a（20261112120000_company_support.sql）適用後のDBが前提。
-- 先に 20261110170000_auto_reference_number.sql をSQL Editorで実行する。
-- このファイル全体を実行し、ERROR: TEST RESULT: ALL PASSED を確認する。
-- 最後の意図的な例外により、期間・科目・仕訳・取込データ・履歴をすべてロールバックする。
-- ALL PASSED 以外のエラー（FAILED を含む）は成功と判断しない。
-- 確認できないもの: 同時保存・デッドロック・ロック待ち後の採番（別接続が必要）。
--   → 20261110170000_auto_reference_number_apply.md の「同時実行テスト」で確認する。
--   （ロックの種類は A8 で確認する。一括日付変更との競合は T6 で確認する）

do $test$
declare
  v_company uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
  v_cash uuid;
  v_sales uuid;
  v_lines jsonb;
  v_res jsonb;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e100 uuid; v_e101 uuid; v_e50 uuid; v_e200 uuid; v_legacy uuid;
  v_n integer;
  v_n2 integer;
  v_text text;
  v_count integer;
  v_before integer;
  v_total integer := 0;
  v_fails text[] := '{}';
  v_oid oid;
  v_fn text;
  v_constraint text;
  v_state text;
  s1 uuid; s2 uuid; s3 uuid;
begin
  -- 既存会社・当期を使わず、このDOブロック内の架空の会社だけで準備する。
  insert into public.companies (name, kind, tax_method)
  values ('ZZREF' || replace(gen_random_uuid()::text, '-', ''), 'CORPORATION', 'EXEMPT')
  returning id into v_company;

  -- ------------------------------------------------------------
  -- 準備（ZZREF で始まる架空データ）
  -- ------------------------------------------------------------
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current)
  values (v_company, 'ZZREF 2100年3月期', '2099-04-01', '2100-03-31', false) returning id into v_p1;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current)
  values (v_company, 'ZZREF 2101年3月期', '2100-04-01', '2101-03-31', false) returning id into v_p2;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current)
  values (v_company, 'ZZREF 2102年3月期', '2101-04-01', '2102-03-31', false) returning id into v_p3;

  insert into public.accounts (company_id, code, name, type) values (v_company, 'ZZREF-CASH', '採番テスト現金', 'ASSET') returning id into v_cash;
  insert into public.accounts (company_id, code, name, type) values (v_company, 'ZZREF-SALES', '採番テスト売上', 'REVENUE') returning id into v_sales;

  v_lines := jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', v_cash,  'amount', '1000', 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', v_sales, 'amount', '1000', 'tax_code', null)
  );

  -- ------------------------------------------------------------
  -- A. 構造
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'journal_entries'
      and column_name = 'reference_number' and data_type = 'integer' and is_nullable = 'YES'
  ) then
    v_fails := array_append(v_fails, 'A1: reference_number は nullable integer であること');
  end if;

  v_total := v_total + 1;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.journal_entries'::regclass
      and conname = 'journal_entries_reference_number_range' and contype = 'c'
  ) then
    v_fails := array_append(v_fails, 'A2: CHECK journal_entries_reference_number_range があること');
  end if;

  v_total := v_total + 1;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'uq_journal_entries_period_reference_number'
      and indexdef ilike '%unique%' and indexdef ilike '%(period_id, reference_number)%'
      and indexdef ilike '%where%reference_number is not null%'
  ) then
    v_fails := array_append(v_fails, 'A3: 部分一意インデックス (period_id, reference_number) WHERE NOT NULL があること');
  end if;

  v_total := v_total + 1;
  if exists (select 1 from pg_proc where proname = 'create_journal_entry' and pronamespace = 'public'::regnamespace
             and pg_get_function_identity_arguments(oid) like '%p_reference_number text%')
     or exists (select 1 from pg_proc where proname = 'update_journal_entry' and pronamespace = 'public'::regnamespace
             and pg_get_function_identity_arguments(oid) like '%p_reference_number text%') then
    v_fails := array_append(v_fails, 'A4: 旧シグネチャ（p_reference_number text）の関数が残っていないこと');
  end if;

  -- 権限: anon / authenticated は実行可・PUBLIC には付いていない
  foreach v_fn in array array[
    'public.lock_period_for_numbering(uuid)',
    'public.next_reference_number(uuid)',
    'public.check_reference_number(uuid, integer, uuid)',
    'public.create_journal_entry(uuid, date, text, integer, jsonb, text)',
    'public.update_journal_entry(uuid, date, text, integer, jsonb, text)',
    'public.import_staging_entries(uuid, uuid[])'
  ] loop
    v_total := v_total + 1;
    v_oid := v_fn::regprocedure;
    if not has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      v_fails := array_append(v_fails, 'A5: anon / authenticated に EXECUTE があること: ' || v_fn);
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = v_oid and a.grantee = 0) then
      v_fails := array_append(v_fails, 'A5: PUBLIC に EXECUTE が付いていないこと: ' || v_fn);
    end if;
  end loop;

  -- VOLATILE（文ごとに新しいスナップショットを取る）
  v_total := v_total + 1;
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('lock_period_for_numbering', 'next_reference_number', 'check_reference_number',
                      'create_journal_entry', 'update_journal_entry')
      and provolatile <> 'v'
  ) then
    v_fails := array_append(v_fails, 'A6: 採番に関わる関数がすべて VOLATILE であること');
  end if;

  v_total := v_total + 1;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ledger_view'
      and column_name = 'reference_number' and data_type = 'integer'
  ) or not has_table_privilege('anon', 'public.ledger_view', 'SELECT')
     or not has_table_privilege('authenticated', 'public.ledger_view', 'SELECT') then
    v_fails := array_append(v_fails, 'A7: ledger_view の reference_number が integer で、anon / authenticated に SELECT があること');
  end if;

  -- 採番ロックは「会計期ごとのアドバイザリロック」であること。
  -- fiscal_periods の FOR UPDATE にすると、既存の一括日付変更（行ロック → 期の FOR SHARE）と相互待ちになる
  v_total := v_total + 1;
  perform public.lock_period_for_numbering(v_p1);
  if not exists (
    select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted and objsubid = 2
  ) then
    v_fails := array_append(v_fails, 'A8: lock_period_for_numbering がアドバイザリロックを取ること');
  end if;
  v_total := v_total + 1;
  if exists (
    select 1 from pg_proc
    where proname = 'lock_period_for_numbering' and pronamespace = 'public'::regnamespace
      and position('for update' in lower(prosrc)) > 0
  ) then
    v_fails := array_append(v_fails, 'A8: lock_period_for_numbering が fiscal_periods を FOR UPDATE しないこと（一括日付変更とのデッドロック防止）');
  end if;

  -- ------------------------------------------------------------
  -- B. 自動採番（create_journal_entry）
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  v_res := public.create_journal_entry(v_p1, '2099-05-01', 'ZZREF auto1', null, v_lines);
  v_e1 := (v_res->>'id')::uuid;
  select reference_number into v_n from public.journal_entries where id = v_e1;
  if jsonb_typeof(v_res) <> 'object' or jsonb_typeof(v_res->'id') <> 'string' or jsonb_typeof(v_res->'reference_number') <> 'number'
     or (v_res->>'reference_number')::integer <> 1 or v_n is distinct from 1 then
    v_fails := array_append(v_fails, 'B1: 最初の自動採番は 1 で、戻り値は {id, reference_number}（数値）であり DB の値と一致すること。戻り値=' || v_res::text);
  end if;

  v_total := v_total + 1;
  v_res := public.create_journal_entry(v_p1, '2099-05-02', 'ZZREF auto2', null, v_lines);
  v_e2 := (v_res->>'id')::uuid;
  v_res := public.create_journal_entry(v_p1, '2099-04-10', 'ZZREF auto3 (日付は古い)', null, v_lines);
  v_e3 := (v_res->>'id')::uuid;
  select reference_number into v_n from public.journal_entries where id = v_e2;
  select reference_number into v_n2 from public.journal_entries where id = v_e3;
  if v_n is distinct from 2 or v_n2 is distinct from 3 then
    v_fails := array_append(v_fails, format('B2: 入力順に 2, 3 が付くこと（日付順ではない）: %s, %s', v_n, v_n2));
  end if;

  v_total := v_total + 1;
  select count(*) into v_count from public.journal_entry_logs where entry_id in (v_e1, v_e2, v_e3);
  if v_count <> 0 then
    v_fails := array_append(v_fails, 'B3: 新規作成で訂正履歴が増えないこと: ' || v_count);
  end if;

  -- 手入力 100 → 次の自動採番は 101
  v_total := v_total + 1;
  v_res := public.create_journal_entry(v_p1, '2099-06-01', 'ZZREF manual100', 100, v_lines);
  v_e100 := (v_res->>'id')::uuid;
  v_res := public.create_journal_entry(v_p1, '2099-06-02', 'ZZREF auto after100', null, v_lines);
  v_e101 := (v_res->>'id')::uuid;
  select reference_number into v_n from public.journal_entries where id = v_e100;
  select reference_number into v_n2 from public.journal_entries where id = v_e101;
  if v_n is distinct from 100 or v_n2 is distinct from 101 then
    v_fails := array_append(v_fails, format('B4: 手入力 100 の次は 101 になること: %s, %s', v_n, v_n2));
  end if;

  -- 最大値より小さい未使用の番号も手入力できる。次の自動採番は最大値+1 のまま
  v_total := v_total + 1;
  v_res := public.create_journal_entry(v_p1, '2099-06-03', 'ZZREF manual50', 50, v_lines);
  v_e50 := (v_res->>'id')::uuid;
  v_res := public.create_journal_entry(v_p1, '2099-06-04', 'ZZREF auto after50', null, v_lines);
  select reference_number into v_n from public.journal_entries where id = (v_res->>'id')::uuid;
  if (v_res->>'reference_number')::integer <> 102 or v_n is distinct from 102 then
    v_fails := array_append(v_fails, 'B5: 手入力 50 のあとも自動採番は最大値+1（102）であること: ' || v_res::text);
  end if;

  -- 空文字相当は存在しない（integer）。NULL のみが自動採番の合図
  -- ------------------------------------------------------------
  -- C. 手入力の検証
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  begin
    perform public.create_journal_entry(v_p1, '2099-07-01', 'ZZREF dup', 100, v_lines);
    v_fails := array_append(v_fails, 'C1: 同じ期の重複した伝票番号は拒否されること');
  exception when others then
    if sqlerrm <> 'DUPLICATE_REFERENCE_NUMBER' then
      v_fails := array_append(v_fails, 'C1: DUPLICATE_REFERENCE_NUMBER であること: ' || sqlerrm);
    end if;
  end;

  foreach v_n in array array[0, -5, 1000000000] loop
    v_total := v_total + 1;
    begin
      perform public.create_journal_entry(v_p1, '2099-07-01', 'ZZREF invalid', v_n, v_lines);
      v_fails := array_append(v_fails, 'C2: 範囲外の伝票番号は拒否されること: ' || v_n);
    exception when others then
      if sqlerrm <> 'INVALID_REFERENCE_NUMBER' then
        v_fails := array_append(v_fails, format('C2: INVALID_REFERENCE_NUMBER であること(%s): %s', v_n, sqlerrm));
      end if;
    end;
  end loop;

  -- 失敗した保存で仕訳が残らない（直前の失敗分）
  v_total := v_total + 1;
  select count(*) into v_count from public.journal_entries where description in ('ZZREF dup', 'ZZREF invalid');
  if v_count <> 0 then
    v_fails := array_append(v_fails, 'C3: 拒否された保存で仕訳が残らないこと: ' || v_count);
  end if;

  -- 存在しない会計期
  v_total := v_total + 1;
  begin
    perform public.create_journal_entry(gen_random_uuid(), '2099-07-01', 'ZZREF noperiod', null, v_lines);
    v_fails := array_append(v_fails, 'C4: 存在しない会計期は拒否されること');
  exception when others then
    if sqlerrm <> 'PERIOD_NOT_FOUND' then
      v_fails := array_append(v_fails, 'C4: PERIOD_NOT_FOUND であること: ' || sqlerrm);
    end if;
  end;

  -- 借貸不一致のとき、採番だけ進まない（検証は採番より前）
  v_total := v_total + 1;
  begin
    perform public.create_journal_entry(v_p1, '2099-07-01', 'ZZREF unbalanced', null, jsonb_build_array(
      jsonb_build_object('side', 'DEBIT',  'account_id', v_cash,  'amount', '1000'),
      jsonb_build_object('side', 'CREDIT', 'account_id', v_sales, 'amount', '900')));
    v_fails := array_append(v_fails, 'C5: 借貸不一致は拒否されること');
  exception when others then
    if sqlerrm <> 'DEBIT_CREDIT_MISMATCH' then
      v_fails := array_append(v_fails, 'C5: DEBIT_CREDIT_MISMATCH であること: ' || sqlerrm);
    end if;
  end;

  -- ------------------------------------------------------------
  -- D. 会計期ごとの独立
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  v_res := public.create_journal_entry(v_p2, '2100-05-01', 'ZZREF p2 auto', null, v_lines);
  if (v_res->>'reference_number')::integer <> 1 then
    v_fails := array_append(v_fails, 'D1: 別の会計期は 1 から始まること: ' || v_res::text);
  end if;
  v_total := v_total + 1;
  begin
    v_res := public.create_journal_entry(v_p2, '2100-05-02', 'ZZREF p2 manual100', 100, v_lines);
    if (v_res->>'reference_number')::integer <> 100 then
      v_fails := array_append(v_fails, 'D2: 別の会計期なら同じ番号 100 を使えること');
    end if;
  exception when others then
    v_fails := array_append(v_fails, 'D2: 別の会計期なら同じ番号 100 を使えること: ' || sqlerrm);
  end;

  -- ------------------------------------------------------------
  -- E. 編集（update_journal_entry）
  -- ------------------------------------------------------------
  -- NULL は「変更しない」
  v_total := v_total + 1;
  select count(*) into v_before from public.journal_entry_logs where entry_id = v_e1;
  perform public.update_journal_entry(v_e1, '2099-05-03', 'ZZREF auto1 edited', null, v_lines);
  select reference_number, description into v_n, v_text from public.journal_entries where id = v_e1;
  select count(*) into v_count from public.journal_entry_logs where entry_id = v_e1;
  if v_n is distinct from 1 or v_text <> 'ZZREF auto1 edited' then
    v_fails := array_append(v_fails, format('E1: NULL を渡しても伝票番号は消えず、他の項目は更新されること: %s / %s', v_n, v_text));
  end if;
  if v_count - v_before <> 1 then
    v_fails := array_append(v_fails, 'E1: 編集で訂正履歴が1件増えること（ヘッダー UPDATE から始まる）: ' || (v_count - v_before));
  end if;

  -- 未使用の番号へ変更
  v_total := v_total + 1;
  perform public.update_journal_entry(v_e1, '2099-05-03', 'ZZREF auto1 edited', 200, v_lines);
  select reference_number into v_n from public.journal_entries where id = v_e1;
  v_e200 := v_e1;
  if v_n is distinct from 200 then
    v_fails := array_append(v_fails, 'E2: 未使用の番号 200 へ変更できること: ' || coalesce(v_n::text, 'NULL'));
  end if;

  -- 使用済みの番号は拒否
  v_total := v_total + 1;
  begin
    perform public.update_journal_entry(v_e2, '2099-05-02', 'ZZREF auto2', 100, v_lines);
    v_fails := array_append(v_fails, 'E3: 他の仕訳が使用中の番号への変更は拒否されること');
  exception when others then
    if sqlerrm <> 'DUPLICATE_REFERENCE_NUMBER' then
      v_fails := array_append(v_fails, 'E3: DUPLICATE_REFERENCE_NUMBER であること: ' || sqlerrm);
    end if;
  end;
  select reference_number into v_n from public.journal_entries where id = v_e2;
  if v_n is distinct from 2 then
    v_fails := array_append(v_fails, 'E3: 拒否された編集で番号が変わらないこと: ' || coalesce(v_n::text, 'NULL'));
  end if;

  -- 自分自身の番号をそのまま渡しても重複扱いにならない
  v_total := v_total + 1;
  begin
    perform public.update_journal_entry(v_e2, '2099-05-02', 'ZZREF auto2 again', 2, v_lines);
  exception when others then
    v_fails := array_append(v_fails, 'E4: 自分自身の番号は重複にならないこと: ' || sqlerrm);
  end;

  -- 範囲外
  v_total := v_total + 1;
  begin
    perform public.update_journal_entry(v_e2, '2099-05-02', 'ZZREF auto2', 0, v_lines);
    v_fails := array_append(v_fails, 'E5: 0 は拒否されること');
  exception when others then
    if sqlerrm <> 'INVALID_REFERENCE_NUMBER' then
      v_fails := array_append(v_fails, 'E5: INVALID_REFERENCE_NUMBER であること: ' || sqlerrm);
    end if;
  end;

  -- 過去データ（伝票番号 NULL）: NULL のまま編集できる。番号を付けることもできる
  v_total := v_total + 1;
  v_res := public.create_journal_entry(v_p3, '2101-05-01', 'ZZREF legacy', null, v_lines);
  v_legacy := (v_res->>'id')::uuid;
  update public.journal_entries set reference_number = null where id = v_legacy;
  perform public.update_journal_entry(v_legacy, '2101-05-01', 'ZZREF legacy edited', null, v_lines);
  select reference_number into v_n from public.journal_entries where id = v_legacy;
  if v_n is not null then
    v_fails := array_append(v_fails, 'E6: NULL の過去データを NULL のまま編集しても自動採番されないこと: ' || v_n);
  end if;
  v_total := v_total + 1;
  perform public.update_journal_entry(v_legacy, '2101-05-01', 'ZZREF legacy numbered', 7, v_lines);
  select reference_number into v_n from public.journal_entries where id = v_legacy;
  if v_n is distinct from 7 then
    v_fails := array_append(v_fails, 'E7: NULL の過去データに手入力で番号を付けられること: ' || coalesce(v_n::text, 'NULL'));
  end if;

  -- 存在しない仕訳
  v_total := v_total + 1;
  begin
    perform public.update_journal_entry(gen_random_uuid(), '2099-05-02', 'ZZREF none', null, v_lines);
    v_fails := array_append(v_fails, 'E8: 存在しない仕訳は拒否されること');
  exception when others then
    if sqlerrm <> 'ENTRY_NOT_FOUND' then
      v_fails := array_append(v_fails, 'E8: ENTRY_NOT_FOUND であること: ' || sqlerrm);
    end if;
  end;

  -- 期首残高仕訳は編集できない（従来どおり）
  v_total := v_total + 1;
  update public.journal_entries set is_opening_balance = true where id = v_e3;
  begin
    perform public.update_journal_entry(v_e3, '2099-04-10', 'ZZREF opening', null, v_lines);
    v_fails := array_append(v_fails, 'E9: 期首残高仕訳の編集は拒否されること');
  exception when others then
    if sqlerrm <> 'OPENING_BALANCE_EDIT_FORBIDDEN' then
      v_fails := array_append(v_fails, 'E9: OPENING_BALANCE_EDIT_FORBIDDEN であること: ' || sqlerrm);
    end if;
  end;
  update public.journal_entries set is_opening_balance = false where id = v_e3;

  -- ------------------------------------------------------------
  -- F. DB 直接操作（RPC を通さない経路）の保証範囲
  -- ------------------------------------------------------------
  -- 一意インデックス: 直接 INSERT の重複は拒否される（制約名で見分けられる）
  v_total := v_total + 1;
  begin
    insert into public.journal_entries (period_id, date, description, reference_number)
    values (v_p1, '2099-08-01', 'ZZREF direct dup', 100);
    v_fails := array_append(v_fails, 'F1: 直接 INSERT でも重複は一意インデックスで拒否されること');
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'uq_journal_entries_period_reference_number' then
      v_fails := array_append(v_fails, 'F1: 制約名で伝票番号の重複と判別できること: ' || coalesce(v_constraint, 'NULL'));
    end if;
  end;

  -- CHECK: 直接 INSERT の 0 は拒否される
  v_total := v_total + 1;
  begin
    insert into public.journal_entries (period_id, date, description, reference_number)
    values (v_p1, '2099-08-01', 'ZZREF direct zero', 0);
    v_fails := array_append(v_fails, 'F2: 直接 INSERT の 0 は CHECK で拒否されること');
  exception when check_violation then
    null;
  end;

  -- NULL は何件でも許可（過去データ・直接 INSERT は自動採番されない）
  v_total := v_total + 1;
  begin
    insert into public.journal_entries (period_id, date, description) values (v_p1, '2099-08-01', 'ZZREF direct null 1');
    insert into public.journal_entries (period_id, date, description) values (v_p1, '2099-08-01', 'ZZREF direct null 2');
    select count(*) into v_count from public.journal_entries
     where description in ('ZZREF direct null 1', 'ZZREF direct null 2') and reference_number is null;
    if v_count <> 2 then
      v_fails := array_append(v_fails, 'F3: 直接 INSERT の NULL は自動採番されず、重複扱いにもならないこと: ' || v_count);
    end if;
  exception when others then
    v_fails := array_append(v_fails, 'F3: 直接 INSERT の NULL が許可されること: ' || sqlerrm);
  end;
  -- 以降の取込・採番の確認に影響しないよう、ヘッダーだけの行は削除しておく（未コミットのため遅延制約はまだ働かない）
  delete from public.journal_entries where description like 'ZZREF direct null%';

  -- ------------------------------------------------------------
  -- G. CSV 本登録（import_staging_entries）: 配列順に採番
  -- ------------------------------------------------------------
  -- p3 には手入力 7 の仕訳（E7）と legacy 以外の仕訳がある。最大は 7 のはずなので 8, 9, 10 が付く
  v_total := v_total + 1;
  insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id)
  values (v_company, '2101-06-01', 100, 100, 'ZZREF import A', v_cash, v_sales) returning id into s1;
  insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id)
  values (v_company, '2101-06-02', 200, 200, 'ZZREF import B', v_cash, v_sales) returning id into s2;
  insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id)
  values (v_company, '2101-05-15', 300, 300, 'ZZREF import C', v_cash, v_sales) returning id into s3;

  select max(reference_number) into v_before from public.journal_entries where period_id = v_p3;
  v_n := public.import_staging_entries(v_p3, array[s3, s1, s2]);
  if v_n <> 3 then
    v_fails := array_append(v_fails, 'G1: 登録件数 3 であること: ' || v_n);
  end if;
  if (select reference_number from public.journal_entries where description = 'ZZREF import C') is distinct from v_before + 1
     or (select reference_number from public.journal_entries where description = 'ZZREF import A') is distinct from v_before + 2
     or (select reference_number from public.journal_entries where description = 'ZZREF import B') is distinct from v_before + 3 then
    v_fails := array_append(v_fails, format('G1: 配列順（C, A, B）に %s+1, +2, +3 が付くこと: C=%s A=%s B=%s', v_before,
      (select reference_number from public.journal_entries where description = 'ZZREF import C'),
      (select reference_number from public.journal_entries where description = 'ZZREF import A'),
      (select reference_number from public.journal_entries where description = 'ZZREF import B')));
  end if;

  -- 取込後の自動採番は続きから
  v_total := v_total + 1;
  v_res := public.create_journal_entry(v_p3, '2101-07-01', 'ZZREF after import', null, v_lines);
  if (v_res->>'reference_number')::integer <> v_before + 4 then
    v_fails := array_append(v_fails, 'G2: 取込のあとの自動採番は続きの番号になること: ' || v_res::text);
  end if;

  -- 取込が失敗（存在しない取込行）したら採番も含めて何も残らない
  v_total := v_total + 1;
  select max(reference_number) into v_before from public.journal_entries where period_id = v_p3;
  begin
    perform public.import_staging_entries(v_p3, array[gen_random_uuid()]);
    v_fails := array_append(v_fails, 'G3: 存在しない取込行は拒否されること');
  exception when others then
    if sqlerrm <> 'INVALID_STAGING_ROWS' then
      v_fails := array_append(v_fails, 'G3: INVALID_STAGING_ROWS であること: ' || sqlerrm);
    end if;
  end;

  -- 3件中2件目（実在しない日付）で失敗したら、1件目の登録・採番も含めてすべて取り消される
  v_total := v_total + 1;
  declare
    r1 uuid; r2 uuid; r3 uuid;
  begin
    insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id)
    values (v_company, '2101-08-01', 10, 10, 'ZZREF rb1', v_cash, v_sales) returning id into r1;
    insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id)
    values (v_company, '2101-02-30', 20, 20, 'ZZREF rb2', v_cash, v_sales) returning id into r2;
    insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id)
    values (v_company, '2101-08-03', 30, 30, 'ZZREF rb3', v_cash, v_sales) returning id into r3;
    select max(reference_number) into v_before from public.journal_entries where period_id = v_p3;
    begin
      perform public.import_staging_entries(v_p3, array[r1, r2, r3]);
      v_fails := array_append(v_fails, 'G4: 実在しない日付を含む取込は拒否されること');
    exception when others then
      if sqlerrm <> 'INVALID_DATE' then
        v_fails := array_append(v_fails, 'G4: INVALID_DATE であること: ' || sqlerrm);
      end if;
    end;
    select count(*) into v_count from public.journal_entries where description like 'ZZREF rb%';
    if v_count <> 0 then
      v_fails := array_append(v_fails, 'G4: 1件目も含めて仕訳が1件も残らないこと（全件取り消し）: ' || v_count);
    end if;
    select count(*) into v_count from public.import_staging where id in (r1, r2, r3) and coalesce(is_processed, false);
    if v_count <> 0 then
      v_fails := array_append(v_fails, 'G4: 取込データが処理済みにならないこと: ' || v_count);
    end if;
    v_res := public.create_journal_entry(v_p3, '2101-08-10', 'ZZREF after rollback', null, v_lines);
    if (v_res->>'reference_number')::integer <> v_before + 1 then
      v_fails := array_append(v_fails, 'G4: 失敗した取込で採番が進まないこと: ' || v_res::text);
    end if;
  end;

  -- ------------------------------------------------------------
  -- H. anon ロールでの実行（RLS・権限・FOR UPDATE の確認）
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  begin
    set local role anon;
    v_res := public.create_journal_entry(v_p2, '2100-06-01', 'ZZREF anon create', null, v_lines);
    perform public.update_journal_entry((v_res->>'id')::uuid, '2100-06-01', 'ZZREF anon edit', null, v_lines);
    reset role;
    select reference_number into v_n from public.journal_entries where description = 'ZZREF anon edit';
    if v_n is distinct from (v_res->>'reference_number')::integer then
      v_fails := array_append(v_fails, 'H1: anon の保存で番号が確定し、編集後も保たれること');
    end if;
  exception when others then
    reset role;
    v_fails := array_append(v_fails, 'H1: anon ロールで保存・編集できること: ' || sqlerrm);
  end;

  -- ------------------------------------------------------------
  -- 結果（意図的な例外ですべてロールバックする）
  -- ------------------------------------------------------------
  if array_length(v_fails, 1) is null then
    raise exception 'TEST RESULT: ALL PASSED (% checks)', v_total;
  else
    raise exception 'TEST RESULT: FAILED (% of % checks): %', array_length(v_fails, 1), v_total, array_to_string(v_fails, E'\n');
  end if;
end;
$test$;
