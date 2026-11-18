-- 先に 20261114180000_opening_balances.sql を SQL Editor で実行する。
-- このファイル全体を実行し、ERROR: TEST RESULT: ALL PASSED (66 checks) を確認する。
-- 最後の意図的な例外により、会社・科目・期間・仕訳・期首残高・履歴をすべてロールバックする（ZZOB で始まる架空データ）。
-- ALL PASSED 以外のエラー（FAILED を含む）は成功と判断しない。
-- 確認できないもの: 同時実行（advisory lock の効果）、本番（PostgreSQL 17.6）での挙動、性能。

create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end;
$f$;

-- 残高の取得（無ければ 0）
create or replace function pg_temp.ob(p_period uuid, p_account uuid) returns numeric
language sql as $f$
  select coalesce((select balance from public.get_opening_balances_for_period(p_period) where account_id = p_account), 0);
$f$;

create or replace function pg_temp.ob_sum(p_period uuid) returns numeric
language sql as $f$
  select coalesce((select sum(balance) from public.get_opening_balances_for_period(p_period)), 0);
$f$;

create or replace function pg_temp.je(p_period uuid, p_date date, p_dr uuid, p_cr uuid, p_amount text) returns uuid
language plpgsql as $f$
begin
  return (public.create_journal_entry(p_period, p_date, 'ZZOB', null, jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', p_dr, 'amount', p_amount, 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', p_cr, 'amount', p_amount, 'tax_code', null)))->>'id')::uuid;
end;
$f$;

create or replace function pg_temp.acc(p_company uuid, p_code text) returns uuid
language sql as $f$
  select id from public.accounts where company_id = p_company and code = p_code;
$f$;

create or replace function pg_temp.lines(variadic p_pairs text[]) returns jsonb
language plpgsql as $f$
declare r jsonb := '[]'::jsonb; i integer := 1;
begin
  while i < array_length(p_pairs, 1) loop
    r := r || jsonb_build_array(jsonb_build_object('account_id', p_pairs[i], 'balance', p_pairs[i + 1]));
    i := i + 2;
  end loop;
  return r;
end;
$f$;

do $test$
declare
  v_total integer := 0;
  v_fails text[] := '{}';
  v_res jsonb;
  v_t text;
  v_n integer;
  -- 法人A（3期）
  ca uuid; a1 uuid; a2 uuid; a3 uuid;
  a_cash uuid; a_cur uuid; a_sales uuid; a_exp uuid; a_cap uuid; a_re uuid; a_pay uuid;
  -- 個人B（3期）
  cb uuid; b1 uuid; b2 uuid; b3 uuid;
  b_cash uuid; b_drw uuid; b_cont uuid; b_div uuid; b_capital uuid; b_sales uuid; b_exp uuid; b_loss uuid;
  -- 法人C（繰越先未設定）
  cc uuid; c1 uuid; c2 uuid;
  c_cash uuid; c_cur uuid; c_sales uuid;
  -- 法人D（直接仕訳・補助科目）
  cd uuid; d1 uuid; d2 uuid;
  d_cash uuid; d_re uuid; d_sub1 uuid; d_sub2 uuid; d_sales uuid;
  v_e uuid;
  v_before numeric;
  v_cnt integer;
  v_set_id uuid;
begin
  -- ------------------------------------------------------------
  -- 準備: 法人A（2098/4〜・3期連続）、個人B（2097〜2099年の暦年3期）
  -- ------------------------------------------------------------
  v_res := public.create_company('ZZOB 法人A', 'CORPORATION', 'EXEMPT', '2097-04-01', '2098-03-31');
  ca := (v_res->>'company_id')::uuid; a1 := (v_res->>'period_id')::uuid;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (ca, 'ZZOB A2', '2098-04-01', '2099-03-31', false) returning id into a2;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (ca, 'ZZOB A3', '2099-04-01', '2100-03-31', false) returning id into a3;
  a_cash := pg_temp.acc(ca, '100'); a_cur := pg_temp.acc(ca, '110'); a_sales := pg_temp.acc(ca, '700');
  a_exp := pg_temp.acc(ca, '753'); a_cap := pg_temp.acc(ca, '500'); a_re := pg_temp.acc(ca, '540'); a_pay := pg_temp.acc(ca, '400');

  v_res := public.create_company('ZZOB 個人B', 'INDIVIDUAL', 'EXEMPT', '2097-01-01', '2097-12-31');
  cb := (v_res->>'company_id')::uuid; b1 := (v_res->>'period_id')::uuid;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (cb, 'ZZOB B2', '2098-01-01', '2098-12-31', false) returning id into b2;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (cb, 'ZZOB B3', '2099-01-01', '2099-12-31', false) returning id into b3;
  b_cash := pg_temp.acc(cb, '100'); b_drw := pg_temp.acc(cb, '291'); b_cont := pg_temp.acc(cb, '390'); b_div := pg_temp.acc(cb, '392');
  b_capital := pg_temp.acc(cb, '400'); b_sales := pg_temp.acc(cb, '500'); b_exp := pg_temp.acc(cb, '700'); b_loss := pg_temp.acc(cb, '292');

  -- ------------------------------------------------------------
  -- T1: 法人2期以上。1期の損益が2期の期首で繰越先（540）に入り、合計0
  --   1期: 現金 1000 / 売上 1000（利益1000）、経費 300 / 現金 300 → 純利益 700
  -- ------------------------------------------------------------
  perform pg_temp.je(a1, '2097-06-01', a_cash, a_sales, '1000');
  perform pg_temp.je(a1, '2097-07-01', a_exp, a_cash, '300');
  v_total := v_total + 1;
  if pg_temp.ob(a2, a_cash) <> 700 or pg_temp.ob(a2, a_re) <> -700 or pg_temp.ob_sum(a2) <> 0
     or exists (select 1 from public.get_opening_balances_for_period(a2) where account_id in (a_sales, a_exp)) then
    v_fails := array_append(v_fails, 'T1: 2期の期首が現金700・繰越先-700（損益は返らない）で合計0であること');
  end if;
  -- 3期は2期の損益も含む（2期に売上200）
  perform pg_temp.je(a2, '2098-08-01', a_cash, a_sales, '200');
  v_total := v_total + 1;
  if pg_temp.ob(a3, a_cash) <> 900 or pg_temp.ob(a3, a_re) <> -900 or pg_temp.ob_sum(a3) <> 0 then
    v_fails := array_append(v_fails, 'T1b: 3期の期首が現金900・繰越先-900で合計0であること');
  end if;
  -- 最初の期（手動設定なし）の期首は空
  v_total := v_total + 1;
  if (select count(*) from public.get_opening_balances_for_period(a1)) <> 0 then
    v_fails := array_append(v_fails, 'T17: 最初の期で手動設定なしなら期首残高は空であること');
  end if;

  -- ------------------------------------------------------------
  -- T2: 個人。事業主貸借・292・392 を含む期首が元入金に吸収され、合計0
  --   1期: 現金 5000 / 売上 5000、経費 1000 / 現金 1000、事業主貸 400 / 現金 400、
  --        現金 600 / 事業主借 600、資産譲渡損(292) 50 / 現金 50、現金 80 / 受取配当(392) 80
  --   現金 = 5000-1000-400+600-50+80 = 4230、元入金(貸方) = 4230
  -- ------------------------------------------------------------
  perform pg_temp.je(b1, '2097-03-01', b_cash, b_sales, '5000');
  perform pg_temp.je(b1, '2097-03-02', b_exp, b_cash, '1000');
  perform pg_temp.je(b1, '2097-03-03', b_drw, b_cash, '400');
  perform pg_temp.je(b1, '2097-03-04', b_cash, b_cont, '600');
  perform pg_temp.je(b1, '2097-03-05', b_loss, b_cash, '50');
  perform pg_temp.je(b1, '2097-03-06', b_cash, b_div, '80');
  v_total := v_total + 1;
  if pg_temp.ob(b2, b_cash) <> 4230 or pg_temp.ob(b2, b_capital) <> -4230 or pg_temp.ob_sum(b2) <> 0
     or exists (select 1 from public.get_opening_balances_for_period(b2) where account_id in (b_drw, b_cont, b_div, b_loss, b_sales, b_exp)) then
    v_fails := array_append(v_fails, 'T2: 個人の期首が現金4230・元入金-4230（事業主貸借・292・392・損益は返らない）で合計0であること');
  end if;

  -- ------------------------------------------------------------
  -- T3: 手動設定のない2期で、1期の仕訳金額を変更すると2期の期首に即反映される（2期の仕訳は変わらない）
  -- ------------------------------------------------------------
  select id into v_e from public.journal_entries where period_id = a1 and date = '2097-06-01';
  select count(*) into v_cnt from public.journal_entries where period_id = a2;
  perform public.update_journal_entry(v_e, '2097-06-01', 'ZZOB 修正', null, jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', a_cash,  'amount', '1500', 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', a_sales, 'amount', '1500', 'tax_code', null)));
  v_total := v_total + 1;
  if pg_temp.ob(a2, a_cash) <> 1200 or pg_temp.ob(a2, a_re) <> -1200 or pg_temp.ob_sum(a2) <> 0
     or (select count(*) from public.journal_entries where period_id = a2) <> v_cnt then
    v_fails := array_append(v_fails, 'T3: 1期の修正が2期の期首（現金1200・繰越先-1200）に反映され、2期の仕訳は変わらないこと');
  end if;
  -- 元に戻す
  perform public.update_journal_entry(v_e, '2097-06-01', 'ZZOB', null, jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', a_cash,  'amount', '1000', 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', a_sales, 'amount', '1000', 'tax_code', null)));

  -- ------------------------------------------------------------
  -- T4: 繰越先なし。畳み込みが必要なら CARRY_FORWARD_NOT_SET、不要なら通る
  -- ------------------------------------------------------------
  v_res := public.create_company('ZZOB 法人C', 'CORPORATION', 'EXEMPT', '2097-04-01', '2098-03-31');
  cc := (v_res->>'company_id')::uuid; c1 := (v_res->>'period_id')::uuid;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (cc, 'ZZOB C2', '2098-04-01', '2099-03-31', false) returning id into c2;
  update public.companies set carry_forward_account_id = null where id = cc;
  c_cash := pg_temp.acc(cc, '100'); c_cur := pg_temp.acc(cc, '110'); c_sales := pg_temp.acc(cc, '700');
  perform pg_temp.je(c1, '2097-05-01', c_cur, c_cash, '100');   -- BS科目だけ
  v_total := v_total + 1;
  if pg_temp.ob(c2, c_cur) <> 100 or pg_temp.ob(c2, c_cash) <> -100 then
    v_fails := array_append(v_fails, 'T4a: 繰越先未設定でも、畳み込み不要なら期首残高を取得できること');
  end if;
  perform pg_temp.je(c1, '2097-05-02', c_cash, c_sales, '50');  -- 損益が出る
  v_total := v_total + 1;
  if pg_temp.err(format('select * from public.get_opening_balances_for_period(%L)', c2)) <> 'P0001|CARRY_FORWARD_NOT_SET' then
    v_fails := array_append(v_fails, 'T4b: 繰越先未設定で損益があれば CARRY_FORWARD_NOT_SET になること');
  end if;
  v_total := v_total + 1;
  if pg_temp.err(format('select * from public.save_period_opening_balances(%L, %L::jsonb, null, true)', c2,
        pg_temp.lines(c_cash::text, '100', c_cur::text, '-50')::text)) <> 'P0001|CARRY_FORWARD_NOT_SET' then
    v_fails := array_append(v_fails, 'T4c: 繰越先未設定で差額の自動集計をしようとすると CARRY_FORWARD_NOT_SET になること');
  end if;

  -- ------------------------------------------------------------
  -- T5: 会社ごとに独立（法人Aの期首に個人B・法人Cの科目が混ざらない）
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  if exists (select 1 from public.get_opening_balances_for_period(a2) where account_id in (b_cash, b_capital, c_cash, c_cur))
     or exists (select 1 from public.get_opening_balances_for_period(b2) where account_id in (a_cash, a_re, c_cash)) then
    v_fails := array_append(v_fails, 'T5: 期首残高が会社ごとに独立していること');
  end if;

  -- ------------------------------------------------------------
  -- T6: 繰越先への直接仕訳（配当など）が二重計上されない。補助科目の合算（T12）も確認する
  --   法人D 1期: 現金 1000 / 資本金... ではなく、繰越利益（540）へ直接: 繰越利益 200 / 現金 200（配当）、現金 1000 / 売上 1000
  -- ------------------------------------------------------------
  v_res := public.create_company('ZZOB 法人D', 'CORPORATION', 'EXEMPT', '2097-04-01', '2098-03-31');
  cd := (v_res->>'company_id')::uuid; d1 := (v_res->>'period_id')::uuid;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (cd, 'ZZOB D2', '2098-04-01', '2099-03-31', false) returning id into d2;
  d_cash := pg_temp.acc(cd, '100'); d_re := pg_temp.acc(cd, '540'); d_sales := pg_temp.acc(cd, '700');
  perform pg_temp.je(d1, '2097-05-01', d_cash, d_sales, '1000');
  perform pg_temp.je(d1, '2097-06-01', d_re, d_cash, '200');    -- 繰越先への直接仕訳（借方200）
  v_total := v_total + 1;
  -- 現金800、繰越先 = 直接仕訳の借方200 + 損益の貸方1000 = 貸方800
  if pg_temp.ob(d2, d_cash) <> 800 or pg_temp.ob(d2, d_re) <> -800 or pg_temp.ob_sum(d2) <> 0 then
    v_fails := array_append(v_fails, 'T6: 繰越先への直接仕訳が二重計上されず、期首が現金800・繰越先-800であること');
  end if;

  -- T12: 補助科目に入れた手動明細が返る（親へ合算は集計側。ここでは補助科目の行がそのまま保存・取得できること）
  insert into public.accounts (company_id, code, name, type, parent_id) values (cd, '100-1', 'ZZOB 現金A', 'ASSET', d_cash) returning id into d_sub1;
  insert into public.accounts (company_id, code, name, type, parent_id) values (cd, '100-2', 'ZZOB 現金B', 'ASSET', d_cash) returning id into d_sub2;
  v_res := public.save_period_opening_balances(d2, pg_temp.lines(d_sub1::text, '300', d_sub2::text, '200', d_cash::text, '100', d_re::text, '-600'), null, false);
  v_total := v_total + 1;
  if pg_temp.ob(d2, d_sub1) <> 300 or pg_temp.ob(d2, d_sub2) <> 200 or pg_temp.ob(d2, d_cash) <> 100
     or (select count(*) from public.get_opening_balances_for_period(d2)) <> 4 or pg_temp.ob_sum(d2) <> 0 then
    v_fails := array_append(v_fails, 'T12: 補助科目の手動明細が保存・取得でき、合計0であること');
  end if;
  perform public.clear_period_opening_balances(d2);

  -- ------------------------------------------------------------
  -- T7: 手動保存。合計0で成功／≠0は UNBALANCED／auto_balance で差額が繰越先へ／全額0のヘッダーも「手動」
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  v_res := public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '5000', a_cap::text, '-5000'), 'ZZOB メモ', false);
  if (v_res->>'line_count')::integer <> 2 or (v_res->>'auto_balanced')::boolean
     or pg_temp.ob(a2, a_cash) <> 5000 or pg_temp.ob(a2, a_cap) <> -5000 or pg_temp.ob(a2, a_re) <> 0
     or (select memo from public.period_opening_balance_sets where period_id = a2) is distinct from 'ZZOB メモ' then
    v_fails := array_append(v_fails, 'T7a: 合計0の手動保存が成功し、取得値が手動の値になること: ' || v_res::text);
  end if;
  v_total := v_total + 1;
  v_t := pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
        pg_temp.lines(a_cash::text, '5000', a_cap::text, '-4000')::text));
  if v_t <> 'P0001|OPENING_BALANCE_UNBALANCED' or pg_temp.ob(a2, a_cap) <> -5000 then
    v_fails := array_append(v_fails, 'T7b: 合計≠0は OPENING_BALANCE_UNBALANCED で拒否され、保存済みの値は変わらないこと: ' || v_t);
  end if;
  v_total := v_total + 1;
  v_res := public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '5000', a_cap::text, '-4000'), null, true);
  if (v_res->>'auto_balanced')::boolean is not true or (v_res->>'adjustment')::numeric <> -1000
     or pg_temp.ob(a2, a_re) <> -1000 or pg_temp.ob(a2, a_cap) <> -4000 or pg_temp.ob_sum(a2) <> 0 then
    v_fails := array_append(v_fails, 'T7c: auto_balance で差額が繰越先（540）へ集計され合計0になること: ' || v_res::text);
  end if;
  -- 繰越先の行が既にあるときは加算。結果が0になる場合は行を作らない
  v_total := v_total + 1;
  v_res := public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '100', a_re::text, '-100'), null, true);
  if (v_res->>'auto_balanced')::boolean or pg_temp.ob(a2, a_re) <> -100 then
    v_fails := array_append(v_fails, 'T7d: 合計0なら auto_balanced=false であること');
  end if;
  v_res := public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '100', a_re::text, '-60'), null, true);
  v_total := v_total + 1;
  if pg_temp.ob(a2, a_re) <> -100 or (v_res->>'adjustment')::numeric <> -40 then
    v_fails := array_append(v_fails, 'T7e: 繰越先の行が既にあれば差額が加算されること: ' || v_res::text);
  end if;
  -- 全額0（空配列）のヘッダーは「手動」: 自動計算に戻らず期首は空
  v_res := public.save_period_opening_balances(a2, '[]'::jsonb, null, false);
  v_total := v_total + 1;
  if not exists (select 1 from public.period_opening_balance_sets where period_id = a2)
     or (select count(*) from public.get_opening_balances_for_period(a2)) <> 0 then
    v_fails := array_append(v_fails, 'T7f: 全額0（明細なし）のヘッダーも手動として扱われ、期首残高が空になること');
  end if;
  -- p_auto_balance が null のときは false として扱い、自動調整せず UNBALANCED で拒否する
  v_total := v_total + 1;
  v_t := pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, null)', a2,
        pg_temp.lines(a_cash::text, '5000', a_cap::text, '-4000')::text));
  if v_t <> 'P0001|OPENING_BALANCE_UNBALANCED' then
    v_fails := array_append(v_fails, 'T7h: p_auto_balance が null のとき、自動調整されず OPENING_BALANCE_UNBALANCED になること: ' || v_t);
  end if;
  -- 0の行は捨てられる
  v_res := public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '0', a_cap::text, '0'), null, false);
  v_total := v_total + 1;
  if (v_res->>'line_count')::integer <> 0 then
    v_fails := array_append(v_fails, 'T7g: 金額0の行は保存されないこと');
  end if;

  -- ------------------------------------------------------------
  -- T8: REST 直接書き込みの貸借不一致は COMMIT 時（遅延制約）に拒否される
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  insert into public.period_opening_balance_sets (period_id) values (a3);
  insert into public.period_opening_balance_lines (period_id, account_id, balance) values (a3, a_cash, 100);
  v_t := pg_temp.err('set constraints trg_pob_lines_balanced immediate');
  if v_t <> 'P0001|OPENING_BALANCE_UNBALANCED' then
    v_fails := array_append(v_fails, 'T8: 直接 INSERT の貸借不一致が遅延制約で拒否されること: ' || v_t);
  end if;
  -- 戻す（サブトランザクションではないので、削除してから制約を再び遅延に戻す）
  delete from public.period_opening_balance_lines where period_id = a3;
  delete from public.period_opening_balance_sets where period_id = a3;
  set constraints trg_pob_lines_balanced deferred;

  -- ------------------------------------------------------------
  -- T9: 3期。2期に手動設定 → 1期を修正しても2期以降は不変／設定削除で自動に戻る
  -- ------------------------------------------------------------
  v_res := public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '5000', a_cap::text, '-5000'), null, false);
  v_before := pg_temp.ob(a3, a_cash);   -- 2期手動(5000) + 2期の動き（現金+200 / 売上200 → 損益は畳み込み）= 5200
  select id into v_e from public.journal_entries where period_id = a1 and date = '2097-06-01';
  perform public.update_journal_entry(v_e, '2097-06-01', 'ZZOB 修正', null, jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', a_cash,  'amount', '9000', 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', a_sales, 'amount', '9000', 'tax_code', null)));
  v_total := v_total + 1;
  if v_before <> 5200 or pg_temp.ob(a2, a_cash) <> 5000 or pg_temp.ob(a3, a_cash) <> 5200
     or pg_temp.ob(a3, a_cap) <> -5000 or pg_temp.ob(a3, a_re) <> -200 or pg_temp.ob_sum(a3) <> 0 then
    v_fails := array_append(v_fails, 'T9a: 手動設定の期（2期）とそれ以降（3期）は、1期の修正に影響されず、2期を基準につながること（3期: 現金5200・資本金-5000・繰越先-200）');
  end if;
  perform public.clear_period_opening_balances(a2);
  v_total := v_total + 1;
  -- 自動に戻る: 1期の現金は 9000-300 = 8700
  if pg_temp.ob(a2, a_cash) <> 8700 or pg_temp.ob(a2, a_re) <> -8700 or pg_temp.ob_sum(a2) <> 0 then
    v_fails := array_append(v_fails, 'T9b: 手動設定を解除すると自動計算（現金8700・繰越先-8700）に戻ること');
  end if;
  perform public.update_journal_entry(v_e, '2097-06-01', 'ZZOB', null, jsonb_build_array(
    jsonb_build_object('side', 'DEBIT',  'account_id', a_cash,  'amount', '1000', 'tax_code', null),
    jsonb_build_object('side', 'CREDIT', 'account_id', a_sales, 'amount', '1000', 'tax_code', null)));

  -- ------------------------------------------------------------
  -- T10: 履歴。保存・更新・解除のたびに行が増え、before/after が正しい
  -- ------------------------------------------------------------
  delete from public.period_opening_balance_logs where period_id = a2;   -- この検証用に履歴を空にする
  perform public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '100', a_cap::text, '-100'), 'v1', false);
  perform public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '200', a_cap::text, '-200'), 'v2', false);
  perform public.clear_period_opening_balances(a2);
  perform public.clear_period_opening_balances(a2);   -- ヘッダーが無いので何も記録しない
  v_total := v_total + 1;
  if (select count(*) from public.period_opening_balance_logs where period_id = a2) <> 3
     or (select string_agg(action, ',' order by changed_at, action desc) from public.period_opening_balance_logs where period_id = a2) is null
     or exists (select 1 from public.period_opening_balance_logs where period_id = a2 and action = 'SET' and after_data->>'memo' = 'v1' and before_data is not null)
     or not exists (select 1 from public.period_opening_balance_logs where period_id = a2 and action = 'SET' and after_data->>'memo' = 'v1' and before_data is null)
     or not exists (select 1 from public.period_opening_balance_logs where period_id = a2 and action = 'SET' and after_data->>'memo' = 'v2'
                      and before_data->>'memo' = 'v1' and jsonb_array_length(before_data->'lines') = 2)
     or not exists (select 1 from public.period_opening_balance_logs where period_id = a2 and action = 'CLEAR'
                      and before_data->>'memo' = 'v2' and after_data is null)
     or (select company_id from public.period_opening_balance_logs where period_id = a2 limit 1) <> ca then
    v_fails := array_append(v_fails, 'T10: 保存・更新・解除の履歴が3件（SET 初回 / SET 更新 / CLEAR）で、before/after・会社が正しいこと');
  end if;

  -- ------------------------------------------------------------
  -- T11: 導出関数は、手動設定の期でも導出値を返す（プレビュー・差の表示）
  -- ------------------------------------------------------------
  perform public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '5000', a_cap::text, '-5000'), null, false);
  v_total := v_total + 1;
  if pg_temp.ob(a2, a_cash) <> 5000
     or (select balance from public.get_derived_opening_balances_for_period(a2) where account_id = a_cash) is distinct from 1000 - 300
     or (select balance from public.get_derived_opening_balances_for_period(a2) where account_id = a_re) is distinct from -700
     or (select count(*) from public.get_derived_opening_balances_for_period(a1)) <> 0 then
    v_fails := array_append(v_fails, 'T11: 手動設定の期でも導出関数が前期末からの値（現金700・繰越先-700）を返し、最初の期は空であること');
  end if;
  -- 3期の導出値は手動設定の2期を基準にする
  v_total := v_total + 1;
  if (select balance from public.get_derived_opening_balances_for_period(a3) where account_id = a_cash) is distinct from 5200 then
    v_fails := array_append(v_fails, 'T11b: 3期の導出値は手動設定の2期を基準にすること（現金5200）');
  end if;

  -- ------------------------------------------------------------
  -- T13: ヘッダーのある期の DELETE は 23503（制約名で判定）／ヘッダーなしの期は従来どおり削除できる
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  declare
    a5 uuid;
  begin
    -- 仕訳のない期にヘッダーを置く（仕訳があると仕訳側の外部キーが先に働くため）
    insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (ca, 'ZZOB A5', '2101-04-01', '2102-03-31', false) returning id into a5;
    perform public.save_period_opening_balances(a5, '[]'::jsonb, null, false);
    delete from public.fiscal_periods where id = a5;
    v_fails := array_append(v_fails, 'T13a: ヘッダーのある期は削除できないこと');
  exception when foreign_key_violation then
    get stacked diagnostics v_t = constraint_name;
    if v_t <> 'period_opening_balance_sets_period_fkey' then
      v_fails := array_append(v_fails, 'T13a: 制約名が period_opening_balance_sets_period_fkey であること: ' || coalesce(v_t, 'null'));
    end if;
  end;
  v_total := v_total + 1;
  insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (ca, 'ZZOB A4', '2100-04-01', '2101-03-31', false);
  if pg_temp.err(format('delete from public.fiscal_periods where company_id = %L and name = %L', ca, 'ZZOB A4')) <> 'OK' then
    v_fails := array_append(v_fails, 'T13b: ヘッダーのない期は従来どおり削除できること');
  end if;

  -- ------------------------------------------------------------
  -- T14: 個人で事業主貸・事業主借を明細に入れると拒否。損益科目・収益科目も拒否（法人も）
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  if pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', b2,
        pg_temp.lines(b_drw::text, '100', b_capital::text, '-100')::text)) <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', b2,
        pg_temp.lines(b_cont::text, '-100', b_cash::text, '100')::text)) <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', b2,
        pg_temp.lines(b_sales::text, '-100', b_cash::text, '100')::text)) <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
        pg_temp.lines(a_exp::text, '100', a_cash::text, '-100')::text)) <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT'
     or exists (select 1 from public.period_opening_balance_sets where period_id = b2) then
    v_fails := array_append(v_fails, 'T14: 個人の事業主貸・事業主借と、損益科目は明細に使えず、ヘッダーも作られないこと');
  end if;
  -- 個人の手動設定は、資産・負債・元入金で保存できる（差額は元入金へ）
  v_res := public.save_period_opening_balances(b2, pg_temp.lines(b_cash::text, '1000'), null, true);
  v_total := v_total + 1;
  if pg_temp.ob(b2, b_cash) <> 1000 or pg_temp.ob(b2, b_capital) <> -1000 or pg_temp.ob_sum(b2) <> 0 then
    v_fails := array_append(v_fails, 'T14b: 個人は差額が元入金へ自動集計されて保存されること');
  end if;
  -- 手動設定の2期（個人）の後の3期は、2期に手動値を基準に事業主貸借を元入金へ畳み込む
  perform pg_temp.je(b2, '2098-02-01', b_drw, b_cash, '100');
  v_total := v_total + 1;
  if pg_temp.ob(b3, b_cash) <> 900 or pg_temp.ob(b3, b_capital) <> -900 or pg_temp.ob(b3, b_drw) <> 0 or pg_temp.ob_sum(b3) <> 0 then
    v_fails := array_append(v_fails, 'T14c: 個人の3期は2期の手動値を基準に事業主貸を元入金へ畳み込む（現金900・元入金-900）こと');
  end if;

  -- ------------------------------------------------------------
  -- T15: 明細参照中の科目の区分変更は拒否（案 C）。bs_category NULL も拒否
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  if pg_temp.err(format('update public.accounts set bs_category = null where id = %L', a_cash)) <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT' then
    v_fails := array_append(v_fails, 'T15a: 明細参照中の科目の bs_category を NULL にできないこと');
  end if;
  -- 参照されていない科目（受取手形など）は変更できる
  v_total := v_total + 1;
  if pg_temp.err(format('update public.accounts set pl_category = pl_category where id = %L', a_cash)) <> 'OK' then
    v_fails := array_append(v_fails, 'T15b: 区分以外の更新（区分列を変更しない更新）は通ること');
  end if;
  -- 親科目の区分変更が子へ伝播する経路: 補助科目が明細に使われているとき、親の区分変更は拒否される
  v_res := public.save_period_opening_balances(d2, pg_temp.lines(d_sub1::text, '300', d_re::text, '-300'), null, false);
  v_total := v_total + 1;
  if pg_temp.err(format('update public.accounts set bs_category = null where id = %L', d_cash)) <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT' then
    v_fails := array_append(v_fails, 'T15c: 補助科目が明細に使われているとき、親科目の bs_category を NULL にできないこと（伝播経路）');
  end if;
  -- 個人: 明細参照中の資産科目を事業主貸（OWNER_DRAWINGS）にはできない
  v_total := v_total + 1;
  v_t := pg_temp.err(format('update public.accounts set bs_category = %L where id = %L', 'OWNER_DRAWINGS', b_cash));
  if v_t <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT' then
    v_fails := array_append(v_fails, 'T15d: 個人で明細参照中の資産科目を事業主貸にできず、OPENING_BALANCE_INVALID_ACCOUNT になること: ' || v_t);
  end if;
  -- 参照中の科目の削除は 23503（制約名）
  v_total := v_total + 1;
  begin
    delete from public.accounts where id = a_cap;
    v_fails := array_append(v_fails, 'T15e: 明細参照中の科目は削除できないこと');
  exception when foreign_key_violation then
    get stacked diagnostics v_t = constraint_name;
    if v_t <> 'period_opening_balance_lines_account_fkey' then
      v_fails := array_append(v_fails, 'T15e: 制約名が period_opening_balance_lines_account_fkey であること: ' || coalesce(v_t, 'null'));
    end if;
  end;
  perform public.clear_period_opening_balances(d2);

  -- ------------------------------------------------------------
  -- T16: 期が連続しない（空白がある）場合の導出は日付範囲で数える
  -- ------------------------------------------------------------
  v_res := public.create_company('ZZOB 法人E', 'CORPORATION', 'EXEMPT', '2097-04-01', '2098-03-31');
  declare
    ce uuid := (v_res->>'company_id')::uuid; e1 uuid := (v_res->>'period_id')::uuid; e3 uuid;
    e_cash uuid := pg_temp.acc((v_res->>'company_id')::uuid, '100'); e_cur uuid := pg_temp.acc((v_res->>'company_id')::uuid, '110');
  begin
    -- 2期目（2098/4〜2099/3）を飛ばして、3期目（2099/10〜）だけ作る。空白期間にも仕訳は作れない
    insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (ce, 'ZZOB E3', '2099-10-01', '2100-09-30', false) returning id into e3;
    perform pg_temp.je(e1, '2097-05-01', e_cur, e_cash, '70');
    v_total := v_total + 1;
    if pg_temp.ob(e3, e_cur) <> 70 or pg_temp.ob(e3, e_cash) <> -70 or pg_temp.ob_sum(e3) <> 0 then
      v_fails := array_append(v_fails, 'T16: 期の間に空白があっても、日付範囲で導出し二重計上しないこと');
    end if;
  end;

  -- T16b: 期が重なっている場合も、導出は日付範囲で数え、同じ仕訳を二重に数えない（期の重複は DB では禁止されていない）
  declare
    cg uuid; g1 uuid; g2 uuid; g3 uuid; g_cash uuid; g_cur uuid; g_sales uuid; g_re uuid;
  begin
    v_res := public.create_company('ZZOB 法人G', 'CORPORATION', 'EXEMPT', '2097-04-01', '2098-03-31');
    cg := (v_res->>'company_id')::uuid; g1 := (v_res->>'period_id')::uuid;
    insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (cg, 'ZZOB G2重複', '2097-10-01', '2098-09-30', false) returning id into g2;
    insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (cg, 'ZZOB G3', '2098-10-01', '2099-09-30', false) returning id into g3;
    g_cash := pg_temp.acc(cg, '100'); g_cur := pg_temp.acc(cg, '110'); g_sales := pg_temp.acc(cg, '700'); g_re := pg_temp.acc(cg, '540');
    perform pg_temp.je(g1, '2097-05-01', g_cash, g_sales, '100');   -- 1期のみに含まれる
    perform pg_temp.je(g1, '2097-11-01', g_cur, g_cash, '30');      -- 1期と2期の重複範囲
    perform pg_temp.je(g2, '2098-05-01', g_cash, g_sales, '20');    -- 2期（1期の終了後）
    v_total := v_total + 1;
    -- 3期の期首: 現金 100-30+20=90、当座 30、繰越先 -(100+20)=-120。合計0。仕訳は各1回だけ数える
    if pg_temp.ob(g3, g_cash) <> 90 or pg_temp.ob(g3, g_cur) <> 30 or pg_temp.ob(g3, g_re) <> -120 or pg_temp.ob_sum(g3) <> 0 then
      v_fails := array_append(v_fails, 'T16b: 期が重なっていても、日付範囲で数えて二重計上しないこと（現金90・当座30・繰越先-120）');
    end if;
  end;

  -- ------------------------------------------------------------
  -- T17: 最初の期より前の日付の仕訳があるとき（通常は作れない）は OPENING_BASE_UNDETERMINED
  --   範囲外の仕訳を検出するトリガーを一時的に避けて、最初の期の開始日を仕訳より後ろへずらして再現する（検証用）
  -- ------------------------------------------------------------
  declare
    cf uuid; f1 uuid; f2 uuid; f_cash uuid; f_cur uuid;
  begin
    v_res := public.create_company('ZZOB 法人F', 'CORPORATION', 'EXEMPT', '2097-04-01', '2098-03-31');
    cf := (v_res->>'company_id')::uuid; f1 := (v_res->>'period_id')::uuid;
    insert into public.fiscal_periods (company_id, name, start_date, end_date, is_current) values (cf, 'ZZOB F2', '2098-04-01', '2099-03-31', false) returning id into f2;
    f_cash := pg_temp.acc(cf, '100'); f_cur := pg_temp.acc(cf, '110');
    perform pg_temp.je(f1, '2097-05-01', f_cur, f_cash, '10');
    -- 最初の期の開始日を仕訳より後ろへずらす（範囲外になる仕訳を検出するトリガーを一時的に避ける）
    alter table public.fiscal_periods disable trigger trg_fiscal_periods_check_entries;
    update public.fiscal_periods set start_date = '2097-06-01' where id = f1;
    alter table public.fiscal_periods enable trigger trg_fiscal_periods_check_entries;
    v_total := v_total + 1;
    if pg_temp.err(format('select * from public.get_opening_balances_for_period(%L)', f2)) <> 'P0001|OPENING_BASE_UNDETERMINED' then
      v_fails := array_append(v_fails, 'T17b: 会社の最初の期より前の仕訳があれば OPENING_BASE_UNDETERMINED になること');
    end if;
    -- ヘッダーがあれば（基準が手動設定なので）エラーにならない
    perform public.save_period_opening_balances(f2, pg_temp.lines(f_cash::text, '10', f_cur::text, '-10'), null, false);
    v_total := v_total + 1;
    if pg_temp.ob(f2, f_cash) <> 10 then
      v_fails := array_append(v_fails, 'T17c: 手動設定の期は、導出できなくても手動の値を返すこと');
    end if;
    -- 存在しない期
    v_total := v_total + 1;
    if pg_temp.err(format('select * from public.get_opening_balances_for_period(%L)', gen_random_uuid())) <> 'P0001|PERIOD_NOT_FOUND'
       or pg_temp.err(format('select public.save_period_opening_balances(%L, ''[]''::jsonb)', gen_random_uuid())) <> 'P0001|PERIOD_NOT_FOUND'
       or pg_temp.err(format('select public.clear_period_opening_balances(%L)', gen_random_uuid())) <> 'P0001|PERIOD_NOT_FOUND' then
      v_fails := array_append(v_fails, 'T17d: 存在しない期は PERIOD_NOT_FOUND になること');
    end if;
  end;

  -- ------------------------------------------------------------
  -- T19: 明細・ヘッダーの period_id 付け替えは拒否。遅延制約は UPDATE で旧・新の両期を検証する
  -- ------------------------------------------------------------
  perform public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '100', a_cap::text, '-100'), null, false);
  perform public.save_period_opening_balances(a3, '[]'::jsonb, null, false);
  v_total := v_total + 1;
  if pg_temp.err(format('update public.period_opening_balance_lines set period_id = %L where period_id = %L and account_id = %L', a3, a2, a_cash))
       <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or pg_temp.err(format('update public.period_opening_balance_sets set period_id = %L where period_id = %L', a1, a3))
       <> 'P0001|OPENING_BALANCE_INVALID_LINES' then
    v_fails := array_append(v_fails, 'T19a: 明細・ヘッダーの period_id を変更できないこと');
  end if;
  -- 付け替え禁止トリガーだけを無効化した状態でも、遅延制約（有効のまま）が旧期（2期）の不一致を検出する
  -- ALTER TABLE は保留中の遅延トリガーがあると失敗するため、先に検証を実行して保留を空にする
  set constraints trg_pob_lines_balanced immediate;
  set constraints trg_pob_lines_balanced deferred;
  alter table public.period_opening_balance_lines disable trigger trg_pob_lines_period_immutable;
  update public.period_opening_balance_lines set period_id = a3 where period_id = a2 and account_id = a_cash;
  insert into public.period_opening_balance_lines (period_id, account_id, balance) values (a3, a_cap, -100);
  v_total := v_total + 1;
  v_t := pg_temp.err('set constraints trg_pob_lines_balanced immediate');
  if v_t <> 'P0001|OPENING_BALANCE_UNBALANCED' then
    v_fails := array_append(v_fails, 'T19b: 付け替えで移動元（旧期）が不一致になると、遅延制約が検出すること: ' || v_t);
  end if;
  -- 後片付け: 有効化し、テストの状態を戻す
  delete from public.period_opening_balance_lines where period_id in (a2, a3);
  set constraints trg_pob_lines_balanced immediate;
  set constraints trg_pob_lines_balanced deferred;
  alter table public.period_opening_balance_lines enable trigger trg_pob_lines_period_immutable;
  perform public.clear_period_opening_balances(a2);
  perform public.clear_period_opening_balances(a3);

  -- ------------------------------------------------------------
  -- T20: type=ASSET で bs_category=NULL の科目は明細に使えない
  -- ------------------------------------------------------------
  declare
    n_asset uuid;
  begin
    insert into public.accounts (company_id, code, name, type, pl_category) values (ca, 'ZZOB-N1', 'ZZOB BSなし', 'ASSET', null) returning id into n_asset;
    v_total := v_total + 1;
    if pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
          pg_temp.lines(n_asset::text, '100', a_cap::text, '-100')::text)) <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT'
       or pg_temp.err(format('insert into public.period_opening_balance_sets (period_id) values (%L)', a2)) <> 'OK'
       or pg_temp.err(format('insert into public.period_opening_balance_lines (period_id, account_id, balance) values (%L, %L, 1)', a2, n_asset))
          <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT' then
      v_fails := array_append(v_fails, 'T20: bs_category が NULL の資産科目は手動明細に使えないこと（RPC・直接 INSERT とも）');
    end if;
    delete from public.period_opening_balance_sets where period_id = a2;
  end;

  -- ------------------------------------------------------------
  -- T21: 金額の精度。小数第3位は拒否（丸めない）、小数第2位まで・整数・文字列は可、13桁超・NaN・指数表記は拒否
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  if pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
        pg_temp.lines(a_cash::text, '100.005', a_cap::text, '-100.005')::text)) <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
        pg_temp.lines(a_cash::text, '10000000000000', a_cap::text, '-10000000000000')::text)) <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
        pg_temp.lines(a_cash::text, 'NaN', a_cap::text, '0')::text)) <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
        pg_temp.lines(a_cash::text, '1e2', a_cap::text, '-1e2')::text)) <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or exists (select 1 from public.period_opening_balance_sets where period_id = a2) then
    v_fails := array_append(v_fails, 'T21a: 小数第3位・13桁超・NaN・指数表記は拒否され、何も保存されないこと');
  end if;
  v_res := public.save_period_opening_balances(a2,
    jsonb_build_array(jsonb_build_object('account_id', a_cash, 'balance', 100.50),
                      jsonb_build_object('account_id', a_cap, 'balance', '-100.50')), null, false);
  v_total := v_total + 1;
  if pg_temp.ob(a2, a_cash) <> 100.50 or pg_temp.ob(a2, a_cap) <> -100.50 then
    v_fails := array_append(v_fails, 'T21b: 小数第2位まで（JSON 数値・文字列とも）は保存できること');
  end if;
  -- その他の入力エラー: 配列でない・重複・他社の科目・科目が不正
  v_total := v_total + 1;
  if pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2, '{}')) <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, null, null, false)', a2)) <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
          pg_temp.lines(a_cash::text, '1', a_cash::text, '-1')::text)) <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
          pg_temp.lines('not-a-uuid', '1')::text)) <> 'P0001|OPENING_BALANCE_INVALID_LINES'
     or pg_temp.err(format('select public.save_period_opening_balances(%L, %L::jsonb, null, false)', a2,
          pg_temp.lines(b_cash::text, '1', a_cap::text, '-1')::text)) <> 'P0001|REFERENCE_NOT_FOUND_OR_OTHER_COMPANY' then
    v_fails := array_append(v_fails, 'T21c: 配列でない・null・重複・uuid でない・他社の科目は、それぞれ拒否されること');
  end if;
  perform public.clear_period_opening_balances(a2);

  -- ------------------------------------------------------------
  -- T23: 明細の account_id を別の BS 科目へ UPDATE できる（合計は不変）。損益科目への UPDATE は拒否
  -- ------------------------------------------------------------
  perform public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '100', a_cap::text, '-100'), null, false);
  v_total := v_total + 1;
  if pg_temp.err(format('update public.period_opening_balance_lines set account_id = %L where period_id = %L and account_id = %L', a_cur, a2, a_cash)) <> 'OK'
     or pg_temp.ob(a2, a_cur) <> 100 or pg_temp.ob(a2, a_cash) <> 0
     or pg_temp.err(format('update public.period_opening_balance_lines set account_id = %L where period_id = %L and account_id = %L', a_sales, a2, a_cur))
        <> 'P0001|OPENING_BALANCE_INVALID_ACCOUNT' then
    v_fails := array_append(v_fails, 'T23: 明細の科目を別の BS 科目へ変更でき、損益科目へは変更できないこと');
  end if;
  perform public.clear_period_opening_balances(a2);

  -- ------------------------------------------------------------
  -- 権限・構造
  -- ------------------------------------------------------------
  v_total := v_total + 1;
  if (select count(*) from pg_class where relname in ('period_opening_balance_sets', 'period_opening_balance_lines', 'period_opening_balance_logs')
        and relnamespace = 'public'::regnamespace and relrowsecurity) <> 3 then
    v_fails := array_append(v_fails, 'P1: 3表とも RLS が有効であること');
  end if;
  v_total := v_total + 1;
  if has_table_privilege('anon', 'public.period_opening_balance_sets', 'TRUNCATE') or has_table_privilege('anon', 'public.period_opening_balance_sets', 'REFERENCES')
     or has_table_privilege('anon', 'public.period_opening_balance_sets', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.period_opening_balance_lines', 'TRUNCATE')
     or has_table_privilege('anon', 'public.period_opening_balance_logs', 'UPDATE') or has_table_privilege('anon', 'public.period_opening_balance_logs', 'DELETE')
     or not has_table_privilege('anon', 'public.period_opening_balance_sets', 'SELECT') or not has_table_privilege('anon', 'public.period_opening_balance_sets', 'DELETE')
     or not has_table_privilege('authenticated', 'public.period_opening_balance_lines', 'INSERT')
     or not has_table_privilege('anon', 'public.period_opening_balance_logs', 'INSERT') then
    v_fails := array_append(v_fails, 'P2: 表の権限が設計どおり（TRUNCATE/REFERENCES/TRIGGER なし・履歴は SELECT/INSERT のみ）であること');
  end if;
  v_total := v_total + 1;
  if has_function_privilege('public', 'public.save_period_opening_balances(uuid, jsonb, text, boolean)', 'EXECUTE')
     or has_function_privilege('public', 'public.clear_period_opening_balances(uuid)', 'EXECUTE')
     or has_function_privilege('public', 'public.get_derived_opening_balances_for_period(uuid)', 'EXECUTE')
     or has_function_privilege('public', 'public.get_opening_balances_for_period(uuid)', 'EXECUTE')
     or has_function_privilege('public', 'public.check_opening_balance_set_balanced()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.save_period_opening_balances(uuid, jsonb, text, boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_derived_opening_balances_for_period(uuid)', 'EXECUTE') then
    v_fails := array_append(v_fails, 'P3: RPC の EXECUTE が PUBLIC に付かず、anon/authenticated にだけ付いていること');
  end if;
  -- anon ロールでも保存・取得・解除ができる
  v_total := v_total + 1;
  begin
    set local role anon;
    perform public.save_period_opening_balances(a2, pg_temp.lines(a_cash::text, '10', a_cap::text, '-10'), null, false);
    if pg_temp.ob(a2, a_cash) <> 10 then
      reset role;
      v_fails := array_append(v_fails, 'P4: anon ロールで手動の期首残高が保存・取得できること');
    end if;
    perform public.clear_period_opening_balances(a2);
    reset role;
  exception when others then
    reset role;
    v_fails := array_append(v_fails, 'P4: anon ロールで保存・解除ができること: ' || sqlerrm);
  end;
  v_total := v_total + 1;
  if (select count(*) from pg_trigger where tgname = 'trg_accounts_c_guard_opening_lines' and tgrelid = 'public.accounts'::regclass) <> 1 then
    v_fails := array_append(v_fails, 'P5: accounts のガードトリガーが存在すること');
  end if;

  -- ------------------------------------------------------------
  -- P6: 補助関数と4 RPC の EXECUTE を両ロールで個別に検証（10項目）
  -- ------------------------------------------------------------
  declare
    f text;
    r text;
  begin
    foreach f in array array[
      'public.opening_balance_account_ok(text,text,text)',
      'public.get_derived_opening_balances_for_period(uuid)',
      'public.get_opening_balances_for_period(uuid)',
      'public.save_period_opening_balances(uuid,jsonb,text,boolean)',
      'public.clear_period_opening_balances(uuid)'
    ] loop
      foreach r in array array['anon', 'authenticated'] loop
        v_total := v_total + 1;
        if has_function_privilege(r, f, 'EXECUTE') is not true then
          v_fails := array_append(v_fails, format('P6: %s に %s の EXECUTE があること', r, f));
        end if;
      end loop;
    end loop;
  end;

  -- P7/P8: 専用の架空会社・期・初期科目を postgres で作り、anon で保存・解除（4項目）
  -- 既存fixtureを使わず、法人は現金/資本金、個人は現金/元入金を100/-100で保存する。
  declare
    k text;
    v_company uuid;
    v_period uuid;
    v_cash uuid;
    v_capital uuid;
    v_lines jsonb;
  begin
    foreach k in array array['CORPORATION', 'INDIVIDUAL'] loop
      v_res := public.create_company('ZZOB anon ' || k || ' ' || gen_random_uuid()::text,
        k, 'EXEMPT', '2096-01-01', '2096-12-31');
      v_company := (v_res->>'company_id')::uuid;
      v_period := (v_res->>'period_id')::uuid;
      v_cash := pg_temp.acc(v_company, '100');
      v_capital := pg_temp.acc(v_company, case when k = 'CORPORATION' then '500' else '400' end);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'balance', 100),
        jsonb_build_object('account_id', v_capital, 'balance', -100));

      v_total := v_total + 1;
      begin
        set local role anon;
        -- postgres で先行実行した計画を破棄し、anon の権限で補助関数の呼び出しを計画し直す。
        discard plans;
        v_res := public.save_period_opening_balances(v_period, v_lines, 'ZZOB anon 保存', false);
        reset role;
        if (v_res->>'line_count')::integer is distinct from 2
           or (v_res->>'auto_balanced')::boolean is distinct from false
           or not exists (select 1 from public.period_opening_balance_sets
                          where period_id = v_period and company_id = v_company)
           or (select count(*) from public.period_opening_balance_lines where period_id = v_period) <> 2
           or not exists (select 1 from public.period_opening_balance_lines
                          where period_id = v_period and company_id = v_company and account_id = v_cash and balance = 100)
           or not exists (select 1 from public.period_opening_balance_lines
                          where period_id = v_period and company_id = v_company and account_id = v_capital and balance = -100) then
          v_fails := array_append(v_fails, format('P7: %s の anon 保存後に貸借一致の2明細が保存されていること', k));
        end if;
      exception when others then
        reset role;
        v_fails := array_append(v_fails, format('P7: %s の anon 保存が成功すること: [%s] %s', k, sqlstate, sqlerrm));
      end;

      v_total := v_total + 1;
      begin
        set local role anon;
        perform public.clear_period_opening_balances(v_period);
        reset role;
        if exists (select 1 from public.period_opening_balance_sets where period_id = v_period)
           or exists (select 1 from public.period_opening_balance_lines where period_id = v_period) then
          v_fails := array_append(v_fails, format('P8: %s の anon 解除後にヘッダー・明細が残らないこと', k));
        end if;
      exception when others then
        reset role;
        v_fails := array_append(v_fails, format('P8: %s の anon 解除が成功すること: [%s] %s', k, sqlstate, sqlerrm));
      end;
    end loop;
  end;

  -- ------------------------------------------------------------
  -- 結果（意図的な例外ですべてロールバックする。ALL PASSED (66 checks)）
  -- ------------------------------------------------------------
  if array_length(v_fails, 1) is null then
    raise exception 'TEST RESULT: ALL PASSED (% checks)', v_total;
  else
    raise exception 'TEST RESULT: FAILED (% of % checks): %', array_length(v_fails, 1), v_total, array_to_string(v_fails, E'\n');
  end if;
end;
$test$;
