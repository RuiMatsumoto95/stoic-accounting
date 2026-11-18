-- 先に 20261112120000_company_support.sql を SQL Editor で実行する。
-- このファイル全体を実行し、ERROR: TEST RESULT: ALL PASSED を確認する。
-- 最後の意図的な例外により、会社・科目・期間・仕訳・取込データ・履歴をすべてロールバックする（ZZCO で始まる架空データ）。
-- ALL PASSED 以外のエラー（FAILED を含む）は成功と判断しない。
-- 確認できないもの: 既存データの移行結果（件数の照合は _apply.md の SQL で行う）、同時実行、PostgreSQL 17 固有の挙動。
-- 変更履歴: ステップ2（20261114180000_opening_balances.sql）の適用後は、G1・G2 の期待値が変わる（損益科目は期首残高に返らず繰越先へ畳み込まれる）。
--   G1 を強化し、G2 を「繰越先未設定で畳み込みが必要なら CARRY_FORWARD_NOT_SET」に変更、G2b を追加（136項目）。この版は、ステップ2の SQL を適用した後に実行する。
-- 注意: 20261101180000 / 20261101180100 / 20261104180000 / 20261110170000 の各 .test.sql は、会社を指定せずに
--   科目・会計期間を作る。このマイグレーション以降は company_id が必須のため、そのままでは実行できない
--   （保存 RPC の回帰は、このテストの H・I・J で確認する）。

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
  c1 uuid; c2 uuid; c3 uuid;           -- 法人A / 個人B / 法人C
  p1 uuid; p2 uuid; p3 uuid;           -- 各社の最初の期
  a1_cash uuid; a1_sales uuid; a1_exp uuid;
  a3_cash uuid; a3_sales uuid;
  b_cash uuid;
  v_n integer;
  v_t text;
  v_id uuid;
  v_ref integer;
  v_lines1 jsonb; v_lines3 jsonb;
  v_sub uuid; v_sub2 uuid; v_exp_parent uuid;
  v_e1 uuid; v_e3 uuid;
  v_cnt_before integer;
  s1 uuid;
begin
  -- ------------------------------------------------------------
  -- A. create_company（法人181・個人141・繰越先・最初の期・エイリアス）
  -- ------------------------------------------------------------
  v_res := public.create_company('ZZCO 法人A', 'CORPORATION', 'STANDARD_INDIVIDUAL', '2098-04-01', '2099-03-31');
  c1 := (v_res->>'company_id')::uuid; p1 := (v_res->>'period_id')::uuid;
  v_total := v_total + 1;
  if (v_res->>'account_count')::integer <> 181 then v_fails := array_append(v_fails, ('A1: 法人の科目数が181であること: ' || v_res::text)); end if;

  v_res := public.create_company('ZZCO 個人B', 'INDIVIDUAL', 'EXEMPT', '2099-01-01', '2099-12-31');
  c2 := (v_res->>'company_id')::uuid; p2 := (v_res->>'period_id')::uuid;
  v_total := v_total + 1;
  if (v_res->>'account_count')::integer <> 141 then v_fails := array_append(v_fails, ('A2: 個人の科目数が141であること: ' || v_res::text)); end if;

  v_res := public.create_company('ZZCO 法人C', 'CORPORATION', null, '2098-04-01', '2099-03-31');
  c3 := (v_res->>'company_id')::uuid; p3 := (v_res->>'period_id')::uuid;
  v_total := v_total + 1;
  if (select tax_method from public.companies where id = c3) <> 'EXEMPT' then v_fails := array_append(v_fails, 'A3: tax_method を省略すると EXEMPT になること'); end if;
  v_total := v_total + 1;
  if (select tax_method from public.companies where id = c1) <> 'STANDARD_INDIVIDUAL' then v_fails := array_append(v_fails, 'A3b: 指定した tax_method が保存されること'); end if;

  v_total := v_total + 1;
  if (select count(*) from public.accounts where company_id = c1) <> 181
     or (select count(*) from public.accounts where company_id = c2) <> 141 then
    v_fails := array_append(v_fails, 'A4: accounts の件数が 181 / 141 であること');
  end if;

  v_total := v_total + 1;
  if exists (select 1 from public.accounts where company_id in (c1, c3) and code in ('000', '001'))
     or exists (select 1 from public.accounts where company_id = c2 and code in ('000', '001')) then
    v_fails := array_append(v_fails, 'A5: 諸口（000・001）が入っていないこと');
  end if;

  v_total := v_total + 1;
  if (select name from public.accounts where company_id = c1 and code = '753') is distinct from '交際費' then
    v_fails := array_append(v_fails, 'A6: 法人の 753 が「交際費」であること');
  end if;

  -- 繰越先
  v_total := v_total + 1;
  if (select a.code || a.name from public.companies c join public.accounts a on a.id = c.carry_forward_account_id where c.id = c1) <> '540繰越利益'
     or (select a.code || a.name from public.companies c join public.accounts a on a.id = c.carry_forward_account_id where c.id = c2) <> '400元入金' then
    v_fails := array_append(v_fails, 'A7: 繰越先が 法人=540繰越利益 / 個人=400元入金 であること');
  end if;

  -- 最初の期
  v_total := v_total + 1;
  if (select count(*) from public.fiscal_periods where company_id = c1 and is_current) <> 1
     or (select name from public.fiscal_periods where id = p1) <> '2099年3月期'
     or (select name from public.fiscal_periods where id = p2) <> '2099年12月期' then
    v_fails := array_append(v_fails, 'A8: 最初の期が当期として作られ、期名が終了日から付くこと');
  end if;

  -- 区分別の内訳
  v_total := v_total + 1;
  if (select count(*) from public.accounts where company_id = c1 and pl_category = 'SGA') <> 41
     or (select count(*) from public.accounts where company_id = c1 and pl_category = 'TAX') <> 3
     or (select count(*) from public.accounts where company_id = c1 and bs_category = 'DEFERRED_ASSETS') <> 3
     or (select count(*) from public.accounts where company_id = c1 and bs_category in ('OWNER_DRAWINGS', 'OWNER_CONTRIBUTIONS')) <> 0 then
    v_fails := array_append(v_fails, 'A9: 法人の区分の内訳（販管費41・法人税等3・繰延資産3・事業主区分0）');
  end if;
  v_total := v_total + 1;
  if (select count(*) from public.accounts where company_id = c2 and bs_category = 'OWNER_DRAWINGS') <> 2
     or (select count(*) from public.accounts where company_id = c2 and bs_category = 'OWNER_CONTRIBUTIONS') <> 4
     or (select count(*) from public.accounts where company_id = c2 and pl_category = 'RESERVE_REVERSAL') <> 1
     or (select count(*) from public.accounts where company_id = c2 and pl_category = 'RESERVE_PROVISION') <> 2
     or (select count(*) from public.accounts where company_id = c2 and pl_category = 'REVENUE') <> 8
     or (select count(*) from public.accounts where company_id = c2 and pl_category = 'SGA') <> 43
     or (select count(*) from public.accounts where company_id = c2 and pl_category in ('NON_OP_INCOME', 'NON_OP_EXPENSE', 'EXTRA_INCOME', 'EXTRA_LOSS', 'TAX')) <> 0 then
    v_fails := array_append(v_fails, 'A10: 個人の区分の内訳（事業主貸2・事業主借4・繰戻1・繰入2・収入8・経費43・法人用区分0）');
  end if;

  -- 税区分グループ
  v_total := v_total + 1;
  if (select default_tax_code from public.accounts where company_id = c1 and code = '700') <> 'SALES'
     or (select default_tax_code from public.accounts where company_id = c1 and code = '753') <> 'PURCHASE'
     or (select default_tax_code from public.accounts where company_id = c1 and code = '800') <> 'NON_TAXABLE_SALES'
     or (select default_tax_code from public.accounts where company_id = c1 and code = '180') <> 'NONE'
     or (select default_tax_code from public.accounts where company_id = c1 and code = '440') <> 'NONE'
     or (select default_tax_code from public.accounts where company_id = c1 and code = '100') <> 'NONE' then
    v_fails := array_append(v_fails, 'A11: 税区分グループ（売上=SALES・交際費=PURCHASE・受取利息=NON_TAXABLE_SALES・仮払/仮受/現金=NONE）');
  end if;

  -- エイリアス（ROMAN・normalizeText 済み）
  v_total := v_total + 1;
  if not exists (select 1 from public.account_aliases al join public.accounts a on a.id = al.account_id
                  where a.company_id = c1 and a.code = '100' and al.alias = 'GENKIN' and al.normalized_alias = 'genkin' and al.alias_type = 'ROMAN') then
    v_fails := array_append(v_fails, 'A12: 現金に ROMAN エイリアス GENKIN（normalized = genkin）があること');
  end if;
  v_total := v_total + 1;
  select count(*) into v_n from public.account_aliases al join public.accounts a on a.id = al.account_id where a.company_id = c1;
  if v_n <> 388 then v_fails := array_append(v_fails, 'A13: 法人のエイリアスが388件（弥生のサーチキー181＋既存DBの読み・ローマ字207）であること: ' || v_n); end if;
  v_total := v_total + 1;
  select count(*) into v_n from public.account_aliases al join public.accounts a on a.id = al.account_id where a.company_id = c2;
  if v_n <> 320 then v_fails := array_append(v_fails, 'A13b: 個人のエイリアスが320件（サーチキー141＋既存DBの読み・ローマ字179）であること: ' || v_n); end if;
  v_total := v_total + 1;
  if not exists (select 1 from public.account_aliases al join public.accounts a on a.id = al.account_id
                  where a.company_id = c1 and a.code = '100' and al.alias = 'げんきん' and al.normalized_alias = 'げんきん' and al.alias_type = 'KANA')
     or not exists (select 1 from public.account_aliases al join public.accounts a on a.id = al.account_id
                  where a.company_id = c1 and a.code = '753' and al.normalized_alias = 'settai')
     or exists (select 1 from public.account_aliases al join public.accounts a on a.id = al.account_id
                 where a.company_id in (c1, c2, c3) and al.alias ~ '[^\x01-\x7f\u3040-\u309f\u30fc]') then
    v_fails := array_append(v_fails, 'A13c: 現金に読み「げんきん」（KANA）、交際費に別名 settai があり、読み以外の非ASCII文字が混ざっていないこと');
  end if;
  v_total := v_total + 1;
  if exists (select 1 from public.account_aliases where normalized_alias <> lower(normalized_alias)) then
    v_fails := array_append(v_fails, 'A14: normalized_alias が小文字化済みであること');
  end if;

  -- 引数の検証（どれも何も作らない）
  select count(*) into v_cnt_before from public.companies;
  foreach v_t in array array[
    'select public.create_company(''  '', ''CORPORATION'', ''EXEMPT'', ''2098-04-01'', ''2099-03-31'')',
    'select public.create_company(null, ''CORPORATION'', ''EXEMPT'', ''2098-04-01'', ''2099-03-31'')',
    'select public.create_company(''ZZCO bad'', ''OTHER'', ''EXEMPT'', ''2098-04-01'', ''2099-03-31'')',
    'select public.create_company(''ZZCO bad'', null, ''EXEMPT'', ''2098-04-01'', ''2099-03-31'')',
    'select public.create_company(''ZZCO bad'', ''CORPORATION'', ''XXX'', ''2098-04-01'', ''2099-03-31'')',
    'select public.create_company(''ZZCO bad'', ''CORPORATION'', ''EXEMPT'', ''2099-04-01'', ''2099-03-31'')',
    'select public.create_company(''ZZCO bad'', ''CORPORATION'', ''EXEMPT'', null, ''2099-03-31'')',
    'select public.create_company(''ZZCO bad'', ''INDIVIDUAL'', ''EXEMPT'', ''2098-04-01'', ''2099-03-31'')',
    'select public.create_company(''ZZCO bad'', ''INDIVIDUAL'', ''EXEMPT'', ''2099-01-01'', ''2100-12-31'')'
  ] loop
    v_total := v_total + 1;
    if split_part(pg_temp.err(v_t), '|', 1) <> 'P0001' or split_part(pg_temp.err(v_t), '|', 2) <> 'INVALID_COMPANY' then
      v_fails := array_append(v_fails, ('A15: INVALID_COMPANY で拒否されること: ' || v_t || ' → ' || pg_temp.err(v_t)));
    end if;
  end loop;
  v_total := v_total + 1;
  if (select count(*) from public.companies) <> v_cnt_before then v_fails := array_append(v_fails, 'A16: 拒否された呼び出しで会社が増えないこと'); end if;

  -- 会社名の重複
  v_total := v_total + 1;
  v_t := pg_temp.err($$select public.create_company('ZZCO 法人A', 'CORPORATION', 'EXEMPT', '2098-04-01', '2099-03-31')$$);
  if split_part(v_t, '|', 1) <> '23505' then v_fails := array_append(v_fails, ('A17: 会社名の重複は 23505: ' || v_t)); end if;

  -- 途中で失敗したら何も残らない（最後の「期の作成」を失敗させる）
  v_total := v_total + 1;
  create function pg_temp.zz_fail() returns trigger language plpgsql as $f$ begin raise exception 'ZZ forced failure'; end; $f$;
  create trigger zz_fail_period before insert on public.fiscal_periods for each row when (new.name like '____年_月期' or new.name like '____年__月期') execute function pg_temp.zz_fail();
  select count(*) into v_cnt_before from public.accounts;
  v_t := pg_temp.err($$select public.create_company('ZZCO 失敗', 'CORPORATION', 'EXEMPT', '2090-04-01', '2091-03-31')$$);
  drop trigger zz_fail_period on public.fiscal_periods;
  if v_t not like 'P0001|ZZ forced failure' and v_t not like '%ZZ forced failure%' then
    v_fails := array_append(v_fails, ('A18: 期の作成を強制的に失敗させる準備: ' || v_t));
  end if;
  if exists (select 1 from public.companies where name = 'ZZCO 失敗')
     or (select count(*) from public.accounts) <> v_cnt_before then
    v_fails := array_append(v_fails, 'A18: 途中で失敗したら会社・科目が何も残らないこと');
  end if;

  -- ------------------------------------------------------------
  -- B. 構造（制約・インデックス・旧制約の撤去）
  -- ------------------------------------------------------------
  foreach v_t in array array[
    'accounts|accounts_parent_id_fkey', 'journal_entries|journal_entries_period_id_fkey',
    'journal_lines|journal_lines_entry_id_fkey', 'journal_lines|journal_lines_account_id_fkey',
    'import_staging|import_staging_predicted_account_id_fkey', 'import_staging|import_staging_counter_account_id_fkey',
    'import_staging|import_staging_debit_sub_account_id_fkey', 'import_staging|import_staging_credit_sub_account_id_fkey',
    'mapping_rules|mapping_rules_account_id_fkey', 'journal_template_lines|journal_template_lines_account_id_fkey',
    'journal_template_lines|journal_template_lines_template_id_fkey', 'companies|companies_carry_forward_fkey',
    'accounts|accounts_company_kind_fkey'
  ] loop
    v_total := v_total + 1;
    if not exists (select 1 from pg_constraint
                    where conrelid = ('public.' || split_part(v_t, '|', 1))::regclass
                      and conname = split_part(v_t, '|', 2) and contype = 'f' and array_length(conkey, 1) = 2) then
      v_fails := array_append(v_fails, ('B1: 2列の複合外部キーであること: ' || v_t));
    end if;
  end loop;

  v_total := v_total + 1;
  if exists (select 1 from pg_constraint where conname = 'accounts_code_unique')
     or not exists (select 1 from pg_constraint where conname = 'accounts_company_code_key' and contype = 'u') then
    v_fails := array_append(v_fails, 'B2: accounts の code の一意制約が (company_id, code) になっていること');
  end if;

  v_total := v_total + 1;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_fiscal_periods_single_current'
                  and indexdef ilike '%(company_id)%' and indexdef ilike '%where%is_current%') then
    v_fails := array_append(v_fails, 'B3: is_current の部分ユニークが会社ごとであること');
  end if;

  v_total := v_total + 1;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and column_name = 'company_id'
              and table_name in ('accounts', 'fiscal_periods', 'journal_entries', 'journal_lines', 'import_staging', 'mapping_rules', 'journal_templates', 'journal_template_lines')
              and (is_nullable <> 'NO' or column_default is not null)) then
    v_fails := array_append(v_fails, 'B4: company_id が NOT NULL で DEFAULT を持たないこと');
  end if;
  v_total := v_total + 1;
  if (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'company_id'
       and table_name in ('accounts', 'fiscal_periods', 'journal_entries', 'journal_lines', 'import_staging', 'mapping_rules', 'journal_templates', 'journal_template_lines')) <> 8 then
    v_fails := array_append(v_fails, 'B5: 8表すべてに company_id があること');
  end if;

  -- ------------------------------------------------------------
  -- C. 会社をまたぐ参照の拒否（複合外部キー）
  -- ------------------------------------------------------------
  select id into a1_cash  from public.accounts where company_id = c1 and code = '100';
  select id into a1_sales from public.accounts where company_id = c1 and code = '700';
  select id into a1_exp   from public.accounts where company_id = c1 and code = '753';
  select id into a3_cash  from public.accounts where company_id = c3 and code = '100';
  select id into a3_sales from public.accounts where company_id = c3 and code = '700';
  select id into b_cash   from public.accounts where company_id = c2 and code = '100';

  v_lines1 := jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', a1_cash,  'amount', '1000', 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', a1_sales, 'amount', '1000', 'tax_code', null));
  v_lines3 := jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', a3_cash,  'amount', '300', 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', a3_sales, 'amount', '300', 'tax_code', null));

  -- C1: 保存 RPC（引数・本体は変更なし）で自社の科目なら保存でき、会社が期から自動設定される
  v_total := v_total + 1;
  v_res := public.create_journal_entry(p1, '2098-05-01', 'ZZCO 法人A 仕訳', null, v_lines1);
  v_e1 := (v_res->>'id')::uuid;
  if (select company_id from public.journal_entries where id = v_e1) is distinct from c1
     or (select count(*) from public.journal_lines where entry_id = v_e1 and company_id = c1) <> 2 then
    v_fails := array_append(v_fails, 'C1: 仕訳・明細の company_id が期から自動設定されること');
  end if;

  -- C2: 他社の科目を含む明細は 23503
  v_total := v_total + 1;
  v_t := pg_temp.err(format('select public.create_journal_entry(%L, %L, %L, null, %L)', p1, '2098-05-02', 'ZZCO 他社科目',
        jsonb_build_array(jsonb_build_object('side', 'DEBIT', 'account_id', a3_cash, 'amount', '10', 'tax_code', null),
                          jsonb_build_object('side', 'CREDIT', 'account_id', a1_sales, 'amount', '10', 'tax_code', null))));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C2: 他社の科目での保存は 23503: ' || v_t)); end if;
  v_total := v_total + 1;
  if exists (select 1 from public.journal_entries where description = 'ZZCO 他社科目') then v_fails := array_append(v_fails, 'C2b: 拒否された保存で仕訳が残らないこと'); end if;

  -- C3: 個人の会社の科目も同様
  v_total := v_total + 1;
  v_t := pg_temp.err(format('select public.create_journal_entry(%L, %L, %L, null, %L)', p1, '2098-05-02', 'ZZCO 他社科目2',
        jsonb_build_array(jsonb_build_object('side', 'DEBIT', 'account_id', b_cash, 'amount', '10', 'tax_code', null),
                          jsonb_build_object('side', 'CREDIT', 'account_id', a1_sales, 'amount', '10', 'tax_code', null))));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C3: 個人の科目での保存も 23503: ' || v_t)); end if;

  -- C4: 編集でも他社の科目は拒否され、元の明細が残る
  v_total := v_total + 1;
  v_t := pg_temp.err(format('select public.update_journal_entry(%L, %L, %L, null, %L)', v_e1, '2098-05-01', 'ZZCO 編集',
        jsonb_build_array(jsonb_build_object('side', 'DEBIT', 'account_id', a3_cash, 'amount', '10', 'tax_code', null),
                          jsonb_build_object('side', 'CREDIT', 'account_id', a1_sales, 'amount', '10', 'tax_code', null))));
  if split_part(v_t, '|', 1) <> '23503'
     or (select count(*) from public.journal_lines where entry_id = v_e1 and amount = 1000) <> 2
     or (select description from public.journal_entries where id = v_e1) <> 'ZZCO 法人A 仕訳' then
    v_fails := array_append(v_fails, ('C4: 編集でも他社の科目は 23503 で、元の仕訳が残ること: ' || v_t));
  end if;

  -- C5: 他社の期への仕訳（company_id を明示しても拒否）
  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.journal_entries (period_id, company_id, date, description) values (%L, %L, %L, %L)', p3, c1, '2098-05-03', 'ZZCO 他社期'));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C5: 他社の期への仕訳は 23503: ' || v_t)); end if;

  -- C6: 仕訳の期を他社の期へ付け替えられない（日付は範囲内）
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.journal_entries set period_id = %L where id = %L', p3, v_e1));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C6: 他社の期への付け替えは 23503: ' || v_t)); end if;

  -- C7: company_id そのものは変更できない（全8表）
  foreach v_t in array array['accounts', 'fiscal_periods', 'journal_entries', 'journal_lines', 'import_staging', 'mapping_rules', 'journal_templates', 'journal_template_lines'] loop
    v_total := v_total + 1;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || v_t)::regclass and tgname = 'trg_' || v_t || '_company_immutable') then
      v_fails := array_append(v_fails, ('C7: company_id の変更禁止トリガーがあること: ' || v_t));
    end if;
  end loop;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.journal_entries set company_id = %L where id = %L', c3, v_e1));
  if split_part(v_t, '|', 2) <> 'COMPANY_ID_IMMUTABLE' then v_fails := array_append(v_fails, ('C7b: 仕訳の company_id 変更は拒否: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.accounts set company_id = %L where id = %L', c3, a1_exp));
  if split_part(v_t, '|', 2) <> 'COMPANY_ID_IMMUTABLE' then v_fails := array_append(v_fails, ('C7c: 科目の company_id 変更は拒否: ' || v_t)); end if;

  -- C8: 補助科目は同じ会社の親だけ。区分は親から継承する
  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.accounts (company_id, code, name, type, parent_id) values (%L, %L, %L, %L, %L)', c1, '753-0001', 'ZZCO 他社親', 'EXPENSE', a3_cash));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C8: 他社の親科目への補助科目は 23503: ' || v_t)); end if;

  v_total := v_total + 1;
  insert into public.accounts (company_id, code, name, type, bs_category, pl_category, parent_id)
  values (c1, '753-0001', 'ZZCO 補助', 'ASSET', 'FIXED_ASSETS', null, a1_exp) returning id into v_sub;
  if (select (type, bs_category, pl_category)::text from public.accounts where id = v_sub) <> '(EXPENSE,,SGA)' then
    v_fails := array_append(v_fails, ('C9: 補助科目が親の type / 区分を継承すること: ' || (select (type, bs_category, pl_category)::text from public.accounts where id = v_sub)));
  end if;

  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.accounts (company_id, code, name, type, parent_id) values (%L, %L, %L, %L, %L)', c1, '753-0001-1', 'ZZCO 孫', 'EXPENSE', v_sub));
  if split_part(v_t, '|', 2) <> 'INVALID_ACCOUNT_HIERARCHY' then v_fails := array_append(v_fails, ('C10: 補助科目の下に補助科目は作れないこと: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.accounts set parent_id = %L where id = %L', a1_cash, a1_exp));
  if split_part(v_t, '|', 2) <> 'INVALID_ACCOUNT_HIERARCHY' then v_fails := array_append(v_fails, ('C11: 補助科目を持つ科目を補助科目にできないこと: ' || v_t)); end if;

  -- 自分自身を親にできない（INSERT・UPDATE とも）
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.accounts set parent_id = id where id = %L', a1_cash));
  if split_part(v_t, '|', 2) <> 'INVALID_ACCOUNT_HIERARCHY' then v_fails := array_append(v_fails, 'C11b: 科目自身を親にする UPDATE は拒否: ' || v_t); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.accounts (id, company_id, code, name, type, parent_id) values (%L, %L, ''ZZ-SELF'', ''x'', ''EXPENSE'', %L)',
        'aaaaaaaa-0000-0000-0000-0000000000aa', c1, 'aaaaaaaa-0000-0000-0000-0000000000aa'));
  if split_part(v_t, '|', 2) <> 'INVALID_ACCOUNT_HIERARCHY' then v_fails := array_append(v_fails, 'C11c: 科目自身を親にする INSERT は拒否: ' || v_t); end if;

  -- 親の区分を変えると補助科目も追従する
  v_total := v_total + 1;
  update public.accounts set pl_category = 'COGS' where id = a1_exp;
  if (select pl_category from public.accounts where id = v_sub) <> 'COGS' then v_fails := array_append(v_fails, 'C12: 親の区分変更が補助科目に伝わること'); end if;
  update public.accounts set pl_category = 'SGA' where id = a1_exp;

  -- C13: mapping_rules / import_staging / テンプレート
  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.mapping_rules (company_id, keyword, account_id) values (%L, %L, %L)', c1, 'zzco', a3_cash));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C13: 置換ルールで他社の科目は 23503: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.mapping_rules (company_id, keyword, account_id) values (%L, %L, %L)', c1, 'zzco', a1_cash));
  if v_t <> 'OK' then v_fails := array_append(v_fails, ('C13b: 自社の科目なら置換ルールを作れること: ' || v_t)); end if;

  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_description, predicted_account_id, counter_account_id) values (%L, %L, 1, %L, %L, %L)', c1, '2098-06-01', 'ZZCO', a3_cash, a1_sales));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C14: 取込データで他社の科目は 23503: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.import_staging (company_id, raw_date, raw_description, debit_sub_account_id) values (%L, %L, %L, %L)', c1, '2098-06-01', 'ZZCO', a3_cash));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C15: 取込データの補助科目列でも他社の科目は 23503: ' || v_t)); end if;

  v_total := v_total + 1;
  declare v_tpl uuid; v_tpl3 uuid; begin
    insert into public.journal_templates (company_id, name) values (c1, 'ZZCO テンプレ') returning id into v_tpl;
    insert into public.journal_templates (company_id, name) values (c3, 'ZZCO テンプレC') returning id into v_tpl3;
    v_t := pg_temp.err(format('insert into public.journal_template_lines (template_id, line_number, side, account_id) values (%L, 1, %L, %L)', v_tpl, 'DEBIT', a3_cash));
    if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C16: テンプレート明細で他社の科目は 23503: ' || v_t)); end if;
    v_t := pg_temp.err(format('insert into public.journal_template_lines (template_id, line_number, side, account_id, company_id) values (%L, 1, %L, %L, %L)', v_tpl3, 'DEBIT', a3_cash, c1));
    if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('C17: 他社のテンプレートへの明細は 23503: ' || v_t)); end if;
    -- 自社なら入り、company_id はテンプレートから自動設定される。科目を消すと account_id だけ NULL になる（ON DELETE SET NULL (列)）
    insert into public.journal_template_lines (template_id, line_number, side, account_id) values (v_tpl, 1, 'DEBIT', v_sub);
    if (select company_id from public.journal_template_lines where template_id = v_tpl) is distinct from c1 then
      v_fails := array_append(v_fails, 'C18: テンプレート明細の company_id が自動設定されること');
    end if;
    -- 取込データの補助科目列も同様
    insert into public.import_staging (company_id, raw_date, raw_description, debit_sub_account_id) values (c1, '2098-06-02', 'ZZCO sub', v_sub) returning id into s1;
    delete from public.accounts where id = v_sub;
    if (select account_id from public.journal_template_lines where template_id = v_tpl) is not null
       or (select company_id from public.journal_template_lines where template_id = v_tpl) is distinct from c1 then
      v_fails := array_append(v_fails, 'C19: 科目の削除でテンプレート明細の account_id だけが NULL になり company_id は残ること');
    end if;
    if (select debit_sub_account_id from public.import_staging where id = s1) is not null
       or (select company_id from public.import_staging where id = s1) is distinct from c1 then
      v_fails := array_append(v_fails, 'C20: 科目の削除で取込データの補助科目列だけが NULL になり company_id は残ること');
    end if;
  end;

  -- ------------------------------------------------------------
  -- D. 区分の CHECK（種別との整合・会社区分別）
  -- ------------------------------------------------------------
  foreach v_t in array array[
    -- 法人に事業主区分・個人用PL区分
    format('insert into public.accounts (company_id, code, name, type, bs_category) values (%L, ''ZZ-D1'', ''x'', ''ASSET'', ''OWNER_DRAWINGS'')', c1),
    format('insert into public.accounts (company_id, code, name, type, bs_category) values (%L, ''ZZ-D2'', ''x'', ''LIABILITY'', ''OWNER_CONTRIBUTIONS'')', c1),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D3'', ''x'', ''REVENUE'', ''RESERVE_REVERSAL'')', c1),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D4'', ''x'', ''EXPENSE'', ''RESERVE_PROVISION'')', c3),
    -- 個人に営業外・特別・法人税等
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D5'', ''x'', ''REVENUE'', ''NON_OP_INCOME'')', c2),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D6'', ''x'', ''EXPENSE'', ''NON_OP_EXPENSE'')', c2),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D7'', ''x'', ''REVENUE'', ''EXTRA_INCOME'')', c2),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D8'', ''x'', ''EXPENSE'', ''EXTRA_LOSS'')', c2),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D9'', ''x'', ''EXPENSE'', ''TAX'')', c2),
    -- 種別と区分の不整合・未知の値
    format('insert into public.accounts (company_id, code, name, type, bs_category) values (%L, ''ZZ-D10'', ''x'', ''ASSET'', ''CURRENT_LIABILITIES'')', c1),
    format('insert into public.accounts (company_id, code, name, type, bs_category) values (%L, ''ZZ-D11'', ''x'', ''EXPENSE'', ''CURRENT_ASSETS'')', c1),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D12'', ''x'', ''REVENUE'', ''COGS'')', c1),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D13'', ''x'', ''ASSET'', ''SGA'')', c1),
    format('insert into public.accounts (company_id, code, name, type, bs_category) values (%L, ''ZZ-D14'', ''x'', ''ASSET'', ''NOPE'')', c1),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-D15'', ''x'', ''EXPENSE'', ''NOPE'')', c1),
    format('insert into public.accounts (company_id, code, name, type, default_tax_code) values (%L, ''ZZ-D16'', ''x'', ''EXPENSE'', ''OUT_OF_SCOPE'')', c1),
    format('insert into public.accounts (company_id, code, name, type, default_tax_code) values (%L, ''ZZ-D17'', ''x'', ''EXPENSE'', ''課税10%%'')', c1)
  ] loop
    v_total := v_total + 1;
    if split_part(pg_temp.err(v_t), '|', 1) <> '23514' then
      v_fails := array_append(v_fails, ('D1: CHECK 違反 (23514) になること: ' || v_t || ' → ' || pg_temp.err(v_t)));
    end if;
  end loop;

  -- 通る組み合わせ
  foreach v_t in array array[
    format('insert into public.accounts (company_id, code, name, type, bs_category) values (%L, ''ZZ-E1'', ''x'', ''ASSET'', ''OWNER_DRAWINGS'')', c2),
    format('insert into public.accounts (company_id, code, name, type, bs_category) values (%L, ''ZZ-E2'', ''x'', ''LIABILITY'', ''OWNER_CONTRIBUTIONS'')', c2),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-E3'', ''x'', ''EXPENSE'', ''RESERVE_PROVISION'')', c2),
    format('insert into public.accounts (company_id, code, name, type, pl_category) values (%L, ''ZZ-E4'', ''x'', ''REVENUE'', ''EXTRA_INCOME'')', c1),
    format('insert into public.accounts (company_id, code, name, type, pl_category, default_tax_code) values (%L, ''ZZ-E5'', ''x'', ''EXPENSE'', ''TAX'', ''PURCHASE_RETURN'')', c3),
    format('insert into public.accounts (company_id, code, name, type) values (%L, ''ZZ-E6'', ''x'', ''EXPENSE'')', c1)
  ] loop
    v_total := v_total + 1;
    if pg_temp.err(v_t) <> 'OK' then v_fails := array_append(v_fails, ('D2: 通ること: ' || v_t || ' → ' || pg_temp.err(v_t))); end if;
  end loop;

  -- 同じコードは会社が違えば作れる。同じ会社では 23505
  v_total := v_total + 1;
  if pg_temp.err(format('insert into public.accounts (company_id, code, name, type) values (%L, ''ZZ-F1'', ''x'', ''EXPENSE'')', c1)) <> 'OK'
     or pg_temp.err(format('insert into public.accounts (company_id, code, name, type) values (%L, ''ZZ-F1'', ''x'', ''EXPENSE'')', c3)) <> 'OK' then
    v_fails := array_append(v_fails, 'D3: 同じコードを別の会社に作れること');
  end if;
  v_total := v_total + 1;
  if split_part(pg_temp.err(format('insert into public.accounts (company_id, code, name, type) values (%L, ''ZZ-F1'', ''y'', ''EXPENSE'')', c1)), '|', 1) <> '23505' then
    v_fails := array_append(v_fails, 'D4: 同じ会社の同じコードは 23505');
  end if;

  -- company_kind は呼び出し側の指定を無視して会社の区分になる
  v_total := v_total + 1;
  insert into public.accounts (company_id, company_kind, code, name, type) values (c1, 'INDIVIDUAL', 'ZZ-F2', 'x', 'EXPENSE') returning id into v_id;
  if (select company_kind from public.accounts where id = v_id) <> 'CORPORATION' then v_fails := array_append(v_fails, 'D5: company_kind は会社の区分で上書きされること'); end if;
  v_total := v_total + 1;
  if split_part(pg_temp.err(format('insert into public.accounts (company_id, code, name, type) values (%L, ''ZZ-F3'', ''x'', ''EXPENSE'')', gen_random_uuid())), '|', 1) <> '23503' then
    v_fails := array_append(v_fails, 'D6: 存在しない会社への科目は 23503');
  end if;

  -- ------------------------------------------------------------
  -- E. 繰越先・会社の区分
  -- ------------------------------------------------------------
  select carry_forward_account_id into v_id from public.companies where id = c1;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('delete from public.accounts where id = %L', v_id));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('E1: 繰越先の科目は削除できない: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.accounts set type = ''ASSET'', bs_category = ''CURRENT_ASSETS'' where id = %L', v_id));
  if split_part(v_t, '|', 2) <> 'INVALID_CARRY_FORWARD_ACCOUNT' then v_fails := array_append(v_fails, ('E2: 繰越先の type を EQUITY 以外にできない: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.accounts set bs_category = null where id = %L', v_id));
  if split_part(v_t, '|', 2) <> 'INVALID_CARRY_FORWARD_ACCOUNT' then v_fails := array_append(v_fails, ('E3: 繰越先の bs_category を EQUITY 以外にできない: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.accounts set parent_id = %L where id = %L', (select id from public.accounts where company_id = c1 and code = '500'), v_id));
  if split_part(v_t, '|', 2) <> 'INVALID_CARRY_FORWARD_ACCOUNT' then v_fails := array_append(v_fails, ('E4: 繰越先を補助科目にできない: ' || v_t)); end if;
  v_total := v_total + 1;
  if pg_temp.err(format('update public.accounts set name = ''繰越利益（改）'' where id = %L', v_id)) <> 'OK' then v_fails := array_append(v_fails, 'E5: 繰越先の科目名は変更できること'); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.companies set carry_forward_account_id = %L where id = %L', a1_cash, c1));
  if split_part(v_t, '|', 2) <> 'INVALID_CARRY_FORWARD_ACCOUNT' then v_fails := array_append(v_fails, ('E6: 繰越先に EQUITY 以外を設定できない: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.companies set carry_forward_account_id = %L where id = %L', (select carry_forward_account_id from public.companies where id = c3), c1));
  if split_part(v_t, '|', 1) <> '23503' then v_fails := array_append(v_fails, ('E7: 繰越先に他社の科目を設定できない: ' || v_t)); end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.companies set kind = ''INDIVIDUAL'' where id = %L', c1));
  if split_part(v_t, '|', 2) <> 'COMPANY_KIND_IMMUTABLE' then v_fails := array_append(v_fails, ('E8: 会社の区分は変更できない: ' || v_t)); end if;
  v_total := v_total + 1;
  if pg_temp.err(format('update public.companies set name = ''ZZCO 法人A改'' where id = %L', c1)) <> 'OK' then v_fails := array_append(v_fails, 'E9: 会社名は変更できること'); end if;
  v_total := v_total + 1;
  if pg_temp.err(format('update public.companies set carry_forward_account_id = null where id = %L', c3)) <> 'OK' then v_fails := array_append(v_fails, 'E10: 繰越先を未設定（NULL）にできること'); end if;

  -- ------------------------------------------------------------
  -- F. 当期は会社ごとに1つ
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  if (select count(*) from public.fiscal_periods where is_current and company_id in (c1, c2, c3)) <> 3 then
    v_fails := array_append(v_fails, 'F1: 3社それぞれに当期があること');
  end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (%L, ''ZZCO 2'', ''2099-04-01'', ''2100-03-31'', true)', c1));
  if split_part(v_t, '|', 1) <> '23505' then v_fails := array_append(v_fails, ('F2: 同じ会社の当期は1つだけ: ' || v_t)); end if;
  v_total := v_total + 1;
  if pg_temp.err(format('insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (%L, ''ZZCO 2'', ''2099-04-01'', ''2100-03-31'', false)', c1)) <> 'OK' then
    v_fails := array_append(v_fails, 'F3: 当期でない期は追加できること');
  end if;

  -- ------------------------------------------------------------
  -- G. 期首残高は会社ごとに独立
  -- ------------------------------------------------------------
  declare
    q1 uuid; q3 uuid; r1 uuid; r3 uuid;
  begin
    -- 前期（1期前）を作り、各社に別の金額の仕訳を入れる
    insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (c1, 'ZZCO A前期', '2097-04-01', '2098-03-31', false) returning id into q1;
    insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (c3, 'ZZCO C前期', '2097-04-01', '2098-03-31', false) returning id into q3;
    perform public.create_journal_entry(q1, '2097-06-01', 'ZZCO A前期', null, v_lines1);
    perform public.create_journal_entry(q3, '2097-06-01', 'ZZCO C前期', null, v_lines3);

    -- G1・G2 はステップ2（期首残高）で期待値を変更した。損益科目は期首残高に返らず、繰越先へ畳み込まれる
    -- G1: 法人Aの期首は自社の仕訳だけ。現金1000が返り、売上は返らず、繰越先（540）に貸方1000として集約される
    v_total := v_total + 1;
    if (select balance from public.get_opening_balances_for_period(p1) where account_id = a1_cash) is distinct from 1000
       or (select count(*) from public.get_opening_balances_for_period(p1)) <> 2
       or exists (select 1 from public.get_opening_balances_for_period(p1) where account_id = a1_sales)
       or (select balance from public.get_opening_balances_for_period(p1)
            where account_id = (select carry_forward_account_id from public.companies where id = c1)) is distinct from -1000
       or exists (select 1 from public.get_opening_balances_for_period(p1) where account_id in (a3_cash, a3_sales)) then
      v_fails := array_append(v_fails, 'G1: 法人Aの期首残高は自社の仕訳だけ（現金1000・繰越先-1000・売上は返らない）であること');
    end if;
    -- G2: 法人Cは繰越先が未設定（E10）。前期に売上があり畳み込みが必要なので、黙って進まず CARRY_FORWARD_NOT_SET になる
    v_total := v_total + 1;
    if pg_temp.err(format('select * from public.get_opening_balances_for_period(%L)', p3)) <> 'P0001|CARRY_FORWARD_NOT_SET' then
      v_fails := array_append(v_fails, 'G2: 繰越先未設定の会社で、前期に損益があれば CARRY_FORWARD_NOT_SET になること');
    end if;
    -- G2b: 繰越先未設定でも、前期が資産科目だけの仕訳（畳み込み不要）なら取得でき、他社の科目は混ざらない
    declare
      v_dres jsonb; v_pd1 uuid; v_pd2 uuid; v_d_cash uuid; v_d_cur uuid;
    begin
      v_dres := public.create_company('ZZCO 法人D', 'CORPORATION', null, '2097-04-01', '2098-03-31');
      v_pd1 := (v_dres->>'period_id')::uuid;
      insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current)
        values ((v_dres->>'company_id')::uuid, 'ZZCO D2', '2098-04-01', '2099-03-31', false) returning id into v_pd2;
      update public.companies set carry_forward_account_id = null where id = (v_dres->>'company_id')::uuid;
      select id into v_d_cash from public.accounts where company_id = (v_dres->>'company_id')::uuid and code = '100';
      select id into v_d_cur  from public.accounts where company_id = (v_dres->>'company_id')::uuid and code = '110';
      perform public.create_journal_entry(v_pd1, '2097-06-01', 'ZZCO D前期', null, jsonb_build_array(
        jsonb_build_object('side', 'DEBIT',  'account_id', v_d_cur,  'amount', '300', 'tax_code', null),
        jsonb_build_object('side', 'CREDIT', 'account_id', v_d_cash, 'amount', '300', 'tax_code', null)));
      v_total := v_total + 1;
      if (select balance from public.get_opening_balances_for_period(v_pd2) where account_id = v_d_cur) is distinct from 300
         or (select balance from public.get_opening_balances_for_period(v_pd2) where account_id = v_d_cash) is distinct from -300
         or (select count(*) from public.get_opening_balances_for_period(v_pd2)) <> 2
         or exists (select 1 from public.get_opening_balances_for_period(v_pd2) where account_id in (a1_cash, a1_sales, a3_cash, a3_sales)) then
        v_fails := array_append(v_fails, 'G2b: 繰越先未設定でも、前期が資産科目だけなら期首残高を取得でき、他社の科目が混ざらないこと');
      end if;
    end;
    v_total := v_total + 1;
    if (select count(*) from public.get_opening_balances_for_period(p2)) <> 0 then
      v_fails := array_append(v_fails, 'G3: 仕訳のない個人Bの期首残高は空であること（他社の仕訳が混ざらない）');
    end if;
  end;

  -- ------------------------------------------------------------
  -- H. 伝票番号は期ごと（＝会社ごと）に独立。保存・編集の回帰
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  v_res := public.create_journal_entry(p3, '2098-05-01', 'ZZCO 法人C 仕訳', null, v_lines3);
  v_e3 := (v_res->>'id')::uuid;
  if (v_res->>'reference_number')::integer <> 1 then v_fails := array_append(v_fails, ('H1: 法人Cの最初の伝票番号は1: ' || v_res::text)); end if;
  v_total := v_total + 1;
  if (select reference_number from public.journal_entries where id = v_e1) <> 1 then v_fails := array_append(v_fails, 'H2: 法人Aの最初の伝票番号も1（会社をまたいで影響しない）'); end if;
  v_total := v_total + 1;
  v_res := public.create_journal_entry(p1, '2098-05-04', 'ZZCO 法人A 手入力', 7, v_lines1);
  v_res := public.create_journal_entry(p3, '2098-05-04', 'ZZCO 法人C 手入力', 7, v_lines3);
  if (select count(*) from public.journal_entries where description like 'ZZCO 法人_ 手入力' and reference_number = 7) <> 2 then
    v_fails := array_append(v_fails, 'H3: 同じ番号を別の会社の期で使えること');
  end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('select public.create_journal_entry(%L, %L, %L, 7, %L)', p1, '2098-05-05', 'ZZCO 重複', v_lines1));
  if split_part(v_t, '|', 2) <> 'DUPLICATE_REFERENCE_NUMBER' then v_fails := array_append(v_fails, ('H4: 同じ期の重複は拒否: ' || v_t)); end if;

  v_total := v_total + 1;
  perform public.update_journal_entry(v_e1, '2098-05-01', 'ZZCO 法人A 編集後', null,
    jsonb_build_array(jsonb_build_object('side', 'DEBIT', 'account_id', a1_cash, 'amount', '2500', 'tax_code', null),
                      jsonb_build_object('side', 'CREDIT', 'account_id', a1_sales, 'amount', '2500', 'tax_code', null)));
  if (select sum(amount) from public.journal_lines where entry_id = v_e1 and side = 'DEBIT') <> 2500
     or (select count(*) from public.journal_lines where entry_id = v_e1 and company_id = c1) <> 2 then
    v_fails := array_append(v_fails, 'H5: 編集後も明細の company_id が保たれること');
  end if;

  -- 借貸不一致は従来どおり拒否
  v_total := v_total + 1;
  v_t := pg_temp.err(format('select public.create_journal_entry(%L, %L, %L, null, %L)', p1, '2098-05-06', 'ZZCO 不一致',
        jsonb_build_array(jsonb_build_object('side', 'DEBIT', 'account_id', a1_cash, 'amount', '100', 'tax_code', null),
                          jsonb_build_object('side', 'CREDIT', 'account_id', a1_sales, 'amount', '90', 'tax_code', null))));
  if split_part(v_t, '|', 2) <> 'DEBIT_CREDIT_MISMATCH' then v_fails := array_append(v_fails, ('H6: 借貸不一致は拒否: ' || v_t)); end if;

  -- 仕訳を消すと明細も消える（ON DELETE CASCADE の維持）
  v_total := v_total + 1;
  delete from public.journal_entries where id = v_e3;
  if exists (select 1 from public.journal_lines where entry_id = v_e3) then v_fails := array_append(v_fails, 'H7: 仕訳の削除で明細も削除されること（CASCADE）'); end if;

  -- ------------------------------------------------------------
  -- I. 取込本登録: 取込行の会社と期の会社が違えば拒否
  -- ------------------------------------------------------------
  declare
    t1 uuid; t2 uuid;
  begin
    insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id)
    values (c1, '2098-07-01', 50, 50, 'ZZCO import1', a1_cash, a1_sales) returning id into t1;
    insert into public.import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id)
    values (c1, '2098-07-02', 60, 60, 'ZZCO import2', a1_cash, a1_sales) returning id into t2;

    v_total := v_total + 1;
    v_t := pg_temp.err(format('select public.import_staging_entries(%L, array[%L]::uuid[])', p3, t1));
    if split_part(v_t, '|', 2) <> 'COMPANY_MISMATCH' then v_fails := array_append(v_fails, ('I1: 他社の期への本登録は COMPANY_MISMATCH: ' || v_t)); end if;
    v_total := v_total + 1;
    if exists (select 1 from public.import_staging where id in (t1, t2) and coalesce(is_processed, false))
       or exists (select 1 from public.journal_entries where description like 'ZZCO import%') then
      v_fails := array_append(v_fails, 'I2: 拒否された本登録で何も残らないこと');
    end if;
    v_total := v_total + 1;
    v_t := pg_temp.err(format('select public.import_staging_entries(%L, array[%L, %L]::uuid[])', p3, t2, t1));
    if split_part(v_t, '|', 2) <> 'COMPANY_MISMATCH' then v_fails := array_append(v_fails, ('I3: 複数行でも拒否: ' || v_t)); end if;
    v_total := v_total + 1;
    v_t := pg_temp.err(format('select public.import_staging_entries(%L, array[%L]::uuid[])', gen_random_uuid(), t1));
    if split_part(v_t, '|', 2) <> 'PERIOD_NOT_FOUND' then v_fails := array_append(v_fails, ('I4: 存在しない期は従来どおり PERIOD_NOT_FOUND: ' || v_t)); end if;

    v_total := v_total + 1;
    -- 関数の結果を先に受け取る（同じ文の中の副問い合わせからは、関数内の INSERT が見えないため）
    v_n := public.import_staging_entries(p1, array[t1, t2]);
    if v_n <> 2
       or (select count(*) from public.journal_entries where description like 'ZZCO import%' and company_id = c1) <> 2
       or (select count(*) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
            where e.description like 'ZZCO import%' and l.company_id = c1) <> 4 then
      v_fails := array_append(v_fails, 'I5: 同じ会社の期への本登録は成功し、company_id が付くこと');
    end if;
  end;

  -- ------------------------------------------------------------
  -- J. 権限・RLS・anon ロールでの実行
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  if not has_function_privilege('anon', 'public.create_company(text,text,text,date,date)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_company(text,text,text,date,date)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.company_seed_accounts(text)', 'EXECUTE') then
    v_fails := array_append(v_fails, 'J1: anon / authenticated が create_company・company_seed_accounts を実行できること');
  end if;
  v_total := v_total + 1;
  if exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as x
     where p.pronamespace = 'public'::regnamespace and x.grantee = 0 and x.privilege_type = 'EXECUTE'
       and p.proname in ('create_company', 'company_seed_accounts', 'forbid_company_kind_change', 'fill_journal_entry_company',
                         'fill_journal_line_company', 'fill_template_line_company', 'fill_account_company_kind', 'forbid_company_id_change',
                         'inherit_parent_account_attrs', 'propagate_parent_account_attrs', 'check_company_carry_forward', 'guard_carry_forward_account')
  ) then
    v_fails := array_append(v_fails, 'J2: 新しい関数の EXECUTE が PUBLIC に付いていないこと');
  end if;
  v_total := v_total + 1;
  if not (select relrowsecurity from pg_class where oid = 'public.companies'::regclass)
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies') then
    v_fails := array_append(v_fails, 'J3: companies の RLS が有効で policy があること');
  end if;
  v_total := v_total + 1;
  if has_table_privilege('anon', 'public.companies', 'TRUNCATE') or has_table_privilege('anon', 'public.companies', 'REFERENCES')
     or has_table_privilege('anon', 'public.companies', 'TRIGGER') or has_table_privilege('authenticated', 'public.companies', 'TRUNCATE')
     or has_table_privilege('anon', 'public.companies', 'DELETE')
     or not has_table_privilege('anon', 'public.companies', 'SELECT') or not has_table_privilege('anon', 'public.companies', 'INSERT')
     or not has_table_privilege('anon', 'public.companies', 'UPDATE') then
    v_fails := array_append(v_fails, 'J4: companies に SELECT/INSERT/UPDATE のみ付与され、TRUNCATE/REFERENCES/TRIGGER/DELETE は無いこと');
  end if;

  v_total := v_total + 1;
  begin
    set local role anon;
    v_res := public.create_company('ZZCO anon社', 'INDIVIDUAL', 'EXEMPT', '2099-01-01', '2099-12-31');
    v_id := (select id from public.accounts where company_id = (v_res->>'company_id')::uuid and code = '100');
    v_res := public.create_journal_entry((v_res->>'period_id')::uuid, '2099-03-01', 'ZZCO anon 仕訳', null,
      jsonb_build_array(jsonb_build_object('side', 'DEBIT', 'account_id', v_id, 'amount', '10', 'tax_code', null),
                        jsonb_build_object('side', 'CREDIT', 'account_id', (select id from public.accounts where company_id = (select company_id from public.accounts where id = v_id) and code = '500'), 'amount', '10', 'tax_code', null)));
    reset role;
    if (v_res->>'reference_number')::integer <> 1 then v_fails := array_append(v_fails, 'J5: anon で会社作成→保存ができ、番号が1から始まること'); end if;
  exception when others then
    reset role;
    v_fails := array_append(v_fails, ('J5: anon ロールで会社作成・保存ができること: ' || sqlerrm));
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
