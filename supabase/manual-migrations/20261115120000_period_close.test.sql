-- ステップ3: 年度の確定／ロック の SQL テスト
-- 使い方: Supabase SQL Editor に全体を貼って実行する（ローカルなら psql -f）。
-- 全体を1トランザクションで実行し、最後に意図的な例外でロールバックする（データは残らない）。
-- 結果は最後の ERROR メッセージ「TEST RESULT: ...」で確認する。ALL PASSED 以外は、失敗した項目名が列挙される。
-- 前提: 20261115120000_period_close.sql を適用済みであること。

BEGIN;

CREATE TABLE public.t_results (n serial, name text, ok boolean);
ALTER TABLE public.t_results DISABLE ROW LEVEL SECURITY; -- Supabase は public の新テーブルに RLS を自動で有効化する（rls_auto_enable）。anon が結果を記録できるよう外す
GRANT ALL ON public.t_results TO PUBLIC;
GRANT USAGE ON SEQUENCE public.t_results_n_seq TO PUBLIC;

-- 判定の記録。cond が NULL のときは失敗として扱う
CREATE FUNCTION public.t_chk(p_name text, p_cond boolean) RETURNS void
LANGUAGE sql AS $$ insert into public.t_results (name, ok) values (p_name, coalesce(p_cond, false)); $$;

-- SQL を実行し、P0001 ならメッセージ、成功なら 'OK'、それ以外なら 'ERR:<SQLSTATE>' を返す
CREATE FUNCTION public.t_err(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
begin
  execute p_sql;
  return 'OK';
exception
  when sqlstate 'P0001' then
    get stacked diagnostics p_sql = message_text;
    return p_sql;
  when others then
    return 'ERR:' || sqlstate;
end;
$$;

-- t_err と同じだが、P0001 のときは「メッセージ|DETAIL」を返す（E1〜E5 の種類まで確認するため）
CREATE FUNCTION public.t_errd(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
declare m text; d text;
begin
  execute p_sql;
  return 'OK';
exception
  when sqlstate 'P0001' then
    get stacked diagnostics m = message_text, d = pg_exception_detail;
    return m || '|' || coalesce(d, '');
  when others then
    return 'ERR:' || sqlstate;
end;
$$;

GRANT EXECUTE ON FUNCTION public.t_chk(text, boolean), public.t_err(text), public.t_errd(text) TO PUBLIC;

DO $test$
declare
  cA uuid; cB uuid; cC uuid; cD uuid; cE uuid; cF uuid; cG uuid;
  pE1 uuid; pF1 uuid; pF2 uuid; pF3 uuid; pG1 uuid; pG2 uuid; gcash uuid; gcarry uuid; fcarry uuid; fcash uuid; frev uuid; fexp uuid; sI1 uuid; sI2 uuid;
  pA1 uuid; pA2 uuid; pA3 uuid;
  pB1 uuid; pB2 uuid;
  pC1 uuid; pC2 uuid;
  pD1 uuid; pD2 uuid;
  acash uuid; arev uuid; asga uuid; acarry uuid; acarry2 uuid; aunused uuid; asga2 uuid;
  bcash uuid; brev uuid;
  ccash uuid; crev uuid; cbad uuid; ccarry uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; eB1 uuid;
  v_res jsonb; v_txt text; v_cnt integer; v_ts timestamptz; v_arr text[];
  v_fail text; v_total integer;
  f text;
  r record;
begin
  ----------------------------------------------------------------
  -- 準備: 会社A（法人・3期）と会社B（法人・2期）。作成は postgres ロール
  ----------------------------------------------------------------
  select (create_company('テストA', 'CORPORATION', 'EXEMPT', '2025-01-01', '2025-12-31')->>'company_id')::uuid into cA;
  select id into pA1 from fiscal_periods where company_id = cA;
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current) values (cA, 'A2', '2026-01-01', '2026-12-31', false) returning id into pA2;
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current) values (cA, 'A3', '2027-01-01', '2027-12-31', false) returning id into pA3;
  select id into acash  from accounts where company_id = cA and code = '100';
  select id into arev   from accounts where company_id = cA and code = '700';
  select id into asga   from accounts where company_id = cA and code = '760';
  select id into acarry from accounts where company_id = cA and code = '540';
  select id into asga2  from accounts where company_id = cA and code = '761';
  select id into aunused from accounts where company_id = cA and code = '101';   -- 小口現金（仕訳なし）
  select id into acarry2 from accounts where company_id = cA and code = '535';   -- 別途積立金（EQUITY・別の繰越先候補）

  select (create_company('テストB', 'CORPORATION', 'EXEMPT', '2025-01-01', '2025-12-31')->>'company_id')::uuid into cB;
  select id into pB1 from fiscal_periods where company_id = cB;
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current) values (cB, 'B2', '2026-01-01', '2026-12-31', false) returning id into pB2;
  select id into bcash from accounts where company_id = cB and code = '100';
  select id into brev  from accounts where company_id = cB and code = '700';

  -- 仕訳: A1に1件、A2に2件（e3は科目761のみ）
  select (create_journal_entry(pA1, '2025-03-01', 'A1売上', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',acash,'amount','1000','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',arev,'amount','1000','tax_code',null)), null)->>'id')::uuid into e1;
  select (create_journal_entry(pA2, '2026-03-01', 'A2売上', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',acash,'amount','500','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',arev,'amount','500','tax_code',null)), null)->>'id')::uuid into e2;
  select (create_journal_entry(pA2, '2026-04-01', 'A2経費', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',asga2,'amount','30','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',acash,'amount','30','tax_code',null)), null)->>'id')::uuid into e3;
  select (create_journal_entry(pB1, '2025-03-01', 'B1売上', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',bcash,'amount','70','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',brev,'amount','70','tax_code',null)), null)->>'id')::uuid into eB1;

  ----------------------------------------------------------------
  -- A. 構造（オブジェクトの存在・権限）
  ----------------------------------------------------------------
  perform t_chk('A01 closed_at 列がある', exists (select 1 from information_schema.columns where table_name='fiscal_periods' and column_name='closed_at'));
  perform t_chk('A02 履歴表がある', to_regclass('public.fiscal_period_close_logs') is not null);
  perform t_chk('A03 履歴表のRLSが有効', (select relrowsecurity from pg_class where oid = 'public.fiscal_period_close_logs'::regclass));
  perform t_chk('A04 新トリガー10本', (select count(*) from pg_trigger where not tgisinternal and tgname in (
      'trg_journal_entries_closed_guard','trg_journal_lines_z_closed_guard','trg_pob_sets_closed_guard','trg_pob_lines_closed_guard',
      'trg_fiscal_periods_closed_insert','trg_fiscal_periods_closed_dates','trg_fiscal_periods_closed_delete','trg_fiscal_periods_close_state',
      'trg_accounts_d_guard_closed_periods','trg_companies_guard_closed_carry_forward')) = 10);
  -- 明細の確定ガードは trg_journal_lines_guard（親行ロック）より後に発火すること
  perform t_chk('A05 明細ガードの発火順（guard → z_closed_guard）',
    (select array_position(array_agg(tgname order by tgname), 'trg_journal_lines_z_closed_guard')
          > array_position(array_agg(tgname order by tgname), 'trg_journal_lines_guard')
       from pg_trigger where tgrelid = 'public.journal_lines'::regclass and not tgisinternal and tgtype & 2 = 2));
  perform t_chk('A06 科目ガードが親継承トリガーより後（b_ → d_）',
    (select array_position(array_agg(tgname order by tgname), 'trg_accounts_d_guard_closed_periods')
          > array_position(array_agg(tgname order by tgname), 'trg_accounts_b_inherit_parent')
       from pg_trigger where tgrelid = 'public.accounts'::regclass and not tgisinternal and tgtype & 2 = 2));
  foreach f in array array[
      'public.period_lock_company(uuid, boolean)','public.period_assert_open(uuid)','public.period_close_prev_open(uuid)',
      'public.period_carry_forward_amount(uuid, date)','public.period_close_errors(uuid)','public.period_close_warnings(uuid)',
      'public.guard_period_range(uuid, uuid, date)','public.get_period_close_check(uuid)',
      'public.close_fiscal_period(uuid, text)','public.reopen_fiscal_period(uuid, text)'] loop
    perform t_chk('A07 anon が実行可能: ' || f, has_function_privilege('anon', f, 'EXECUTE'));
    perform t_chk('A08 authenticated が実行可能: ' || f, has_function_privilege('authenticated', f, 'EXECUTE'));
    perform t_chk('A09 PUBLIC には付与しない: ' || f, (select not coalesce(proacl::text, '') ~ '(^\{|,)=X' from pg_proc where oid = f::regprocedure));
  end loop;
  perform t_chk('A12 確認系関数5本は VOLATILE（STABLE だと同一ブロックの式内で直前の書き込みが見えない）',
    (select count(*) from pg_proc where proname in ('period_close_prev_open','period_carry_forward_amount','period_close_errors','period_close_warnings','get_period_close_check') and provolatile = 'v') = 5);
  perform t_chk('A13 同じトランザクションで作った期を、式の中から呼んでも見つかる（回帰）',
    (select count(*) from unnest(period_close_errors(pA1)) w) >= 0 and (select count(*) from unnest(period_close_errors(pB2)) w) >= 0);
  perform t_chk('A10 トリガー関数は PUBLIC に実行権なし', (select count(*) from pg_proc
      where (proname like 'guard\_%closed%' or proname in ('guard_period_close_state','guard_fiscal_period_insert','guard_fiscal_period_dates','guard_fiscal_period_delete','guard_account_in_closed_periods'))
        and coalesce(proacl::text,'') ~ '(^\{|,)=X') = 0);
  perform t_chk('A11 履歴表: anon に UPDATE/DELETE/TRUNCATE なし',
    not has_table_privilege('anon', 'public.fiscal_period_close_logs', 'UPDATE')
    and not has_table_privilege('anon', 'public.fiscal_period_close_logs', 'DELETE')
    and not has_table_privilege('anon', 'public.fiscal_period_close_logs', 'TRUNCATE')
    and has_table_privilege('anon', 'public.fiscal_period_close_logs', 'INSERT')
    and has_table_privilege('anon', 'public.fiscal_period_close_logs', 'SELECT'));

  ----------------------------------------------------------------
  -- B. 確定前チェック（期を確定する前に判定する）
  ----------------------------------------------------------------
  v_res := get_period_close_check(pA1);
  perform t_chk('B01 初回の期は確定可能（エラーなし）', jsonb_array_length(v_res->'errors') = 0 and (v_res->>'closed')::boolean = false);
  v_res := get_period_close_check(pA2);
  perform t_chk('B02 2期目は E1（直前の期が未確定）', v_res->'errors'->>0 like 'E1:%');
  perform t_chk('B03 存在しない期は PERIOD_NOT_FOUND', t_err(format('select get_period_close_check(%L)', gen_random_uuid())) = 'PERIOD_NOT_FOUND');
  perform t_chk('B04 W1 未処理の取込が無ければ警告なし', not exists (select 1 from jsonb_array_elements_text(get_period_close_check(pA1)->'warnings') w where w like 'W1:%'));
  insert into import_staging (company_id, raw_date, raw_description, is_processed) values (cA, '2025-01-05', 'x', false);
  perform t_chk('B05 W1 未処理の取込があれば警告', exists (select 1 from jsonb_array_elements_text(get_period_close_check(pA1)->'warnings') w where w like 'W1:%'));
  perform t_chk('B06 W3 仕訳のある期には出ない', not exists (select 1 from jsonb_array_elements_text(get_period_close_check(pA1)->'warnings') w where w like 'W3:%'));
  perform t_chk('B07 W3 仕訳が無い期に出る', exists (select 1 from jsonb_array_elements_text(get_period_close_check(pA3)->'warnings') w where w like 'W3:%'));

  -- E4: 財務諸表区分が NULL の科目に仕訳がある（会社C）
  select (create_company('テストC', 'CORPORATION', 'EXEMPT', '2025-01-01', '2025-12-31')->>'company_id')::uuid into cC;
  select id into pC1 from fiscal_periods where company_id = cC;
  select id into ccash from accounts where company_id = cC and code = '100';
  insert into accounts (company_id, code, name, type) values (cC, '999', '区分なし資産', 'ASSET') returning id into cbad;
  perform create_journal_entry(pC1, '2025-02-01', 'C区分なし', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',cbad,'amount','10','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',ccash,'amount','10','tax_code',null)), null);
  v_res := get_period_close_check(pC1);
  perform t_chk('B10 E4 区分なしの科目に仕訳', exists (select 1 from jsonb_array_elements_text(v_res->'errors') w where w like 'E4:%999%'));
  perform t_chk('B11 E4 のとき確定(RPC)は PERIOD_CLOSE_CHECK_FAILED', t_errd(format('select close_fiscal_period(%L)', pC1)) like 'PERIOD_CLOSE_CHECK_FAILED|E4:%');
  perform t_chk('B11b E4 のとき直接 UPDATE の確定も拒否', t_errd(format('update fiscal_periods set closed_at = now() where id = %L', pC1)) like 'PERIOD_CLOSE_CHECK_FAILED|E4:%');
  perform t_chk('B12 失敗した確定は closed_at を変えない', (select closed_at is null from fiscal_periods where id = pC1));
  perform t_chk('B13 失敗した確定は履歴を残さない', (select count(*) from fiscal_period_close_logs where period_id = pC1) = 0);
  perform t_chk('B14 E4 は会社で絞られる（会社Aは E4 なし）', not exists (select 1 from jsonb_array_elements_text(get_period_close_check(pA1)->'errors') w where w like 'E4:%'));

  -- E3 と E5: 別会社（会社E）。繰越先を外して損益の動きを作る
  select (create_company('テストE', 'CORPORATION', 'EXEMPT', '2025-01-01', '2025-12-31')->>'company_id')::uuid into cE;
  select id into pE1 from fiscal_periods where company_id = cE;
  select id into ccash from accounts where company_id = cE and code = '100';
  select id into crev  from accounts where company_id = cE and code = '700';
  select id into ccarry from accounts where company_id = cE and code = '540';
  perform create_journal_entry(pE1, '2025-02-01', 'E売上', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',ccash,'amount','100','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',crev,'amount','100','tax_code',null)), null);
  update companies set carry_forward_account_id = null where id = cE;
  v_res := get_period_close_check(pE1);
  perform t_chk('B20 E3 繰越先なしで損益あり', exists (select 1 from jsonb_array_elements_text(v_res->'errors') w where w like 'E3:%'));
  perform t_chk('B21 E3 のとき確定(RPC)は拒否', t_errd(format('select close_fiscal_period(%L)', pE1)) like 'PERIOD_CLOSE_CHECK_FAILED|E3:%');
  perform t_chk('B21b E3 のとき直接 UPDATE の確定も拒否', t_errd(format('update fiscal_periods set closed_at = now() where id = %L', pE1)) like 'PERIOD_CLOSE_CHECK_FAILED|E3:%');
  perform t_err(format('select reopen_fiscal_period(%L)', pE1));   -- 確定が誤って通った場合の後始末（正常時は PERIOD_NOT_CLOSED になるだけ）
  perform t_err(format('update companies set carry_forward_account_id = %L where id = %L', ccarry, cE));   -- 確定が誤って通った場合も、後続の判定を続けられるよう t_err 経由
  perform t_chk('B22 繰越先を設定すると E3 が消える', not exists (select 1 from jsonb_array_elements_text(get_period_close_check(pE1)->'errors') w where w like 'E3:%'));

  -- E5: 他の期と期間が重なる（未確定同士は作成できる）
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current) values (cE, 'E重複', '2025-06-01', '2025-09-30', false);
  perform t_chk('B30 E5 期間の重なり', exists (select 1 from jsonb_array_elements_text(get_period_close_check(pE1)->'errors') w where w like 'E5:%'));
  perform t_chk('B30b E5 のとき確定(RPC)は拒否', t_errd(format('select close_fiscal_period(%L)', pE1)) like 'PERIOD_CLOSE_CHECK_FAILED|E5:%');
  perform t_chk('B30c E5 のとき直接 UPDATE の確定も拒否', t_errd(format('update fiscal_periods set closed_at = now() where id = %L', pE1)) like 'PERIOD_CLOSE_CHECK_FAILED|E5:%');
  delete from fiscal_periods where name = 'E重複' and company_id = cE;
  perform t_chk('B31 重なりを消すと E5 が消える', not exists (select 1 from jsonb_array_elements_text(get_period_close_check(pE1)->'errors') w where w like 'E5:%'));
  -- E2（最初の期より前の仕訳）は、あり得ないデータが必要なため、ローカル専用ファイル *.test_local.sql で確認する

  -- E3 と導出関数の整合（ステップ2の get_derived_opening_balances_for_period と同じ金額か）
  select (create_company('テストF', 'CORPORATION', 'EXEMPT', '2025-01-01', '2025-12-31')->>'company_id')::uuid into cF;
  select id into pF1 from fiscal_periods where company_id = cF;
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current) values (cF, 'F2', '2026-01-01', '2026-12-31', false) returning id into pF2;
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current) values (cF, 'F3', '2027-01-01', '2027-12-31', false) returning id into pF3;
  select id into fcash  from accounts where company_id = cF and code = '100';
  select id into frev   from accounts where company_id = cF and code = '700';
  select id into fexp   from accounts where company_id = cF and code = '760';
  select id into fcarry from accounts where company_id = cF and code = '540';
  perform create_journal_entry(pF1, '2025-03-01', 'F売上', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',fcash,'amount','1000','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',frev,'amount','1000','tax_code',null)), null);
  perform create_journal_entry(pF1, '2025-04-01', 'F経費', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',fexp,'amount','300','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',fcash,'amount','300','tax_code',null)), null);
  perform t_chk('B50 繰越額 = -700（利益700は貸方＝負）', period_carry_forward_amount(cF, '2026-01-01') = -700);
  perform t_chk('B51 手動設定なし: 導出の繰越先の行 = 繰越額',
    (select balance from get_derived_opening_balances_for_period(pF2) where account_id = fcarry) = period_carry_forward_amount(cF, '2026-01-01'));
  -- 2期目に手動の期首残高（現金500・差額は繰越先へ）を置き、2期目にも売上200
  perform save_period_opening_balances(pF2, jsonb_build_array(jsonb_build_object('account_id', fcash, 'balance', '500.00')), 'm', true);
  perform create_journal_entry(pF2, '2026-03-01', 'F売上2', null,
    jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',fcash,'amount','200','tax_code',null),
                      jsonb_build_object('side','CREDIT','account_id',frev,'amount','200','tax_code',null)), null);
  perform t_chk('B52 手動設定を挟むと、繰越額は手動設定の期から数える（-200）', period_carry_forward_amount(cF, '2027-01-01') = -200);
  perform t_chk('B53 手動設定を挟んだ導出の繰越先の行 = 手動の繰越先(-500) + 繰越額(-200)',
    (select balance from get_derived_opening_balances_for_period(pF3) where account_id = fcarry)
      = (select balance from period_opening_balance_lines where period_id = pF2 and account_id = fcarry) + period_carry_forward_amount(cF, '2027-01-01'));
  perform t_chk('B54 手動設定の期自身の期首は手動の値のまま', (select balance from get_opening_balances_for_period(pF2) where account_id = fcarry) = -500);

  ----------------------------------------------------------------
  -- C. 確定・解除の基本動作（会社A）。RPC は anon で実行する
  ----------------------------------------------------------------
  perform t_chk('C01 順序違反: 2期目は先に確定できない', t_err(format('select close_fiscal_period(%L)', pA2)) = 'PERIOD_CLOSE_PREVIOUS_OPEN');
  perform t_chk('C02 順序違反: 直接 UPDATE でも拒否', t_err(format('update fiscal_periods set closed_at = now() where id = %L', pA2)) = 'PERIOD_CLOSE_PREVIOUS_OPEN');
  perform t_chk('C03 存在しない期の確定は PERIOD_NOT_FOUND', t_err(format('select close_fiscal_period(%L)', gen_random_uuid())) = 'PERIOD_NOT_FOUND');
  perform t_chk('C04 存在しない期の解除は PERIOD_NOT_FOUND', t_err(format('select reopen_fiscal_period(%L)', gen_random_uuid())) = 'PERIOD_NOT_FOUND');
  perform t_chk('C05 未確定の期の解除は PERIOD_NOT_CLOSED', t_err(format('select reopen_fiscal_period(%L)', pA1)) = 'PERIOD_NOT_CLOSED');

  set local role anon;
  v_res := close_fiscal_period(pA1, '2025年度の確定');
  reset role;
  perform t_chk('C10 anon が RPC で確定できる', (select closed_at is not null from fiscal_periods where id = pA1));
  perform t_chk('C11 戻り値に closed_at と警告', v_res->>'closed_at' is not null and jsonb_typeof(v_res->'warnings') = 'array');
  perform t_chk('C12 履歴 CLOSE が1件・メモつき', (select count(*) from fiscal_period_close_logs where period_id = pA1 and action = 'CLOSE' and memo = '2025年度の確定' and company_id = cA) = 1);
  perform t_chk('C13 二重確定は PERIOD_ALREADY_CLOSED', t_err(format('select close_fiscal_period(%L)', pA1)) = 'PERIOD_ALREADY_CLOSED');
  perform t_chk('C14 二重確定は履歴を増やさない', (select count(*) from fiscal_period_close_logs where period_id = pA1) = 1);
  perform t_chk('C15 get_period_close_check は closed=true', (get_period_close_check(pA1)->>'closed')::boolean);

  -- 確定日時の書き換えは不可
  perform t_chk('C17 確定済みの closed_at の書き換えを拒否', t_err(format('update fiscal_periods set closed_at = now() + interval ''1 day'' where id = %L', pA1)) = 'PERIOD_CLOSED_FIELDS');
  -- 履歴 INSERT は anon にも許可、UPDATE/DELETE は不可（権限エラー 42501）
  set local role anon;
  perform t_chk('C18 anon は履歴を INSERT できる', t_err(format('insert into fiscal_period_close_logs (company_id, period_id, action) values (%L, %L, ''CLOSE'')', cA, pA1)) = 'OK');
  perform t_chk('C19 anon は履歴を UPDATE できない', t_err('update fiscal_period_close_logs set memo = ''x''') = 'ERR:42501');
  perform t_chk('C20 anon は履歴を DELETE できない', t_err('delete from fiscal_period_close_logs') = 'ERR:42501');
  reset role;
  delete from fiscal_period_close_logs where memo is null and period_id = pA1 and action = 'CLOSE';   -- C18 の偽造行を除去

  ----------------------------------------------------------------
  -- D. 確定済みの期への書き込みを拒否（anon ロールで実行）
  ----------------------------------------------------------------
  insert into import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id, is_processed)
    values (cA, '2025-05-01', 100, 100, 'imp closed', acash, arev, false) returning id into sI1;
  insert into import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description, predicted_account_id, counter_account_id, is_processed)
    values (cA, '2026-05-01', 100, 100, 'imp open', acash, arev, false) returning id into sI2;
  set local role anon;
  perform t_chk('D01 新規仕訳(RPC)を拒否', t_err(format($q$select create_journal_entry(%L, '2025-05-01', 'x', null,
      jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',%L,'amount','1','tax_code',null),
                        jsonb_build_object('side','CREDIT','account_id',%L,'amount','1','tax_code',null)), null)$q$, pA1, acash, arev)) = 'PERIOD_CLOSED');
  perform t_chk('D02 仕訳の編集(RPC)を拒否', t_err(format($q$select update_journal_entry(%L, '2025-03-02', 'x', null,
      jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',%L,'amount','1000','tax_code',null),
                        jsonb_build_object('side','CREDIT','account_id',%L,'amount','1000','tax_code',null)), null)$q$, e1, acash, arev)) = 'PERIOD_CLOSED');
  perform t_chk('D03 ヘッダーの直接UPDATEを拒否', t_err(format('update journal_entries set description = ''x'' where id = %L', e1)) = 'PERIOD_CLOSED');
  perform t_chk('D04 日付だけの一括変更相当を拒否', t_err(format('update journal_entries set date = ''2025-03-05'' where id = any(array[%L]::uuid[])', e1)) = 'PERIOD_CLOSED');
  perform t_chk('D05 ヘッダーの直接DELETEを拒否', t_err(format('delete from journal_entries where id = %L', e1)) = 'PERIOD_CLOSED');
  perform t_chk('D06 明細の直接UPDATEを拒否', t_err(format('update journal_lines set amount = 1 where entry_id = %L', e1)) = 'PERIOD_CLOSED');
  perform t_chk('D07 明細の直接DELETEを拒否', t_err(format('delete from journal_lines where entry_id = %L', e1)) = 'PERIOD_CLOSED');
  perform t_chk('D08 明細の直接INSERTを拒否', t_err(format('insert into journal_lines (entry_id, line_number, side, account_id, amount) values (%L, 9, ''DEBIT'', %L, 1)', e1, acash)) = 'PERIOD_CLOSED');
  perform t_chk('D09 確定済みの期から未確定の期へ付け替えを拒否（旧期チェック）',
    t_err(format('update journal_entries set period_id = %L, date = ''2026-02-01'' where id = %L', pA2, e1)) = 'PERIOD_CLOSED');
  perform t_chk('D10 未確定の期から確定済みの期へ付け替えを拒否（新期チェック）',
    t_err(format('update journal_entries set period_id = %L, date = ''2025-06-01'' where id = %L', pA1, e2)) = 'PERIOD_CLOSED');
  perform t_chk('D11 期首残高の保存(RPC)を拒否', t_err(format($q$select save_period_opening_balances(%L, '[]'::jsonb, null, false)$q$, pA1)) = 'PERIOD_CLOSED');
  perform t_chk('D12 期首残高の解除(RPC)は設定が無ければ何もしない', t_err(format('select clear_period_opening_balances(%L)', pA1)) = 'OK');
  perform t_chk('D13 期首残高ヘッダーの直接INSERTを拒否', t_err(format('insert into period_opening_balance_sets (company_id, period_id) values (%L, %L)', cA, pA1)) = 'PERIOD_CLOSED');
  perform t_chk('D14 CSV本登録(RPC)は確定済みの期で必ず PERIOD_CLOSED（有効な取込データ）', t_err(format($q$select import_staging_entries(%L, array[%L]::uuid[])$q$, pA1, sI1)) = 'PERIOD_CLOSED');
  perform t_chk('D14b 拒否された取込は未処理のまま', (select not is_processed from import_staging where id = sI1));
  reset role;
  perform t_chk('D15 データは変わっていない', (select count(*) from journal_lines where entry_id = e1) = 2 and (select description from journal_entries where id = e1) = 'A1売上');

  -- 他社・未確定の期は影響を受けない
  set local role anon;
  perform t_chk('D20 未確定の期へ新規仕訳できる', t_err(format($q$select create_journal_entry(%L, '2026-05-01', 'ok', null,
      jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',%L,'amount','1','tax_code',null),
                        jsonb_build_object('side','CREDIT','account_id',%L,'amount','1','tax_code',null)), null)$q$, pA2, acash, arev)) = 'OK');
  perform t_chk('D21 未確定の期の仕訳を編集できる', t_err(format($q$select update_journal_entry(%L, '2026-03-02', 'edited', null,
      jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',%L,'amount','500','tax_code',null),
                        jsonb_build_object('side','CREDIT','account_id',%L,'amount','500','tax_code',null)), null)$q$, e2, acash, arev)) = 'OK');
  perform t_chk('D22 未確定の期の日付の一括変更ができる', t_err(format('update journal_entries set date = ''2026-03-03'' where id = %L', e3)) = 'OK');
  perform t_chk('D23 他社の期は影響を受けない（会社B）', t_err(format($q$select create_journal_entry(%L, '2025-06-01', 'B', null,
      jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',%L,'amount','1','tax_code',null),
                        jsonb_build_object('side','CREDIT','account_id',%L,'amount','1','tax_code',null)), null)$q$, pB1, bcash, brev)) = 'OK');
  perform t_chk('D24b CSV本登録(RPC)は未確定の期なら成功（同じ形式の取込データ）', t_err(format($q$select import_staging_entries(%L, array[%L]::uuid[])$q$, pA2, sI2)) = 'OK');
  perform t_chk('D24 未確定の期の期首残高を保存できる', t_err(format($q$select save_period_opening_balances(%L, '[]'::jsonb, 'm', false)$q$, pA2)) = 'OK');
  perform t_chk('D25 未確定の期の期首残高を解除できる', t_err(format('select clear_period_opening_balances(%L)', pA2)) = 'OK');
  reset role;
  perform t_chk('D26 仕訳の削除（未確定の期・CASCADE）ができる', t_err(format('delete from journal_entries where id = %L', e3)) = 'OK');
  perform t_chk('D27 削除した仕訳の明細も消えている', (select count(*) from journal_lines where entry_id = e3) = 0);

  ----------------------------------------------------------------
  -- E. 期間・期の行の保護
  ----------------------------------------------------------------
  perform t_chk('E01 確定済みの期の終了日変更を拒否', t_err(format('update fiscal_periods set end_date = ''2026-01-15'' where id = %L', pA1)) = 'PERIOD_CLOSED_FIELDS');
  perform t_chk('E02 確定済みの期の開始日変更を拒否', t_err(format('update fiscal_periods set start_date = ''2024-12-01'' where id = %L', pA1)) = 'PERIOD_CLOSED_FIELDS');
  perform t_chk('E03 確定済みの期の削除を拒否', t_err(format('delete from fiscal_periods where id = %L', pA1)) = 'PERIOD_CLOSED_FIELDS');
  perform t_chk('E04 値が変わらない更新は通す（期名変更で end_date を送る現行UI）',
    t_err(format('update fiscal_periods set name = ''A1改'', end_date = end_date, start_date = start_date where id = %L', pA1)) = 'OK');
  perform t_chk('E05 期名の変更ができる', (select name from fiscal_periods where id = pA1) = 'A1改');
  perform t_chk('E06 確定済みの期と重なる期の作成を拒否', t_err(format('insert into fiscal_periods (company_id, name, start_date, end_date) values (%L, ''重複'', ''2025-12-31'', ''2026-02-01'')', cA)) = 'PERIOD_OVERLAPS_CLOSED');
  perform t_chk('E07 確定済みの期より前の期の作成を拒否', t_err(format('insert into fiscal_periods (company_id, name, start_date, end_date) values (%L, ''過去'', ''2024-01-01'', ''2024-12-31'')', cA)) = 'PERIOD_OVERLAPS_CLOSED');
  perform t_chk('E08 確定済みの状態での期の作成を拒否', t_err(format('insert into fiscal_periods (company_id, name, start_date, end_date, closed_at) values (%L, ''x'', ''2028-01-01'', ''2028-12-31'', now())', cA)) = 'PERIOD_CLOSED_FIELDS');
  perform t_chk('E09 後ろの期の作成はできる', t_err(format('insert into fiscal_periods (company_id, name, start_date, end_date) values (%L, ''A4'', ''2028-01-01'', ''2028-12-31'')', cA)) = 'OK');
  perform t_chk('E10 未確定の期の開始日を確定済みの期の内側へ動かせない', t_err(format('update fiscal_periods set start_date = ''2025-12-01'' where id = %L', pA2)) = 'PERIOD_OVERLAPS_CLOSED');
  perform t_chk('E11 未確定の期の終了日は動かせる', t_err(format('update fiscal_periods set end_date = ''2026-12-30'' where id = %L', pA2)) = 'OK');
  perform t_chk('E12 他社の期の作成は影響を受けない', t_err(format('insert into fiscal_periods (company_id, name, start_date, end_date) values (%L, ''B3'', ''2027-01-01'', ''2027-12-31'')', cB)) = 'OK');
  perform t_chk('E13 手順0: 確定と終了日の同時変更を拒否（E5迂回の防止）',
    t_err(format('update fiscal_periods set closed_at = now(), end_date = ''2026-12-31'' where id = %L', pA2)) = 'PERIOD_CLOSED_FIELDS');
  -- E13 の元の不具合の再現: 終了日を延ばして「変更後だけ」次の期（A3: 2027-01-01〜）と重なる状態にして確定すると、保存済みの行を読む E5 をすり抜ける
  perform t_chk('E13b 手順0: 変更後だけ他の期と重なる日付と確定の同時変更を拒否',
    t_err(format('update fiscal_periods set closed_at = now(), end_date = ''2027-02-01'' where id = %L', pA2)) = 'PERIOD_CLOSED_FIELDS');
  perform t_chk('E13c 拒否後も未確定で、終了日も元のまま', (select closed_at is null and end_date = '2026-12-30' from fiscal_periods where id = pA2));
  perform t_chk('E14 手順0: 解除と開始日の同時変更を拒否',
    t_err(format('update fiscal_periods set closed_at = null, start_date = ''2025-01-02'' where id = %L', pA1)) = 'PERIOD_CLOSED_FIELDS');
  perform t_chk('E15 手順0: 失敗しても状態は変わらない', (select closed_at is null from fiscal_periods where id = pA2) and (select closed_at is not null from fiscal_periods where id = pA1));
  perform t_chk('E16 確定と期名・当期フラグの同時変更は許可', t_err(format('update fiscal_periods set closed_at = now(), name = ''A2確定'' where id = %L', pA2)) = 'OK');
  -- A2 を確定した直後に、後続のテストのため解除する（解除と is_current の同時変更も許可）
  perform t_chk('E17 解除と期名の同時変更は許可', t_err(format('update fiscal_periods set closed_at = null, name = ''A2'' where id = %L', pA2)) = 'OK');

  ----------------------------------------------------------------
  -- F. 科目マスタ・繰越先の保護
  ----------------------------------------------------------------
  perform t_chk('F01 確定済みの期で使う科目の区分変更を拒否',
    t_err(format('update accounts set bs_category = ''FIXED_ASSETS'' where id = %L', acash)) = 'ACCOUNT_IN_CLOSED_PERIOD');
  perform t_chk('F02 確定済みの期で使う科目の損益区分変更を拒否（有効な区分値）',
    t_err(format('update accounts set pl_category = ''NON_OP_INCOME'' where id = %L', arev)) = 'ACCOUNT_IN_CLOSED_PERIOD');
  perform t_chk('F03 確定済みの期で使う科目の親変更を拒否',
    t_err(format('update accounts set parent_id = %L where id = %L', aunused, acash)) = 'ACCOUNT_IN_CLOSED_PERIOD');
  perform t_chk('F04 名前だけの変更は通す', t_err(format('update accounts set name = ''現金改'' where id = %L', acash)) = 'OK');
  perform t_chk('F05 値が変わらない更新は通す', t_err(format('update accounts set type = type, bs_category = bs_category where id = %L', acash)) = 'OK');
  perform t_chk('F06 仕訳に使われていない科目の区分は変更できる', t_err(format('update accounts set bs_category = ''FIXED_ASSETS'' where id = %L', aunused)) = 'OK');
  perform t_chk('F07 未確定の期だけで使う科目の区分は変更できる', t_err(format('update accounts set pl_category = ''COGS'' where id = %L', asga2)) = 'OK');
  perform t_chk('F08 補助科目を追加できる（確定済みの期の親科目の下にも）',
    t_err(format('insert into accounts (company_id, code, name, type, parent_id) values (%L, ''1001'', ''現金補助'', ''ASSET'', %L)', cA, acash)) = 'OK');
  perform t_chk('F09 繰越先の変更を拒否（確定済みの期がある会社）', t_err(format('update companies set carry_forward_account_id = %L where id = %L', acarry2, cA)) = 'CARRY_FORWARD_LOCKED');
  perform t_chk('F10 繰越先の値が同じなら通す', t_err(format('update companies set carry_forward_account_id = carry_forward_account_id, name = name where id = %L', cA)) = 'OK');
  v_txt := t_err(format('update companies set carry_forward_account_id = %L where id = %L', (select id from accounts where company_id = cB and code = '535'), cB));
  perform t_chk('F11 確定済みの期が無い会社は繰越先を変更できる（会社B） [' || v_txt || ']', v_txt = 'OK');

  ----------------------------------------------------------------
  -- G. 解除の順序・履歴・メモの漏れ
  ----------------------------------------------------------------
  -- 2期目を確定（1期目が確定済みなので可能）
  v_res := close_fiscal_period(pA2, null);
  perform t_chk('G01 2期目を確定できる', (select closed_at is not null from fiscal_periods where id = pA2));
  perform t_chk('G02 メモなしの確定は memo が NULL', exists (select 1 from fiscal_period_close_logs where period_id = pA2 and action = 'CLOSE' and memo is null));
  perform t_chk('G03 1期目の解除は拒否（直後の期が確定済み）', t_err(format('select reopen_fiscal_period(%L)', pA1)) = 'PERIOD_REOPEN_NEXT_CLOSED');
  perform t_chk('G04 直接UPDATEの解除も拒否', t_err(format('update fiscal_periods set closed_at = null where id = %L', pA1)) = 'PERIOD_REOPEN_NEXT_CLOSED');
  perform t_chk('G05 拒否された解除は履歴を残さない', (select count(*) from fiscal_period_close_logs where period_id = pA1 and action = 'REOPEN') = 0);
  perform reopen_fiscal_period(pA2, '誤りの訂正');
  perform t_chk('G06 2期目を解除できる', (select closed_at is null from fiscal_periods where id = pA2));
  perform t_chk('G07 履歴 REOPEN・メモつき', (select count(*) from fiscal_period_close_logs where period_id = pA2 and action = 'REOPEN' and memo = '誤りの訂正') = 1);
  -- メモが次の直接UPDATEに漏れない
  perform close_fiscal_period(pA2, '漏れ確認');
  update fiscal_periods set closed_at = null where id = pA2;
  perform t_chk('G08 RPC後の直接UPDATEにメモが漏れない', (select count(*) from fiscal_period_close_logs where period_id = pA2 and action = 'REOPEN' and memo = '漏れ確認') = 0
      and (select count(*) from fiscal_period_close_logs where period_id = pA2 and action = 'REOPEN') = 3);
  perform reopen_fiscal_period(pA1, null);
  perform t_chk('G09 1期目も解除できる（2期目は未確定）', (select closed_at is null from fiscal_periods where id = pA1));
  perform t_chk('G10 解除後は書き込める', t_err(format($q$select create_journal_entry(%L, '2025-05-05', 'y', null,
      jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',%L,'amount','1','tax_code',null),
                        jsonb_build_object('side','CREDIT','account_id',%L,'amount','1','tax_code',null)), null)$q$, pA1, acash, arev)) = 'OK');
  perform t_chk('G11 解除後は繰越先を変更できる', t_err(format('update companies set carry_forward_account_id = %L where id = %L', acarry, cA)) = 'OK');
  perform t_chk('G12 解除後は科目の区分を変更できる（区分制約の範囲内）', t_err(format('update accounts set bs_category = ''FIXED_ASSETS'' where id = %L', acash)) = 'OK');
  perform t_chk('G13 解除後は期間も変更できる', t_err(format('update fiscal_periods set end_date = ''2025-12-30'' where id = %L', pA1)) in ('OK', 'PERIOD_HAS_OUTSIDE_ENTRIES'));
  -- 履歴の総数
  select count(*) into v_cnt from fiscal_period_close_logs where company_id = cA;
  perform t_chk('G14 履歴の総数が操作と一致', v_cnt >= 6);

  ----------------------------------------------------------------
  -- H. 順序（連続確定・間の期が空の場合）
  ----------------------------------------------------------------
  perform close_fiscal_period(pA1, null);
  perform close_fiscal_period(pA2, null);
  perform t_chk('H01 3期目: 直前が確定済みなら確定できる（E1 なし）', not exists (select 1 from unnest(period_close_errors(pA3)) w where w like 'E1:%'));
  perform t_chk('H02 確定済みの期 P2 の仕訳削除を拒否', t_err(format('delete from journal_entries where id = %L', e2)) = 'PERIOD_CLOSED');
  perform t_chk('H03 確定済みの期のヘッダー期首残高の直接DELETEは存在しなければ0件', t_err(format('delete from period_opening_balance_sets where period_id = %L', pA2)) = 'OK');
  perform t_chk('H04 3期目の確定も順番どおり', t_err(format('select close_fiscal_period(%L)', pA3)) = 'OK');
  perform t_chk('H05 全期確定後は新しい期（後ろ）を追加できる', t_err(format('insert into fiscal_periods (company_id, name, start_date, end_date) values (%L, ''A5'', ''2029-01-01'', ''2029-12-31'')', cA)) = 'OK');
  -- 手動期首残高（借貸のある明細）を持つ期の確定（会社G）
  select (create_company('テストG', 'CORPORATION', 'EXEMPT', '2025-01-01', '2025-12-31')->>'company_id')::uuid into cG;
  select id into pG1 from fiscal_periods where company_id = cG;
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current) values (cG, 'G2', '2026-01-01', '2026-12-31', false) returning id into pG2;
  select id into gcash  from accounts where company_id = cG and code = '100';
  select id into gcarry from accounts where company_id = cG and code = '540';
  perform save_period_opening_balances(pG2, jsonb_build_array(jsonb_build_object('account_id', gcash, 'balance', '1000.00')), 'first', true);
  perform t_chk('H09 手動設定の明細が2行できた（現金＋繰越先）', (select count(*) from period_opening_balance_lines where period_id = pG2) = 2);
  perform close_fiscal_period(pG1, null);
  perform close_fiscal_period(pG2, null);
  perform t_chk('H10 手動設定のある期を確定後、期首残高の解除を拒否', t_err(format('select clear_period_opening_balances(%L)', pG2)) = 'PERIOD_CLOSED');
  perform t_chk('H11 手動設定のある期を確定後、設定の直接UPDATEを拒否', t_err(format('update period_opening_balance_sets set memo = ''x'' where period_id = %L', pG2)) = 'PERIOD_CLOSED');
  perform t_chk('H12 手動設定のある期の明細INSERTを拒否',
    t_err(format('insert into period_opening_balance_lines (period_id, account_id, balance) values (%L, %L, 1)', pG2, (select id from accounts where company_id = cG and code = '101'))) = 'PERIOD_CLOSED');
  perform t_chk('H12b 手動設定の明細UPDATEを拒否', t_err(format('update period_opening_balance_lines set balance = 5 where period_id = %L and account_id = %L', pG2, gcash)) = 'PERIOD_CLOSED');
  perform t_chk('H12c 手動設定の明細DELETEを拒否', t_err(format('delete from period_opening_balance_lines where period_id = %L and account_id = %L', pG2, gcash)) = 'PERIOD_CLOSED');
  -- この科目（現金）は、仕訳には使われず、確定済みの期の手動期首残高だけが使う
  perform t_chk('H13 仕訳に使われていない（手動期首残高だけが使う）', not exists (select 1 from journal_lines where account_id = gcash));
  v_txt := t_err(format('update accounts set bs_category = ''FIXED_ASSETS'' where id = %L', gcash));
  perform t_chk('H14 手動期首残高だけが使う科目の区分変更を拒否 [' || v_txt || ']', v_txt = 'ACCOUNT_IN_CLOSED_PERIOD');
  v_txt := t_err(format('update accounts set bs_category = ''FIXED_ASSETS'' where id = %L', gcarry));
  perform t_chk('H15 手動期首残高の繰越先の行がある科目の区分変更を拒否 [' || v_txt || ']', v_txt = 'ACCOUNT_IN_CLOSED_PERIOD');
  perform reopen_fiscal_period(pG2, null);
  v_txt := t_err(format('update accounts set bs_category = ''FIXED_ASSETS'' where id = %L', gcash));
  perform t_chk('H16 確定を解除すれば、同じ区分変更が通る（拒否の原因は年度ロックだけ） [' || v_txt || ']', v_txt = 'OK');

  ----------------------------------------------------------------
  -- 集計
  ----------------------------------------------------------------
  select count(*), string_agg(name, ' / ' order by n) filter (where not ok) into v_total, v_fail from public.t_results;
  if v_fail is null then
    raise exception 'TEST RESULT: ALL PASSED (% checks)', v_total;
  else
    raise exception 'TEST RESULT: FAILED -> %', v_fail;
  end if;
end;
$test$;

ROLLBACK;
