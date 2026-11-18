-- ステップ3: ローカル検証専用テスト（本番では実行しない）
-- あり得ないデータ（最初の期より前の日付の仕訳）を作るため、session_replication_role = replica で
-- トリガーと外部キーの検査を一時的に止める。Supabase 側でこの設定が使えるかは未確認。
-- 全体を1トランザクションで実行し、最後に意図的な例外でロールバックする。
BEGIN;
CREATE TABLE public.t_results (n serial, name text, ok boolean);
CREATE FUNCTION public.t_chk(p_name text, p_cond boolean) RETURNS void LANGUAGE sql AS $$ insert into public.t_results (name, ok) values (p_name, coalesce(p_cond, false)); $$;
CREATE FUNCTION public.t_errd(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
declare m text; d text;
begin execute p_sql; return 'OK';
exception when sqlstate 'P0001' then
  get stacked diagnostics m = message_text, d = pg_exception_detail; return m || '|' || coalesce(d, '');
  when others then return 'ERR:' || sqlstate;
end $$;

DO $test$
declare cD uuid; pD1 uuid; pD2 uuid; e4 uuid; v_fail text; v_total integer;
begin
  select (create_company('ローカルD', 'CORPORATION', 'EXEMPT', '2025-01-01', '2025-12-31')->>'company_id')::uuid into cD;
  select id into pD1 from fiscal_periods where company_id = cD;
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current) values (cD, 'D2', '2026-01-01', '2026-12-31', false) returning id into pD2;
  perform close_fiscal_period(pD1, null);   -- E1 を満たすため、あり得ないデータを作る前に1期目を確定しておく
  set local session_replication_role = replica;
  insert into journal_entries (period_id, company_id, date, description, reference_number) values (pD1, cD, '2024-06-01', 'D古い仕訳', 1) returning id into e4;
  insert into journal_lines (entry_id, line_number, side, account_id, amount, company_id)
    select e4, 1, 'DEBIT', (select id from accounts where company_id = cD and code='100'), 5, cD
    union all select e4, 2, 'CREDIT', (select id from accounts where company_id = cD and code='700'), 5, cD;
  set local session_replication_role = origin;

  perform t_chk('L01 E2: 最初の期より前の仕訳 → 2期目の確定前チェックに E2',
    exists (select 1 from unnest(period_close_errors(pD2)) w where w like 'E2:%'));
  -- 直接 UPDATE で E2 を迂回できないこと（1期目は確定済み＝E1 は満たしている）
  perform t_chk('L03 E2 のとき確定(RPC)は拒否', t_errd(format('select close_fiscal_period(%L)', pD2)) like 'PERIOD_CLOSE_CHECK_FAILED|E2:%');
  perform t_chk('L04 E2 のとき直接 UPDATE の確定も拒否', t_errd(format('update fiscal_periods set closed_at = now() where id = %L', pD2)) like 'PERIOD_CLOSE_CHECK_FAILED|E2:%');
  perform t_chk('L05 拒否後も未確定のまま', (select closed_at is null from fiscal_periods where id = pD2));

  select count(*), string_agg(name, ' / ' order by n) filter (where not ok) into v_total, v_fail from public.t_results;
  if v_fail is null then raise exception 'TEST RESULT: ALL PASSED (% checks)', v_total;
  else raise exception 'TEST RESULT: FAILED -> %', v_fail; end if;
end $test$;
ROLLBACK;
