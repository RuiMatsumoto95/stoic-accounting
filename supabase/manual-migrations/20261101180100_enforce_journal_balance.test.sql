-- 1a（20261112120000_company_support.sql）適用後のDBが前提。
-- Migration B（20261101180100_enforce_journal_balance.sql）のテスト
--
-- 使い方: Supabase の SQL Editor にこのファイル全体を貼り付けて実行する（A のテストと同じ方式）。
--
-- ★ 結果は必ず「ERROR」として表示されます（テストデータを残さないための意図的なエラー）。
--    ・成功: ERROR: TEST RESULT: ALL PASSED (n/n) ...
--    ・失敗: ERROR: TEST RESULT: FAILED (x/n) ... のあとに失敗したケースの一覧
--
-- ・借貸一致の制約 Trigger は DEFERRABLE INITIALLY DEFERRED（COMMIT 時に検証）。
--   このテストは最後に全体をロールバックするため COMMIT しない。そこで各ケースで
--     SET CONSTRAINTS trg_journal_lines_balance, trg_journal_entries_balance IMMEDIATE
--   を実行して、保留中の検証をその場で走らせ、「期待したエラーで失敗したこと」を PASS と判定する。
--   各ケースは EXCEPTION 節つきのブロック（= 内部的に SAVEPOINT）で分離している。
-- ・COMMIT 経路そのもの（SET CONSTRAINTS を使わない場合）の確認は 20261101180100_concurrency_test.md の手順 0 を参照。

do $test$
declare
  v_company uuid;
  v_period uuid;
  v_cash   uuid;
  v_sales  uuid;
  v_exp    uuid;
  v_e1     uuid;
  v_e2     uuid;
  v_e3     uuid;
  v_s1     uuid;
  v_txt    text;
  v_msg    text;
  v_n      integer;
  v_total  integer := 0;
  v_fails  text[] := '{}';
begin
  -- 既存会社・当期を使わず、このDOブロック内の架空の会社だけで準備する。
  insert into public.companies (name, kind, tax_method)
  values ('ZZB' || replace(gen_random_uuid()::text, '-', ''), 'CORPORATION', 'EXEMPT')
  returning id into v_company;

  -- ------------------------------------------------------------
  -- テスト用ヘルパー
  -- ------------------------------------------------------------
  -- p_sql を実行 → 遅延制約をその場で検証 → 期待したエラーになるか
  create function pg_temp.expect_error_at_check(p_sql text, p_expected text, p_detail_like text default null)
  returns text language plpgsql as $f$
  declare
    v_state text; v_msg text; v_detail text;
  begin
    begin
      execute p_sql;
      set constraints trg_journal_lines_balance, trg_journal_entries_balance immediate;
      set constraints trg_journal_lines_balance, trg_journal_entries_balance deferred;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
      set constraints trg_journal_lines_balance, trg_journal_entries_balance deferred;
      if (v_state = p_expected or v_msg = p_expected)
         and (p_detail_like is null or coalesce(v_detail, '') like p_detail_like) then
        return null;
      end if;
      return format('期待 %s / 実際 [%s] %s | %s', p_expected, v_state, v_msg, coalesce(v_detail, ''));
    end;
    return format('期待 %s / エラーにならなかった', p_expected);
  end;
  $f$;

  -- p_sql を実行 → 遅延制約をその場で検証 → エラーにならないか（成功した変更は残る）
  create function pg_temp.expect_ok_at_check(p_sql text)
  returns text language plpgsql as $f$
  declare
    v_state text; v_msg text; v_detail text;
  begin
    execute p_sql;
    set constraints trg_journal_lines_balance, trg_journal_entries_balance immediate;
    set constraints trg_journal_lines_balance, trg_journal_entries_balance deferred;
    return null;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
    set constraints trg_journal_lines_balance, trg_journal_entries_balance deferred;
    return format('エラーになった: [%s] %s | %s', v_state, v_msg, coalesce(v_detail, ''));
  end;
  $f$;

  create function pg_temp.lines(p_debit_acc uuid, p_debit text, p_credit_acc uuid, p_credit text)
  returns jsonb language sql as $f$
    select jsonb_build_array(
      jsonb_build_object('side', 'DEBIT',  'account_id', p_debit_acc,  'amount', p_debit),
      jsonb_build_object('side', 'CREDIT', 'account_id', p_credit_acc, 'amount', p_credit));
  $f$;

  -- 仕訳ヘッダー＋明細を1文で直接 INSERT する SQL（PostgREST を経由しない直接書き込みの再現）
  create function pg_temp.direct_entry_sql(p_period uuid, p_desc text, p_lines text)
  returns text language sql as $f$
    select format(
      'with e as (insert into journal_entries (period_id, date, description) values (%L, %L, %L) returning id) '
      'insert into journal_lines (entry_id, line_number, side, account_id, amount) '
      'select e.id, v.n, v.s, v.a::uuid, v.amt from e, (values %s) as v(n, s, a, amt)',
      p_period, '2099-05-01', p_desc, p_lines);
  $f$;

  -- ------------------------------------------------------------
  -- テストデータ
  -- ------------------------------------------------------------
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current)
  values (v_company, 'ZZTEST 2100年3月期', '2099-04-01', '2100-03-31', false) returning id into v_period;
  insert into accounts (company_id, code, name, type) values (v_company, 'ZZTEST-1', 'テスト現金', 'ASSET')   returning id into v_cash;
  insert into accounts (company_id, code, name, type) values (v_company, 'ZZTEST-2', 'テスト売上', 'REVENUE') returning id into v_sales;
  insert into accounts (company_id, code, name, type) values (v_company, 'ZZTEST-3', 'テスト経費', 'EXPENSE') returning id into v_exp;

  v_e1 := (public.create_journal_entry(v_period, '2099-05-01', 'ZZTEST E1', null, pg_temp.lines(v_cash, '1000', v_sales, '1000'))->>'id')::uuid;
  v_e2 := (public.create_journal_entry(v_period, '2099-05-02', 'ZZTEST E2', null, pg_temp.lines(v_exp, '500', v_cash, '500'))->>'id')::uuid;

  -- ============================================================
  -- 前提: 検証が本当に COMMIT まで遅延されていること
  -- ============================================================
  -- ヘッダーだけの INSERT は、SET CONSTRAINTS をしない限りその場ではエラーにならない
  v_total := v_total + 1;
  begin
    insert into journal_entries (period_id, date, description) values (v_period, '2099-05-01', 'ZZTEST 遅延確認');
    raise exception 'ZZTEST_DEFERRED_OK';  -- ここまで来れば遅延されている。この INSERT はブロックごと取り消す
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ZZTEST_DEFERRED_OK' then
      v_fails := v_fails || format('DEFER-1 遅延されていない: %s', v_msg);
    end if;
  end;

  -- ============================================================
  -- 正常系（遅延検証を通る）
  -- ============================================================
  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok_at_check(format('select create_journal_entry(%L, %L, %L, null, %L)',
             v_period, '2099-06-01', 'ZZTEST RPC新規', pg_temp.lines(v_cash, '300', v_sales, '300')));
  if v_txt is not null then v_fails := v_fails || ('OK-B1 RPC 新規: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok_at_check(format('select update_journal_entry(%L, %L, %L, null, %L)',
             v_e1, '2099-05-01', 'ZZTEST E1 編集', jsonb_build_array(
               jsonb_build_object('side','DEBIT','account_id',v_cash,'amount','600'),
               jsonb_build_object('side','DEBIT','account_id',v_exp,'amount','400'),
               jsonb_build_object('side','CREDIT','account_id',v_sales,'amount','1000'))));
  if v_txt is not null then v_fails := v_fails || ('OK-B2 RPC 編集: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok_at_check(pg_temp.direct_entry_sql(v_period, 'ZZTEST 直接OK',
             format('(1, %L, %L, 100.00), (2, %L, %L, 100.00)', 'DEBIT', v_cash, 'CREDIT', v_sales)));
  if v_txt is not null then v_fails := v_fails || ('OK-B3 直接 INSERT（一致）: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok_at_check(format('update journal_lines set amount = 800 where entry_id = %L', v_e2));
  if v_txt is not null then v_fails := v_fails || ('OK-B4 両方の明細を同額に変更: ' || v_txt); end if;

  insert into import_staging (company_id, raw_date, raw_debit_amount, raw_description, predicted_account_id, counter_account_id)
  values (v_company, '2099-07-01', 120, 'ZZTEST CSV', v_cash, v_sales) returning id into v_s1;
  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok_at_check(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s1]));
  if v_txt is not null then v_fails := v_fails || ('OK-B5 CSV本登録: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok_at_check(format('delete from journal_entries where id = %L', v_e2));
  if v_txt is not null then v_fails := v_fails || ('OK-B6 仕訳の削除（明細は CASCADE）: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok_at_check(format('delete from journal_entries where description in (%L, %L)',
             'ZZTEST RPC新規', 'ZZTEST CSV'));
  if v_txt is not null then v_fails := v_fails || ('OK-B7 一括削除: ' || v_txt); end if;

  -- ============================================================
  -- 異常系（直接書き込みで借貸を崩す → 検証時に拒否される）
  -- ============================================================
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(format(
             'insert into journal_entries (period_id, date, description) values (%L, %L, %L)',
             v_period, '2099-05-01', 'ZZTEST ヘッダーのみ'), 'INVALID_JOURNAL_LINES');
  if v_txt is not null then v_fails := v_fails || ('NG-B1 ヘッダーのみ: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(pg_temp.direct_entry_sql(v_period, 'ZZTEST 直接NG',
             format('(1, %L, %L, 100.00), (2, %L, %L, 99.00)', 'DEBIT', v_cash, 'CREDIT', v_sales)),
             'DEBIT_CREDIT_MISMATCH');
  if v_txt is not null then v_fails := v_fails || ('NG-B2 直接 INSERT（不一致）: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(pg_temp.direct_entry_sql(v_period, 'ZZTEST 借方のみ',
             format('(1, %L, %L, 100.00), (2, %L, %L, 100.00)', 'DEBIT', v_cash, 'DEBIT', v_exp)),
             'INVALID_JOURNAL_LINES');
  if v_txt is not null then v_fails := v_fails || ('NG-B3 直接 INSERT（借方のみ）: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(format(
             'update journal_lines set amount = 999 where entry_id = %L and side = %L', v_e1, 'CREDIT'),
             'DEBIT_CREDIT_MISMATCH');
  if v_txt is not null then v_fails := v_fails || ('NG-B4 片側の金額だけ変更: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(format(
             'update journal_lines set side = %L where entry_id = %L and side = %L', 'DEBIT', v_e1, 'CREDIT'),
             'INVALID_JOURNAL_LINES');
  if v_txt is not null then v_fails := v_fails || ('NG-B5 貸方を借方に変更: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(format(
             'delete from journal_lines where entry_id = %L and line_number = 1', v_e1),
             'DEBIT_CREDIT_MISMATCH');
  if v_txt is not null then v_fails := v_fails || ('NG-B6 明細1行の削除: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(format('delete from journal_lines where entry_id = %L', v_e1),
             'INVALID_JOURNAL_LINES');
  if v_txt is not null then v_fails := v_fails || ('NG-B7 明細を全削除: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(format(
             'insert into journal_lines (entry_id, line_number, side, account_id, amount) values (%L, 9, %L, %L, 1)',
             v_e1, 'DEBIT', v_cash), 'DEBIT_CREDIT_MISMATCH');
  if v_txt is not null then v_fails := v_fails || ('NG-B8 明細の追加で不一致: ' || v_txt); end if;

  -- 明細の付け替えは即時（BEFORE Trigger）で拒否
  select (public.create_journal_entry(v_period, '2099-05-03', 'ZZTEST E3', null, pg_temp.lines(v_cash, '50', v_sales, '50'))->>'id')::uuid
    into v_e3;
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error_at_check(format(
             'update journal_lines set entry_id = %L where entry_id = %L and line_number = 1', v_e3, v_e1),
             'INVALID_JOURNAL_LINES', '%移動%');
  if v_txt is not null then v_fails := v_fails || ('NG-B9 明細を別の仕訳へ移動: ' || v_txt); end if;

  -- 失敗したケースはすべて取り消され、E1 は RPC 編集後の 3 行・借貸一致のまま
  v_total := v_total + 1;
  select count(*) into v_n from journal_lines where entry_id = v_e1;
  if v_n <> 3 or exists (select 1 from journal_entries where description in
       ('ZZTEST ヘッダーのみ', 'ZZTEST 直接NG', 'ZZTEST 借方のみ')) then
    v_fails := v_fails || format('NG-B10 失敗ケースの取り消し: E1 の明細 %s 行 / 失敗した仕訳が残っている可能性', v_n);
  end if;

  -- ============================================================
  -- 結果（意図的なエラーで全体をロールバック）
  -- ============================================================
  if cardinality(v_fails) = 0 then
    raise exception 'TEST RESULT: ALL PASSED (%/%) — このエラーはテストデータを消すための意図的なものです',
      v_total, v_total;
  else
    raise exception 'TEST RESULT: FAILED (%/%)', cardinality(v_fails), v_total
      using detail = array_to_string(v_fails, E'\n');
  end if;
end;
$test$;
