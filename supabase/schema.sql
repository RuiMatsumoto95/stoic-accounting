--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: bump_parent_entry_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_parent_entry_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE journal_entries
  SET updated_at = NOW()
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  RETURN NULL;
END;
$$;


--
-- Name: check_company_carry_forward(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_company_carry_forward() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  a accounts%rowtype;
begin
  if new.carry_forward_account_id is null then
    return new;
  end if;
  select * into a from accounts where id = new.carry_forward_account_id;
  if found and (a.type <> 'EQUITY' or a.bs_category is distinct from 'EQUITY' or a.parent_id is not null) then
    raise exception using errcode = 'P0001', message = 'INVALID_CARRY_FORWARD_ACCOUNT',
      detail = format('繰越先は純資産（EQUITY）の親科目に限ります: %s %s', a.code, a.name);
  end if;
  return new;
end;
$$;


--
-- Name: check_fiscal_period_entries(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_fiscal_period_entries() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
    from journal_entries
   where period_id = new.id
     and (date < new.start_date or date > new.end_date);

  if v_count > 0 then
    raise exception using errcode = 'P0001', message = 'PERIOD_HAS_OUTSIDE_ENTRIES',
      detail = format('変更後の期間（%s〜%s）の範囲外になる仕訳が %s 件あります', new.start_date, new.end_date, v_count);
  end if;

  return new;
end;
$$;


--
-- Name: check_journal_entry_balance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_journal_entry_balance() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_entry_id     uuid;
  v_count        integer;
  v_debit_count  integer;
  v_credit_count integer;
  v_debit_total  numeric;
  v_credit_total numeric;
begin
  if tg_table_name = 'journal_entries' then
    v_entry_id := new.id;
  elsif tg_op = 'DELETE' then
    v_entry_id := old.entry_id;
  else
    v_entry_id := new.entry_id;
  end if;

  -- 仕訳自体が削除済みなら検証不要
  if not exists (select 1 from journal_entries where id = v_entry_id) then
    return null;
  end if;

  select count(*),
         count(*) filter (where side = 'DEBIT'),
         count(*) filter (where side = 'CREDIT'),
         coalesce(sum(amount) filter (where side = 'DEBIT'), 0),
         coalesce(sum(amount) filter (where side = 'CREDIT'), 0)
    into v_count, v_debit_count, v_credit_count, v_debit_total, v_credit_total
    from journal_lines
   where entry_id = v_entry_id;

  if v_count < 2 or v_debit_count = 0 or v_credit_count = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
      detail = format('仕訳 %s の明細が不足しています（%s 行）', v_entry_id, v_count);
  end if;

  if v_debit_total <> v_credit_total then
    raise exception using errcode = 'P0001', message = 'DEBIT_CREDIT_MISMATCH',
      detail = format('仕訳 %s: 借方合計 %s / 貸方合計 %s', v_entry_id, v_debit_total, v_credit_total);
  end if;

  return null;
end;
$$;


--
-- Name: check_journal_entry_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_journal_entry_period() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_start date;
  v_end   date;
begin
  select start_date, end_date
    into v_start, v_end
    from fiscal_periods
   where id = new.period_id
     for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND',
      detail = format('period_id = %s', new.period_id);
  end if;

  if new.date < v_start or new.date > v_end then
    raise exception using errcode = 'P0001', message = 'OUT_OF_PERIOD',
      detail = format('日付 %s は会計期間 %s〜%s の範囲外です', new.date, v_start, v_end);
  end if;

  return new;
end;
$$;


--
-- Name: check_opening_balance_line_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_opening_balance_line_account() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  a accounts%rowtype;
begin
  -- FOR SHARE: 科目の区分変更（FOR NO KEY UPDATE）と競合させ、検証から COMMIT までの間に区分を変えられないようにする。
  -- （外部キーの FOR KEY SHARE だけでは、キーを変えない UPDATE を止められない）
  select * into a from accounts where id = new.account_id and company_id = new.company_id for share;
  if not found then
    -- 存在しない／他社の科目は複合外部キーが 23503 で拒否する
    return new;
  end if;
  if not opening_balance_account_ok(a.type, a.bs_category, a.company_kind) then
    raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_ACCOUNT',
      detail = format('期首残高に使えない科目です: %s %s', a.code, a.name);
  end if;
  return new;
end;
$$;


--
-- Name: check_opening_balance_set_balanced(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_opening_balance_set_balanced() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_periods uuid[] := '{}';
  v_period  uuid;
  v_sum     numeric;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_periods := array_append(v_periods, old.period_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if not (new.period_id = any(v_periods)) then
      v_periods := array_append(v_periods, new.period_id);
    end if;
  end if;

  foreach v_period in array v_periods loop
    -- ヘッダーが無い（ヘッダー削除の CASCADE など）なら検証不要
    if exists (select 1 from period_opening_balance_sets where period_id = v_period) then
      select coalesce(sum(balance), 0) into v_sum from period_opening_balance_lines where period_id = v_period;
      if v_sum <> 0 then
        raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_UNBALANCED',
          detail = format('期首残高の借方・貸方が一致しません（期 %s・差額 %s）', v_period, v_sum);
      end if;
    end if;
  end loop;
  return null;
end;
$$;


--
-- Name: check_reference_number(uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_reference_number(p_period_id uuid, p_reference_number integer, p_exclude_entry_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if p_reference_number is null then
    return;
  end if;

  if p_reference_number < 1 or p_reference_number > 999999999 then
    raise exception using errcode = 'P0001', message = 'INVALID_REFERENCE_NUMBER',
      detail = '伝票番号は 1 以上 999999999 以下の整数で入力してください';
  end if;

  if exists (
    select 1 from journal_entries
     where period_id = p_period_id
       and reference_number = p_reference_number
       and (p_exclude_entry_id is null or id <> p_exclude_entry_id)
  ) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_REFERENCE_NUMBER',
      detail = format('この会計期には伝票番号 %s が既に存在します', p_reference_number);
  end if;
end;
$$;


--
-- Name: clear_period_opening_balances(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_period_opening_balances(p_period_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_company uuid;
  v_before  jsonb;
begin
  select company_id into v_company from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND', detail = '会計期間が見つかりません';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('period_opening_balance:' || p_period_id::text, 0));

  select jsonb_build_object(
           'memo', s.memo,
           'lines', coalesce((select jsonb_agg(jsonb_build_object('account_id', l.account_id, 'balance', l.balance)
                                               order by l.account_id)
                                from period_opening_balance_lines l where l.period_id = p_period_id), '[]'::jsonb))
    into v_before
    from period_opening_balance_sets s
   where s.period_id = p_period_id;

  if v_before is null then
    return;
  end if;

  insert into period_opening_balance_logs (company_id, period_id, action, before_data, after_data)
  values (v_company, p_period_id, 'CLEAR', v_before, null);

  delete from period_opening_balance_sets where period_id = p_period_id;   -- 明細は CASCADE
end;
$$;


--
-- Name: close_fiscal_period(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_fiscal_period(p_period_id uuid, p_memo text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_closed_at timestamptz;
begin
  perform 1 from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND', detail = '会計期間が見つかりません';
  end if;

  perform set_config('stoic.close_memo', coalesce(p_memo, ''), true);
  update fiscal_periods set closed_at = now() where id = p_period_id and closed_at is null
  returning closed_at into v_closed_at;
  if not found then
    perform set_config('stoic.close_memo', '', true);
    raise exception using errcode = 'P0001', message = 'PERIOD_ALREADY_CLOSED', detail = 'この期は既に確定されています';
  end if;
  perform set_config('stoic.close_memo', '', true);

  return jsonb_build_object('period_id', p_period_id, 'closed_at', v_closed_at,
                            'warnings', to_jsonb(period_close_warnings(p_period_id)));
end;
$$;


--
-- Name: company_seed_accounts(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.company_seed_accounts(p_kind text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $_$
begin
  if p_kind = 'CORPORATION' then
    return $seed_corp$
[
{"code":"100","name":"現金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"GENKIN","normalized_alias":"genkin","alias_type":"ROMAN"},{"alias":"げんきん","normalized_alias":"げんきん","alias_type":"KANA"}]},
{"code":"101","name":"小口現金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KOGUCHI","normalized_alias":"koguchi","alias_type":"ROMAN"},{"alias":"こぐちげんきん","normalized_alias":"こぐちげんきん","alias_type":"KANA"},{"alias":"koguchigenkin","normalized_alias":"koguchigenkin","alias_type":"ROMAN"}]},
{"code":"110","name":"当座預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TOUZAYO","normalized_alias":"touzayo","alias_type":"ROMAN"},{"alias":"とうざよきん","normalized_alias":"とうざよきん","alias_type":"KANA"},{"alias":"tozayokin","normalized_alias":"tozayokin","alias_type":"ROMAN"},{"alias":"toza","normalized_alias":"toza","alias_type":"ROMAN"}]},
{"code":"115","name":"普通預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"FUTSUUYO","normalized_alias":"futsuuyo","alias_type":"ROMAN"},{"alias":"ふつうよきん","normalized_alias":"ふつうよきん","alias_type":"KANA"},{"alias":"futsuyokin","normalized_alias":"futsuyokin","alias_type":"ROMAN"},{"alias":"futsu","normalized_alias":"futsu","alias_type":"ROMAN"}]},
{"code":"124","name":"定期預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TEIKIYO","normalized_alias":"teikiyo","alias_type":"ROMAN"},{"alias":"ていきよきん","normalized_alias":"ていきよきん","alias_type":"KANA"},{"alias":"teikiyokin","normalized_alias":"teikiyokin","alias_type":"ROMAN"},{"alias":"teiki","normalized_alias":"teiki","alias_type":"ROMAN"}]},
{"code":"120","name":"通知預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TSUUCHI","normalized_alias":"tsuuchi","alias_type":"ROMAN"},{"alias":"つうちよきん","normalized_alias":"つうちよきん","alias_type":"KANA"},{"alias":"tsuchiyokin","normalized_alias":"tsuchiyokin","alias_type":"ROMAN"}]},
{"code":"128","name":"定期積金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TEIKITSU","normalized_alias":"teikitsu","alias_type":"ROMAN"},{"alias":"ていきつみきん","normalized_alias":"ていきつみきん","alias_type":"KANA"},{"alias":"teikitsumikinn","normalized_alias":"teikitsumikinn","alias_type":"ROMAN"}]},
{"code":"129","name":"別段預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"BETSUDAN","normalized_alias":"betsudan","alias_type":"ROMAN"},{"alias":"べつだんよきん","normalized_alias":"べつだんよきん","alias_type":"KANA"},{"alias":"betsudanyokin","normalized_alias":"betsudanyokin","alias_type":"ROMAN"}]},
{"code":"130","name":"郵便貯金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"YUUBIN","normalized_alias":"yuubin","alias_type":"ROMAN"},{"alias":"ゆうびんちょきん","normalized_alias":"ゆうびんちょきん","alias_type":"KANA"},{"alias":"yubinchokinn","normalized_alias":"yubinchokinn","alias_type":"ROMAN"}]},
{"code":"140","name":"受取手形","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"UKETORI","normalized_alias":"uketori","alias_type":"ROMAN"},{"alias":"うけとりてがた","normalized_alias":"うけとりてがた","alias_type":"KANA"},{"alias":"uketoritetegata","normalized_alias":"uketoritetegata","alias_type":"ROMAN"},{"alias":"tegata","normalized_alias":"tegata","alias_type":"ROMAN"}]},
{"code":"143","name":"電子記録債権","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"DENSHIKI","normalized_alias":"denshiki","alias_type":"ROMAN"},{"alias":"でんしきろくさいけん","normalized_alias":"でんしきろくさいけん","alias_type":"KANA"},{"alias":"denshikirokusaiken","normalized_alias":"denshikirokusaiken","alias_type":"ROMAN"},{"alias":"denshi","normalized_alias":"denshi","alias_type":"ROMAN"}]},
{"code":"141","name":"不渡手形","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"FUWATARI","normalized_alias":"fuwatari","alias_type":"ROMAN"},{"alias":"ふわたりてがた","normalized_alias":"ふわたりてがた","alias_type":"KANA"},{"alias":"fuwataritegata","normalized_alias":"fuwataritegata","alias_type":"ROMAN"}]},
{"code":"142","name":"売掛金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"URIKAKE","normalized_alias":"urikake","alias_type":"ROMAN"},{"alias":"うりかけきん","normalized_alias":"うりかけきん","alias_type":"KANA"},{"alias":"urikakekin","normalized_alias":"urikakekin","alias_type":"ROMAN"},{"alias":"uri","normalized_alias":"uri","alias_type":"ROMAN"}]},
{"code":"149","name":"貸倒引当金(売)","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"},{"alias":"かしだおれひきあてきん","normalized_alias":"かしだおれひきあてきん","alias_type":"KANA"},{"alias":"kashidaore","normalized_alias":"kashidaore","alias_type":"ROMAN"}]},
{"code":"150","name":"有価証券","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"YUUKASHO","normalized_alias":"yuukasho","alias_type":"ROMAN"},{"alias":"ゆうかしょうけん","normalized_alias":"ゆうかしょうけん","alias_type":"KANA"},{"alias":"yukashoken","normalized_alias":"yukashoken","alias_type":"ROMAN"}]},
{"code":"160","name":"商品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHOUHIN","normalized_alias":"shouhin","alias_type":"ROMAN"},{"alias":"しょうひん","normalized_alias":"しょうひん","alias_type":"KANA"},{"alias":"shohin","normalized_alias":"shohin","alias_type":"ROMAN"}]},
{"code":"161","name":"製品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SEIHIN","normalized_alias":"seihin","alias_type":"ROMAN"},{"alias":"せいひん","normalized_alias":"せいひん","alias_type":"KANA"}]},
{"code":"166","name":"副産物作業くず","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"FUKUSAN","normalized_alias":"fukusan","alias_type":"ROMAN"}]},
{"code":"162","name":"半製品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"HANSEIHI","normalized_alias":"hanseihi","alias_type":"ROMAN"},{"alias":"はんせいひん","normalized_alias":"はんせいひん","alias_type":"KANA"},{"alias":"hanseihin","normalized_alias":"hanseihin","alias_type":"ROMAN"}]},
{"code":"164","name":"原材料","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"GENZAIRY","normalized_alias":"genzairy","alias_type":"ROMAN"},{"alias":"げんざいりょう","normalized_alias":"げんざいりょう","alias_type":"KANA"},{"alias":"genzairyo","normalized_alias":"genzairyo","alias_type":"ROMAN"}]},
{"code":"163","name":"仕掛品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHIKAKAR","normalized_alias":"shikakar","alias_type":"ROMAN"},{"alias":"しかかりひん","normalized_alias":"しかかりひん","alias_type":"KANA"},{"alias":"shikakariin","normalized_alias":"shikakariin","alias_type":"ROMAN"}]},
{"code":"165","name":"貯蔵品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOZOUHI","normalized_alias":"chozouhi","alias_type":"ROMAN"},{"alias":"ちょぞうひん","normalized_alias":"ちょぞうひん","alias_type":"KANA"},{"alias":"chozohin","normalized_alias":"chozohin","alias_type":"ROMAN"}]},
{"code":"170","name":"前渡金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEWATAS","normalized_alias":"maewatas","alias_type":"ROMAN"},{"alias":"まえわたしきん","normalized_alias":"まえわたしきん","alias_type":"KANA"},{"alias":"maewatashikin","normalized_alias":"maewatashikin","alias_type":"ROMAN"}]},
{"code":"175","name":"前払費用","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEBARAI","normalized_alias":"maebarai","alias_type":"ROMAN"},{"alias":"まえばらいひよう","normalized_alias":"まえばらいひよう","alias_type":"KANA"},{"alias":"maebaraihiyo","normalized_alias":"maebaraihiyo","alias_type":"ROMAN"}]},
{"code":"174","name":"未収収益","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MISHUUSH","normalized_alias":"mishuush","alias_type":"ROMAN"},{"alias":"みしゅうしゅうえき","normalized_alias":"みしゅうしゅうえき","alias_type":"KANA"},{"alias":"mishuushue","normalized_alias":"mishuushue","alias_type":"ROMAN"}]},
{"code":"173","name":"短期貸付金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TANKIKAS","normalized_alias":"tankikas","alias_type":"ROMAN"},{"alias":"たんきかしつけきん","normalized_alias":"たんきかしつけきん","alias_type":"KANA"},{"alias":"tankikashitsuke","normalized_alias":"tankikashitsuke","alias_type":"ROMAN"}]},
{"code":"172","name":"未収入金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MISHUUNY","normalized_alias":"mishuuny","alias_type":"ROMAN"},{"alias":"みしゅうにゅうきん","normalized_alias":"みしゅうにゅうきん","alias_type":"KANA"},{"alias":"mishunukin","normalized_alias":"mishunukin","alias_type":"ROMAN"}]},
{"code":"171","name":"立替金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TATEKAE","normalized_alias":"tatekae","alias_type":"ROMAN"},{"alias":"たてかえきん","normalized_alias":"たてかえきん","alias_type":"KANA"},{"alias":"tatekaekin","normalized_alias":"tatekaekin","alias_type":"ROMAN"}]},
{"code":"177","name":"預け金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"AZUKEKIN","normalized_alias":"azukekin","alias_type":"ROMAN"},{"alias":"あずけきん","normalized_alias":"あずけきん","alias_type":"KANA"}]},
{"code":"176","name":"仮払金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KARIBARA","normalized_alias":"karibara","alias_type":"ROMAN"},{"alias":"かりばらいきん","normalized_alias":"かりばらいきん","alias_type":"KANA"},{"alias":"karibaraikin","normalized_alias":"karibaraikin","alias_type":"ROMAN"}]},
{"code":"180","name":"仮払消費税等","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KARIBARA","normalized_alias":"karibara","alias_type":"ROMAN"},{"alias":"かりばらいしょうひぜいとう","normalized_alias":"かりばらいしょうひぜいとう","alias_type":"KANA"},{"alias":"karibaraishohizei","normalized_alias":"karibaraishohizei","alias_type":"ROMAN"},{"alias":"karishohizei","normalized_alias":"karishohizei","alias_type":"ROMAN"}]},
{"code":"199","name":"貸倒引当金(他)","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"200","name":"建物","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"TATEMONO","normalized_alias":"tatemono","alias_type":"ROMAN"},{"alias":"たてもの","normalized_alias":"たてもの","alias_type":"KANA"}]},
{"code":"201","name":"附属設備","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"FUZOKUSE","normalized_alias":"fuzokuse","alias_type":"ROMAN"},{"alias":"ふぞくせつび","normalized_alias":"ふぞくせつび","alias_type":"KANA"},{"alias":"fuzokusetubi","normalized_alias":"fuzokusetubi","alias_type":"ROMAN"}]},
{"code":"202","name":"構築物","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KOUCHIKU","normalized_alias":"kouchiku","alias_type":"ROMAN"},{"alias":"こうちくぶつ","normalized_alias":"こうちくぶつ","alias_type":"KANA"},{"alias":"kochikubutsu","normalized_alias":"kochikubutsu","alias_type":"ROMAN"}]},
{"code":"203","name":"機械装置","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KIKAISO","normalized_alias":"kikaiso","alias_type":"ROMAN"},{"alias":"きかいそうち","normalized_alias":"きかいそうち","alias_type":"KANA"},{"alias":"kikaisouchi","normalized_alias":"kikaisouchi","alias_type":"ROMAN"},{"alias":"kikai","normalized_alias":"kikai","alias_type":"ROMAN"}]},
{"code":"204","name":"車両運搬具","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"SHARYOU","normalized_alias":"sharyou","alias_type":"ROMAN"},{"alias":"しゃりょううんぱんぐ","normalized_alias":"しゃりょううんぱんぐ","alias_type":"KANA"},{"alias":"sharyounpangu","normalized_alias":"sharyounpangu","alias_type":"ROMAN"},{"alias":"sharyo","normalized_alias":"sharyo","alias_type":"ROMAN"}]},
{"code":"205","name":"工具器具備品","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KOUGUKI","normalized_alias":"kouguki","alias_type":"ROMAN"},{"alias":"こうぐきぐびひん","normalized_alias":"こうぐきぐびひん","alias_type":"KANA"},{"alias":"kogukigubihin","normalized_alias":"kogukigubihin","alias_type":"ROMAN"},{"alias":"bihin","normalized_alias":"bihin","alias_type":"ROMAN"}]},
{"code":"208","name":"一括償却資産","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"IKKATSUS","normalized_alias":"ikkatsus","alias_type":"ROMAN"},{"alias":"いっかつしょうきゃくしさん","normalized_alias":"いっかつしょうきゃくしさん","alias_type":"KANA"},{"alias":"ikkatsu","normalized_alias":"ikkatsu","alias_type":"ROMAN"}]},
{"code":"209","name":"減価償却累計額","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"GENKARUI","normalized_alias":"genkarui","alias_type":"ROMAN"},{"alias":"げんかしょうきゃくるいけいがく","normalized_alias":"げんかしょうきゃくるいけいがく","alias_type":"KANA"},{"alias":"ruikei","normalized_alias":"ruikei","alias_type":"ROMAN"}]},
{"code":"210","name":"土地","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TOCHI","normalized_alias":"tochi","alias_type":"ROMAN"},{"alias":"とち","normalized_alias":"とち","alias_type":"KANA"}]},
{"code":"211","name":"建設仮勘定","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KENSETSU","normalized_alias":"kensetsu","alias_type":"ROMAN"},{"alias":"けんせつかりかんじょう","normalized_alias":"けんせつかりかんじょう","alias_type":"KANA"}]},
{"code":"220","name":"電話加入権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"DENWA","normalized_alias":"denwa","alias_type":"ROMAN"},{"alias":"でんわかにゅうけん","normalized_alias":"でんわかにゅうけん","alias_type":"KANA"},{"alias":"denwakanyuken","normalized_alias":"denwakanyuken","alias_type":"ROMAN"}]},
{"code":"221","name":"施設利用権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"SHISETSU","normalized_alias":"shisetsu","alias_type":"ROMAN"}]},
{"code":"222","name":"工業所有権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KOUGYOU","normalized_alias":"kougyou","alias_type":"ROMAN"}]},
{"code":"223","name":"営業権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"EIGYOU","normalized_alias":"eigyou","alias_type":"ROMAN"}]},
{"code":"224","name":"借地権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHAKUCHI","normalized_alias":"shakuchi","alias_type":"ROMAN"}]},
{"code":"225","name":"ソフトウェア","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"SOFUTO","normalized_alias":"sofuto","alias_type":"ROMAN"},{"alias":"そふとうえあ","normalized_alias":"そふとうえあ","alias_type":"KANA"},{"alias":"software","normalized_alias":"software","alias_type":"ROMAN"},{"alias":"soft","normalized_alias":"soft","alias_type":"ROMAN"}]},
{"code":"240","name":"投資有価証券","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TOUSHIYU","normalized_alias":"toushiyu","alias_type":"ROMAN"},{"alias":"とうしゆうかしょうけん","normalized_alias":"とうしゆうかしょうけん","alias_type":"KANA"},{"alias":"toshiyukashoken","normalized_alias":"toshiyukashoken","alias_type":"ROMAN"}]},
{"code":"249","name":"関係会社株式","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KANKEIGA","normalized_alias":"kankeiga","alias_type":"ROMAN"},{"alias":"かんけいがいしゃかぶしき","normalized_alias":"かんけいがいしゃかぶしき","alias_type":"KANA"}]},
{"code":"241","name":"出資金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHUSSHI","normalized_alias":"shusshi","alias_type":"ROMAN"}]},
{"code":"250","name":"関係会社出資金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KANKEIGA","normalized_alias":"kankeiga","alias_type":"ROMAN"}]},
{"code":"242","name":"敷金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHIKIKIN","normalized_alias":"shikikin","alias_type":"ROMAN"},{"alias":"しききん","normalized_alias":"しききん","alias_type":"KANA"}]},
{"code":"243","name":"差入保証金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SASHIIRE","normalized_alias":"sashiire","alias_type":"ROMAN"},{"alias":"さしいれほしょうきん","normalized_alias":"さしいれほしょうきん","alias_type":"KANA"},{"alias":"sashiirehoshokin","normalized_alias":"sashiirehoshokin","alias_type":"ROMAN"},{"alias":"hosho","normalized_alias":"hosho","alias_type":"ROMAN"}]},
{"code":"244","name":"長期貸付金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIKA","normalized_alias":"choukika","alias_type":"ROMAN"},{"alias":"ちょうきかしつけきん","normalized_alias":"ちょうきかしつけきん","alias_type":"KANA"},{"alias":"chokikashitsuke","normalized_alias":"chokikashitsuke","alias_type":"ROMAN"}]},
{"code":"245","name":"長期固定性預金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIKO","normalized_alias":"choukiko","alias_type":"ROMAN"}]},
{"code":"246","name":"長期滞留債権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKITA","normalized_alias":"choukita","alias_type":"ROMAN"}]},
{"code":"247","name":"長期前払費用","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIMA","normalized_alias":"choukima","alias_type":"ROMAN"}]},
{"code":"253","name":"前払年金費用","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEBARAI","normalized_alias":"maebarai","alias_type":"ROMAN"}]},
{"code":"248","name":"繰延税金資産","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KURINOBE","normalized_alias":"kurinobe","alias_type":"ROMAN"},{"alias":"くりのべぜいきんしさん","normalized_alias":"くりのべぜいきんしさん","alias_type":"KANA"},{"alias":"kurinobezeikin","normalized_alias":"kurinobezeikin","alias_type":"ROMAN"}]},
{"code":"251","name":"預託金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"YOTAKU","normalized_alias":"yotaku","alias_type":"ROMAN"}]},
{"code":"252","name":"貸倒引当金(投)","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"260","name":"創立費","type":"ASSET","bs_category":"DEFERRED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"SOURITSU","normalized_alias":"souritsu","alias_type":"ROMAN"}]},
{"code":"261","name":"開業費","type":"ASSET","bs_category":"DEFERRED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KAIGYOU","normalized_alias":"kaigyou","alias_type":"ROMAN"}]},
{"code":"262","name":"開発費","type":"ASSET","bs_category":"DEFERRED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KAIHATSU","normalized_alias":"kaihatsu","alias_type":"ROMAN"}]},
{"code":"400","name":"支払手形","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHIHARAI","normalized_alias":"shiharai","alias_type":"ROMAN"},{"alias":"しはらいてがた","normalized_alias":"しはらいてがた","alias_type":"KANA"},{"alias":"shiharaitegata","normalized_alias":"shiharaitegata","alias_type":"ROMAN"}]},
{"code":"401","name":"電子記録債務","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"DENSHIKI","normalized_alias":"denshiki","alias_type":"ROMAN"},{"alias":"でんしきろくさいむ","normalized_alias":"でんしきろくさいむ","alias_type":"KANA"},{"alias":"denshikirokusaimu","normalized_alias":"denshikirokusaimu","alias_type":"ROMAN"}]},
{"code":"405","name":"買掛金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KAIKAKE","normalized_alias":"kaikake","alias_type":"ROMAN"},{"alias":"かいかけきん","normalized_alias":"かいかけきん","alias_type":"KANA"},{"alias":"kaikakekin","normalized_alias":"kaikakekin","alias_type":"ROMAN"},{"alias":"kai","normalized_alias":"kai","alias_type":"ROMAN"}]},
{"code":"406","name":"設備支払手形","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SETSUBI","normalized_alias":"setsubi","alias_type":"ROMAN"}]},
{"code":"410","name":"短期借入金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TANKIKAR","normalized_alias":"tankikar","alias_type":"ROMAN"},{"alias":"たんきかりいれきん","normalized_alias":"たんきかりいれきん","alias_type":"KANA"},{"alias":"tankikariirekin","normalized_alias":"tankikariirekin","alias_type":"ROMAN"},{"alias":"tanki","normalized_alias":"tanki","alias_type":"ROMAN"}]},
{"code":"420","name":"未払金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIK","normalized_alias":"miharaik","alias_type":"ROMAN"},{"alias":"みばらいきん","normalized_alias":"みばらいきん","alias_type":"KANA"},{"alias":"mibaraikin","normalized_alias":"mibaraikin","alias_type":"ROMAN"}]},
{"code":"426","name":"未払費用","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIH","normalized_alias":"miharaih","alias_type":"ROMAN"},{"alias":"みばらいひよう","normalized_alias":"みばらいひよう","alias_type":"KANA"},{"alias":"mibaraihiyo","normalized_alias":"mibaraihiyo","alias_type":"ROMAN"}]},
{"code":"421","name":"未払配当金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIH","normalized_alias":"miharaih","alias_type":"ROMAN"}]},
{"code":"422","name":"未払役員賞与","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIY","normalized_alias":"miharaiy","alias_type":"ROMAN"}]},
{"code":"423","name":"未払法人税等","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIH","normalized_alias":"miharaih","alias_type":"ROMAN"},{"alias":"みばらいほうじんぜいとう","normalized_alias":"みばらいほうじんぜいとう","alias_type":"KANA"},{"alias":"mibaraihojinzei","normalized_alias":"mibaraihojinzei","alias_type":"ROMAN"}]},
{"code":"425","name":"未払消費税等","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIS","normalized_alias":"miharais","alias_type":"ROMAN"},{"alias":"みばらいしょうひぜいとう","normalized_alias":"みばらいしょうひぜいとう","alias_type":"KANA"},{"alias":"mibaraishohizei","normalized_alias":"mibaraishohizei","alias_type":"ROMAN"}]},
{"code":"430","name":"前受金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEUKEKI","normalized_alias":"maeukeki","alias_type":"ROMAN"},{"alias":"まえうけきん","normalized_alias":"まえうけきん","alias_type":"KANA"},{"alias":"maeukekin","normalized_alias":"maeukekin","alias_type":"ROMAN"}]},
{"code":"427","name":"預り金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"AZUKARIK","normalized_alias":"azukarik","alias_type":"ROMAN"},{"alias":"あずかりきん","normalized_alias":"あずかりきん","alias_type":"KANA"},{"alias":"azukarikin","normalized_alias":"azukarikin","alias_type":"ROMAN"}]},
{"code":"431","name":"前受収益","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEUKESH","normalized_alias":"maeukesh","alias_type":"ROMAN"}]},
{"code":"429","name":"預り保証金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"AZUKARIH","normalized_alias":"azukarih","alias_type":"ROMAN"}]},
{"code":"428","name":"仮受金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KARIUKEK","normalized_alias":"kariukek","alias_type":"ROMAN"},{"alias":"かりうけきん","normalized_alias":"かりうけきん","alias_type":"KANA"},{"alias":"kariukekin","normalized_alias":"kariukekin","alias_type":"ROMAN"}]},
{"code":"432","name":"割引手形","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"WARIBIKI","normalized_alias":"waribiki","alias_type":"ROMAN"}]},
{"code":"435","name":"裏書手形","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"URAGAKI","normalized_alias":"uragaki","alias_type":"ROMAN"}]},
{"code":"440","name":"仮受消費税等","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KARIUKES","normalized_alias":"kariukes","alias_type":"ROMAN"},{"alias":"かりうけしょうひぜいとう","normalized_alias":"かりうけしょうひぜいとう","alias_type":"KANA"},{"alias":"kariukeshohizei","normalized_alias":"kariukeshohizei","alias_type":"ROMAN"},{"alias":"karishohizei","normalized_alias":"karishohizei","alias_type":"ROMAN"}]},
{"code":"470","name":"長期借入金","type":"LIABILITY","bs_category":"FIXED_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIKA","normalized_alias":"choukika","alias_type":"ROMAN"},{"alias":"ちょうきかりいれきん","normalized_alias":"ちょうきかりいれきん","alias_type":"KANA"},{"alias":"chokikariirekin","normalized_alias":"chokikariirekin","alias_type":"ROMAN"},{"alias":"choki","normalized_alias":"choki","alias_type":"ROMAN"}]},
{"code":"475","name":"長期未払金","type":"LIABILITY","bs_category":"FIXED_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIMI","normalized_alias":"choukimi","alias_type":"ROMAN"}]},
{"code":"476","name":"繰延税金負債","type":"LIABILITY","bs_category":"FIXED_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KURINOBE","normalized_alias":"kurinobe","alias_type":"ROMAN"}]},
{"code":"490","name":"退職給付引当金","type":"LIABILITY","bs_category":"FIXED_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TAISHOKU","normalized_alias":"taishoku","alias_type":"ROMAN"},{"alias":"たいしょくきゅうふひきあてきん","normalized_alias":"たいしょくきゅうふひきあてきん","alias_type":"KANA"}]},
{"code":"500","name":"資本金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHIHONKI","normalized_alias":"shihonki","alias_type":"ROMAN"},{"alias":"しほんきん","normalized_alias":"しほんきん","alias_type":"KANA"},{"alias":"shihonkin","normalized_alias":"shihonkin","alias_type":"ROMAN"}]},
{"code":"510","name":"新株式申込証拠金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHINKABU","normalized_alias":"shinkabu","alias_type":"ROMAN"}]},
{"code":"520","name":"資本準備金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHIHONJU","normalized_alias":"shihonju","alias_type":"ROMAN"},{"alias":"しほんじゅんびきん","normalized_alias":"しほんじゅんびきん","alias_type":"KANA"},{"alias":"shihonzunbikin","normalized_alias":"shihonzunbikin","alias_type":"ROMAN"}]},
{"code":"525","name":"資本金及び準備金減少差益","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"GENSHISA","normalized_alias":"genshisa","alias_type":"ROMAN"}]},
{"code":"526","name":"自己株式処分差額","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"JIKOKABU","normalized_alias":"jikokabu","alias_type":"ROMAN"}]},
{"code":"530","name":"利益準備金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"RIEKIJUN","normalized_alias":"riekijun","alias_type":"ROMAN"},{"alias":"りえきじゅんびきん","normalized_alias":"りえきじゅんびきん","alias_type":"KANA"},{"alias":"riekijunbikin","normalized_alias":"riekijunbikin","alias_type":"ROMAN"}]},
{"code":"535","name":"別途積立金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"BETTOTSU","normalized_alias":"bettotsu","alias_type":"ROMAN"}]},
{"code":"540","name":"繰越利益","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KURIKOSH","normalized_alias":"kurikosh","alias_type":"ROMAN"},{"alias":"くりこしりえき","normalized_alias":"くりこしりえき","alias_type":"KANA"},{"alias":"kurikoshirieki","normalized_alias":"kurikoshirieki","alias_type":"ROMAN"},{"alias":"kurikoshi","normalized_alias":"kurikoshi","alias_type":"ROMAN"}]},
{"code":"550","name":"自己株式","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"JIKOKABU","normalized_alias":"jikokabu","alias_type":"ROMAN"}]},
{"code":"560","name":"自己株式申込証拠金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"JIKOKABU","normalized_alias":"jikokabu","alias_type":"ROMAN"}]},
{"code":"570","name":"その他有価証券評価差額金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SONOTAYU","normalized_alias":"sonotayu","alias_type":"ROMAN"}]},
{"code":"575","name":"繰延ヘッジ損益","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KURINOBE","normalized_alias":"kurinobe","alias_type":"ROMAN"}]},
{"code":"580","name":"土地再評価差額金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TOCHISAI","normalized_alias":"tochisai","alias_type":"ROMAN"}]},
{"code":"590","name":"新株予約権","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHINKABU","normalized_alias":"shinkabu","alias_type":"ROMAN"}]},
{"code":"700","name":"売上高","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES","aliases":[{"alias":"URIAGE","normalized_alias":"uriage","alias_type":"ROMAN"},{"alias":"うりあげだか","normalized_alias":"うりあげだか","alias_type":"KANA"}]},
{"code":"707","name":"売上値引高","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES_RETURN","aliases":[{"alias":"URIAGENE","normalized_alias":"uriagene","alias_type":"ROMAN"}]},
{"code":"708","name":"売上戻り高","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES_RETURN","aliases":[{"alias":"URIAGEMO","normalized_alias":"uriagemo","alias_type":"ROMAN"}]},
{"code":"709","name":"売上割戻し高","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES_RETURN","aliases":[{"alias":"URIAGEWA","normalized_alias":"uriagewa","alias_type":"ROMAN"}]},
{"code":"710","name":"役務収益","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES","aliases":[{"alias":"EKIMUSHU","normalized_alias":"ekimushu","alias_type":"ROMAN"},{"alias":"やくむしゅうえき","normalized_alias":"やくむしゅうえき","alias_type":"KANA"},{"alias":"yakumushueki","normalized_alias":"yakumushueki","alias_type":"ROMAN"}]},
{"code":"720","name":"期首商品棚卸高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"NONE","aliases":[{"alias":"KISHUSHO","normalized_alias":"kishusho","alias_type":"ROMAN"},{"alias":"きしゅしょうひんたなおろしだか","normalized_alias":"きしゅしょうひんたなおろしだか","alias_type":"KANA"},{"alias":"kishu","normalized_alias":"kishu","alias_type":"ROMAN"}]},
{"code":"725","name":"仕入高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"PURCHASE","aliases":[{"alias":"SHIIREDA","normalized_alias":"shiireda","alias_type":"ROMAN"},{"alias":"しいれだか","normalized_alias":"しいれだか","alias_type":"KANA"},{"alias":"shiiredaka","normalized_alias":"shiiredaka","alias_type":"ROMAN"},{"alias":"shiire","normalized_alias":"shiire","alias_type":"ROMAN"}]},
{"code":"729","name":"仕入値引高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"SHIIRENE","normalized_alias":"shiirene","alias_type":"ROMAN"}]},
{"code":"730","name":"仕入戻し高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"SHIIREMO","normalized_alias":"shiiremo","alias_type":"ROMAN"}]},
{"code":"731","name":"仕入割戻し高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"SHIIREWA","normalized_alias":"shiirewa","alias_type":"ROMAN"}]},
{"code":"739","name":"他勘定振替高(商)","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"NONE","aliases":[{"alias":"TAKANJO","normalized_alias":"takanjo","alias_type":"ROMAN"}]},
{"code":"737","name":"期末商品棚卸高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"NONE","aliases":[{"alias":"KIMATSUS","normalized_alias":"kimatsus","alias_type":"ROMAN"},{"alias":"きまつしょうひんたなおろしだか","normalized_alias":"きまつしょうひんたなおろしだか","alias_type":"KANA"},{"alias":"kimatsu","normalized_alias":"kimatsu","alias_type":"ROMAN"}]},
{"code":"740","name":"役員報酬","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"YAKUINHO","normalized_alias":"yakuinho","alias_type":"ROMAN"},{"alias":"やくいんほうしゅう","normalized_alias":"やくいんほうしゅう","alias_type":"KANA"},{"alias":"yakuinhoshu","normalized_alias":"yakuinhoshu","alias_type":"ROMAN"}]},
{"code":"790","name":"役員賞与","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"YAKUINSH","normalized_alias":"yakuinsh","alias_type":"ROMAN"}]},
{"code":"741","name":"給料手当","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"KYUURYOU","normalized_alias":"kyuuryou","alias_type":"ROMAN"},{"alias":"きゅうりょうてあて","normalized_alias":"きゅうりょうてあて","alias_type":"KANA"},{"alias":"kyuryoteate","normalized_alias":"kyuryoteate","alias_type":"ROMAN"},{"alias":"kyuryo","normalized_alias":"kyuryo","alias_type":"ROMAN"}]},
{"code":"744","name":"雑給","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"ZAKKYUU","normalized_alias":"zakkyuu","alias_type":"ROMAN"},{"alias":"ざっきゅう","normalized_alias":"ざっきゅう","alias_type":"KANA"}]},
{"code":"742","name":"賞与","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"SHOUYO","normalized_alias":"shouyo","alias_type":"ROMAN"},{"alias":"しょうよ","normalized_alias":"しょうよ","alias_type":"KANA"},{"alias":"shoyo","normalized_alias":"shoyo","alias_type":"ROMAN"}]},
{"code":"743","name":"退職金","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"TAISHOKU","normalized_alias":"taishoku","alias_type":"ROMAN"},{"alias":"たいしょくきん","normalized_alias":"たいしょくきん","alias_type":"KANA"},{"alias":"taishokukin","normalized_alias":"taishokukin","alias_type":"ROMAN"}]},
{"code":"745","name":"法定福利費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"HOUTEI","normalized_alias":"houtei","alias_type":"ROMAN"},{"alias":"ほうていふくりひ","normalized_alias":"ほうていふくりひ","alias_type":"KANA"},{"alias":"hoteifukurihi","normalized_alias":"hoteifukurihi","alias_type":"ROMAN"},{"alias":"shakai","normalized_alias":"shakai","alias_type":"ROMAN"}]},
{"code":"746","name":"福利厚生費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"FUKURI","normalized_alias":"fukuri","alias_type":"ROMAN"},{"alias":"ふくりこうせいひ","normalized_alias":"ふくりこうせいひ","alias_type":"KANA"},{"alias":"fukurikoseihi","normalized_alias":"fukurikoseihi","alias_type":"ROMAN"}]},
{"code":"747","name":"退職給付費用","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"TAISHOKU","normalized_alias":"taishoku","alias_type":"ROMAN"}]},
{"code":"749","name":"採用教育費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SAIYOU","normalized_alias":"saiyou","alias_type":"ROMAN"},{"alias":"さいようきょういくひ","normalized_alias":"さいようきょういくひ","alias_type":"KANA"},{"alias":"saiyo","normalized_alias":"saiyo","alias_type":"ROMAN"}]},
{"code":"750","name":"外注費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"GAICHUU","normalized_alias":"gaichuu","alias_type":"ROMAN"},{"alias":"がいちゅうひ","normalized_alias":"がいちゅうひ","alias_type":"KANA"},{"alias":"gaichuhi","normalized_alias":"gaichuhi","alias_type":"ROMAN"}]},
{"code":"751","name":"荷造運賃","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"NIZUKURI","normalized_alias":"nizukuri","alias_type":"ROMAN"},{"alias":"にづくりうんちん","normalized_alias":"にづくりうんちん","alias_type":"KANA"},{"alias":"nizukuriunchin","normalized_alias":"nizukuriunchin","alias_type":"ROMAN"},{"alias":"unchin","normalized_alias":"unchin","alias_type":"ROMAN"}]},
{"code":"752","name":"広告宣伝費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"KOUKOKU","normalized_alias":"koukoku","alias_type":"ROMAN"},{"alias":"こうこくせんでんひ","normalized_alias":"こうこくせんでんひ","alias_type":"KANA"},{"alias":"kokokusendenhi","normalized_alias":"kokokusendenhi","alias_type":"ROMAN"},{"alias":"kokoku","normalized_alias":"kokoku","alias_type":"ROMAN"}]},
{"code":"753","name":"交際費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"KOUSAI","normalized_alias":"kousai","alias_type":"ROMAN"},{"alias":"こうさいひ","normalized_alias":"こうさいひ","alias_type":"KANA"},{"alias":"kosaihi","normalized_alias":"kosaihi","alias_type":"ROMAN"},{"alias":"settai","normalized_alias":"settai","alias_type":"ROMAN"}]},
{"code":"754","name":"会議費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"KAIGI","normalized_alias":"kaigi","alias_type":"ROMAN"},{"alias":"かいぎひ","normalized_alias":"かいぎひ","alias_type":"KANA"},{"alias":"kaigihi","normalized_alias":"kaigihi","alias_type":"ROMAN"}]},
{"code":"755","name":"旅費交通費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"RYOHI","normalized_alias":"ryohi","alias_type":"ROMAN"},{"alias":"りょひこうつうひ","normalized_alias":"りょひこうつうひ","alias_type":"KANA"},{"alias":"ryohikotsuhi","normalized_alias":"ryohikotsuhi","alias_type":"ROMAN"},{"alias":"kotsu","normalized_alias":"kotsu","alias_type":"ROMAN"}]},
{"code":"756","name":"通信費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"TSUUSHIN","normalized_alias":"tsuushin","alias_type":"ROMAN"},{"alias":"つうしんひ","normalized_alias":"つうしんひ","alias_type":"KANA"},{"alias":"tsushinhi","normalized_alias":"tsushinhi","alias_type":"ROMAN"}]},
{"code":"757","name":"販売手数料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"HANBAITE","normalized_alias":"hanbaite","alias_type":"ROMAN"},{"alias":"はんばいてすうりょう","normalized_alias":"はんばいてすうりょう","alias_type":"KANA"},{"alias":"hanbaitesuryo","normalized_alias":"hanbaitesuryo","alias_type":"ROMAN"}]},
{"code":"758","name":"販売促進費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"HANBAISO","normalized_alias":"hanbaiso","alias_type":"ROMAN"},{"alias":"はんばいそくしんひ","normalized_alias":"はんばいそくしんひ","alias_type":"KANA"},{"alias":"hanbaisokushinhi","normalized_alias":"hanbaisokushinhi","alias_type":"ROMAN"}]},
{"code":"760","name":"消耗品費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHOUMOU","normalized_alias":"shoumou","alias_type":"ROMAN"},{"alias":"しょうもうひんひ","normalized_alias":"しょうもうひんひ","alias_type":"KANA"},{"alias":"shomohimpihi","normalized_alias":"shomohimpihi","alias_type":"ROMAN"},{"alias":"shomo","normalized_alias":"shomo","alias_type":"ROMAN"}]},
{"code":"761","name":"事務用品費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"JIMUYOU","normalized_alias":"jimuyou","alias_type":"ROMAN"},{"alias":"じむようひんひ","normalized_alias":"じむようひんひ","alias_type":"KANA"},{"alias":"jimuyohinhi","normalized_alias":"jimuyohinhi","alias_type":"ROMAN"}]},
{"code":"762","name":"修繕費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHUUZEN","normalized_alias":"shuuzen","alias_type":"ROMAN"},{"alias":"しゅうぜんひ","normalized_alias":"しゅうぜんひ","alias_type":"KANA"},{"alias":"shuzenhi","normalized_alias":"shuzenhi","alias_type":"ROMAN"}]},
{"code":"763","name":"水道光熱費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SUIDOU","normalized_alias":"suidou","alias_type":"ROMAN"},{"alias":"すいどうこうねつひ","normalized_alias":"すいどうこうねつひ","alias_type":"KANA"},{"alias":"suidokonetuhi","normalized_alias":"suidokonetuhi","alias_type":"ROMAN"},{"alias":"konetsu","normalized_alias":"konetsu","alias_type":"ROMAN"}]},
{"code":"764","name":"新聞図書費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHINBUN","normalized_alias":"shinbun","alias_type":"ROMAN"},{"alias":"しんぶんとしょひ","normalized_alias":"しんぶんとしょひ","alias_type":"KANA"},{"alias":"shinbuntoshohi","normalized_alias":"shinbuntoshohi","alias_type":"ROMAN"}]},
{"code":"765","name":"諸会費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"SHOKAIHI","normalized_alias":"shokaihi","alias_type":"ROMAN"},{"alias":"しょかいひ","normalized_alias":"しょかいひ","alias_type":"KANA"}]},
{"code":"766","name":"支払手数料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHIHARAI","normalized_alias":"shiharai","alias_type":"ROMAN"},{"alias":"しはらいてすうりょう","normalized_alias":"しはらいてすうりょう","alias_type":"KANA"},{"alias":"shiharaitesuryo","normalized_alias":"shiharaitesuryo","alias_type":"ROMAN"},{"alias":"tesuryo","normalized_alias":"tesuryo","alias_type":"ROMAN"}]},
{"code":"767","name":"車両費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHARYOU","normalized_alias":"sharyou","alias_type":"ROMAN"},{"alias":"しゃりょうひ","normalized_alias":"しゃりょうひ","alias_type":"KANA"},{"alias":"sharyohi","normalized_alias":"sharyohi","alias_type":"ROMAN"}]},
{"code":"781","name":"地代家賃","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"CHIDAI","normalized_alias":"chidai","alias_type":"ROMAN"}]},
{"code":"782","name":"賃借料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"CHINSHAK","normalized_alias":"chinshak","alias_type":"ROMAN"}]},
{"code":"768","name":"リース料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"RI-SU","normalized_alias":"ri-su","alias_type":"ROMAN"}]},
{"code":"770","name":"保険料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"HOKEN","normalized_alias":"hoken","alias_type":"ROMAN"}]},
{"code":"783","name":"租税公課","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"SOZEI","normalized_alias":"sozei","alias_type":"ROMAN"}]},
{"code":"771","name":"支払報酬料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHIHARAI","normalized_alias":"shiharai","alias_type":"ROMAN"}]},
{"code":"772","name":"寄付金","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"KIFUKIN","normalized_alias":"kifukin","alias_type":"ROMAN"}]},
{"code":"773","name":"研究開発費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"KENKYUU","normalized_alias":"kenkyuu","alias_type":"ROMAN"}]},
{"code":"780","name":"減価償却費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"GENKASHO","normalized_alias":"genkasho","alias_type":"ROMAN"}]},
{"code":"784","name":"長期前払費用償却","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"CHOUKIMA","normalized_alias":"choukima","alias_type":"ROMAN"}]},
{"code":"785","name":"繰延資産償却(販)","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"KURINOBE","normalized_alias":"kurinobe","alias_type":"ROMAN"}]},
{"code":"786","name":"貸倒損失(販)","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"787","name":"貸倒引当金繰入額(販)","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"789","name":"雑費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"ZAPPI","normalized_alias":"zappi","alias_type":"ROMAN"}]},
{"code":"800","name":"受取利息","type":"REVENUE","bs_category":null,"pl_category":"NON_OP_INCOME","default_tax_code":"NON_TAXABLE_SALES","aliases":[{"alias":"UKETORIR","normalized_alias":"uketorir","alias_type":"ROMAN"}]},
{"code":"801","name":"受取配当金","type":"REVENUE","bs_category":null,"pl_category":"NON_OP_INCOME","default_tax_code":"NONE","aliases":[{"alias":"UKETORIH","normalized_alias":"uketorih","alias_type":"ROMAN"}]},
{"code":"802","name":"仕入割引","type":"REVENUE","bs_category":null,"pl_category":"NON_OP_INCOME","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"SHIIREWA","normalized_alias":"shiirewa","alias_type":"ROMAN"}]},
{"code":"803","name":"有価証券売却益","type":"REVENUE","bs_category":null,"pl_category":"NON_OP_INCOME","default_tax_code":"NONE","aliases":[{"alias":"YUUKASHO","normalized_alias":"yuukasho","alias_type":"ROMAN"}]},
{"code":"804","name":"貸倒引当金戻入額","type":"REVENUE","bs_category":null,"pl_category":"NON_OP_INCOME","default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"816","name":"雑収入","type":"REVENUE","bs_category":null,"pl_category":"NON_OP_INCOME","default_tax_code":"SALES","aliases":[{"alias":"ZATSUSHU","normalized_alias":"zatsushu","alias_type":"ROMAN"}]},
{"code":"830","name":"支払利息","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"NONE","aliases":[{"alias":"SHIHARAI","normalized_alias":"shiharai","alias_type":"ROMAN"}]},
{"code":"831","name":"割引料","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"NONE","aliases":[{"alias":"WARIBIKI","normalized_alias":"waribiki","alias_type":"ROMAN"}]},
{"code":"837","name":"手形売却損","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"NONE","aliases":[{"alias":"TEGATABA","normalized_alias":"tegataba","alias_type":"ROMAN"}]},
{"code":"838","name":"電子記録債権売却損","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"NONE","aliases":[{"alias":"DENSHIKI","normalized_alias":"denshiki","alias_type":"ROMAN"}]},
{"code":"832","name":"貸倒損失(外)","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"833","name":"売上割引","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"SALES_RETURN","aliases":[{"alias":"URIAGEWA","normalized_alias":"uriagewa","alias_type":"ROMAN"}]},
{"code":"834","name":"有価証券売却損","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"NONE","aliases":[{"alias":"YUUKASHO","normalized_alias":"yuukasho","alias_type":"ROMAN"}]},
{"code":"835","name":"繰延資産償却(外)","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"NONE","aliases":[{"alias":"KURINOBE","normalized_alias":"kurinobe","alias_type":"ROMAN"}]},
{"code":"836","name":"貸倒引当金繰入額(外)","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"846","name":"雑損失","type":"EXPENSE","bs_category":null,"pl_category":"NON_OP_EXPENSE","default_tax_code":"PURCHASE","aliases":[{"alias":"ZATSUSON","normalized_alias":"zatsuson","alias_type":"ROMAN"}]},
{"code":"913","name":"前期損益修正益","type":"REVENUE","bs_category":null,"pl_category":"EXTRA_INCOME","default_tax_code":"NONE","aliases":[{"alias":"ZENKISON","normalized_alias":"zenkison","alias_type":"ROMAN"}]},
{"code":"900","name":"固定資産売却益","type":"REVENUE","bs_category":null,"pl_category":"EXTRA_INCOME","default_tax_code":"SALES","aliases":[{"alias":"KOTEISHI","normalized_alias":"koteishi","alias_type":"ROMAN"}]},
{"code":"901","name":"投資有価証券売却益","type":"REVENUE","bs_category":null,"pl_category":"EXTRA_INCOME","default_tax_code":"NONE","aliases":[{"alias":"TOUSHISH","normalized_alias":"toushish","alias_type":"ROMAN"}]},
{"code":"933","name":"前期損益修正損","type":"EXPENSE","bs_category":null,"pl_category":"EXTRA_LOSS","default_tax_code":"NONE","aliases":[{"alias":"ZENKISON","normalized_alias":"zenkison","alias_type":"ROMAN"}]},
{"code":"920","name":"固定資産売却損","type":"EXPENSE","bs_category":null,"pl_category":"EXTRA_LOSS","default_tax_code":"NONE","aliases":[{"alias":"KOTEISHI","normalized_alias":"koteishi","alias_type":"ROMAN"}]},
{"code":"921","name":"固定資産除却損","type":"EXPENSE","bs_category":null,"pl_category":"EXTRA_LOSS","default_tax_code":"NONE","aliases":[{"alias":"KOTEISHI","normalized_alias":"koteishi","alias_type":"ROMAN"}]},
{"code":"922","name":"投資有価証券売却損","type":"EXPENSE","bs_category":null,"pl_category":"EXTRA_LOSS","default_tax_code":"NONE","aliases":[{"alias":"TOUSHISH","normalized_alias":"toushish","alias_type":"ROMAN"}]},
{"code":"982","name":"法人税、住民税及び事業税","type":"EXPENSE","bs_category":null,"pl_category":"TAX","default_tax_code":"NONE","aliases":[{"alias":"HOUJINZE","normalized_alias":"houjinze","alias_type":"ROMAN"}]},
{"code":"980","name":"法人税等","type":"EXPENSE","bs_category":null,"pl_category":"TAX","default_tax_code":"NONE","aliases":[{"alias":"HOUJINZE","normalized_alias":"houjinze","alias_type":"ROMAN"}]},
{"code":"981","name":"法人税等調整額","type":"EXPENSE","bs_category":null,"pl_category":"TAX","default_tax_code":"NONE","aliases":[{"alias":"HOUJINZE","normalized_alias":"houjinze","alias_type":"ROMAN"}]}
]
$seed_corp$::jsonb;
  elsif p_kind = 'INDIVIDUAL' then
    return $seed_ind$
[
{"code":"100","name":"現金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"GENKIN","normalized_alias":"genkin","alias_type":"ROMAN"},{"alias":"げんきん","normalized_alias":"げんきん","alias_type":"KANA"}]},
{"code":"101","name":"小口現金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KOGUCHI","normalized_alias":"koguchi","alias_type":"ROMAN"},{"alias":"こぐちげんきん","normalized_alias":"こぐちげんきん","alias_type":"KANA"},{"alias":"koguchigenkin","normalized_alias":"koguchigenkin","alias_type":"ROMAN"}]},
{"code":"110","name":"当座預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TOUZAYO","normalized_alias":"touzayo","alias_type":"ROMAN"},{"alias":"とうざよきん","normalized_alias":"とうざよきん","alias_type":"KANA"},{"alias":"tozayokin","normalized_alias":"tozayokin","alias_type":"ROMAN"},{"alias":"toza","normalized_alias":"toza","alias_type":"ROMAN"}]},
{"code":"111","name":"普通預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"FUTSUUYO","normalized_alias":"futsuuyo","alias_type":"ROMAN"},{"alias":"ふつうよきん","normalized_alias":"ふつうよきん","alias_type":"KANA"},{"alias":"futsuyokin","normalized_alias":"futsuyokin","alias_type":"ROMAN"},{"alias":"futsu","normalized_alias":"futsu","alias_type":"ROMAN"}]},
{"code":"112","name":"通知預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TSUUCHI","normalized_alias":"tsuuchi","alias_type":"ROMAN"},{"alias":"つうちよきん","normalized_alias":"つうちよきん","alias_type":"KANA"},{"alias":"tsuchiyokin","normalized_alias":"tsuchiyokin","alias_type":"ROMAN"}]},
{"code":"113","name":"定期預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TEIKIYO","normalized_alias":"teikiyo","alias_type":"ROMAN"},{"alias":"ていきよきん","normalized_alias":"ていきよきん","alias_type":"KANA"},{"alias":"teikiyokin","normalized_alias":"teikiyokin","alias_type":"ROMAN"},{"alias":"teiki","normalized_alias":"teiki","alias_type":"ROMAN"}]},
{"code":"114","name":"定期積金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TEIKITSU","normalized_alias":"teikitsu","alias_type":"ROMAN"},{"alias":"ていきつみきん","normalized_alias":"ていきつみきん","alias_type":"KANA"},{"alias":"teikitsumikinn","normalized_alias":"teikitsumikinn","alias_type":"ROMAN"}]},
{"code":"115","name":"別段預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"BETSUDAN","normalized_alias":"betsudan","alias_type":"ROMAN"},{"alias":"べつだんよきん","normalized_alias":"べつだんよきん","alias_type":"KANA"},{"alias":"betsudanyokin","normalized_alias":"betsudanyokin","alias_type":"ROMAN"}]},
{"code":"116","name":"郵便貯金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"YUBIN","normalized_alias":"yubin","alias_type":"ROMAN"},{"alias":"ゆうびんちょきん","normalized_alias":"ゆうびんちょきん","alias_type":"KANA"},{"alias":"yubinchokinn","normalized_alias":"yubinchokinn","alias_type":"ROMAN"}]},
{"code":"117","name":"納税準備預金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"NOUZEI","normalized_alias":"nouzei","alias_type":"ROMAN"}]},
{"code":"120","name":"受取手形","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"UKETORI","normalized_alias":"uketori","alias_type":"ROMAN"},{"alias":"うけとりてがた","normalized_alias":"うけとりてがた","alias_type":"KANA"},{"alias":"uketoritetegata","normalized_alias":"uketoritetegata","alias_type":"ROMAN"},{"alias":"tegata","normalized_alias":"tegata","alias_type":"ROMAN"}]},
{"code":"122","name":"電子記録債権","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"DENSHIKI","normalized_alias":"denshiki","alias_type":"ROMAN"},{"alias":"でんしきろくさいけん","normalized_alias":"でんしきろくさいけん","alias_type":"KANA"},{"alias":"denshikirokusaiken","normalized_alias":"denshikirokusaiken","alias_type":"ROMAN"},{"alias":"denshi","normalized_alias":"denshi","alias_type":"ROMAN"}]},
{"code":"121","name":"不渡手形","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"FUWATARI","normalized_alias":"fuwatari","alias_type":"ROMAN"},{"alias":"ふわたりてがた","normalized_alias":"ふわたりてがた","alias_type":"KANA"},{"alias":"fuwataritegata","normalized_alias":"fuwataritegata","alias_type":"ROMAN"}]},
{"code":"130","name":"売掛金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"URIKAKE","normalized_alias":"urikake","alias_type":"ROMAN"},{"alias":"うりかけきん","normalized_alias":"うりかけきん","alias_type":"KANA"},{"alias":"urikakekin","normalized_alias":"urikakekin","alias_type":"ROMAN"},{"alias":"uri","normalized_alias":"uri","alias_type":"ROMAN"}]},
{"code":"140","name":"有価証券","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"YUUKASHO","normalized_alias":"yuukasho","alias_type":"ROMAN"},{"alias":"ゆうかしょうけん","normalized_alias":"ゆうかしょうけん","alias_type":"KANA"},{"alias":"yukashoken","normalized_alias":"yukashoken","alias_type":"ROMAN"}]},
{"code":"150","name":"商品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHOUHIN","normalized_alias":"shouhin","alias_type":"ROMAN"},{"alias":"しょうひん","normalized_alias":"しょうひん","alias_type":"KANA"},{"alias":"shohin","normalized_alias":"shohin","alias_type":"ROMAN"}]},
{"code":"151","name":"製品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SEIHIN","normalized_alias":"seihin","alias_type":"ROMAN"},{"alias":"せいひん","normalized_alias":"せいひん","alias_type":"KANA"}]},
{"code":"152","name":"半製品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"HANSEIHI","normalized_alias":"hanseihi","alias_type":"ROMAN"},{"alias":"はんせいひん","normalized_alias":"はんせいひん","alias_type":"KANA"},{"alias":"hanseihin","normalized_alias":"hanseihin","alias_type":"ROMAN"}]},
{"code":"153","name":"仕掛品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHIKAKAR","normalized_alias":"shikakar","alias_type":"ROMAN"},{"alias":"しかかりひん","normalized_alias":"しかかりひん","alias_type":"KANA"},{"alias":"shikakariin","normalized_alias":"shikakariin","alias_type":"ROMAN"}]},
{"code":"154","name":"原材料","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"GENZAIRY","normalized_alias":"genzairy","alias_type":"ROMAN"},{"alias":"げんざいりょう","normalized_alias":"げんざいりょう","alias_type":"KANA"},{"alias":"genzairyo","normalized_alias":"genzairyo","alias_type":"ROMAN"}]},
{"code":"155","name":"貯蔵品","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOZOUHI","normalized_alias":"chozouhi","alias_type":"ROMAN"},{"alias":"ちょぞうひん","normalized_alias":"ちょぞうひん","alias_type":"KANA"},{"alias":"chozohin","normalized_alias":"chozohin","alias_type":"ROMAN"}]},
{"code":"156","name":"副産物作業くず","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"FUKUSAN","normalized_alias":"fukusan","alias_type":"ROMAN"}]},
{"code":"160","name":"前払金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEBARAI","normalized_alias":"maebarai","alias_type":"ROMAN"}]},
{"code":"163","name":"短期貸付金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TANKIKAS","normalized_alias":"tankikas","alias_type":"ROMAN"},{"alias":"たんきかしつけきん","normalized_alias":"たんきかしつけきん","alias_type":"KANA"},{"alias":"tankikashitsuke","normalized_alias":"tankikashitsuke","alias_type":"ROMAN"}]},
{"code":"161","name":"前払費用","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEBARAI","normalized_alias":"maebarai","alias_type":"ROMAN"},{"alias":"まえばらいひよう","normalized_alias":"まえばらいひよう","alias_type":"KANA"},{"alias":"maebaraihiyo","normalized_alias":"maebaraihiyo","alias_type":"ROMAN"}]},
{"code":"162","name":"未収収益","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MISHUUSH","normalized_alias":"mishuush","alias_type":"ROMAN"},{"alias":"みしゅうしゅうえき","normalized_alias":"みしゅうしゅうえき","alias_type":"KANA"},{"alias":"mishuushue","normalized_alias":"mishuushue","alias_type":"ROMAN"}]},
{"code":"164","name":"未収入金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MISHUUNY","normalized_alias":"mishuuny","alias_type":"ROMAN"},{"alias":"みしゅうにゅうきん","normalized_alias":"みしゅうにゅうきん","alias_type":"KANA"},{"alias":"mishunukin","normalized_alias":"mishunukin","alias_type":"ROMAN"}]},
{"code":"165","name":"預け金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"AZUKEKIN","normalized_alias":"azukekin","alias_type":"ROMAN"},{"alias":"あずけきん","normalized_alias":"あずけきん","alias_type":"KANA"}]},
{"code":"166","name":"立替金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TATEKAE","normalized_alias":"tatekae","alias_type":"ROMAN"},{"alias":"たてかえきん","normalized_alias":"たてかえきん","alias_type":"KANA"},{"alias":"tatekaekin","normalized_alias":"tatekaekin","alias_type":"ROMAN"}]},
{"code":"167","name":"仮払金","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KARIBARA","normalized_alias":"karibara","alias_type":"ROMAN"},{"alias":"かりばらいきん","normalized_alias":"かりばらいきん","alias_type":"KANA"},{"alias":"karibaraikin","normalized_alias":"karibaraikin","alias_type":"ROMAN"}]},
{"code":"181","name":"仮払消費税等","type":"ASSET","bs_category":"CURRENT_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KARIBARA","normalized_alias":"karibara","alias_type":"ROMAN"},{"alias":"かりばらいしょうひぜいとう","normalized_alias":"かりばらいしょうひぜいとう","alias_type":"KANA"},{"alias":"karibaraishohizei","normalized_alias":"karibaraishohizei","alias_type":"ROMAN"},{"alias":"karishohizei","normalized_alias":"karishohizei","alias_type":"ROMAN"}]},
{"code":"200","name":"建物","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"TATEMONO","normalized_alias":"tatemono","alias_type":"ROMAN"},{"alias":"たてもの","normalized_alias":"たてもの","alias_type":"KANA"}]},
{"code":"201","name":"附属設備","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"FUZOKUSE","normalized_alias":"fuzokuse","alias_type":"ROMAN"},{"alias":"ふぞくせつび","normalized_alias":"ふぞくせつび","alias_type":"KANA"},{"alias":"fuzokusetubi","normalized_alias":"fuzokusetubi","alias_type":"ROMAN"}]},
{"code":"202","name":"構築物","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KOUCHIKU","normalized_alias":"kouchiku","alias_type":"ROMAN"},{"alias":"こうちくぶつ","normalized_alias":"こうちくぶつ","alias_type":"KANA"},{"alias":"kochikubutsu","normalized_alias":"kochikubutsu","alias_type":"ROMAN"}]},
{"code":"203","name":"機械装置","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KIKAISO","normalized_alias":"kikaiso","alias_type":"ROMAN"},{"alias":"きかいそうち","normalized_alias":"きかいそうち","alias_type":"KANA"},{"alias":"kikaisouchi","normalized_alias":"kikaisouchi","alias_type":"ROMAN"},{"alias":"kikai","normalized_alias":"kikai","alias_type":"ROMAN"}]},
{"code":"204","name":"車両運搬具","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"SHARYOU","normalized_alias":"sharyou","alias_type":"ROMAN"},{"alias":"しゃりょううんぱんぐ","normalized_alias":"しゃりょううんぱんぐ","alias_type":"KANA"},{"alias":"sharyounpangu","normalized_alias":"sharyounpangu","alias_type":"ROMAN"},{"alias":"sharyo","normalized_alias":"sharyo","alias_type":"ROMAN"}]},
{"code":"206","name":"工具器具備品","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KOUGUKI","normalized_alias":"kouguki","alias_type":"ROMAN"},{"alias":"こうぐきぐびひん","normalized_alias":"こうぐきぐびひん","alias_type":"KANA"},{"alias":"kogukigubihin","normalized_alias":"kogukigubihin","alias_type":"ROMAN"},{"alias":"bihin","normalized_alias":"bihin","alias_type":"ROMAN"}]},
{"code":"210","name":"土地","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TOCHI","normalized_alias":"tochi","alias_type":"ROMAN"},{"alias":"とち","normalized_alias":"とち","alias_type":"KANA"}]},
{"code":"211","name":"建設仮勘定","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KENSETSU","normalized_alias":"kensetsu","alias_type":"ROMAN"},{"alias":"けんせつかりかんじょう","normalized_alias":"けんせつかりかんじょう","alias_type":"KANA"}]},
{"code":"212","name":"一括償却資産","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"IKKATSUS","normalized_alias":"ikkatsus","alias_type":"ROMAN"},{"alias":"いっかつしょうきゃくしさん","normalized_alias":"いっかつしょうきゃくしさん","alias_type":"KANA"},{"alias":"ikkatsu","normalized_alias":"ikkatsu","alias_type":"ROMAN"}]},
{"code":"250","name":"電話加入権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"DENWA","normalized_alias":"denwa","alias_type":"ROMAN"},{"alias":"でんわかにゅうけん","normalized_alias":"でんわかにゅうけん","alias_type":"KANA"},{"alias":"denwakanyuken","normalized_alias":"denwakanyuken","alias_type":"ROMAN"}]},
{"code":"251","name":"施設利用権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"SHISETSU","normalized_alias":"shisetsu","alias_type":"ROMAN"}]},
{"code":"252","name":"工業所有権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KOUGYOU","normalized_alias":"kougyou","alias_type":"ROMAN"}]},
{"code":"253","name":"借地権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHAKUCHI","normalized_alias":"shakuchi","alias_type":"ROMAN"}]},
{"code":"255","name":"ソフトウェア","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"SOFUTO","normalized_alias":"sofuto","alias_type":"ROMAN"},{"alias":"そふとうえあ","normalized_alias":"そふとうえあ","alias_type":"KANA"},{"alias":"software","normalized_alias":"software","alias_type":"ROMAN"},{"alias":"soft","normalized_alias":"soft","alias_type":"ROMAN"}]},
{"code":"260","name":"投資有価証券","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TOUSHIYU","normalized_alias":"toushiyu","alias_type":"ROMAN"},{"alias":"とうしゆうかしょうけん","normalized_alias":"とうしゆうかしょうけん","alias_type":"KANA"},{"alias":"toshiyukashoken","normalized_alias":"toshiyukashoken","alias_type":"ROMAN"}]},
{"code":"261","name":"出資金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHUSSHI","normalized_alias":"shusshi","alias_type":"ROMAN"}]},
{"code":"262","name":"敷金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHIKIKIN","normalized_alias":"shikikin","alias_type":"ROMAN"},{"alias":"しききん","normalized_alias":"しききん","alias_type":"KANA"}]},
{"code":"263","name":"長期貸付金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIKA","normalized_alias":"choukika","alias_type":"ROMAN"},{"alias":"ちょうきかしつけきん","normalized_alias":"ちょうきかしつけきん","alias_type":"KANA"},{"alias":"chokikashitsuke","normalized_alias":"chokikashitsuke","alias_type":"ROMAN"}]},
{"code":"264","name":"破産更生債権","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"HASANKOU","normalized_alias":"hasankou","alias_type":"ROMAN"}]},
{"code":"265","name":"長期前払費用","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIMA","normalized_alias":"choukima","alias_type":"ROMAN"}]},
{"code":"267","name":"長期固定性預金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIKO","normalized_alias":"choukiko","alias_type":"ROMAN"}]},
{"code":"268","name":"差入保証金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SASHIIRE","normalized_alias":"sashiire","alias_type":"ROMAN"},{"alias":"さしいれほしょうきん","normalized_alias":"さしいれほしょうきん","alias_type":"KANA"},{"alias":"sashiirehoshokin","normalized_alias":"sashiirehoshokin","alias_type":"ROMAN"},{"alias":"hosho","normalized_alias":"hosho","alias_type":"ROMAN"}]},
{"code":"269","name":"預託金","type":"ASSET","bs_category":"FIXED_ASSETS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"YOTAKU","normalized_alias":"yotaku","alias_type":"ROMAN"}]},
{"code":"280","name":"開業費","type":"ASSET","bs_category":"DEFERRED_ASSETS","pl_category":null,"default_tax_code":"PURCHASE","aliases":[{"alias":"KAIGYOU","normalized_alias":"kaigyou","alias_type":"ROMAN"}]},
{"code":"291","name":"事業主貸","type":"ASSET","bs_category":"OWNER_DRAWINGS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"JIGYOU","normalized_alias":"jigyou","alias_type":"ROMAN"}]},
{"code":"292","name":"資産譲渡損","type":"ASSET","bs_category":"OWNER_DRAWINGS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHISANJO","normalized_alias":"shisanjo","alias_type":"ROMAN"}]},
{"code":"300","name":"支払手形","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHIHARAI","normalized_alias":"shiharai","alias_type":"ROMAN"},{"alias":"しはらいてがた","normalized_alias":"しはらいてがた","alias_type":"KANA"},{"alias":"shiharaitegata","normalized_alias":"shiharaitegata","alias_type":"ROMAN"}]},
{"code":"302","name":"電子記録債務","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"DENSHIKI","normalized_alias":"denshiki","alias_type":"ROMAN"},{"alias":"でんしきろくさいむ","normalized_alias":"でんしきろくさいむ","alias_type":"KANA"},{"alias":"denshikirokusaimu","normalized_alias":"denshikirokusaimu","alias_type":"ROMAN"}]},
{"code":"301","name":"買掛金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KAIKAKE","normalized_alias":"kaikake","alias_type":"ROMAN"},{"alias":"かいかけきん","normalized_alias":"かいかけきん","alias_type":"KANA"},{"alias":"kaikakekin","normalized_alias":"kaikakekin","alias_type":"ROMAN"},{"alias":"kai","normalized_alias":"kai","alias_type":"ROMAN"}]},
{"code":"320","name":"短期借入金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"TANKIKAR","normalized_alias":"tankikar","alias_type":"ROMAN"},{"alias":"たんきかりいれきん","normalized_alias":"たんきかりいれきん","alias_type":"KANA"},{"alias":"tankikariirekin","normalized_alias":"tankikariirekin","alias_type":"ROMAN"},{"alias":"tanki","normalized_alias":"tanki","alias_type":"ROMAN"}]},
{"code":"321","name":"設備支払手形","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SETSUBI","normalized_alias":"setsubi","alias_type":"ROMAN"}]},
{"code":"322","name":"未払金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIK","normalized_alias":"miharaik","alias_type":"ROMAN"},{"alias":"みばらいきん","normalized_alias":"みばらいきん","alias_type":"KANA"},{"alias":"mibaraikin","normalized_alias":"mibaraikin","alias_type":"ROMAN"}]},
{"code":"323","name":"未払費用","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIH","normalized_alias":"miharaih","alias_type":"ROMAN"},{"alias":"みばらいひよう","normalized_alias":"みばらいひよう","alias_type":"KANA"},{"alias":"mibaraihiyo","normalized_alias":"mibaraihiyo","alias_type":"ROMAN"}]},
{"code":"324","name":"前受金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEUKEKI","normalized_alias":"maeukeki","alias_type":"ROMAN"},{"alias":"まえうけきん","normalized_alias":"まえうけきん","alias_type":"KANA"},{"alias":"maeukekin","normalized_alias":"maeukekin","alias_type":"ROMAN"}]},
{"code":"325","name":"預り金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"AZUKARIK","normalized_alias":"azukarik","alias_type":"ROMAN"},{"alias":"あずかりきん","normalized_alias":"あずかりきん","alias_type":"KANA"},{"alias":"azukarikin","normalized_alias":"azukarikin","alias_type":"ROMAN"}]},
{"code":"327","name":"前受収益","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MAEUKESH","normalized_alias":"maeukesh","alias_type":"ROMAN"}]},
{"code":"330","name":"預り保証金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"AZUKARIH","normalized_alias":"azukarih","alias_type":"ROMAN"}]},
{"code":"328","name":"仮受金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KARIUKEK","normalized_alias":"kariukek","alias_type":"ROMAN"},{"alias":"かりうけきん","normalized_alias":"かりうけきん","alias_type":"KANA"},{"alias":"kariukekin","normalized_alias":"kariukekin","alias_type":"ROMAN"}]},
{"code":"331","name":"割引手形","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"WARIBIKI","normalized_alias":"waribiki","alias_type":"ROMAN"}]},
{"code":"332","name":"裏書手形","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"URAGAKI","normalized_alias":"uragaki","alias_type":"ROMAN"}]},
{"code":"333","name":"貸倒引当金","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"338","name":"未払消費税等","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MIHARAIS","normalized_alias":"miharais","alias_type":"ROMAN"},{"alias":"みばらいしょうひぜいとう","normalized_alias":"みばらいしょうひぜいとう","alias_type":"KANA"},{"alias":"mibaraishohizei","normalized_alias":"mibaraishohizei","alias_type":"ROMAN"}]},
{"code":"361","name":"仮受消費税等","type":"LIABILITY","bs_category":"CURRENT_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"KARIUKES","normalized_alias":"kariukes","alias_type":"ROMAN"},{"alias":"かりうけしょうひぜいとう","normalized_alias":"かりうけしょうひぜいとう","alias_type":"KANA"},{"alias":"kariukeshohizei","normalized_alias":"kariukeshohizei","alias_type":"ROMAN"},{"alias":"karishohizei","normalized_alias":"karishohizei","alias_type":"ROMAN"}]},
{"code":"370","name":"長期借入金","type":"LIABILITY","bs_category":"FIXED_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIKA","normalized_alias":"choukika","alias_type":"ROMAN"},{"alias":"ちょうきかりいれきん","normalized_alias":"ちょうきかりいれきん","alias_type":"KANA"},{"alias":"chokikariirekin","normalized_alias":"chokikariirekin","alias_type":"ROMAN"},{"alias":"choki","normalized_alias":"choki","alias_type":"ROMAN"}]},
{"code":"371","name":"長期未払金","type":"LIABILITY","bs_category":"FIXED_LIABILITIES","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"CHOUKIMI","normalized_alias":"choukimi","alias_type":"ROMAN"}]},
{"code":"390","name":"事業主借","type":"LIABILITY","bs_category":"OWNER_CONTRIBUTIONS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"JIGYOU","normalized_alias":"jigyou","alias_type":"ROMAN"}]},
{"code":"391","name":"受取利息","type":"LIABILITY","bs_category":"OWNER_CONTRIBUTIONS","pl_category":null,"default_tax_code":"NON_TAXABLE_SALES","aliases":[{"alias":"UKETORIR","normalized_alias":"uketorir","alias_type":"ROMAN"}]},
{"code":"392","name":"受取配当","type":"LIABILITY","bs_category":"OWNER_CONTRIBUTIONS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"UKETORIH","normalized_alias":"uketorih","alias_type":"ROMAN"}]},
{"code":"393","name":"資産売却益","type":"LIABILITY","bs_category":"OWNER_CONTRIBUTIONS","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"SHISANBA","normalized_alias":"shisanba","alias_type":"ROMAN"}]},
{"code":"400","name":"元入金","type":"EQUITY","bs_category":"EQUITY","pl_category":null,"default_tax_code":"NONE","aliases":[{"alias":"MOTOIRE","normalized_alias":"motoire","alias_type":"ROMAN"}]},
{"code":"500","name":"売上高","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES","aliases":[{"alias":"URIAGE","normalized_alias":"uriage","alias_type":"ROMAN"},{"alias":"うりあげだか","normalized_alias":"うりあげだか","alias_type":"KANA"}]},
{"code":"510","name":"売上値引高","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES_RETURN","aliases":[{"alias":"URIAGENE","normalized_alias":"uriagene","alias_type":"ROMAN"}]},
{"code":"520","name":"売上戻り高","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES_RETURN","aliases":[{"alias":"URIAGEMO","normalized_alias":"uriagemo","alias_type":"ROMAN"}]},
{"code":"530","name":"売上割戻し高","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES_RETURN","aliases":[{"alias":"URIAGEWA","normalized_alias":"uriagewa","alias_type":"ROMAN"}]},
{"code":"580","name":"事業分量配当金","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"JIGYOUBU","normalized_alias":"jigyoubu","alias_type":"ROMAN"}]},
{"code":"581","name":"仕入割引","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"SHIIREWA","normalized_alias":"shiirewa","alias_type":"ROMAN"}]},
{"code":"583","name":"家事消費等","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES","aliases":[{"alias":"KAJISHOU","normalized_alias":"kajishou","alias_type":"ROMAN"}]},
{"code":"590","name":"雑収入","type":"REVENUE","bs_category":null,"pl_category":"REVENUE","default_tax_code":"SALES","aliases":[{"alias":"ZATSUSHU","normalized_alias":"zatsushu","alias_type":"ROMAN"}]},
{"code":"600","name":"期首商品棚卸高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"NONE","aliases":[{"alias":"KISHUSHO","normalized_alias":"kishusho","alias_type":"ROMAN"},{"alias":"きしゅしょうひんたなおろしだか","normalized_alias":"きしゅしょうひんたなおろしだか","alias_type":"KANA"},{"alias":"kishu","normalized_alias":"kishu","alias_type":"ROMAN"}]},
{"code":"610","name":"仕入高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"PURCHASE","aliases":[{"alias":"SHIIREDA","normalized_alias":"shiireda","alias_type":"ROMAN"},{"alias":"しいれだか","normalized_alias":"しいれだか","alias_type":"KANA"},{"alias":"shiiredaka","normalized_alias":"shiiredaka","alias_type":"ROMAN"},{"alias":"shiire","normalized_alias":"shiire","alias_type":"ROMAN"}]},
{"code":"620","name":"仕入値引高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"SHIIRENE","normalized_alias":"shiirene","alias_type":"ROMAN"}]},
{"code":"630","name":"仕入戻し高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"SHIIREMO","normalized_alias":"shiiremo","alias_type":"ROMAN"}]},
{"code":"640","name":"仕入割戻し高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"PURCHASE_RETURN","aliases":[{"alias":"SHIIREWA","normalized_alias":"shiirewa","alias_type":"ROMAN"}]},
{"code":"650","name":"期末商品棚卸高","type":"EXPENSE","bs_category":null,"pl_category":"COGS","default_tax_code":"NONE","aliases":[{"alias":"KIMATSUS","normalized_alias":"kimatsus","alias_type":"ROMAN"},{"alias":"きまつしょうひんたなおろしだか","normalized_alias":"きまつしょうひんたなおろしだか","alias_type":"KANA"},{"alias":"kimatsu","normalized_alias":"kimatsu","alias_type":"ROMAN"}]},
{"code":"700","name":"租税公課","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"SOZEI","normalized_alias":"sozei","alias_type":"ROMAN"}]},
{"code":"701","name":"荷造運賃手数料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"NIZUKURI","normalized_alias":"nizukuri","alias_type":"ROMAN"}]},
{"code":"702","name":"運賃","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"UNCHIN","normalized_alias":"unchin","alias_type":"ROMAN"}]},
{"code":"703","name":"水道光熱費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SUIDOU","normalized_alias":"suidou","alias_type":"ROMAN"},{"alias":"すいどうこうねつひ","normalized_alias":"すいどうこうねつひ","alias_type":"KANA"},{"alias":"suidokonetuhi","normalized_alias":"suidokonetuhi","alias_type":"ROMAN"},{"alias":"konetsu","normalized_alias":"konetsu","alias_type":"ROMAN"}]},
{"code":"704","name":"旅費交通費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"RYOHI","normalized_alias":"ryohi","alias_type":"ROMAN"},{"alias":"りょひこうつうひ","normalized_alias":"りょひこうつうひ","alias_type":"KANA"},{"alias":"ryohikotsuhi","normalized_alias":"ryohikotsuhi","alias_type":"ROMAN"},{"alias":"kotsu","normalized_alias":"kotsu","alias_type":"ROMAN"}]},
{"code":"705","name":"通信費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"TSUUSHIN","normalized_alias":"tsuushin","alias_type":"ROMAN"},{"alias":"つうしんひ","normalized_alias":"つうしんひ","alias_type":"KANA"},{"alias":"tsushinhi","normalized_alias":"tsushinhi","alias_type":"ROMAN"}]},
{"code":"706","name":"広告宣伝費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"KOUKOKU","normalized_alias":"koukoku","alias_type":"ROMAN"},{"alias":"こうこくせんでんひ","normalized_alias":"こうこくせんでんひ","alias_type":"KANA"},{"alias":"kokokusendenhi","normalized_alias":"kokokusendenhi","alias_type":"ROMAN"},{"alias":"kokoku","normalized_alias":"kokoku","alias_type":"ROMAN"}]},
{"code":"707","name":"接待交際費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SETTAIKO","normalized_alias":"settaiko","alias_type":"ROMAN"},{"alias":"こうさいひ","normalized_alias":"こうさいひ","alias_type":"KANA"},{"alias":"kosaihi","normalized_alias":"kosaihi","alias_type":"ROMAN"},{"alias":"settai","normalized_alias":"settai","alias_type":"ROMAN"}]},
{"code":"708","name":"保険料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"HOKEN","normalized_alias":"hoken","alias_type":"ROMAN"}]},
{"code":"709","name":"修繕費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHUUZEN","normalized_alias":"shuuzen","alias_type":"ROMAN"},{"alias":"しゅうぜんひ","normalized_alias":"しゅうぜんひ","alias_type":"KANA"},{"alias":"shuzenhi","normalized_alias":"shuzenhi","alias_type":"ROMAN"}]},
{"code":"710","name":"消耗品費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHOUMOU","normalized_alias":"shoumou","alias_type":"ROMAN"},{"alias":"しょうもうひんひ","normalized_alias":"しょうもうひんひ","alias_type":"KANA"},{"alias":"shomohimpihi","normalized_alias":"shomohimpihi","alias_type":"ROMAN"},{"alias":"shomo","normalized_alias":"shomo","alias_type":"ROMAN"}]},
{"code":"711","name":"事務用品費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"JIMUYOU","normalized_alias":"jimuyou","alias_type":"ROMAN"},{"alias":"じむようひんひ","normalized_alias":"じむようひんひ","alias_type":"KANA"},{"alias":"jimuyohinhi","normalized_alias":"jimuyohinhi","alias_type":"ROMAN"}]},
{"code":"712","name":"減価償却費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"GENKASHO","normalized_alias":"genkasho","alias_type":"ROMAN"}]},
{"code":"713","name":"福利厚生費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"FUKURI","normalized_alias":"fukuri","alias_type":"ROMAN"},{"alias":"ふくりこうせいひ","normalized_alias":"ふくりこうせいひ","alias_type":"KANA"},{"alias":"fukurikoseihi","normalized_alias":"fukurikoseihi","alias_type":"ROMAN"}]},
{"code":"714","name":"法定福利費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"HOUTEI","normalized_alias":"houtei","alias_type":"ROMAN"},{"alias":"ほうていふくりひ","normalized_alias":"ほうていふくりひ","alias_type":"KANA"},{"alias":"hoteifukurihi","normalized_alias":"hoteifukurihi","alias_type":"ROMAN"},{"alias":"shakai","normalized_alias":"shakai","alias_type":"ROMAN"}]},
{"code":"715","name":"給料手当","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"KYUURYOU","normalized_alias":"kyuuryou","alias_type":"ROMAN"},{"alias":"きゅうりょうてあて","normalized_alias":"きゅうりょうてあて","alias_type":"KANA"},{"alias":"kyuryoteate","normalized_alias":"kyuryoteate","alias_type":"ROMAN"},{"alias":"kyuryo","normalized_alias":"kyuryo","alias_type":"ROMAN"}]},
{"code":"716","name":"賞与","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"SHOUYO","normalized_alias":"shouyo","alias_type":"ROMAN"},{"alias":"しょうよ","normalized_alias":"しょうよ","alias_type":"KANA"},{"alias":"shoyo","normalized_alias":"shoyo","alias_type":"ROMAN"}]},
{"code":"717","name":"雑給","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"ZAKKYUU","normalized_alias":"zakkyuu","alias_type":"ROMAN"},{"alias":"ざっきゅう","normalized_alias":"ざっきゅう","alias_type":"KANA"}]},
{"code":"718","name":"退職金","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"TAISHOKU","normalized_alias":"taishoku","alias_type":"ROMAN"},{"alias":"たいしょくきん","normalized_alias":"たいしょくきん","alias_type":"KANA"},{"alias":"taishokukin","normalized_alias":"taishokukin","alias_type":"ROMAN"}]},
{"code":"719","name":"退職金掛金","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"TAISHOKU","normalized_alias":"taishoku","alias_type":"ROMAN"}]},
{"code":"720","name":"外注費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"GAICHUU","normalized_alias":"gaichuu","alias_type":"ROMAN"},{"alias":"がいちゅうひ","normalized_alias":"がいちゅうひ","alias_type":"KANA"},{"alias":"gaichuhi","normalized_alias":"gaichuhi","alias_type":"ROMAN"}]},
{"code":"721","name":"支払利息","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"SHIHARAI","normalized_alias":"shiharai","alias_type":"ROMAN"}]},
{"code":"722","name":"割引料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"WARIBIKI","normalized_alias":"waribiki","alias_type":"ROMAN"}]},
{"code":"736","name":"手形売却損","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"TEGATABA","normalized_alias":"tegataba","alias_type":"ROMAN"}]},
{"code":"737","name":"電子記録債権売却損","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"DENSHIKI","normalized_alias":"denshiki","alias_type":"ROMAN"}]},
{"code":"723","name":"地代家賃","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"CHIDAI","normalized_alias":"chidai","alias_type":"ROMAN"}]},
{"code":"724","name":"貸倒損失","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"725","name":"支払手数料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHIHARAI","normalized_alias":"shiharai","alias_type":"ROMAN"},{"alias":"しはらいてすうりょう","normalized_alias":"しはらいてすうりょう","alias_type":"KANA"},{"alias":"shiharaitesuryo","normalized_alias":"shiharaitesuryo","alias_type":"ROMAN"},{"alias":"tesuryo","normalized_alias":"tesuryo","alias_type":"ROMAN"}]},
{"code":"726","name":"車両費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHARYOU","normalized_alias":"sharyou","alias_type":"ROMAN"},{"alias":"しゃりょうひ","normalized_alias":"しゃりょうひ","alias_type":"KANA"},{"alias":"sharyohi","normalized_alias":"sharyohi","alias_type":"ROMAN"}]},
{"code":"727","name":"燃料費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"NENRYOU","normalized_alias":"nenryou","alias_type":"ROMAN"}]},
{"code":"728","name":"賃借料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"CHINSHAK","normalized_alias":"chinshak","alias_type":"ROMAN"}]},
{"code":"729","name":"リース料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"RI-SU","normalized_alias":"ri-su","alias_type":"ROMAN"}]},
{"code":"730","name":"採用教育費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SAIYOU","normalized_alias":"saiyou","alias_type":"ROMAN"},{"alias":"さいようきょういくひ","normalized_alias":"さいようきょういくひ","alias_type":"KANA"},{"alias":"saiyo","normalized_alias":"saiyo","alias_type":"ROMAN"}]},
{"code":"731","name":"会議費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"KAIGI","normalized_alias":"kaigi","alias_type":"ROMAN"},{"alias":"かいぎひ","normalized_alias":"かいぎひ","alias_type":"KANA"},{"alias":"kaigihi","normalized_alias":"kaigihi","alias_type":"ROMAN"}]},
{"code":"732","name":"新聞図書費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHINBUN","normalized_alias":"shinbun","alias_type":"ROMAN"},{"alias":"しんぶんとしょひ","normalized_alias":"しんぶんとしょひ","alias_type":"KANA"},{"alias":"shinbuntoshohi","normalized_alias":"shinbuntoshohi","alias_type":"ROMAN"}]},
{"code":"733","name":"販売手数料","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"HANBAITE","normalized_alias":"hanbaite","alias_type":"ROMAN"},{"alias":"はんばいてすうりょう","normalized_alias":"はんばいてすうりょう","alias_type":"KANA"},{"alias":"hanbaitesuryo","normalized_alias":"hanbaitesuryo","alias_type":"ROMAN"}]},
{"code":"734","name":"販売促進費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"HANBAISO","normalized_alias":"hanbaiso","alias_type":"ROMAN"},{"alias":"はんばいそくしんひ","normalized_alias":"はんばいそくしんひ","alias_type":"KANA"},{"alias":"hanbaisokushinhi","normalized_alias":"hanbaisokushinhi","alias_type":"ROMAN"}]},
{"code":"735","name":"諸会費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"SHOKAIHI","normalized_alias":"shokaihi","alias_type":"ROMAN"},{"alias":"しょかいひ","normalized_alias":"しょかいひ","alias_type":"KANA"}]},
{"code":"740","name":"売上割引","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"SALES_RETURN","aliases":[{"alias":"URIAGEWA","normalized_alias":"uriagewa","alias_type":"ROMAN"}]},
{"code":"741","name":"長期前払費用償却","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"CHOUKIMA","normalized_alias":"choukima","alias_type":"ROMAN"}]},
{"code":"742","name":"繰延資産償却","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"NONE","aliases":[{"alias":"KURINOBE","normalized_alias":"kurinobe","alias_type":"ROMAN"}]},
{"code":"750","name":"雑損失","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"ZATSUSON","normalized_alias":"zatsuson","alias_type":"ROMAN"}]},
{"code":"760","name":"雑費","type":"EXPENSE","bs_category":null,"pl_category":"SGA","default_tax_code":"PURCHASE","aliases":[{"alias":"ZAPPI","normalized_alias":"zappi","alias_type":"ROMAN"}]},
{"code":"800","name":"貸倒引当金戻入","type":"REVENUE","bs_category":null,"pl_category":"RESERVE_REVERSAL","default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]},
{"code":"810","name":"専従者給与","type":"EXPENSE","bs_category":null,"pl_category":"RESERVE_PROVISION","default_tax_code":"NONE","aliases":[{"alias":"SENJUU","normalized_alias":"senjuu","alias_type":"ROMAN"}]},
{"code":"811","name":"貸倒引当金繰入","type":"EXPENSE","bs_category":null,"pl_category":"RESERVE_PROVISION","default_tax_code":"NONE","aliases":[{"alias":"KASHIDAO","normalized_alias":"kashidao","alias_type":"ROMAN"}]}
]
$seed_ind$::jsonb;
  end if;
  raise exception using errcode = 'P0001', message = 'INVALID_COMPANY',
    detail = format('会社の区分が不正です: %s', p_kind);
end;
$_$;


--
-- Name: create_company(text, text, text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_company(p_name text, p_kind text, p_tax_method text, p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_name     text := btrim(coalesce(p_name, ''));
  v_tax      text := coalesce(p_tax_method, 'EXEMPT');
  v_company  uuid;
  v_period   uuid;
  v_count    integer;
  v_carry    uuid;
begin
  if v_name = '' then
    raise exception using errcode = 'P0001', message = 'INVALID_COMPANY', detail = '会社名を入力してください';
  end if;
  if p_kind is null or p_kind not in ('CORPORATION', 'INDIVIDUAL') then
    raise exception using errcode = 'P0001', message = 'INVALID_COMPANY', detail = format('会社の区分が不正です: %s', p_kind);
  end if;
  if v_tax not in ('EXEMPT', 'SIMPLE', 'STANDARD_INDIVIDUAL', 'STANDARD_PROPORTIONAL') then
    raise exception using errcode = 'P0001', message = 'INVALID_COMPANY', detail = format('課税方式が不正です: %s', v_tax);
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception using errcode = 'P0001', message = 'INVALID_COMPANY', detail = '会計期間の開始日・終了日が不正です';
  end if;
  -- 個人事業主の会計期間は暦年（1/1〜12/31）に固定
  if p_kind = 'INDIVIDUAL' and not (
       extract(month from p_start_date) = 1 and extract(day from p_start_date) = 1
       and extract(month from p_end_date) = 12 and extract(day from p_end_date) = 31
       and extract(year from p_start_date) = extract(year from p_end_date)) then
    raise exception using errcode = 'P0001', message = 'INVALID_COMPANY',
      detail = '個人事業主の会計期間は、同じ年の1月1日から12月31日までにしてください';
  end if;

  insert into companies (name, kind, tax_method) values (v_name, p_kind, v_tax) returning id into v_company;

  insert into accounts (company_id, code, name, type, bs_category, pl_category, default_tax_code)
  select v_company, s.code, s.name, s.type, s.bs_category, s.pl_category, s.default_tax_code
    from jsonb_to_recordset(company_seed_accounts(p_kind))
         as s(code text, name text, type text, bs_category text, pl_category text, default_tax_code text);
  get diagnostics v_count = row_count;

  insert into account_aliases (account_id, alias, normalized_alias, alias_type, sort_order)
  select a.id, al->>'alias', al->>'normalized_alias', al->>'alias_type', 0
    from jsonb_array_elements(company_seed_accounts(p_kind)) as s(j)
    cross join lateral jsonb_array_elements(s.j->'aliases') as al
    join accounts a on a.company_id = v_company and a.code = s.j->>'code'
  on conflict (account_id, normalized_alias) do nothing;

  select id into v_carry from accounts
   where company_id = v_company and code = case when p_kind = 'CORPORATION' then '540' else '400' end;
  update companies set carry_forward_account_id = v_carry where id = v_company;

  insert into fiscal_periods (company_id, name, start_date, end_date, is_current)
  values (v_company,
          format('%s年%s月期', extract(year from p_end_date)::integer, extract(month from p_end_date)::integer),
          p_start_date, p_end_date, true)
  returning id into v_period;

  return jsonb_build_object('company_id', v_company, 'period_id', v_period, 'account_count', v_count);
end;
$$;


--
-- Name: create_journal_entry(uuid, date, text, integer, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_journal_entry(p_period_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_entry_id uuid;
  v_ref      integer;
begin
  perform validate_journal_lines(p_lines);

  -- 最初に会計期ごとの採番ロックを取る（以降の最大値取得・重複確認・INSERT はロック保持中）
  perform lock_period_for_numbering(p_period_id);

  if p_reference_number is null then
    v_ref := next_reference_number(p_period_id);
  else
    perform check_reference_number(p_period_id, p_reference_number, null);
    v_ref := p_reference_number;
  end if;

  -- 会計期間のチェックは trg_journal_entries_check_period が行う
  insert into journal_entries (period_id, date, description, reference_number, is_opening_balance, supplement)
  values (p_period_id, p_date, p_description, v_ref, false, nullif(p_supplement, ''))
  returning id into v_entry_id;

  perform insert_journal_lines(v_entry_id, p_lines);

  return jsonb_build_object('id', v_entry_id, 'reference_number', v_ref);
end;
$$;


--
-- Name: fill_account_company_kind(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fill_account_company_kind() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  -- 呼び出し側が company_kind を指定しても、会社の区分で上書きする（会社が無ければ外部キーが拒否する）
  select kind into new.company_kind from companies where id = new.company_id;
  if new.company_kind is null then
    raise exception using errcode = '23503', message = 'company_id の会社が存在しません',
      detail = format('company_id = %s', new.company_id);
  end if;
  return new;
end;
$$;


--
-- Name: fill_journal_entry_company(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fill_journal_entry_company() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.company_id is null then
    select company_id into new.company_id from fiscal_periods where id = new.period_id;
  end if;
  return new;
end;
$$;


--
-- Name: fill_journal_line_company(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fill_journal_line_company() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.company_id is null then
    select company_id into new.company_id from journal_entries where id = new.entry_id;
  end if;
  return new;
end;
$$;


--
-- Name: fill_opening_balance_company(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fill_opening_balance_company() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.company_id is null then
    select company_id into new.company_id from fiscal_periods where id = new.period_id;
  end if;
  return new;
end;
$$;


--
-- Name: fill_template_line_company(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fill_template_line_company() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.company_id is null then
    select company_id into new.company_id from journal_templates where id = new.template_id;
  end if;
  return new;
end;
$$;


--
-- Name: forbid_company_id_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_company_id_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception using errcode = 'P0001', message = 'COMPANY_ID_IMMUTABLE',
      detail = format('%s の company_id は変更できません', tg_table_name);
  end if;
  return new;
end;
$$;


--
-- Name: forbid_company_kind_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_company_kind_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.kind is distinct from old.kind then
    raise exception using errcode = 'P0001', message = 'COMPANY_KIND_IMMUTABLE',
      detail = '会社の区分（法人／個人）は変更できません。法人成りなどは別の会社として作成してください';
  end if;
  return new;
end;
$$;


--
-- Name: forbid_opening_balance_period_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_opening_balance_period_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.period_id is distinct from old.period_id then
    raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES',
      detail = '期首残高の明細・ヘッダーを別の期へ移動することはできません';
  end if;
  return new;
end;
$$;


--
-- Name: get_derived_opening_balances_for_period(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_derived_opening_balances_for_period(target_period_id uuid) RETURNS TABLE(account_id uuid, balance numeric)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
#variable_conflict use_column
declare
  v_company     uuid;
  v_start       date;
  v_base_id     uuid;
  v_base_start  date;
  v_base_manual boolean;
  v_carry       uuid;
  v_bucket      numeric;
begin
  select company_id, start_date into v_company, v_start
    from fiscal_periods where id = target_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND', detail = '会計期間が見つかりません';
  end if;

  -- 基準の期: 対象より前で、ヘッダーのある最新の期。無ければ会社の最初の期
  select p.id, p.start_date into v_base_id, v_base_start
    from fiscal_periods p
    join period_opening_balance_sets s on s.period_id = p.id
   where p.company_id = v_company and p.start_date < v_start
   order by p.start_date desc
   limit 1;
  v_base_manual := v_base_id is not null;

  if v_base_id is null then
    select id, start_date into v_base_id, v_base_start
      from fiscal_periods
     where company_id = v_company
     order by start_date, id
     limit 1;
  end if;

  -- 基準が無い（ヘッダーなし）場合、基準の期首日より前の仕訳があると出発点を決められない
  if not v_base_manual and exists (
       select 1 from journal_entries e where e.company_id = v_company and e.date < v_base_start) then
    raise exception using errcode = 'P0001', message = 'OPENING_BASE_UNDETERMINED',
      detail = '会社の最初の期より前の日付の仕訳があるため、期首残高の基準を決められません';
  end if;

  -- 最初の期（対象自身が基準）で手動設定なし → 期首残高なし
  if v_base_id = target_period_id then
    return;
  end if;

  -- 畳み込む動き（損益科目・個人の事業主貸借）の合計
  select coalesce(sum(m.bal), 0) into v_bucket
    from (
      select jl.account_id,
             sum(case when jl.side = 'DEBIT' then jl.amount else -jl.amount end) as bal
        from journal_lines jl
        join journal_entries e on e.id = jl.entry_id
       where e.company_id = v_company and e.date >= v_base_start and e.date < v_start
       group by jl.account_id
    ) m
    join accounts a on a.id = m.account_id
   where a.type in ('REVENUE', 'EXPENSE') or a.bs_category in ('OWNER_DRAWINGS', 'OWNER_CONTRIBUTIONS');

  select carry_forward_account_id into v_carry from companies where id = v_company;
  if v_bucket <> 0 and v_carry is null then
    raise exception using errcode = 'P0001', message = 'CARRY_FORWARD_NOT_SET',
      detail = '繰越先の科目が設定されていないため、損益・事業主貸借を期首残高へ繰り越せません';
  end if;

  return query
    select x.account_id, sum(x.bal)::numeric
      from (
        -- 基準の期首残高（手動設定の期のみ。最初の期でヘッダーなしなら無し）
        select l.account_id, l.balance as bal
          from period_opening_balance_lines l
         where l.period_id = v_base_id
        union all
        -- 基準から期首日の前日までの動き（BS科目）
        select m.account_id, m.bal
          from (
            select jl.account_id,
                   sum(case when jl.side = 'DEBIT' then jl.amount else -jl.amount end) as bal
              from journal_lines jl
              join journal_entries e on e.id = jl.entry_id
             where e.company_id = v_company and e.date >= v_base_start and e.date < v_start
             group by jl.account_id
          ) m
          join accounts a on a.id = m.account_id
         where not (a.type in ('REVENUE', 'EXPENSE') or a.bs_category in ('OWNER_DRAWINGS', 'OWNER_CONTRIBUTIONS'))
        union all
        -- 畳み込んだ動きを繰越先へ
        select v_carry, v_bucket where v_bucket <> 0
      ) x
     group by x.account_id
    having sum(x.bal) <> 0;
end;
$$;


--
-- Name: get_opening_balances_for_period(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_opening_balances_for_period(target_period_id uuid) RETURNS TABLE(account_id uuid, balance numeric)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
#variable_conflict use_column
begin
  if exists (select 1 from period_opening_balance_sets s where s.period_id = target_period_id) then
    return query
      select l.account_id, l.balance
        from period_opening_balance_lines l
       where l.period_id = target_period_id;
  else
    return query
      select d.account_id, d.balance
        from get_derived_opening_balances_for_period(target_period_id) d;
  end if;
end;
$$;


--
-- Name: get_period_close_check(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_period_close_check(p_period_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_closed timestamptz;
begin
  select closed_at into v_closed from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND', detail = '会計期間が見つかりません';
  end if;
  return jsonb_build_object(
    'closed', v_closed is not null,
    'errors', to_jsonb(period_close_errors(p_period_id)),
    'warnings', to_jsonb(period_close_warnings(p_period_id)));
end;
$$;


--
-- Name: get_pl_data(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pl_data(target_period_id uuid) RETURNS TABLE(account_id uuid, total_debit numeric, total_credit numeric)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    jl.account_id,
    COALESCE(SUM(CASE WHEN jl.side = 'DEBIT'  THEN jl.amount ELSE 0 END), 0) AS total_debit,
    COALESCE(SUM(CASE WHEN jl.side = 'CREDIT' THEN jl.amount ELSE 0 END), 0) AS total_credit
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id
  WHERE je.period_id = target_period_id
    AND je.is_opening_balance = FALSE
  GROUP BY jl.account_id;
$$;


--
-- Name: guard_account_in_closed_periods(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_account_in_closed_periods() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if (old.type, old.bs_category, old.pl_category, old.parent_id)
       is not distinct from (new.type, new.bs_category, new.pl_category, new.parent_id) then
    return new;
  end if;

  perform period_lock_company(old.company_id, false);

  if exists (
       select 1
         from journal_lines jl
         join journal_entries e on e.id = jl.entry_id
         join fiscal_periods p on p.id = e.period_id
        where jl.account_id = old.id and p.closed_at is not null)
     or exists (
       select 1
         from period_opening_balance_lines l
         join fiscal_periods p on p.id = l.period_id
        where l.account_id = old.id and p.closed_at is not null) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_IN_CLOSED_PERIOD',
      detail = format('確定済みの期で使われている科目は、種別・財務諸表区分・親科目を変更できません: %s %s', old.code, old.name);
  end if;
  return new;
end;
$$;


--
-- Name: guard_carry_forward_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_carry_forward_account() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if exists (select 1 from companies where carry_forward_account_id = old.id)
     and (new.type <> 'EQUITY' or new.bs_category is distinct from 'EQUITY' or new.parent_id is not null) then
    raise exception using errcode = 'P0001', message = 'INVALID_CARRY_FORWARD_ACCOUNT',
      detail = format('繰越先に設定されている科目は、純資産（EQUITY）の親科目のまま変更できません: %s %s', old.code, old.name);
  end if;
  return new;
end;
$$;


--
-- Name: guard_closed_carry_forward(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_closed_carry_forward() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.carry_forward_account_id is not distinct from old.carry_forward_account_id then
    return new;
  end if;
  perform period_lock_company(old.id, false);
  if exists (select 1 from fiscal_periods where company_id = old.id and closed_at is not null) then
    raise exception using errcode = 'P0001', message = 'CARRY_FORWARD_LOCKED',
      detail = '確定済みの期があるため、繰越先の科目は変更できません';
  end if;
  return new;
end;
$$;


--
-- Name: guard_closed_period_journal_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_closed_period_journal_entry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    perform period_assert_open(new.period_id);
    return new;
  elsif tg_op = 'DELETE' then
    perform period_assert_open(old.period_id);
    return old;
  end if;

  if old.period_id is not distinct from new.period_id then
    perform period_assert_open(old.period_id);
  elsif old.period_id < new.period_id then
    perform period_assert_open(old.period_id);
    perform period_assert_open(new.period_id);
  else
    perform period_assert_open(new.period_id);
    perform period_assert_open(old.period_id);
  end if;
  return new;
end;
$$;


--
-- Name: guard_closed_period_journal_line(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_closed_period_journal_line() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_entry_id  uuid;
  v_period_id uuid;
begin
  v_entry_id := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
  select period_id into v_period_id from journal_entries where id = v_entry_id;
  if found then   -- 仕訳ごと削除（CASCADE）された場合は親が見えない。仕訳側のガードが先に判定している
    perform period_assert_open(v_period_id);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: guard_closed_period_opening_balance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_closed_period_opening_balance() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'DELETE' then
    perform period_assert_open(old.period_id);
    return old;
  end if;
  perform period_assert_open(new.period_id);
  return new;
end;
$$;


--
-- Name: guard_fiscal_period_dates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_fiscal_period_dates() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.start_date is not distinct from old.start_date and new.end_date is not distinct from old.end_date then
    return new;
  end if;
  if old.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'PERIOD_CLOSED_FIELDS',
      detail = format('期 %s は確定済みのため、期間（開始日・終了日）は変更できません', old.name);
  end if;
  perform guard_period_range(new.company_id, new.id, new.start_date);
  return new;
end;
$$;


--
-- Name: guard_fiscal_period_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_fiscal_period_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if old.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'PERIOD_CLOSED_FIELDS',
      detail = format('期 %s は確定済みのため削除できません', old.name);
  end if;
  return old;
end;
$$;


--
-- Name: guard_fiscal_period_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_fiscal_period_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'PERIOD_CLOSED_FIELDS',
      detail = '確定済みの状態で期を作成することはできません（期を作成してから確定してください）';
  end if;
  perform guard_period_range(new.company_id, new.id, new.start_date);
  return new;
end;
$$;


--
-- Name: guard_journal_line_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_journal_line_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_entry_id uuid;
begin
  if tg_op = 'UPDATE' and new.entry_id is distinct from old.entry_id then
    raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
      detail = '明細を別の仕訳へ移動することはできません';
  end if;

  v_entry_id := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;

  -- 同じ仕訳への明細変更を直列化する。後から来たトランザクションは先のトランザクションの終了を待ち、
  -- その後の遅延チェックで、先に確定した変更を含めた状態を検証する。
  -- 仕訳ごと削除（CASCADE）された場合は親行が見えないので、何もロックせずに通す。
  perform 1 from journal_entries where id = v_entry_id for no key update;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: guard_opening_balance_line_accounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_opening_balance_line_accounts() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if exists (select 1 from period_opening_balance_lines where account_id = old.id)
     and not opening_balance_account_ok(new.type, new.bs_category, new.company_kind) then
    raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_ACCOUNT',
      detail = format('期首残高に使われている科目は、財務諸表区分のある資産・負債・純資産のまま変更できません: %s %s', old.code, old.name);
  end if;
  return new;
end;
$$;


--
-- Name: guard_period_close_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_period_close_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_errs text[];
  v_next timestamptz;
  v_next_found boolean;
begin
  if old.closed_at is not distinct from new.closed_at then
    return new;
  end if;

  -- 手順0: 確定・解除と期間の変更は別の操作にする（E1〜E5 は保存済みの行を読むため、同時変更を許すと検査と保存がずれる）
  if new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    raise exception using errcode = 'P0001', message = 'PERIOD_CLOSED_FIELDS',
      detail = '確定・解除と期間（開始日・終了日）の変更は同時にできません';
  end if;

  if old.closed_at is null and new.closed_at is not null then
    -- 確定。この UPDATE が期の行を既にロックしている。ロック順は「期の行 → 会社の advisory（排他）」
    perform period_lock_company(old.company_id, true);

    if period_close_prev_open(old.id) then
      raise exception using errcode = 'P0001', message = 'PERIOD_CLOSE_PREVIOUS_OPEN',
        detail = '直前の期が確定されていません（期は古い順に確定します）';
    end if;

    v_errs := period_close_errors(old.id);
    if coalesce(array_length(v_errs, 1), 0) > 0 then
      raise exception using errcode = 'P0001', message = 'PERIOD_CLOSE_CHECK_FAILED',
        detail = array_to_string(v_errs, E'\n');
    end if;

    new.closed_at := now();   -- 呼び出し側の指定値は使わない
    insert into fiscal_period_close_logs (company_id, period_id, action, memo)
    values (old.company_id, old.id, 'CLOSE', nullif(current_setting('stoic.close_memo', true), ''));

  elsif old.closed_at is not null and new.closed_at is null then
    perform period_lock_company(old.company_id, true);

    select n.closed_at, true into v_next, v_next_found
      from fiscal_periods n
     where n.company_id = old.company_id and n.start_date > old.start_date
     order by n.start_date, n.id
     limit 1;
    if coalesce(v_next_found, false) and v_next is not null then
      raise exception using errcode = 'P0001', message = 'PERIOD_REOPEN_NEXT_CLOSED',
        detail = '直後の期が確定済みのため解除できません（新しい期から順に解除してください）';
    end if;

    insert into fiscal_period_close_logs (company_id, period_id, action, memo)
    values (old.company_id, old.id, 'REOPEN', nullif(current_setting('stoic.close_memo', true), ''));

  else
    raise exception using errcode = 'P0001', message = 'PERIOD_CLOSED_FIELDS',
      detail = '確定日時を書き換えることはできません（解除してから確定し直してください）';
  end if;

  return new;
end;
$$;


--
-- Name: guard_period_range(uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_period_range(p_company_id uuid, p_period_id uuid, p_start date) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_max date;
begin
  perform period_lock_company(p_company_id, false);
  select max(end_date) into v_max
    from fiscal_periods
   where company_id = p_company_id and id <> p_period_id and closed_at is not null;
  if v_max is not null and p_start <= v_max then
    raise exception using errcode = 'P0001', message = 'PERIOD_OVERLAPS_CLOSED',
      detail = format('確定済みの期（%s まで）と重なる、またはそれより前になる期は作成・変更できません', v_max);
  end if;
end;
$$;


--
-- Name: import_staging_entries(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.import_staging_entries(p_period_id uuid, p_staging_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_total     integer;
  v_found     integer;
  v_processed integer;
  r           record;
  v_date      date;
  v_amount    numeric;
  v_lines     jsonb;
  v_entry_id  uuid;
  v_state     text;
  v_message   text;
  v_ref       integer;
  v_detail    text;
begin
  v_total := coalesce(cardinality(p_staging_ids), 0);
  if v_total = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_STAGING_ROWS',
      detail = '登録対象の行がありません';
  end if;

  if (select count(distinct x) from unnest(p_staging_ids) as x) <> v_total
     or array_position(p_staging_ids, null) is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_STAGING_ROWS',
      detail = '登録対象の指定に重複または空の値があります';
  end if;

  -- 対象行をロックしてから件数・処理済みを確認する（並行する本登録・削除との競合を防ぐ）
  select count(*), count(*) filter (where coalesce(is_processed, false))
    into v_found, v_processed
    from (
      select id, is_processed
        from import_staging
       where id = any(p_staging_ids)
       order by id   -- ロック取得順を固定（重複する ID を含む複数の本登録が互いを待ち合うのを避ける）
         for update
    ) as locked;

  if v_found <> v_total then
    raise exception using errcode = 'P0001', message = 'INVALID_STAGING_ROWS',
      detail = format('取込データが見つかりません（指定 %s 件 / 存在 %s 件）。画面を再読み込みしてください', v_total, v_found);
  end if;

  if v_processed > 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_STAGING_ROWS',
      detail = format('登録済みの取込データが %s 件含まれています。画面を再読み込みしてください', v_processed);
  end if;

  -- 取込行の会社と、登録先の期の会社が違えば拒否する（期が存在しない場合は、下の採番ロックが PERIOD_NOT_FOUND を返す）
  if exists (select 1 from fiscal_periods where id = p_period_id)
     and exists (
       select 1
         from import_staging s
        where s.id = any(p_staging_ids)
          and s.company_id is distinct from (select company_id from fiscal_periods where id = p_period_id)
     ) then
    raise exception using errcode = 'P0001', message = 'COMPANY_MISMATCH',
      detail = '取込データの会社と、登録先の会計期間の会社が一致しません';
  end if;

  -- 伝票番号の採番ロックは、取込行のロックの後・本登録ループの前に1回だけ取る
  -- （ロック順: import_staging の行 → 採番ロック。create/update は 採番ロック → journal_entries）
  perform lock_period_for_numbering(p_period_id);

  for r in
    select s.*, u.ord
      from unnest(p_staging_ids) with ordinality as u(id, ord)
      join import_staging s on s.id = u.id
     order by u.ord
  loop
    begin
      -- CSV パーサーは日付を YYYY-MM-DD に正規化して staging に入れる。NULL・空・別書式は拒否する
      -- （NULL::date はエラーにならず、後続の NOT NULL 違反になってしまうため、先に明示的に弾く）
      if r.raw_date is null or r.raw_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_DATE',
          detail = format('日付を読み取れません: %s', coalesce(nullif(r.raw_date, ''), '（空）'));
      end if;
      begin
        v_date := r.raw_date::date;
      exception when others then
        raise exception using errcode = 'P0001', message = 'INVALID_DATE',
          detail = format('日付を読み取れません: %s', r.raw_date);
      end;

      if r.predicted_account_id is null or r.counter_account_id is null then
        raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
          detail = '借方科目・貸方科目が設定されていません';
      end if;

      -- 負数は無視せず拒否する（「借方 -100 / 貸方 100」で -100 が捨てられ 100 の仕訳になるのを防ぐ）。
      -- 通常は CSV パーサーが弾くが、DB 側にも最終検証を持たせる
      if coalesce(r.raw_debit_amount, 0) < 0 or coalesce(r.raw_credit_amount, 0) < 0 then
        raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
          detail = format('金額に負の値が含まれています（借方 %s / 貸方 %s）',
                          coalesce(r.raw_debit_amount::text, '空'), coalesce(r.raw_credit_amount::text, '空'));
      end if;

      -- 片側だけの金額は従来どおり許容（その金額を借貸の両方に使う）。
      -- 両側とも正で金額が違う場合、元データの貸方（または借方）が黙って捨てられてしまうので拒否する
      if coalesce(r.raw_debit_amount, 0) > 0 and coalesce(r.raw_credit_amount, 0) > 0
         and r.raw_debit_amount <> r.raw_credit_amount then
        raise exception using errcode = 'P0001', message = 'DEBIT_CREDIT_MISMATCH',
          detail = format('借方金額 %s と貸方金額 %s が一致しません', r.raw_debit_amount, r.raw_credit_amount);
      end if;

      -- 従来の画面ロジックと同じ: 借方金額 > 0 ならそれを、そうでなければ貸方金額を使う
      v_amount := case when coalesce(r.raw_debit_amount, 0) > 0 then r.raw_debit_amount else r.raw_credit_amount end;

      v_lines := jsonb_build_array(
        jsonb_build_object('side', 'DEBIT',  'account_id', r.predicted_account_id,
                           'amount', v_amount::text, 'tax_code', r.debit_tax_code_id),
        jsonb_build_object('side', 'CREDIT', 'account_id', r.counter_account_id,
                           'amount', v_amount::text, 'tax_code', r.credit_tax_code_id)
      );
      perform validate_journal_lines(v_lines);

      -- 配列順に、その期の「最大の伝票番号+1」を付ける（同一トランザクション内の直前の行も数える）
      v_ref := next_reference_number(p_period_id);

      insert into journal_entries (period_id, date, description, reference_number, is_opening_balance)
      values (p_period_id, v_date, r.raw_description, v_ref, false)
      returning id into v_entry_id;

      perform insert_journal_lines(v_entry_id, v_lines);

    exception when others then
      -- SQLSTATE と message は保ったまま、どの行で失敗したかを DETAIL に付けて再送出する
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
      raise exception using errcode = v_state, message = v_message,
        detail = format('%s行目（%s）: %s', r.ord, coalesce(r.raw_description, '摘要なし'),
                        coalesce(nullif(v_detail, ''), v_message));
    end;
  end loop;

  update import_staging set is_processed = true where id = any(p_staging_ids);

  return v_total;
end;
$_$;


--
-- Name: inherit_parent_account_attrs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inherit_parent_account_attrs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  p accounts%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;

  -- 自分自身を親にできない（複合外部キーは、自分自身の行があれば通してしまう）
  if new.parent_id = new.id then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCOUNT_HIERARCHY',
      detail = '科目自身を親科目にはできません';
  end if;

  select * into p from accounts where id = new.parent_id;
  if not found then
    return new;  -- 存在しない親は外部キーが拒否する
  end if;

  if p.parent_id is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCOUNT_HIERARCHY',
      detail = '補助科目の下に補助科目は作れません';
  end if;

  if exists (select 1 from accounts where parent_id = new.id) then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCOUNT_HIERARCHY',
      detail = '補助科目を持つ科目を、別の科目の補助科目にはできません';
  end if;

  new.type := p.type;
  new.bs_category := p.bs_category;
  new.pl_category := p.pl_category;
  return new;
end;
$$;


--
-- Name: insert_journal_lines(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_journal_lines(p_entry_id uuid, p_lines jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  perform validate_journal_lines(p_lines);

  insert into journal_lines (entry_id, line_number, side, account_id, amount, tax_code, description)
  select
    p_entry_id,
    e.ordinality::integer,
    e.value->>'side',
    (e.value->>'account_id')::uuid,
    (e.value->>'amount')::numeric,
    nullif(e.value->>'tax_code', ''),
    null
  from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality);
end;
$$;


--
-- Name: lock_period_for_numbering(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_period_for_numbering(p_period_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  perform pg_advisory_xact_lock(hashtext('stoic.journal_reference_number'), hashtext(p_period_id::text));

  perform 1 from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND',
      detail = format('period_id = %s', p_period_id);
  end if;
end;
$$;


--
-- Name: log_journal_entry_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_journal_entry_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  lines_snapshot JSONB;
BEGIN
  -- 直接のヘッダーUPDATE/DELETEはTrigger階層1。journal_linesのTrigger経由の連鎖更新は階層2以上
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- 変更前のjournal_linesを丸ごとJSONBに変換
  SELECT jsonb_agg(row_to_json(l))
  INTO lines_snapshot
  FROM journal_lines l
  WHERE l.entry_id = OLD.id;

  INSERT INTO journal_entry_logs (entry_id, action, before_data)
  VALUES (
    OLD.id,
    TG_OP,  -- 'UPDATE' または 'DELETE'
    jsonb_build_object(
      'entry', row_to_json(OLD),
      'lines', COALESCE(lines_snapshot, '[]')
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: next_reference_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_reference_number(p_period_id uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_next integer;
begin
  perform lock_period_for_numbering(p_period_id);

  select coalesce(max(reference_number), 0) + 1
    into v_next
    from journal_entries
   where period_id = p_period_id;

  if v_next > 999999999 then
    raise exception using errcode = 'P0001', message = 'INVALID_REFERENCE_NUMBER',
      detail = '伝票番号が上限（999999999）に達しました';
  end if;

  return v_next;
end;
$$;


--
-- Name: opening_balance_account_ok(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.opening_balance_account_ok(p_type text, p_bs_category text, p_company_kind text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select p_type in ('ASSET', 'LIABILITY', 'EQUITY')
     and p_bs_category is not null
     and not (p_company_kind = 'INDIVIDUAL' and p_bs_category in ('OWNER_DRAWINGS', 'OWNER_CONTRIBUTIONS'));
$$;


--
-- Name: period_assert_open(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.period_assert_open(p_period_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_name   text;
  v_closed timestamptz;
begin
  select name, closed_at into v_name, v_closed
    from fiscal_periods
   where id = p_period_id
     for share;
  if found and v_closed is not null then
    raise exception using errcode = 'P0001', message = 'PERIOD_CLOSED',
      detail = format('期 %s は確定済みのため、仕訳・期首残高は変更できません', v_name);
  end if;
end;
$$;


--
-- Name: period_carry_forward_amount(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.period_carry_forward_amount(p_company_id uuid, p_target_start date) RETURNS numeric
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_base_id    uuid;
  v_base_start date;
  v_bucket     numeric;
begin
  select p.id, p.start_date into v_base_id, v_base_start
    from fiscal_periods p
    join period_opening_balance_sets s on s.period_id = p.id
   where p.company_id = p_company_id and p.start_date < p_target_start
   order by p.start_date desc
   limit 1;

  if v_base_id is null then
    select id, start_date into v_base_id, v_base_start
      from fiscal_periods
     where company_id = p_company_id
     order by start_date, id
     limit 1;
  end if;

  if v_base_id is null then
    return 0;
  end if;

  select coalesce(sum(m.bal), 0) into v_bucket
    from (
      select jl.account_id,
             sum(case when jl.side = 'DEBIT' then jl.amount else -jl.amount end) as bal
        from journal_lines jl
        join journal_entries e on e.id = jl.entry_id
       where e.company_id = p_company_id and e.date >= v_base_start and e.date < p_target_start
       group by jl.account_id
    ) m
    join accounts a on a.id = m.account_id
   where a.type in ('REVENUE', 'EXPENSE') or a.bs_category in ('OWNER_DRAWINGS', 'OWNER_CONTRIBUTIONS');

  return v_bucket;
end;
$$;


--
-- Name: period_close_errors(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.period_close_errors(p_period_id uuid) RETURNS text[]
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  p        fiscal_periods%rowtype;
  v_errs   text[] := '{}';
  v_msg    text;
  v_list   text;
  v_carry  uuid;
begin
  select * into p from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND', detail = '会計期間が見つかりません';
  end if;

  -- E1: 直前の期が未確定
  if period_close_prev_open(p_period_id) then
    v_errs := array_append(v_errs, 'E1: 直前の期が確定されていません（期は古い順に確定します）');
  end if;

  -- E2: 期首残高を導出できない（導出関数のエラーを変換する。導出関数は変更しない）
  begin
    perform count(*) from get_derived_opening_balances_for_period(p_period_id);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    if v_msg in ('OPENING_BASE_UNDETERMINED', 'CARRY_FORWARD_NOT_SET') then
      v_errs := array_append(v_errs, format('E2: 期首残高を導出できません（%s）', v_msg));
    else
      raise;
    end if;
  end;

  -- E3: 次の期へ繰り越す損益・事業主貸借の動きがあるのに、繰越先が未設定
  select carry_forward_account_id into v_carry from companies where id = p.company_id;
  if v_carry is null and period_carry_forward_amount(p.company_id, p.end_date + 1) <> 0 then
    v_errs := array_append(v_errs, 'E3: 損益・事業主貸借を繰り越す先の科目（繰越先）が設定されていません');
  end if;

  -- E4: 財務諸表区分が未設定の科目に、期末日以前の明細がある（BS／PL から脱落する）
  select string_agg(distinct a.code || ' ' || a.name, ', ' order by a.code || ' ' || a.name) into v_list
    from journal_lines jl
    join journal_entries e on e.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where e.company_id = p.company_id
     and e.date <= p.end_date
     and ((a.type in ('ASSET', 'LIABILITY', 'EQUITY') and a.bs_category is null)
       or (a.type in ('REVENUE', 'EXPENSE') and a.pl_category is null));
  if v_list is not null then
    v_errs := array_append(v_errs, format('E4: 財務諸表区分が未設定の科目に仕訳があります: %s', v_list));
  end if;

  -- E5: 同じ会社の他の期と日付範囲が重なる
  select string_agg(o.name, ', ' order by o.start_date) into v_list
    from fiscal_periods o
   where o.company_id = p.company_id and o.id <> p.id
     and o.start_date <= p.end_date and o.end_date >= p.start_date;
  if v_list is not null then
    v_errs := array_append(v_errs, format('E5: 他の期と期間が重なっています: %s', v_list));
  end if;

  return v_errs;
end;
$$;


--
-- Name: period_close_prev_open(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.period_close_prev_open(p_period_id uuid) RETURNS boolean
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select pv.closed_at is null
      from fiscal_periods p
      join lateral (
        select q.closed_at
          from fiscal_periods q
         where q.company_id = p.company_id and q.start_date < p.start_date
         order by q.start_date desc, q.id
         limit 1
      ) pv on true
     where p.id = p_period_id
  ), false);
$$;


--
-- Name: period_close_warnings(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.period_close_warnings(p_period_id uuid) RETURNS text[]
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  p       fiscal_periods%rowtype;
  v_warns text[] := '{}';
  v_cnt   bigint;
begin
  select * into p from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND', detail = '会計期間が見つかりません';
  end if;

  -- W1: 未処理の取込行（期の情報を持たないため会社全体の件数）
  select count(*) into v_cnt
    from import_staging
   where company_id = p.company_id and not coalesce(is_processed, false);
  if v_cnt > 0 then
    v_warns := array_append(v_warns, format('W1: 未処理の取込データが %s 件あります（会社全体の件数）', v_cnt));
  end if;

  -- W3: 仕訳が 1 件も無い
  if not exists (select 1 from journal_entries where period_id = p_period_id) then
    v_warns := array_append(v_warns, 'W3: この期には仕訳が1件もありません');
  end if;

  return v_warns;
end;
$$;


--
-- Name: period_lock_company(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.period_lock_company(p_company_id uuid, p_exclusive boolean) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if p_exclusive then
    perform pg_advisory_xact_lock(hashtext('stoic.period_close'), hashtext(p_company_id::text));
  else
    perform pg_advisory_xact_lock_shared(hashtext('stoic.period_close'), hashtext(p_company_id::text));
  end if;
end;
$$;


--
-- Name: propagate_parent_account_attrs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.propagate_parent_account_attrs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  update accounts
     set type = new.type, bs_category = new.bs_category, pl_category = new.pl_category
   where parent_id = new.id
     and (type, bs_category, pl_category) is distinct from (new.type, new.bs_category, new.pl_category);
  return null;
end;
$$;


--
-- Name: reopen_fiscal_period(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_fiscal_period(p_period_id uuid, p_memo text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  perform 1 from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND', detail = '会計期間が見つかりません';
  end if;

  perform set_config('stoic.close_memo', coalesce(p_memo, ''), true);
  update fiscal_periods set closed_at = null where id = p_period_id and closed_at is not null;
  if not found then
    perform set_config('stoic.close_memo', '', true);
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_CLOSED', detail = 'この期は確定されていません';
  end if;
  perform set_config('stoic.close_memo', '', true);

  return jsonb_build_object('period_id', p_period_id, 'closed_at', null);
end;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: save_period_opening_balances(uuid, jsonb, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_period_opening_balances(p_period_id uuid, p_lines jsonb, p_memo text DEFAULT NULL::text, p_auto_balance boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_company   uuid;
  v_carry     uuid;
  v_elem      jsonb;
  v_acc       uuid;
  v_txt       text;
  v_bal       numeric;
  v_accs      uuid[] := '{}';   -- 重複検出用（0 の行も含む）
  v_acc_arr   uuid[] := '{}';
  v_bal_arr   numeric[] := '{}';
  v_idx       integer;
  v_sum       numeric;
  v_adj       numeric := 0;
  v_before    jsonb;
  v_after     jsonb;
  v_line_cnt  integer;
begin
  select company_id into v_company from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND', detail = '会計期間が見つかりません';
  end if;

  -- 同じ期への同時保存を直列化する（fiscal_periods は FOR UPDATE で握らない）
  perform pg_advisory_xact_lock(hashtextextended('period_opening_balance:' || p_period_id::text, 0));

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES',
      detail = '明細は配列で指定してください';
  end if;

  for v_elem in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES', detail = '明細の形式が不正です';
    end if;
    begin
      v_acc := (v_elem->>'account_id')::uuid;
    exception when others then
      v_acc := null;
    end;
    if v_acc is null then
      raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES', detail = '科目が不正です';
    end if;
    if v_acc = any(v_accs) then
      raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES', detail = '同じ科目が重複しています';
    end if;
    v_accs := array_append(v_accs, v_acc);

    -- 数値以外（NaN・指数表記・空）は拒否。小数第3位以下は丸めずに拒否
    v_txt := v_elem->>'balance';
    if v_txt is null or v_txt !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES', detail = '金額が数値ではありません';
    end if;
    v_bal := v_txt::numeric;
    if v_bal <> round(v_bal, 2) then
      raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES', detail = '金額は小数第2位までで入力してください';
    end if;
    if abs(v_bal) >= 10000000000000 then
      raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES', detail = '金額の桁数が大きすぎます';
    end if;

    if v_bal <> 0 then
      v_acc_arr := array_append(v_acc_arr, v_acc);
      v_bal_arr := array_append(v_bal_arr, v_bal);
    end if;
  end loop;

  -- 科目が期の会社のものか（他社・存在しない科目は拒否）
  if (select count(*) from accounts where id = any(v_accs) and company_id = v_company) <> coalesce(array_length(v_accs, 1), 0) then
    raise exception using errcode = 'P0001', message = 'REFERENCE_NOT_FOUND_OR_OTHER_COMPANY',
      detail = '存在しない科目、または別の会社の科目が含まれています';
  end if;

  -- 貸借合計
  select coalesce(sum(x), 0) into v_sum from unnest(v_bal_arr) as x;
  if v_sum <> 0 then
    -- p_auto_balance が null のときは false として扱う（null のまま `not` を評価すると真にならず、自動調整に進んでしまう）
    if not coalesce(p_auto_balance, false) then
      raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_UNBALANCED',
        detail = format('期首残高の借方・貸方が一致しません（差額 %s）', v_sum);
    end if;
    select carry_forward_account_id into v_carry from companies where id = v_company;
    if v_carry is null then
      raise exception using errcode = 'P0001', message = 'CARRY_FORWARD_NOT_SET',
        detail = '繰越先の科目が設定されていないため、差額を集計できません';
    end if;
    v_adj := -v_sum;
    v_idx := array_position(v_acc_arr, v_carry);
    if v_idx is null then
      v_acc_arr := array_append(v_acc_arr, v_carry);
      v_bal_arr := array_append(v_bal_arr, v_adj);
    else
      v_bal_arr[v_idx] := v_bal_arr[v_idx] + v_adj;
    end if;
  end if;

  -- 変更前の内容
  select jsonb_build_object(
           'memo', s.memo,
           'lines', coalesce((select jsonb_agg(jsonb_build_object('account_id', l.account_id, 'balance', l.balance)
                                               order by l.account_id)
                                from period_opening_balance_lines l where l.period_id = p_period_id), '[]'::jsonb))
    into v_before
    from period_opening_balance_sets s
   where s.period_id = p_period_id;

  insert into period_opening_balance_sets (company_id, period_id, memo)
  values (v_company, p_period_id, p_memo)
  on conflict (period_id) do update set memo = excluded.memo, updated_at = now();

  delete from period_opening_balance_lines where period_id = p_period_id;

  insert into period_opening_balance_lines (company_id, period_id, account_id, balance)
  select v_company, p_period_id, t.a, t.b
    from unnest(v_acc_arr, v_bal_arr) as t(a, b)
   where t.b <> 0;
  get diagnostics v_line_cnt = row_count;

  select jsonb_build_object(
           'memo', p_memo,
           'lines', coalesce((select jsonb_agg(jsonb_build_object('account_id', t.a, 'balance', t.b) order by t.a)
                                from unnest(v_acc_arr, v_bal_arr) as t(a, b) where t.b <> 0), '[]'::jsonb))
    into v_after;

  insert into period_opening_balance_logs (company_id, period_id, action, before_data, after_data)
  values (v_company, p_period_id, 'SET', v_before, v_after);

  return jsonb_build_object(
    'period_id', p_period_id,
    'line_count', v_line_cnt,
    'auto_balanced', v_adj <> 0,
    'adjustment', v_adj);
end;
$_$;


--
-- Name: update_journal_entry(uuid, date, text, integer, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_journal_entry(p_entry_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_period_id        uuid;
  v_locked_period_id uuid;
  v_is_opening       boolean;
begin
  perform validate_journal_lines(p_lines);

  -- ロック順は「採番ロック（会計期ごと）→ 仕訳行」。会計期を特定するための最初の読み取りはロックなしで行う
  select period_id into v_period_id from journal_entries where id = p_entry_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ENTRY_NOT_FOUND',
      detail = format('entry_id = %s', p_entry_id);
  end if;

  perform lock_period_for_numbering(v_period_id);

  -- 存在確認と同時に行ロックを取り、確認後に他の処理で削除・変更される余地をなくす
  select coalesce(is_opening_balance, false), period_id
    into v_is_opening, v_locked_period_id
    from journal_entries
   where id = p_entry_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ENTRY_NOT_FOUND',
      detail = format('entry_id = %s', p_entry_id);
  end if;

  -- 最初の読み取りから仕訳行のロックまでの間に、他の処理が所属期を変えていないか再確認する
  if v_locked_period_id is distinct from v_period_id then
    raise exception using errcode = 'P0001', message = 'ENTRY_PERIOD_CHANGED',
      detail = format('entry_id = %s', p_entry_id);
  end if;

  if v_is_opening then
    raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_EDIT_FORBIDDEN';
  end if;

  perform check_reference_number(v_period_id, p_reference_number, p_entry_id);

  update journal_entries
     set date             = p_date,
         description      = p_description,
         reference_number = coalesce(p_reference_number, reference_number),
         supplement       = case when p_supplement is null then supplement else nullif(p_supplement, '') end,
         updated_at       = now()
   where id = p_entry_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ENTRY_NOT_FOUND',
      detail = format('entry_id = %s', p_entry_id);
  end if;

  delete from journal_lines where entry_id = p_entry_id;

  perform insert_journal_lines(p_entry_id, p_lines);
end;
$$;


--
-- Name: validate_journal_lines(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_journal_lines(p_lines jsonb) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $_$
declare
  v_line   jsonb;
  v_idx    integer;
  v_amount numeric;
  v_debit_total  numeric := 0;
  v_credit_total numeric := 0;
  v_debit_count  integer := 0;
  v_credit_count integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
      detail = '明細が配列ではありません';
  end if;

  if jsonb_array_length(p_lines) < 2 then
    raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
      detail = '明細は2行以上必要です';
  end if;

  for v_line, v_idx in
    select e.value, e.ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
        detail = format('%s行目: 明細の形式が不正です', v_idx);
    end if;

    if coalesce(v_line->>'side', '') not in ('DEBIT', 'CREDIT') then
      raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
        detail = format('%s行目: 借方・貸方の指定が不正です', v_idx);
    end if;

    if jsonb_typeof(v_line->'account_id') is distinct from 'string'
       or (v_line->>'account_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
        detail = format('%s行目: 勘定科目が指定されていません', v_idx);
    end if;

    if jsonb_typeof(v_line->'amount') is distinct from 'string'
       or (v_line->>'amount') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' then
      raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
        detail = format('%s行目: 金額は小数第2位までの正の数で入力してください', v_idx);
    end if;

    v_amount := (v_line->>'amount')::numeric;
    if v_amount <= 0 then
      raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
        detail = format('%s行目: 金額は0より大きい値を入力してください', v_idx);
    end if;

    if v_line ? 'tax_code' and jsonb_typeof(v_line->'tax_code') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
        detail = format('%s行目: 税区分の形式が不正です', v_idx);
    end if;

    if v_line->>'side' = 'DEBIT' then
      v_debit_total := v_debit_total + v_amount;
      v_debit_count := v_debit_count + 1;
    else
      v_credit_total := v_credit_total + v_amount;
      v_credit_count := v_credit_count + 1;
    end if;
  end loop;

  if v_debit_count = 0 or v_credit_count = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_JOURNAL_LINES',
      detail = '借方・貸方それぞれ1行以上必要です';
  end if;

  if v_debit_total <> v_credit_total then
    raise exception using errcode = 'P0001', message = 'DEBIT_CREDIT_MISMATCH',
      detail = format('借方合計 %s / 貸方合計 %s', v_debit_total, v_credit_total);
  end if;
end;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    alias_type text DEFAULT 'OTHER'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_aliases_type_check CHECK ((alias_type = ANY (ARRAY['KANA'::text, 'ROMAN'::text, 'ABBREV'::text, 'OTHER'::text])))
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    parent_id uuid,
    default_tax_code text,
    pl_category text,
    bs_category text,
    company_id uuid NOT NULL,
    company_kind text NOT NULL,
    CONSTRAINT accounts_bs_category_check CHECK (((bs_category IS NULL) OR (bs_category = ANY (ARRAY['CURRENT_ASSETS'::text, 'FIXED_ASSETS'::text, 'DEFERRED_ASSETS'::text, 'OWNER_DRAWINGS'::text, 'CURRENT_LIABILITIES'::text, 'FIXED_LIABILITIES'::text, 'OWNER_CONTRIBUTIONS'::text, 'EQUITY'::text])))),
    CONSTRAINT accounts_category_by_kind_check CHECK ((((company_kind = 'CORPORATION'::text) AND (COALESCE(bs_category, ''::text) <> ALL (ARRAY['OWNER_DRAWINGS'::text, 'OWNER_CONTRIBUTIONS'::text])) AND (COALESCE(pl_category, ''::text) <> ALL (ARRAY['RESERVE_REVERSAL'::text, 'RESERVE_PROVISION'::text]))) OR ((company_kind = 'INDIVIDUAL'::text) AND (COALESCE(pl_category, ''::text) <> ALL (ARRAY['NON_OP_INCOME'::text, 'NON_OP_EXPENSE'::text, 'EXTRA_INCOME'::text, 'EXTRA_LOSS'::text, 'TAX'::text]))))),
    CONSTRAINT accounts_category_by_type_check CHECK ((((bs_category IS NULL) OR (((type = 'ASSET'::text) AND (bs_category = ANY (ARRAY['CURRENT_ASSETS'::text, 'FIXED_ASSETS'::text, 'DEFERRED_ASSETS'::text, 'OWNER_DRAWINGS'::text]))) OR ((type = 'LIABILITY'::text) AND (bs_category = ANY (ARRAY['CURRENT_LIABILITIES'::text, 'FIXED_LIABILITIES'::text, 'OWNER_CONTRIBUTIONS'::text]))) OR ((type = 'EQUITY'::text) AND (bs_category = 'EQUITY'::text)))) AND ((pl_category IS NULL) OR (((type = 'REVENUE'::text) AND (pl_category = ANY (ARRAY['REVENUE'::text, 'NON_OP_INCOME'::text, 'EXTRA_INCOME'::text, 'RESERVE_REVERSAL'::text]))) OR ((type = 'EXPENSE'::text) AND (pl_category = ANY (ARRAY['COGS'::text, 'SGA'::text, 'NON_OP_EXPENSE'::text, 'EXTRA_LOSS'::text, 'TAX'::text, 'RESERVE_PROVISION'::text]))))))),
    CONSTRAINT accounts_default_tax_code_check CHECK (((default_tax_code IS NULL) OR (default_tax_code = ANY (ARRAY['NONE'::text, 'SALES'::text, 'SALES_RETURN'::text, 'PURCHASE'::text, 'PURCHASE_RETURN'::text, 'NON_TAXABLE_SALES'::text])))),
    CONSTRAINT accounts_pl_category_check CHECK (((pl_category IS NULL) OR (pl_category = ANY (ARRAY['REVENUE'::text, 'NON_OP_INCOME'::text, 'EXTRA_INCOME'::text, 'RESERVE_REVERSAL'::text, 'COGS'::text, 'SGA'::text, 'NON_OP_EXPENSE'::text, 'EXTRA_LOSS'::text, 'TAX'::text, 'RESERVE_PROVISION'::text])))),
    CONSTRAINT accounts_type_check CHECK ((type = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text, 'EQUITY'::text, 'REVENUE'::text, 'EXPENSE'::text])))
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    tax_method text DEFAULT 'EXEMPT'::text NOT NULL,
    carry_forward_account_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    CONSTRAINT companies_kind_check CHECK ((kind = ANY (ARRAY['CORPORATION'::text, 'INDIVIDUAL'::text]))),
    CONSTRAINT companies_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT companies_tax_method_check CHECK ((tax_method = ANY (ARRAY['EXEMPT'::text, 'SIMPLE'::text, 'STANDARD_INDIVIDUAL'::text, 'STANDARD_PROPORTIONAL'::text])))
);


--
-- Name: fiscal_period_close_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_period_close_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    period_id uuid NOT NULL,
    action text NOT NULL,
    memo text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fiscal_period_close_logs_action_check CHECK ((action = ANY (ARRAY['CLOSE'::text, 'REOPEN'::text])))
);


--
-- Name: fiscal_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    company_id uuid NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT fiscal_periods_date_order CHECK ((start_date <= end_date))
);


--
-- Name: import_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_staging (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    raw_date text,
    raw_debit_amount numeric(15,2),
    raw_credit_amount numeric(15,2),
    raw_description text,
    predicted_account_id uuid,
    counter_account_id uuid,
    is_processed boolean DEFAULT false,
    raw_debit_account text,
    raw_debit_sub_account text,
    raw_debit_tax_code text,
    raw_credit_account text,
    raw_credit_sub_account text,
    raw_credit_tax_code text,
    debit_sub_account_id uuid,
    credit_sub_account_id uuid,
    debit_tax_code_id text,
    credit_tax_code_id text,
    parse_warnings text[],
    company_id uuid NOT NULL
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_id uuid NOT NULL,
    date date NOT NULL,
    description text NOT NULL,
    reference_number integer,
    is_opening_balance boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    supplement text,
    company_id uuid NOT NULL,
    CONSTRAINT journal_entries_reference_number_range CHECK (((reference_number >= 1) AND (reference_number <= 999999999)))
);


--
-- Name: journal_entry_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entry_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    action text NOT NULL,
    changed_at timestamp with time zone DEFAULT now(),
    changed_by text DEFAULT 'user'::text,
    before_data jsonb NOT NULL,
    CONSTRAINT journal_entry_logs_action_check CHECK ((action = ANY (ARRAY['UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: journal_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    line_number integer NOT NULL,
    side text NOT NULL,
    account_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    tax_code text,
    description text,
    company_id uuid NOT NULL,
    CONSTRAINT journal_lines_amount_positive CHECK (((amount > (0)::numeric) AND (amount <> 'NaN'::numeric))),
    CONSTRAINT journal_lines_side_check CHECK ((side = ANY (ARRAY['DEBIT'::text, 'CREDIT'::text])))
);


--
-- Name: journal_template_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_template_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    line_number integer NOT NULL,
    side text NOT NULL,
    account_id uuid,
    amount numeric,
    tax_code text,
    description text,
    company_id uuid NOT NULL,
    CONSTRAINT journal_template_lines_side_check CHECK ((side = ANY (ARRAY['DEBIT'::text, 'CREDIT'::text])))
);


--
-- Name: journal_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    default_description text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid NOT NULL
);


--
-- Name: ledger_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ledger_view AS
 SELECT jl.id,
    jl.entry_id,
    jl.line_number,
    jl.side,
    jl.account_id,
    jl.amount,
    jl.tax_code,
    jl.description AS line_description,
    je.date,
    je.description AS entry_description,
    je.reference_number,
    je.period_id,
    je.is_opening_balance,
        CASE
            WHEN (( SELECT count(DISTINCT opp.id) AS count
               FROM public.journal_lines opp
              WHERE ((opp.entry_id = jl.entry_id) AND (opp.side <> jl.side))) = 1) THEN ( SELECT ac.name
               FROM (public.journal_lines opp
                 JOIN public.accounts ac ON ((opp.account_id = ac.id)))
              WHERE ((opp.entry_id = jl.entry_id) AND (opp.side <> jl.side))
             LIMIT 1)
            ELSE (( SELECT ac.name
               FROM (public.journal_lines opp
                 JOIN public.accounts ac ON ((opp.account_id = ac.id)))
              WHERE ((opp.entry_id = jl.entry_id) AND (opp.side <> jl.side))
              ORDER BY opp.line_number
             LIMIT 1) || ' ほか'::text)
        END AS counter_account_name
   FROM (public.journal_lines jl
     JOIN public.journal_entries je ON ((jl.entry_id = je.id)));


--
-- Name: mapping_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mapping_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    keyword text NOT NULL,
    account_id uuid NOT NULL,
    priority integer DEFAULT 0,
    company_id uuid NOT NULL
);


--
-- Name: period_opening_balance_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.period_opening_balance_lines (
    period_id uuid NOT NULL,
    account_id uuid NOT NULL,
    company_id uuid NOT NULL,
    balance numeric(15,2) NOT NULL,
    CONSTRAINT period_opening_balance_lines_balance_check CHECK (((balance <> (0)::numeric) AND (balance <> 'NaN'::numeric)))
);


--
-- Name: period_opening_balance_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.period_opening_balance_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    period_id uuid NOT NULL,
    action text NOT NULL,
    before_data jsonb,
    after_data jsonb,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT period_opening_balance_logs_action_check CHECK ((action = ANY (ARRAY['SET'::text, 'CLEAR'::text])))
);


--
-- Name: period_opening_balance_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.period_opening_balance_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    period_id uuid NOT NULL,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key text NOT NULL,
    value text NOT NULL
);


--
-- Name: tax_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_codes (
    id text NOT NULL,
    name text NOT NULL,
    short_name text,
    search_key text,
    tax_type text NOT NULL,
    rate numeric(6,4),
    applies_to text[] DEFAULT '{ALL}'::text[] NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT tax_codes_tax_type_check CHECK ((tax_type = ANY (ARRAY['SALES'::text, 'PURCHASE'::text, 'BOTH'::text, 'NONE'::text])))
);


--
-- Name: account_aliases account_aliases_account_id_normalized_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_aliases
    ADD CONSTRAINT account_aliases_account_id_normalized_alias_key UNIQUE (account_id, normalized_alias);


--
-- Name: account_aliases account_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_aliases
    ADD CONSTRAINT account_aliases_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_company_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_company_code_key UNIQUE (company_id, code);


--
-- Name: accounts accounts_id_company_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_id_company_key UNIQUE (id, company_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: companies companies_id_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_id_kind_key UNIQUE (id, kind);


--
-- Name: companies companies_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_name_key UNIQUE (name);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: fiscal_period_close_logs fiscal_period_close_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_period_close_logs
    ADD CONSTRAINT fiscal_period_close_logs_pkey PRIMARY KEY (id);


--
-- Name: fiscal_periods fiscal_periods_id_company_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_id_company_key UNIQUE (id, company_id);


--
-- Name: fiscal_periods fiscal_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_pkey PRIMARY KEY (id);


--
-- Name: import_staging import_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_id_company_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_id_company_key UNIQUE (id, company_id);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_entry_logs journal_entry_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_logs
    ADD CONSTRAINT journal_entry_logs_pkey PRIMARY KEY (id);


--
-- Name: journal_lines journal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id);


--
-- Name: journal_template_lines journal_template_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_template_lines
    ADD CONSTRAINT journal_template_lines_pkey PRIMARY KEY (id);


--
-- Name: journal_template_lines journal_template_lines_template_id_line_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_template_lines
    ADD CONSTRAINT journal_template_lines_template_id_line_number_key UNIQUE (template_id, line_number);


--
-- Name: journal_templates journal_templates_id_company_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_templates
    ADD CONSTRAINT journal_templates_id_company_key UNIQUE (id, company_id);


--
-- Name: journal_templates journal_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_templates
    ADD CONSTRAINT journal_templates_pkey PRIMARY KEY (id);


--
-- Name: mapping_rules mapping_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mapping_rules
    ADD CONSTRAINT mapping_rules_pkey PRIMARY KEY (id);


--
-- Name: period_opening_balance_lines period_opening_balance_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_lines
    ADD CONSTRAINT period_opening_balance_lines_pkey PRIMARY KEY (period_id, account_id);


--
-- Name: period_opening_balance_logs period_opening_balance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_logs
    ADD CONSTRAINT period_opening_balance_logs_pkey PRIMARY KEY (id);


--
-- Name: period_opening_balance_sets period_opening_balance_sets_period_company_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_sets
    ADD CONSTRAINT period_opening_balance_sets_period_company_key UNIQUE (period_id, company_id);


--
-- Name: period_opening_balance_sets period_opening_balance_sets_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_sets
    ADD CONSTRAINT period_opening_balance_sets_period_key UNIQUE (period_id);


--
-- Name: period_opening_balance_sets period_opening_balance_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_sets
    ADD CONSTRAINT period_opening_balance_sets_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: tax_codes tax_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_codes
    ADD CONSTRAINT tax_codes_pkey PRIMARY KEY (id);


--
-- Name: fiscal_period_close_logs_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiscal_period_close_logs_period_idx ON public.fiscal_period_close_logs USING btree (period_id, changed_at);


--
-- Name: idx_account_aliases_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_aliases_account_id ON public.account_aliases USING btree (account_id);


--
-- Name: idx_account_aliases_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_aliases_normalized ON public.account_aliases USING btree (normalized_alias);


--
-- Name: idx_fiscal_periods_single_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_fiscal_periods_single_current ON public.fiscal_periods USING btree (company_id) WHERE (is_current = true);


--
-- Name: idx_journal_entries_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_date ON public.journal_entries USING btree (date);


--
-- Name: idx_journal_entries_period_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_period_company ON public.journal_entries USING btree (period_id, company_id);


--
-- Name: idx_journal_entry_logs_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entry_logs_changed_at ON public.journal_entry_logs USING btree (changed_at);


--
-- Name: idx_journal_entry_logs_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entry_logs_entry_id ON public.journal_entry_logs USING btree (entry_id);


--
-- Name: idx_journal_lines_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_lines_account_id ON public.journal_lines USING btree (account_id);


--
-- Name: idx_journal_lines_amount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_lines_amount ON public.journal_lines USING btree (amount);


--
-- Name: idx_journal_lines_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_lines_entry_id ON public.journal_lines USING btree (entry_id);


--
-- Name: period_opening_balance_logs_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX period_opening_balance_logs_period_idx ON public.period_opening_balance_logs USING btree (period_id, changed_at);


--
-- Name: uq_journal_entries_period_reference_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_journal_entries_period_reference_number ON public.journal_entries USING btree (period_id, reference_number) WHERE (reference_number IS NOT NULL);


--
-- Name: accounts trg_accounts_a_fill_company_kind; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_a_fill_company_kind BEFORE INSERT OR UPDATE OF company_id ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.fill_account_company_kind();


--
-- Name: accounts trg_accounts_b_inherit_parent; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_b_inherit_parent BEFORE INSERT OR UPDATE OF parent_id, type, bs_category, pl_category ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.inherit_parent_account_attrs();


--
-- Name: accounts trg_accounts_c_guard_opening_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_c_guard_opening_lines BEFORE UPDATE OF type, bs_category, parent_id ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_opening_balance_line_accounts();


--
-- Name: accounts trg_accounts_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_company_immutable BEFORE UPDATE OF company_id ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: accounts trg_accounts_d_guard_closed_periods; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_d_guard_closed_periods BEFORE UPDATE OF type, bs_category, pl_category, parent_id ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_account_in_closed_periods();


--
-- Name: accounts trg_accounts_guard_carry_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_guard_carry_forward BEFORE UPDATE OF type, bs_category, parent_id ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_carry_forward_account();


--
-- Name: accounts trg_accounts_propagate_to_children; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_propagate_to_children AFTER UPDATE OF type, bs_category, pl_category ON public.accounts FOR EACH ROW WHEN ((new.parent_id IS NULL)) EXECUTE FUNCTION public.propagate_parent_account_attrs();


--
-- Name: companies trg_companies_check_carry_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_check_carry_forward BEFORE INSERT OR UPDATE OF carry_forward_account_id ON public.companies FOR EACH ROW EXECUTE FUNCTION public.check_company_carry_forward();


--
-- Name: companies trg_companies_guard_closed_carry_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_guard_closed_carry_forward BEFORE UPDATE OF carry_forward_account_id ON public.companies FOR EACH ROW EXECUTE FUNCTION public.guard_closed_carry_forward();


--
-- Name: companies trg_companies_kind_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_kind_immutable BEFORE UPDATE OF kind ON public.companies FOR EACH ROW EXECUTE FUNCTION public.forbid_company_kind_change();


--
-- Name: fiscal_periods trg_fiscal_periods_check_entries; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fiscal_periods_check_entries BEFORE UPDATE OF start_date, end_date ON public.fiscal_periods FOR EACH ROW EXECUTE FUNCTION public.check_fiscal_period_entries();


--
-- Name: fiscal_periods trg_fiscal_periods_close_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fiscal_periods_close_state BEFORE UPDATE OF closed_at ON public.fiscal_periods FOR EACH ROW EXECUTE FUNCTION public.guard_period_close_state();


--
-- Name: fiscal_periods trg_fiscal_periods_closed_dates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fiscal_periods_closed_dates BEFORE UPDATE OF start_date, end_date ON public.fiscal_periods FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_period_dates();


--
-- Name: fiscal_periods trg_fiscal_periods_closed_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fiscal_periods_closed_delete BEFORE DELETE ON public.fiscal_periods FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_period_delete();


--
-- Name: fiscal_periods trg_fiscal_periods_closed_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fiscal_periods_closed_insert BEFORE INSERT ON public.fiscal_periods FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_period_insert();


--
-- Name: fiscal_periods trg_fiscal_periods_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fiscal_periods_company_immutable BEFORE UPDATE OF company_id ON public.fiscal_periods FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: import_staging trg_import_staging_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_import_staging_company_immutable BEFORE UPDATE OF company_id ON public.import_staging FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: journal_entries trg_journal_entries_a_fill_company; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_entries_a_fill_company BEFORE INSERT ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.fill_journal_entry_company();


--
-- Name: journal_entries trg_journal_entries_balance; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_journal_entries_balance AFTER INSERT ON public.journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_journal_entry_balance();


--
-- Name: journal_entries trg_journal_entries_check_period; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_entries_check_period BEFORE INSERT OR UPDATE OF date, period_id ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.check_journal_entry_period();


--
-- Name: journal_entries trg_journal_entries_closed_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_entries_closed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period_journal_entry();


--
-- Name: journal_entries trg_journal_entries_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_entries_company_immutable BEFORE UPDATE OF company_id ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: journal_entries trg_journal_entry_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_entry_changes BEFORE DELETE OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.log_journal_entry_changes();


--
-- Name: journal_lines trg_journal_lines_a_fill_company; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_lines_a_fill_company BEFORE INSERT ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.fill_journal_line_company();


--
-- Name: journal_lines trg_journal_lines_balance; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_journal_lines_balance AFTER INSERT OR DELETE OR UPDATE ON public.journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_journal_entry_balance();


--
-- Name: journal_lines trg_journal_lines_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_lines_company_immutable BEFORE UPDATE OF company_id ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: journal_lines trg_journal_lines_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_lines_guard BEFORE INSERT OR DELETE OR UPDATE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.guard_journal_line_change();


--
-- Name: journal_lines trg_journal_lines_z_closed_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_lines_z_closed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period_journal_line();


--
-- Name: journal_template_lines trg_journal_template_lines_a_fill_company; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_template_lines_a_fill_company BEFORE INSERT ON public.journal_template_lines FOR EACH ROW EXECUTE FUNCTION public.fill_template_line_company();


--
-- Name: journal_template_lines trg_journal_template_lines_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_template_lines_company_immutable BEFORE UPDATE OF company_id ON public.journal_template_lines FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: journal_templates trg_journal_templates_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_templates_company_immutable BEFORE UPDATE OF company_id ON public.journal_templates FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: journal_lines trg_lines_changes_bump_parent; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lines_changes_bump_parent AFTER INSERT OR DELETE OR UPDATE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.bump_parent_entry_updated_at();


--
-- Name: mapping_rules trg_mapping_rules_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mapping_rules_company_immutable BEFORE UPDATE OF company_id ON public.mapping_rules FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: period_opening_balance_lines trg_pob_lines_a_fill_company; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_lines_a_fill_company BEFORE INSERT ON public.period_opening_balance_lines FOR EACH ROW EXECUTE FUNCTION public.fill_opening_balance_company();


--
-- Name: period_opening_balance_lines trg_pob_lines_balanced; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_pob_lines_balanced AFTER INSERT OR DELETE OR UPDATE ON public.period_opening_balance_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_opening_balance_set_balanced();


--
-- Name: period_opening_balance_lines trg_pob_lines_check_account; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_lines_check_account BEFORE INSERT OR UPDATE OF account_id ON public.period_opening_balance_lines FOR EACH ROW EXECUTE FUNCTION public.check_opening_balance_line_account();


--
-- Name: period_opening_balance_lines trg_pob_lines_closed_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_lines_closed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.period_opening_balance_lines FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period_opening_balance();


--
-- Name: period_opening_balance_lines trg_pob_lines_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_lines_company_immutable BEFORE UPDATE OF company_id ON public.period_opening_balance_lines FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: period_opening_balance_lines trg_pob_lines_period_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_lines_period_immutable BEFORE UPDATE OF period_id ON public.period_opening_balance_lines FOR EACH ROW EXECUTE FUNCTION public.forbid_opening_balance_period_change();


--
-- Name: period_opening_balance_logs trg_pob_logs_a_fill_company; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_logs_a_fill_company BEFORE INSERT ON public.period_opening_balance_logs FOR EACH ROW EXECUTE FUNCTION public.fill_opening_balance_company();


--
-- Name: period_opening_balance_logs trg_pob_logs_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_logs_company_immutable BEFORE UPDATE OF company_id ON public.period_opening_balance_logs FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: period_opening_balance_sets trg_pob_sets_a_fill_company; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_sets_a_fill_company BEFORE INSERT ON public.period_opening_balance_sets FOR EACH ROW EXECUTE FUNCTION public.fill_opening_balance_company();


--
-- Name: period_opening_balance_sets trg_pob_sets_closed_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_sets_closed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.period_opening_balance_sets FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period_opening_balance();


--
-- Name: period_opening_balance_sets trg_pob_sets_company_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_sets_company_immutable BEFORE UPDATE OF company_id ON public.period_opening_balance_sets FOR EACH ROW EXECUTE FUNCTION public.forbid_company_id_change();


--
-- Name: period_opening_balance_sets trg_pob_sets_period_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pob_sets_period_immutable BEFORE UPDATE OF period_id ON public.period_opening_balance_sets FOR EACH ROW EXECUTE FUNCTION public.forbid_opening_balance_period_change();


--
-- Name: account_aliases account_aliases_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_aliases
    ADD CONSTRAINT account_aliases_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: accounts accounts_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_company_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: accounts accounts_company_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_company_kind_fkey FOREIGN KEY (company_id, company_kind) REFERENCES public.companies(id, kind);


--
-- Name: accounts accounts_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_id_fkey FOREIGN KEY (parent_id, company_id) REFERENCES public.accounts(id, company_id);


--
-- Name: companies companies_carry_forward_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_carry_forward_fkey FOREIGN KEY (carry_forward_account_id, id) REFERENCES public.accounts(id, company_id);


--
-- Name: fiscal_period_close_logs fiscal_period_close_logs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_period_close_logs
    ADD CONSTRAINT fiscal_period_close_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: fiscal_periods fiscal_periods_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_company_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: import_staging import_staging_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_company_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: import_staging import_staging_counter_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_counter_account_id_fkey FOREIGN KEY (counter_account_id, company_id) REFERENCES public.accounts(id, company_id);


--
-- Name: import_staging import_staging_credit_sub_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_credit_sub_account_id_fkey FOREIGN KEY (credit_sub_account_id, company_id) REFERENCES public.accounts(id, company_id) ON DELETE SET NULL (credit_sub_account_id);


--
-- Name: import_staging import_staging_credit_tax_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_credit_tax_code_id_fkey FOREIGN KEY (credit_tax_code_id) REFERENCES public.tax_codes(id) ON DELETE SET NULL;


--
-- Name: import_staging import_staging_debit_sub_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_debit_sub_account_id_fkey FOREIGN KEY (debit_sub_account_id, company_id) REFERENCES public.accounts(id, company_id) ON DELETE SET NULL (debit_sub_account_id);


--
-- Name: import_staging import_staging_debit_tax_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_debit_tax_code_id_fkey FOREIGN KEY (debit_tax_code_id) REFERENCES public.tax_codes(id) ON DELETE SET NULL;


--
-- Name: import_staging import_staging_predicted_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_predicted_account_id_fkey FOREIGN KEY (predicted_account_id, company_id) REFERENCES public.accounts(id, company_id);


--
-- Name: journal_entries journal_entries_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_period_id_fkey FOREIGN KEY (period_id, company_id) REFERENCES public.fiscal_periods(id, company_id);


--
-- Name: journal_lines journal_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_account_id_fkey FOREIGN KEY (account_id, company_id) REFERENCES public.accounts(id, company_id);


--
-- Name: journal_lines journal_lines_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_entry_id_fkey FOREIGN KEY (entry_id, company_id) REFERENCES public.journal_entries(id, company_id) ON DELETE CASCADE;


--
-- Name: journal_template_lines journal_template_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_template_lines
    ADD CONSTRAINT journal_template_lines_account_id_fkey FOREIGN KEY (account_id, company_id) REFERENCES public.accounts(id, company_id) ON DELETE SET NULL (account_id);


--
-- Name: journal_template_lines journal_template_lines_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_template_lines
    ADD CONSTRAINT journal_template_lines_template_id_fkey FOREIGN KEY (template_id, company_id) REFERENCES public.journal_templates(id, company_id) ON DELETE CASCADE;


--
-- Name: journal_templates journal_templates_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_templates
    ADD CONSTRAINT journal_templates_company_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: mapping_rules mapping_rules_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mapping_rules
    ADD CONSTRAINT mapping_rules_account_id_fkey FOREIGN KEY (account_id, company_id) REFERENCES public.accounts(id, company_id);


--
-- Name: mapping_rules mapping_rules_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mapping_rules
    ADD CONSTRAINT mapping_rules_company_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: period_opening_balance_lines period_opening_balance_lines_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_lines
    ADD CONSTRAINT period_opening_balance_lines_account_fkey FOREIGN KEY (account_id, company_id) REFERENCES public.accounts(id, company_id);


--
-- Name: period_opening_balance_lines period_opening_balance_lines_set_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_lines
    ADD CONSTRAINT period_opening_balance_lines_set_fkey FOREIGN KEY (period_id, company_id) REFERENCES public.period_opening_balance_sets(period_id, company_id) ON DELETE CASCADE;


--
-- Name: period_opening_balance_logs period_opening_balance_logs_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_logs
    ADD CONSTRAINT period_opening_balance_logs_company_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: period_opening_balance_sets period_opening_balance_sets_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_sets
    ADD CONSTRAINT period_opening_balance_sets_company_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: period_opening_balance_sets period_opening_balance_sets_period_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_opening_balance_sets
    ADD CONSTRAINT period_opening_balance_sets_period_fkey FOREIGN KEY (period_id, company_id) REFERENCES public.fiscal_periods(id, company_id);


--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts allow_all_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_accounts ON public.accounts USING (true) WITH CHECK (true);


--
-- Name: companies allow_all_companies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_companies ON public.companies USING (true) WITH CHECK (true);


--
-- Name: fiscal_periods allow_all_fiscal_periods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_fiscal_periods ON public.fiscal_periods USING (true) WITH CHECK (true);


--
-- Name: import_staging allow_all_import_staging; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_import_staging ON public.import_staging USING (true) WITH CHECK (true);


--
-- Name: journal_entries allow_all_journal_entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_journal_entries ON public.journal_entries USING (true) WITH CHECK (true);


--
-- Name: journal_lines allow_all_journal_lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_journal_lines ON public.journal_lines USING (true) WITH CHECK (true);


--
-- Name: mapping_rules allow_all_mapping_rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_mapping_rules ON public.mapping_rules USING (true) WITH CHECK (true);


--
-- Name: period_opening_balance_lines allow_all_period_opening_balance_lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_period_opening_balance_lines ON public.period_opening_balance_lines USING (true) WITH CHECK (true);


--
-- Name: period_opening_balance_sets allow_all_period_opening_balance_sets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_period_opening_balance_sets ON public.period_opening_balance_sets USING (true) WITH CHECK (true);


--
-- Name: fiscal_period_close_logs allow_insert_fiscal_period_close_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_fiscal_period_close_logs ON public.fiscal_period_close_logs FOR INSERT WITH CHECK (true);


--
-- Name: journal_entry_logs allow_insert_journal_entry_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_journal_entry_logs ON public.journal_entry_logs FOR INSERT WITH CHECK (true);


--
-- Name: period_opening_balance_logs allow_insert_period_opening_balance_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_period_opening_balance_logs ON public.period_opening_balance_logs FOR INSERT WITH CHECK (true);


--
-- Name: fiscal_period_close_logs allow_select_fiscal_period_close_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_select_fiscal_period_close_logs ON public.fiscal_period_close_logs FOR SELECT USING (true);


--
-- Name: journal_entry_logs allow_select_journal_entry_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_select_journal_entry_logs ON public.journal_entry_logs FOR SELECT USING (true);


--
-- Name: period_opening_balance_logs allow_select_period_opening_balance_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_select_period_opening_balance_logs ON public.period_opening_balance_logs FOR SELECT USING (true);


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: fiscal_period_close_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fiscal_period_close_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: fiscal_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: import_staging; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_staging ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entry_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entry_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: mapping_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mapping_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: period_opening_balance_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.period_opening_balance_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: period_opening_balance_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.period_opening_balance_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: period_opening_balance_sets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.period_opening_balance_sets ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION check_company_carry_forward(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_company_carry_forward() FROM PUBLIC;


--
-- Name: FUNCTION check_fiscal_period_entries(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_fiscal_period_entries() FROM PUBLIC;


--
-- Name: FUNCTION check_journal_entry_balance(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_journal_entry_balance() FROM PUBLIC;


--
-- Name: FUNCTION check_journal_entry_period(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_journal_entry_period() FROM PUBLIC;


--
-- Name: FUNCTION check_opening_balance_line_account(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_opening_balance_line_account() FROM PUBLIC;


--
-- Name: FUNCTION check_opening_balance_set_balanced(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_opening_balance_set_balanced() FROM PUBLIC;


--
-- Name: FUNCTION check_reference_number(p_period_id uuid, p_reference_number integer, p_exclude_entry_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_reference_number(p_period_id uuid, p_reference_number integer, p_exclude_entry_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_reference_number(p_period_id uuid, p_reference_number integer, p_exclude_entry_id uuid) TO anon;
GRANT ALL ON FUNCTION public.check_reference_number(p_period_id uuid, p_reference_number integer, p_exclude_entry_id uuid) TO authenticated;


--
-- Name: FUNCTION clear_period_opening_balances(p_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clear_period_opening_balances(p_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_period_opening_balances(p_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.clear_period_opening_balances(p_period_id uuid) TO authenticated;


--
-- Name: FUNCTION close_fiscal_period(p_period_id uuid, p_memo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.close_fiscal_period(p_period_id uuid, p_memo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_fiscal_period(p_period_id uuid, p_memo text) TO anon;
GRANT ALL ON FUNCTION public.close_fiscal_period(p_period_id uuid, p_memo text) TO authenticated;


--
-- Name: FUNCTION company_seed_accounts(p_kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.company_seed_accounts(p_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.company_seed_accounts(p_kind text) TO anon;
GRANT ALL ON FUNCTION public.company_seed_accounts(p_kind text) TO authenticated;


--
-- Name: FUNCTION create_company(p_name text, p_kind text, p_tax_method text, p_start_date date, p_end_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_company(p_name text, p_kind text, p_tax_method text, p_start_date date, p_end_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_company(p_name text, p_kind text, p_tax_method text, p_start_date date, p_end_date date) TO anon;
GRANT ALL ON FUNCTION public.create_company(p_name text, p_kind text, p_tax_method text, p_start_date date, p_end_date date) TO authenticated;


--
-- Name: FUNCTION create_journal_entry(p_period_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_journal_entry(p_period_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_journal_entry(p_period_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text) TO anon;
GRANT ALL ON FUNCTION public.create_journal_entry(p_period_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text) TO authenticated;


--
-- Name: FUNCTION fill_account_company_kind(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fill_account_company_kind() FROM PUBLIC;


--
-- Name: FUNCTION fill_journal_entry_company(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fill_journal_entry_company() FROM PUBLIC;


--
-- Name: FUNCTION fill_journal_line_company(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fill_journal_line_company() FROM PUBLIC;


--
-- Name: FUNCTION fill_opening_balance_company(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fill_opening_balance_company() FROM PUBLIC;


--
-- Name: FUNCTION fill_template_line_company(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fill_template_line_company() FROM PUBLIC;


--
-- Name: FUNCTION forbid_company_id_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.forbid_company_id_change() FROM PUBLIC;


--
-- Name: FUNCTION forbid_company_kind_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.forbid_company_kind_change() FROM PUBLIC;


--
-- Name: FUNCTION forbid_opening_balance_period_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.forbid_opening_balance_period_change() FROM PUBLIC;


--
-- Name: FUNCTION get_derived_opening_balances_for_period(target_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_derived_opening_balances_for_period(target_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_derived_opening_balances_for_period(target_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_derived_opening_balances_for_period(target_period_id uuid) TO authenticated;


--
-- Name: FUNCTION get_opening_balances_for_period(target_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_opening_balances_for_period(target_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_opening_balances_for_period(target_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_opening_balances_for_period(target_period_id uuid) TO authenticated;


--
-- Name: FUNCTION get_period_close_check(p_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_period_close_check(p_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_period_close_check(p_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_period_close_check(p_period_id uuid) TO authenticated;


--
-- Name: FUNCTION get_pl_data(target_period_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_pl_data(target_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_pl_data(target_period_id uuid) TO authenticated;


--
-- Name: FUNCTION guard_account_in_closed_periods(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_account_in_closed_periods() FROM PUBLIC;


--
-- Name: FUNCTION guard_carry_forward_account(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_carry_forward_account() FROM PUBLIC;


--
-- Name: FUNCTION guard_closed_carry_forward(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_closed_carry_forward() FROM PUBLIC;


--
-- Name: FUNCTION guard_closed_period_journal_entry(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_closed_period_journal_entry() FROM PUBLIC;


--
-- Name: FUNCTION guard_closed_period_journal_line(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_closed_period_journal_line() FROM PUBLIC;


--
-- Name: FUNCTION guard_closed_period_opening_balance(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_closed_period_opening_balance() FROM PUBLIC;


--
-- Name: FUNCTION guard_fiscal_period_dates(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_fiscal_period_dates() FROM PUBLIC;


--
-- Name: FUNCTION guard_fiscal_period_delete(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_fiscal_period_delete() FROM PUBLIC;


--
-- Name: FUNCTION guard_fiscal_period_insert(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_fiscal_period_insert() FROM PUBLIC;


--
-- Name: FUNCTION guard_journal_line_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_journal_line_change() FROM PUBLIC;


--
-- Name: FUNCTION guard_opening_balance_line_accounts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_opening_balance_line_accounts() FROM PUBLIC;


--
-- Name: FUNCTION guard_period_close_state(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_period_close_state() FROM PUBLIC;


--
-- Name: FUNCTION guard_period_range(p_company_id uuid, p_period_id uuid, p_start date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_period_range(p_company_id uuid, p_period_id uuid, p_start date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_period_range(p_company_id uuid, p_period_id uuid, p_start date) TO anon;
GRANT ALL ON FUNCTION public.guard_period_range(p_company_id uuid, p_period_id uuid, p_start date) TO authenticated;


--
-- Name: FUNCTION import_staging_entries(p_period_id uuid, p_staging_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.import_staging_entries(p_period_id uuid, p_staging_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.import_staging_entries(p_period_id uuid, p_staging_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.import_staging_entries(p_period_id uuid, p_staging_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION inherit_parent_account_attrs(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.inherit_parent_account_attrs() FROM PUBLIC;


--
-- Name: FUNCTION insert_journal_lines(p_entry_id uuid, p_lines jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.insert_journal_lines(p_entry_id uuid, p_lines jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.insert_journal_lines(p_entry_id uuid, p_lines jsonb) TO anon;
GRANT ALL ON FUNCTION public.insert_journal_lines(p_entry_id uuid, p_lines jsonb) TO authenticated;


--
-- Name: FUNCTION lock_period_for_numbering(p_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lock_period_for_numbering(p_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lock_period_for_numbering(p_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.lock_period_for_numbering(p_period_id uuid) TO authenticated;


--
-- Name: FUNCTION next_reference_number(p_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.next_reference_number(p_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.next_reference_number(p_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.next_reference_number(p_period_id uuid) TO authenticated;


--
-- Name: FUNCTION opening_balance_account_ok(p_type text, p_bs_category text, p_company_kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.opening_balance_account_ok(p_type text, p_bs_category text, p_company_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opening_balance_account_ok(p_type text, p_bs_category text, p_company_kind text) TO anon;
GRANT ALL ON FUNCTION public.opening_balance_account_ok(p_type text, p_bs_category text, p_company_kind text) TO authenticated;


--
-- Name: FUNCTION period_assert_open(p_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.period_assert_open(p_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.period_assert_open(p_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.period_assert_open(p_period_id uuid) TO authenticated;


--
-- Name: FUNCTION period_carry_forward_amount(p_company_id uuid, p_target_start date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.period_carry_forward_amount(p_company_id uuid, p_target_start date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.period_carry_forward_amount(p_company_id uuid, p_target_start date) TO anon;
GRANT ALL ON FUNCTION public.period_carry_forward_amount(p_company_id uuid, p_target_start date) TO authenticated;


--
-- Name: FUNCTION period_close_errors(p_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.period_close_errors(p_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.period_close_errors(p_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.period_close_errors(p_period_id uuid) TO authenticated;


--
-- Name: FUNCTION period_close_prev_open(p_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.period_close_prev_open(p_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.period_close_prev_open(p_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.period_close_prev_open(p_period_id uuid) TO authenticated;


--
-- Name: FUNCTION period_close_warnings(p_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.period_close_warnings(p_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.period_close_warnings(p_period_id uuid) TO anon;
GRANT ALL ON FUNCTION public.period_close_warnings(p_period_id uuid) TO authenticated;


--
-- Name: FUNCTION period_lock_company(p_company_id uuid, p_exclusive boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.period_lock_company(p_company_id uuid, p_exclusive boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.period_lock_company(p_company_id uuid, p_exclusive boolean) TO anon;
GRANT ALL ON FUNCTION public.period_lock_company(p_company_id uuid, p_exclusive boolean) TO authenticated;


--
-- Name: FUNCTION propagate_parent_account_attrs(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.propagate_parent_account_attrs() FROM PUBLIC;


--
-- Name: FUNCTION reopen_fiscal_period(p_period_id uuid, p_memo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reopen_fiscal_period(p_period_id uuid, p_memo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reopen_fiscal_period(p_period_id uuid, p_memo text) TO anon;
GRANT ALL ON FUNCTION public.reopen_fiscal_period(p_period_id uuid, p_memo text) TO authenticated;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION save_period_opening_balances(p_period_id uuid, p_lines jsonb, p_memo text, p_auto_balance boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_period_opening_balances(p_period_id uuid, p_lines jsonb, p_memo text, p_auto_balance boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_period_opening_balances(p_period_id uuid, p_lines jsonb, p_memo text, p_auto_balance boolean) TO anon;
GRANT ALL ON FUNCTION public.save_period_opening_balances(p_period_id uuid, p_lines jsonb, p_memo text, p_auto_balance boolean) TO authenticated;


--
-- Name: FUNCTION update_journal_entry(p_entry_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_journal_entry(p_entry_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_journal_entry(p_entry_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text) TO anon;
GRANT ALL ON FUNCTION public.update_journal_entry(p_entry_id uuid, p_date date, p_description text, p_reference_number integer, p_lines jsonb, p_supplement text) TO authenticated;


--
-- Name: FUNCTION validate_journal_lines(p_lines jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_journal_lines(p_lines jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.validate_journal_lines(p_lines jsonb) TO anon;
GRANT ALL ON FUNCTION public.validate_journal_lines(p_lines jsonb) TO authenticated;


--
-- Name: TABLE account_aliases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.account_aliases TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.account_aliases TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.account_aliases TO service_role;


--
-- Name: TABLE accounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.accounts TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.accounts TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.accounts TO service_role;


--
-- Name: COLUMN accounts.pl_category; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(pl_category) ON TABLE public.accounts TO anon;
GRANT SELECT(pl_category) ON TABLE public.accounts TO authenticated;


--
-- Name: COLUMN accounts.bs_category; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(bs_category) ON TABLE public.accounts TO anon;
GRANT SELECT(bs_category) ON TABLE public.accounts TO authenticated;


--
-- Name: TABLE companies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.companies TO anon;
GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.companies TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.companies TO service_role;


--
-- Name: TABLE fiscal_period_close_logs; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.fiscal_period_close_logs TO service_role;
GRANT SELECT,INSERT ON TABLE public.fiscal_period_close_logs TO anon;
GRANT SELECT,INSERT ON TABLE public.fiscal_period_close_logs TO authenticated;


--
-- Name: TABLE fiscal_periods; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.fiscal_periods TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.fiscal_periods TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.fiscal_periods TO service_role;


--
-- Name: TABLE import_staging; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.import_staging TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.import_staging TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.import_staging TO service_role;


--
-- Name: TABLE journal_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.journal_entries TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.journal_entries TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.journal_entries TO service_role;


--
-- Name: TABLE journal_entry_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN ON TABLE public.journal_entry_logs TO anon;
GRANT SELECT,INSERT,MAINTAIN ON TABLE public.journal_entry_logs TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.journal_entry_logs TO service_role;


--
-- Name: TABLE journal_lines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.journal_lines TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.journal_lines TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.journal_lines TO service_role;


--
-- Name: TABLE journal_template_lines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.journal_template_lines TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.journal_template_lines TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.journal_template_lines TO service_role;


--
-- Name: TABLE journal_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.journal_templates TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.journal_templates TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.journal_templates TO service_role;


--
-- Name: TABLE ledger_view; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.ledger_view TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.ledger_view TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.ledger_view TO service_role;


--
-- Name: TABLE mapping_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.mapping_rules TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.mapping_rules TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.mapping_rules TO service_role;


--
-- Name: TABLE period_opening_balance_lines; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.period_opening_balance_lines TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.period_opening_balance_lines TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.period_opening_balance_lines TO authenticated;


--
-- Name: TABLE period_opening_balance_logs; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.period_opening_balance_logs TO service_role;
GRANT SELECT,INSERT ON TABLE public.period_opening_balance_logs TO anon;
GRANT SELECT,INSERT ON TABLE public.period_opening_balance_logs TO authenticated;


--
-- Name: TABLE period_opening_balance_sets; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.period_opening_balance_sets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.period_opening_balance_sets TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.period_opening_balance_sets TO authenticated;


--
-- Name: TABLE system_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.system_settings TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.system_settings TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.system_settings TO service_role;


--
-- Name: TABLE tax_codes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.tax_codes TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.tax_codes TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.tax_codes TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--
