-- 1a（20261112120000_company_support.sql）適用後のDBが前提。
-- Migration A（20261101180000_atomic_journal_save.sql）のテスト
--
-- 使い方: Supabase の SQL Editor にこのファイル全体を貼り付けて実行する。
--
-- ★ 結果は必ず「ERROR」として表示されます（テストデータを残さないための意図的なエラー）。
--    ・成功: ERROR: TEST RESULT: ALL PASSED (n/n) ...
--    ・失敗: ERROR: TEST RESULT: FAILED (x/n) ... のあとに失敗したケースの一覧
--    DO ブロック全体が1つの文として実行され、最後の RAISE ですべてロールバックされるので、
--    本番 DB で実行しても仕訳・期間・科目・ログ・取込データは一切残らない。
--
-- ・異常系の各ケースは EXCEPTION 節つきのブロック（= 内部的に SAVEPOINT）で分離し、
--   「期待したエラーで失敗したこと」を明示的に PASS と判定する。
-- ・「TEST RESULT: ALL PASSED」以外のエラー（SQL の構文エラー、想定外の例外、権限エラーなど）が出た場合は、
--   テスト成功と判断しないこと。DO ブロック内の変更はその場合もロールバックされる。
-- ・権限テスト: (a) EXECUTE 権限はカタログで必ず確認する。(b) SET ROLE anon ができない環境では (b) だけスキップされ、
--   末尾に「PERM-b … スキップ」と表示される。切り替えた後の権限エラーは FAIL になる。
-- ・テスト用の会計期間は 2099-04-01〜2100-03-31（is_current = false）、科目コードは ZZTEST- で始まる。
-- ・Migration B 適用後に実行しても結果は同じ（遅延制約は COMMIT 前にロールバックされるため発火しない）。

do $test$
declare
  v_company uuid;
  v_period  uuid;
  v_period2 uuid;
  v_cash    uuid;
  v_sales   uuid;
  v_exp     uuid;
  v_entry   uuid;
  v_entry2  uuid;
  v_ob      uuid;
  v_s1      uuid;
  v_s2      uuid;
  v_s3      uuid;
  v_s_done  uuid;
  v_n       integer;
  v_txt     text;
  v_lines_ok jsonb;
  v_total   integer := 0;
  v_fails   text[] := '{}';
  v_role_note text := '';
begin
  -- 既存会社・当期を使わず、このDOブロック内の架空の会社だけで準備する。
  insert into public.companies (name, kind, tax_method)
  values ('ZZA' || replace(gen_random_uuid()::text, '-', ''), 'CORPORATION', 'EXEMPT')
  returning id into v_company;

  -- ------------------------------------------------------------
  -- テスト用ヘルパー（pg_temp の関数も最後にロールバックされる）
  -- ------------------------------------------------------------
  create function pg_temp.expect_error(p_sql text, p_expected text, p_detail_like text default null)
  returns text language plpgsql as $f$
  declare
    v_state text; v_msg text; v_detail text;
  begin
    begin
      execute p_sql;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
      if (v_state = p_expected or v_msg = p_expected)
         and (p_detail_like is null or coalesce(v_detail, '') like p_detail_like) then
        return null;  -- PASS
      end if;
      return format('期待 %s%s / 実際 [%s] %s | %s', p_expected,
                    coalesce(' detail~' || p_detail_like, ''), v_state, v_msg, coalesce(v_detail, ''));
    end;
    return format('期待 %s / エラーにならなかった', p_expected);
  end;
  $f$;

  create function pg_temp.expect_ok(p_sql text)
  returns text language plpgsql as $f$
  declare
    v_state text; v_msg text; v_detail text;
  begin
    execute p_sql;
    return null;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
    return format('エラーになった: [%s] %s | %s', v_state, v_msg, coalesce(v_detail, ''));
  end;
  $f$;

  create function pg_temp.lines(p_debit_acc uuid, p_debit text, p_credit_acc uuid, p_credit text)
  returns jsonb language sql as $f$
    select jsonb_build_array(
      jsonb_build_object('side', 'DEBIT',  'account_id', p_debit_acc,  'amount', p_debit,  'tax_code', null),
      jsonb_build_object('side', 'CREDIT', 'account_id', p_credit_acc, 'amount', p_credit, 'tax_code', null));
  $f$;

  -- ------------------------------------------------------------
  -- テストデータ
  -- ------------------------------------------------------------
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current)
  values (v_company, 'ZZTEST 2100年3月期', '2099-04-01', '2100-03-31', false) returning id into v_period;
  insert into fiscal_periods (company_id, name, start_date, end_date, is_current)
  values (v_company, 'ZZTEST 2101年3月期', '2100-04-01', '2101-03-31', false) returning id into v_period2;

  insert into accounts (company_id, code, name, type) values (v_company, 'ZZTEST-1', 'テスト現金', 'ASSET')   returning id into v_cash;
  insert into accounts (company_id, code, name, type) values (v_company, 'ZZTEST-2', 'テスト売上', 'REVENUE') returning id into v_sales;
  insert into accounts (company_id, code, name, type) values (v_company, 'ZZTEST-3', 'テスト経費', 'EXPENSE') returning id into v_exp;

  v_lines_ok := pg_temp.lines(v_cash, '1000', v_sales, '1000');

  -- ============================================================
  -- 正常系
  -- ============================================================

  -- [OK-1] 新規: 2行の仕訳が作られ、訂正履歴は0件
  v_total := v_total + 1;
  v_entry := (public.create_journal_entry(v_period, '2099-05-01', 'ZZTEST 新規', 1, v_lines_ok)->>'id')::uuid;
  select count(*) into v_n from journal_lines where entry_id = v_entry;
  if v_n <> 2 then v_fails := v_fails || format('OK-1 新規: 明細 %s 行', v_n); end if;
  select count(*) into v_n from journal_entry_logs where entry_id = v_entry;
  if v_n <> 0 then v_fails := v_fails || format('OK-1 新規: ログ %s 件（期待 0）', v_n); end if;

  -- [OK-2] 編集: 明細が置き換わり、訂正履歴は1件（変更前の2行を記録）
  v_total := v_total + 1;
  perform update_journal_entry(v_entry, '2099-05-02', 'ZZTEST 編集後', null, jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', v_cash, 'amount', '700',    'tax_code', null),
    jsonb_build_object('side', 'DEBIT',  'account_id', v_exp,  'amount', '300.50', 'tax_code', 'T1'),
    jsonb_build_object('side', 'CREDIT', 'account_id', v_sales,'amount', '1000.50','tax_code', null)));
  select count(*) into v_n from journal_lines where entry_id = v_entry;
  if v_n <> 3 then v_fails := v_fails || format('OK-2 編集: 明細 %s 行（期待 3）', v_n); end if;
  select count(*) into v_n from journal_entry_logs where entry_id = v_entry and action = 'UPDATE';
  if v_n <> 1 then v_fails := v_fails || format('OK-2 編集: UPDATE ログ %s 件（期待 1）', v_n); end if;
  select jsonb_array_length(before_data->'lines') into v_n from journal_entry_logs where entry_id = v_entry;
  if v_n is distinct from 2 then v_fails := v_fails || format('OK-2 編集: ログの変更前明細 %s 行（期待 2）', v_n); end if;
  select description into v_txt from journal_entries where id = v_entry;
  if v_txt <> 'ZZTEST 編集後' then v_fails := v_fails || 'OK-2 編集: 摘要が更新されていない'::text; end if;

  -- [OK-3] 小数第2位までの金額は保存精度どおりに入る
  v_total := v_total + 1;
  select sum(amount) into v_txt from journal_lines where entry_id = v_entry and side = 'DEBIT';
  if v_txt <> '1000.50' then v_fails := v_fails || format('OK-3 小数: 借方合計 %s', v_txt); end if;

  -- [OK-4] 期首日・期末日ちょうどは期間内
  v_total := v_total + 1;
  v_txt := coalesce(pg_temp.expect_ok(format('select create_journal_entry(%L, %L, %L, null, %L)',
             v_period, '2099-04-01', 'ZZTEST 期首日', v_lines_ok)), '')
        || coalesce(pg_temp.expect_ok(format('select create_journal_entry(%L, %L, %L, null, %L)',
             v_period, '2100-03-31', 'ZZTEST 期末日', v_lines_ok)), '');
  if v_txt <> '' then v_fails := v_fails || ('OK-4 期首日・期末日: ' || v_txt); end if;

  -- [OK-5] 一括変更（直接 UPDATE）で期間内の日付へ変更できる
  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok(format('update journal_entries set date = %L where id = %L', '2099-12-31', v_entry));
  if v_txt is not null then v_fails := v_fails || ('OK-5 一括変更: ' || v_txt); end if;

  -- [OK-6] CSV本登録: 配列順に登録、staging は処理済み、ログ0件
  v_total := v_total + 1;
  insert into import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description,
                              predicted_account_id, counter_account_id, debit_tax_code_id, credit_tax_code_id)
  values (v_company, '2099-06-01', 500, null, 'ZZTEST CSV1', v_cash, v_sales, null, null) returning id into v_s1;
  insert into import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description,
                              predicted_account_id, counter_account_id)
  values (v_company, '2099-06-02', 0, 250.25, 'ZZTEST CSV2', v_exp, v_cash) returning id into v_s2;
  v_n := import_staging_entries(v_period, array[v_s1, v_s2]);
  if v_n <> 2 then v_fails := v_fails || format('OK-6 CSV: 戻り値 %s', v_n); end if;
  select count(*) into v_n from journal_entries where description in ('ZZTEST CSV1', 'ZZTEST CSV2');
  if v_n <> 2 then v_fails := v_fails || format('OK-6 CSV: 仕訳 %s 件', v_n); end if;
  select count(*) into v_n from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.description = 'ZZTEST CSV2' and l.amount = 250.25;
  if v_n <> 2 then v_fails := v_fails || format('OK-6 CSV: 貸方金額側の行が %s 行', v_n); end if;
  select count(*) into v_n from import_staging where id in (v_s1, v_s2) and is_processed;
  if v_n <> 2 then v_fails := v_fails || format('OK-6 CSV: 処理済み %s 件', v_n); end if;
  select count(*) into v_n from journal_entry_logs g join journal_entries e on e.id = g.entry_id
   where e.description like 'ZZTEST CSV%';
  if v_n <> 0 then v_fails := v_fails || format('OK-6 CSV: ログ %s 件', v_n); end if;

  -- [OK-7] 明細変更に伴う updated_at の連鎖更新では期間チェックが発火しない（期間外の既存行が無くても確認として）
  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok(format('update journal_lines set tax_code = %L where entry_id = %L', 'T2', v_entry));
  if v_txt is not null then v_fails := v_fails || ('OK-7 連鎖更新: ' || v_txt); end if;

  -- [OK-8] 期間の変更: 範囲外の仕訳が出ない変更は通る（翌期の終了日を延ばす）
  v_total := v_total + 1;
  v_txt := pg_temp.expect_ok(format('update fiscal_periods set end_date = %L where id = %L', '2101-04-30', v_period2));
  if v_txt is not null then v_fails := v_fails || ('OK-8 期間変更: ' || v_txt); end if;

  -- ============================================================
  -- 異常系: 明細の検証（validate_journal_lines）
  -- ============================================================
  declare
    c record;
  begin
    for c in
      select * from (values
        ('NG-01 借貸不一致',          pg_temp.lines(v_cash, '1000', v_sales, '999'),            'DEBIT_CREDIT_MISMATCH'),
        ('NG-02 小数3桁（丸めで一致）', pg_temp.lines(v_cash, '100.004', v_sales, '100.00'),      'INVALID_JOURNAL_LINES'),
        ('NG-03 小数3桁（両方）',      pg_temp.lines(v_cash, '100.005', v_sales, '100.005'),     'INVALID_JOURNAL_LINES'),
        ('NG-04 NaN',                 pg_temp.lines(v_cash, 'NaN', v_sales, 'NaN'),             'INVALID_JOURNAL_LINES'),
        ('NG-05 Infinity',            pg_temp.lines(v_cash, 'Infinity', v_sales, 'Infinity'),   'INVALID_JOURNAL_LINES'),
        ('NG-06 負数',                pg_temp.lines(v_cash, '-100', v_sales, '-100'),            'INVALID_JOURNAL_LINES'),
        ('NG-07 0円',                 pg_temp.lines(v_cash, '0', v_sales, '0'),                  'INVALID_JOURNAL_LINES'),
        ('NG-08 0.00円',              pg_temp.lines(v_cash, '0.00', v_sales, '0.00'),            'INVALID_JOURNAL_LINES'),
        ('NG-09 指数表記',            pg_temp.lines(v_cash, '1e3', v_sales, '1000'),             'INVALID_JOURNAL_LINES'),
        ('NG-10 桁あふれ（14桁）',     pg_temp.lines(v_cash, '10000000000000', v_sales, '10000000000000'), 'INVALID_JOURNAL_LINES'),
        ('NG-11 空文字',              pg_temp.lines(v_cash, '', v_sales, ''),                    'INVALID_JOURNAL_LINES'),
        ('NG-12 全角数字',            pg_temp.lines(v_cash, '１００', v_sales, '１００'),          'INVALID_JOURNAL_LINES'),
        ('NG-13 金額が JSON 数値',    jsonb_build_array(
                                        jsonb_build_object('side','DEBIT','account_id',v_cash,'amount',100),
                                        jsonb_build_object('side','CREDIT','account_id',v_sales,'amount',100)), 'INVALID_JOURNAL_LINES'),
        ('NG-14 明細1行',             jsonb_build_array(
                                        jsonb_build_object('side','DEBIT','account_id',v_cash,'amount','100')), 'INVALID_JOURNAL_LINES'),
        ('NG-15 借方のみ2行',         jsonb_build_array(
                                        jsonb_build_object('side','DEBIT','account_id',v_cash,'amount','100'),
                                        jsonb_build_object('side','DEBIT','account_id',v_exp,'amount','100')), 'INVALID_JOURNAL_LINES'),
        ('NG-16 side 不正',           jsonb_build_array(
                                        jsonb_build_object('side','debit','account_id',v_cash,'amount','100'),
                                        jsonb_build_object('side','CREDIT','account_id',v_sales,'amount','100')), 'INVALID_JOURNAL_LINES'),
        ('NG-17 科目なし',            jsonb_build_array(
                                        jsonb_build_object('side','DEBIT','account_id',null,'amount','100'),
                                        jsonb_build_object('side','CREDIT','account_id',v_sales,'amount','100')), 'INVALID_JOURNAL_LINES'),
        ('NG-18 配列でない',          jsonb_build_object('side','DEBIT'),                         'INVALID_JOURNAL_LINES'),
        ('NG-19 税区分が数値',        jsonb_build_array(
                                        jsonb_build_object('side','DEBIT','account_id',v_cash,'amount','100','tax_code',1),
                                        jsonb_build_object('side','CREDIT','account_id',v_sales,'amount','100')), 'INVALID_JOURNAL_LINES'),
        ('NG-20 存在しない科目',      pg_temp.lines(gen_random_uuid(), '100', v_sales, '100'),     '23503')
      ) as t(name, lines, expected)
    loop
      v_total := v_total + 1;
      v_txt := pg_temp.expect_error(format('select create_journal_entry(%L, %L, %L, null, %L)',
                 v_period, '2099-07-01', 'ZZTEST NG', c.lines), c.expected);
      if v_txt is not null then v_fails := v_fails || (c.name || ': ' || v_txt); end if;
    end loop;
  end;

  -- [NG-21] 失敗した新規入力はヘッダーも残らない（原子性）
  v_total := v_total + 1;
  select count(*) into v_n from journal_entries where description = 'ZZTEST NG';
  if v_n <> 0 then v_fails := v_fails || format('NG-21 原子性（新規）: ヘッダーが %s 件残った', v_n); end if;

  -- [NG-22] insert_journal_lines を直接呼んでも検証される
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select insert_journal_lines(%L, %L)',
             v_entry, pg_temp.lines(v_cash, '1', v_sales, '2')), 'DEBIT_CREDIT_MISMATCH');
  if v_txt is not null then v_fails := v_fails || ('NG-22 insert_journal_lines 直接: ' || v_txt); end if;

  -- ============================================================
  -- 異常系: 会計期間
  -- ============================================================
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select create_journal_entry(%L, %L, %L, null, %L)',
             v_period, '2099-03-31', 'ZZTEST 期間前', v_lines_ok), 'OUT_OF_PERIOD');
  if v_txt is not null then v_fails := v_fails || ('NG-23 期首日の前日: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select create_journal_entry(%L, %L, %L, null, %L)',
             v_period, '2100-04-01', 'ZZTEST 期間後', v_lines_ok), 'OUT_OF_PERIOD');
  if v_txt is not null then v_fails := v_fails || ('NG-24 期末日の翌日: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select create_journal_entry(%L, %L, %L, null, %L)',
             gen_random_uuid(), '2099-05-01', 'ZZTEST 期間なし', v_lines_ok), 'PERIOD_NOT_FOUND');
  if v_txt is not null then v_fails := v_fails || ('NG-25 存在しない期間: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select update_journal_entry(%L, %L, %L, null, %L)',
             v_entry, '2100-04-01', 'ZZTEST 期間外へ編集', v_lines_ok), 'OUT_OF_PERIOD');
  if v_txt is not null then v_fails := v_fails || ('NG-26 編集で期間外: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('update journal_entries set date = %L where id = %L', '2100-04-01', v_entry),
             'OUT_OF_PERIOD');
  if v_txt is not null then v_fails := v_fails || ('NG-27 一括変更で期間外: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('update fiscal_periods set end_date = %L where id = %L', '2099-12-30', v_period),
             'PERIOD_HAS_OUTSIDE_ENTRIES');
  if v_txt is not null then v_fails := v_fails || ('NG-28 期末日の短縮: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('update fiscal_periods set start_date = %L where id = %L', '2099-05-01', v_period),
             'PERIOD_HAS_OUTSIDE_ENTRIES');
  if v_txt is not null then v_fails := v_fails || ('NG-29 期首日の変更: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('update fiscal_periods set end_date = %L where id = %L', '2100-03-31', v_period2),
             '23514');
  if v_txt is not null then v_fails := v_fails || ('NG-30 期間の開始日>終了日: ' || v_txt); end if;

  -- ============================================================
  -- 異常系: 編集
  -- ============================================================
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select update_journal_entry(%L, %L, %L, null, %L)',
             gen_random_uuid(), '2099-05-01', 'ZZTEST', v_lines_ok), 'ENTRY_NOT_FOUND');
  if v_txt is not null then v_fails := v_fails || ('NG-31 存在しない仕訳の編集: ' || v_txt); end if;

  -- 期首残高仕訳（明細つきで直接作成）
  insert into journal_entries (period_id, date, description, is_opening_balance)
  values (v_period, '2099-04-01', 'ZZTEST 期首残高', true) returning id into v_ob;
  insert into journal_lines (entry_id, line_number, side, account_id, amount)
  values (v_ob, 1, 'DEBIT', v_cash, 10), (v_ob, 2, 'CREDIT', v_sales, 10);

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select update_journal_entry(%L, %L, %L, null, %L)',
             v_ob, '2099-04-01', 'ZZTEST', v_lines_ok), 'OPENING_BALANCE_EDIT_FORBIDDEN');
  if v_txt is not null then v_fails := v_fails || ('NG-32 期首残高仕訳の編集: ' || v_txt); end if;

  -- [NG-33] 不正な明細での編集は何も変えない（ヘッダー・明細・ログとも元のまま）
  v_total := v_total + 1;
  select count(*) into v_n from journal_entry_logs where entry_id = v_entry;
  v_txt := pg_temp.expect_error(format('select update_journal_entry(%L, %L, %L, null, %L)',
             v_entry, '2099-05-03', 'ZZTEST 失敗する編集', pg_temp.lines(v_cash, '1', v_sales, '2')),
             'DEBIT_CREDIT_MISMATCH');
  if v_txt is not null then v_fails := v_fails || ('NG-33 不正な編集: ' || v_txt); end if;
  if (select description from journal_entries where id = v_entry) <> 'ZZTEST 編集後'
     or (select count(*) from journal_lines where entry_id = v_entry) <> 3
     or (select count(*) from journal_entry_logs where entry_id = v_entry) <> v_n then
    v_fails := v_fails || 'NG-33 不正な編集: 元の状態が変わった'::text;
  end if;

  -- ============================================================
  -- 異常系: CHECK 制約（直接 INSERT / UPDATE）
  -- ============================================================
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('update journal_lines set amount = %L where entry_id = %L and line_number = 1',
             'NaN', v_entry), '23514');
  if v_txt is not null then v_fails := v_fails || ('NG-34 明細に NaN: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('update journal_lines set amount = 0 where entry_id = %L and line_number = 1',
             v_entry), '23514');
  if v_txt is not null then v_fails := v_fails || ('NG-35 明細に 0: ' || v_txt); end if;

  -- ============================================================
  -- 異常系: CSV本登録
  -- ============================================================
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s1]),
             'INVALID_STAGING_ROWS');
  if v_txt is not null then v_fails := v_fails || ('NG-36 処理済みの再登録: ' || v_txt); end if;

  insert into import_staging (company_id, raw_date, raw_debit_amount, raw_description, predicted_account_id, counter_account_id)
  values (v_company, '2099-08-01', 100, 'ZZTEST CSV-A', v_cash, v_sales) returning id into v_s3;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s3, v_s3]),
             'INVALID_STAGING_ROWS');
  if v_txt is not null then v_fails := v_fails || ('NG-37 重複指定: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period,
             array[v_s3, gen_random_uuid()]), 'INVALID_STAGING_ROWS');
  if v_txt is not null then v_fails := v_fails || ('NG-38 存在しない ID: ' || v_txt); end if;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, '{}'::uuid[]),
             'INVALID_STAGING_ROWS');
  if v_txt is not null then v_fails := v_fails || ('NG-39 空配列: ' || v_txt); end if;

  -- 2行目が不正な日付 → 1行目も登録されない・staging は未処理のまま・DELETE ログも出ない
  insert into import_staging (company_id, raw_date, raw_debit_amount, raw_description, predicted_account_id, counter_account_id)
  values (v_company, '2099/13/45', 100, 'ZZTEST CSV-B', v_cash, v_sales) returning id into v_s_done;

  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s3, v_s_done]),
             'INVALID_DATE', '2行目（ZZTEST CSV-B）%');
  if v_txt is not null then v_fails := v_fails || ('NG-40 不正な日付: ' || v_txt); end if;
  if exists (select 1 from journal_entries where description = 'ZZTEST CSV-A')
     or exists (select 1 from import_staging where id = v_s3 and is_processed)
     or exists (select 1 from journal_entry_logs where action = 'DELETE'
                 and before_data->'entry'->>'description' like 'ZZTEST CSV%') then
    v_fails := v_fails || 'NG-40 不正な日付: 1行目が残った、または DELETE ログが出た'::text;
  end if;

  -- 金額が両方0 → 行番号つきで INVALID_JOURNAL_LINES
  update import_staging set raw_date = '2099-08-02', raw_debit_amount = 0, raw_credit_amount = 0 where id = v_s_done;
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s3, v_s_done]),
             'INVALID_JOURNAL_LINES', '2行目%');
  if v_txt is not null then v_fails := v_fails || ('NG-41 金額0: ' || v_txt); end if;

  -- 期間外の日付 → 行番号つきで OUT_OF_PERIOD
  update import_staging set raw_date = '2100-04-01', raw_debit_amount = 100 where id = v_s_done;
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s3, v_s_done]),
             'OUT_OF_PERIOD', '2行目%');
  if v_txt is not null then v_fails := v_fails || ('NG-42 期間外: ' || v_txt); end if;

  -- 科目未設定
  update import_staging set raw_date = '2099-08-02', counter_account_id = null where id = v_s_done;
  v_total := v_total + 1;
  v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s_done]),
             'INVALID_JOURNAL_LINES', '1行目%');
  if v_txt is not null then v_fails := v_fails || ('NG-43 科目未設定: ' || v_txt); end if;

  -- 日付: NULL・空・YYYY-MM-DD 以外はすべて INVALID_DATE（NOT NULL 違反などの素のエラーにしない）
  update import_staging set counter_account_id = v_sales, raw_debit_amount = 100, raw_credit_amount = null
   where id = v_s_done;
  declare
    d record;
  begin
    for d in select * from (values
      ('NG-44 日付 NULL',        null::text),
      ('NG-45 日付 空文字',       ''),
      ('NG-46 日付 スラッシュ',   '2099/08/02'),
      ('NG-47 日付 桁なし',       '2099-8-2'),
      ('NG-48 日付 存在しない日', '2099-02-30')
    ) as t(name, val)
    loop
      update import_staging set raw_date = d.val where id = v_s_done;
      v_total := v_total + 1;
      v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s_done]),
                 'INVALID_DATE', '1行目%');
      if v_txt is not null then v_fails := v_fails || (d.name || ': ' || v_txt); end if;
    end loop;
  end;

  -- 金額: 借方・貸方がともに正で不一致 → 拒否（片側だけ・一致は許容）
  update import_staging set raw_date = '2099-08-02' where id = v_s_done;
  declare
    m record;
  begin
    for m in select * from (values
      ('NG-49 借方10000/貸方12000', 10000::numeric, 12000::numeric, 'DEBIT_CREDIT_MISMATCH'),
      ('NG-50 借方0.01/貸方0.02',   0.01,           0.02,           'DEBIT_CREDIT_MISMATCH')
    ) as t(name, d, c, expected)
    loop
      update import_staging set raw_debit_amount = m.d, raw_credit_amount = m.c where id = v_s_done;
      v_total := v_total + 1;
      v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s_done]),
                 m.expected, '1行目%一致しません');
      if v_txt is not null then v_fails := v_fails || (m.name || ': ' || v_txt); end if;
    end loop;
  end;

  -- 金額: 負数が含まれていたら、反対側が正でも拒否する（負数を黙って無視しない）。NaN も拒否
  declare
    n record;
  begin
    for n in select * from (values
      ('NG-51 借方-100/貸方100',   -100::numeric, 100::numeric,        'INVALID_JOURNAL_LINES'),
      ('NG-52 借方100/貸方-100',   100,           -100,                'INVALID_JOURNAL_LINES'),
      ('NG-53 借方-100/貸方0',     -100,          0,                   'INVALID_JOURNAL_LINES'),
      ('NG-54 借方-100/貸方なし',  -100,          null,                'INVALID_JOURNAL_LINES'),
      ('NG-55 借方なし/貸方-100',  null,          -100,                'INVALID_JOURNAL_LINES'),
      ('NG-56 借方-100/貸方-100',  -100,          -100,                'INVALID_JOURNAL_LINES'),
      ('NG-57 借方NaN/貸方NaN',    'NaN'::numeric,'NaN'::numeric,      'INVALID_JOURNAL_LINES'),
      ('NG-58 借方NaN/貸方100',    'NaN'::numeric, 100,                'DEBIT_CREDIT_MISMATCH')
    ) as t(name, d, c, expected)
    loop
      update import_staging set raw_date = '2099-08-02', raw_debit_amount = n.d, raw_credit_amount = n.c
       where id = v_s_done;
      v_total := v_total + 1;
      v_txt := pg_temp.expect_error(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s_done]),
                 n.expected, '1行目%');
      if v_txt is not null then v_fails := v_fails || (n.name || ': ' || v_txt); end if;
    end loop;
  end;

  -- 許容されるパターン: 借貸同額 / 借方のみ / 貸方のみ / 貸方0（0 は「未入力」扱い）
  declare
    k record;
  begin
    for k in select * from (values
      ('OK-9  借貸同額',     500::numeric, 500::numeric),
      ('OK-10 借方のみ',     500,          null),
      ('OK-11 貸方のみ',     null,         500),
      ('OK-12 借方0/貸方>0', 0,            500)
    ) as t(name, d, c)
    loop
      insert into import_staging (company_id, raw_date, raw_debit_amount, raw_credit_amount, raw_description,
                                  predicted_account_id, counter_account_id)
      values (v_company, '2099-08-03', k.d, k.c, 'ZZTEST CSV-OK', v_cash, v_sales) returning id into v_s1;
      v_total := v_total + 1;
      v_txt := pg_temp.expect_ok(format('select import_staging_entries(%L, %L::uuid[])', v_period, array[v_s1]));
      if v_txt is not null then v_fails := v_fails || (k.name || ': ' || v_txt); end if;
    end loop;
  end;

  -- ============================================================
  -- 権限
  --   (a) EXECUTE 権限の有無は、ロールを切り替えずにカタログで確認する（環境に依存せず必ず実行される）
  --   (b) 実際に anon へ切り替えて RPC を呼ぶ。スキップするのは「ロールを切り替えられない」場合だけ。
  --       切り替えた後のエラー（EXECUTE 権限不足・テーブル権限不足・RLS など）は、すべて FAIL にする
  -- ============================================================
  -- (a) anon / authenticated は実行できる、PUBLIC は実行できない
  declare
    f text;
    r text;
  begin
    foreach f in array array[
      'validate_journal_lines(jsonb)',
      'insert_journal_lines(uuid,jsonb)',
      'create_journal_entry(uuid,date,text,integer,jsonb,text)',
      'update_journal_entry(uuid,date,text,integer,jsonb,text)',
      'import_staging_entries(uuid,uuid[])'
    ] loop
      foreach r in array array['anon', 'authenticated'] loop
        v_total := v_total + 1;
        if not has_function_privilege(r, 'public.' || f, 'execute') then
          v_fails := v_fails || format('PERM-a %s に %s の EXECUTE 権限がない', r, f);
        end if;
      end loop;
      v_total := v_total + 1;
      if has_function_privilege('public', 'public.' || f, 'execute') then
        v_fails := v_fails || format('PERM-a PUBLIC に %s の EXECUTE 権限が付いている', f);
      end if;
    end loop;
  end;

  -- (b) 実際に anon で呼ぶ。事前準備（取込データ）は postgres のうちに済ませる
  insert into import_staging (company_id, raw_date, raw_debit_amount, raw_description, predicted_account_id, counter_account_id)
  values (v_company, '2099-09-02', 40, 'ZZTEST anon CSV', v_cash, v_sales) returning id into v_s1;

  declare
    v_can_switch boolean := false;
    v_anon_entry uuid;
  begin
    begin
      set local role anon;
      v_can_switch := true;
    exception when others then
      v_role_note := format('（PERM-b は SET ROLE anon ができないためスキップ: %s）', sqlerrm);
    end;

    if v_can_switch then
      -- ここから先は anon。pg_temp の補助関数は使わず、RPC を直接呼ぶ（補助関数の権限不足と区別するため）
      v_total := v_total + 1;
      begin
        v_anon_entry := (public.create_journal_entry(v_period, '2099-09-01', 'ZZTEST anon', null, v_lines_ok)->>'id')::uuid;
      exception when others then
        v_fails := v_fails || format('PERM-b anon で create_journal_entry が失敗: [%s] %s', sqlstate, sqlerrm);
      end;

      v_total := v_total + 1;
      begin
        perform update_journal_entry(v_anon_entry, '2099-09-02', 'ZZTEST anon 編集', null, v_lines_ok);
      exception when others then
        v_fails := v_fails || format('PERM-b anon で update_journal_entry が失敗: [%s] %s', sqlstate, sqlerrm);
      end;

      v_total := v_total + 1;
      begin
        perform import_staging_entries(v_period, array[v_s1]);
      exception when others then
        v_fails := v_fails || format('PERM-b anon で import_staging_entries が失敗: [%s] %s', sqlstate, sqlerrm);
      end;

      reset role;
    end if;
  end;

  -- ============================================================
  -- 結果（意図的なエラーで全体をロールバック）
  -- ============================================================
  if cardinality(v_fails) = 0 then
    raise exception 'TEST RESULT: ALL PASSED (%/%) %— このエラーはテストデータを消すための意図的なものです',
      v_total, v_total, v_role_note;
  else
    raise exception 'TEST RESULT: FAILED (%/%) %', cardinality(v_fails), v_total, v_role_note
      using detail = array_to_string(v_fails, E'\n');
  end if;
end;
$test$;
