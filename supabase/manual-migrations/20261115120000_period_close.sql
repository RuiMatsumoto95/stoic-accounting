-- ステップ3: 年度の確定（締め）／ロック
-- 設計: claude/SA_step3_sql_design_v1.md（v1.1）。適用前に必ず pg_dump（public）を取得し、_period_close_apply.md の「適用前確認クエリ」を実行すること。
-- 既存のオブジェクト（保存RPC・期首残高RPC・導出関数・既存トリガー）は変更しない。
-- ロック順: 確定・解除・期間変更は「期の行 → 会社の advisory」。書き込み側は「仕訳行 → 期の FOR SHARE」（advisory は取らない）。
-- 各ブロック（-- ===== で区切る）は単独でも実行できる。Supabase SQL Editor では、ブロックごとに分けて実行してよい。

-- ===== 1. 列 =====
ALTER TABLE public.fiscal_periods ADD COLUMN IF NOT EXISTS closed_at timestamptz;   -- NULL＝未確定

-- ===== 2. 履歴表 =====
CREATE TABLE IF NOT EXISTS public.fiscal_period_close_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  period_id  uuid NOT NULL,   -- 外部キーなし（期を削除しても履歴を残す。period_opening_balance_logs と同じ）
  action     text NOT NULL CHECK (action IN ('CLOSE', 'REOPEN')),
  memo       text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiscal_period_close_logs_period_idx ON public.fiscal_period_close_logs (period_id, changed_at);
ALTER TABLE public.fiscal_period_close_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_select_fiscal_period_close_logs ON public.fiscal_period_close_logs;
DROP POLICY IF EXISTS allow_insert_fiscal_period_close_logs ON public.fiscal_period_close_logs;
CREATE POLICY allow_select_fiscal_period_close_logs ON public.fiscal_period_close_logs FOR SELECT USING (true);
CREATE POLICY allow_insert_fiscal_period_close_logs ON public.fiscal_period_close_logs FOR INSERT WITH CHECK (true);
-- 既定権限で付く REFERENCES・TRIGGER・TRUNCATE・MAINTAIN を外し、必要な権限だけ付与する
REVOKE ALL ON TABLE public.fiscal_period_close_logs FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.fiscal_period_close_logs TO anon, authenticated;

-- ===== 3. 共通補助関数 =====
-- 会社単位の advisory lock。排他＝確定・解除（トリガー内）、共有＝科目・繰越先・期間の変更ガード
CREATE OR REPLACE FUNCTION public.period_lock_company(p_company_id uuid, p_exclusive boolean)
RETURNS void
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

-- 期の行を FOR SHARE で読み、確定済みなら PERIOD_CLOSED。期が無ければ何もしない（外部キー・他のトリガーが拒否する）
CREATE OR REPLACE FUNCTION public.period_assert_open(p_period_id uuid)
RETURNS void
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

-- ===== 4. 確定前チェック =====
-- 直前の期（同じ会社で start_date が直前）が存在し、未確定なら true
-- 注意: 以下の確認系関数は STABLE にしない。STABLE だと、同じトランザクション内の PL/pgSQL（DO ブロックなど）で、式やサブクエリの中から呼んだときに、直前に同じブロックが書いた行が見えず PERIOD_NOT_FOUND 等になる（ローカルで再現）。
CREATE OR REPLACE FUNCTION public.period_close_prev_open(p_period_id uuid)
RETURNS boolean
LANGUAGE sql
VOLATILE
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

-- 次の期の期首（p_target_start）へ繰越先へ畳み込まれる動きの合計。
-- get_derived_opening_balances_for_period の v_bucket と同じ式（導出関数は変更しない。整合は SQL テストで確認する）
CREATE OR REPLACE FUNCTION public.period_carry_forward_amount(p_company_id uuid, p_target_start date)
RETURNS numeric
LANGUAGE plpgsql
VOLATILE
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

-- 確定できない理由（空なら確定可能）。保存済みの現在の行を読む。トリガー（guard_period_close_state）が必ず呼ぶ
CREATE OR REPLACE FUNCTION public.period_close_errors(p_period_id uuid)
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
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

-- 警告（確定は止めない）
CREATE OR REPLACE FUNCTION public.period_close_warnings(p_period_id uuid)
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
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

-- ===== 5. トリガー関数 =====
-- 仕訳ヘッダー: 確定済みの期への INSERT／UPDATE／DELETE を拒否（期の付け替えは両方の期を id 順に確認）
CREATE OR REPLACE FUNCTION public.guard_closed_period_journal_entry()
RETURNS trigger
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

-- 仕訳明細: 親の仕訳の期が確定済みなら拒否。
-- trg_journal_lines_guard（親の仕訳を FOR NO KEY UPDATE）より後に発火させる（名前に z_）。
-- 先に期をロックすると、一括変更（仕訳行 → 期の FOR SHARE）と逆順になりデッドロックする
CREATE OR REPLACE FUNCTION public.guard_closed_period_journal_line()
RETURNS trigger
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

-- 期首残高（ヘッダー・明細）
CREATE OR REPLACE FUNCTION public.guard_closed_period_opening_balance()
RETURNS trigger
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

-- 期間ガード: 確定済みの期より前・内側に始まる期は作れない／動かせない（会社の共有 advisory lock の下で判定）
CREATE OR REPLACE FUNCTION public.guard_period_range(p_company_id uuid, p_period_id uuid, p_start date)
RETURNS void
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

CREATE OR REPLACE FUNCTION public.guard_fiscal_period_insert()
RETURNS trigger
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

-- UPDATE OF は SET に含まれるだけで発火するため、値が変わったときだけ判定する（期名の変更で end_date を送る現行 UI を止めない）
CREATE OR REPLACE FUNCTION public.guard_fiscal_period_dates()
RETURNS trigger
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

CREATE OR REPLACE FUNCTION public.guard_fiscal_period_delete()
RETURNS trigger
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

-- 確定・解除の中核。直接 UPDATE でも RPC でも、ここを必ず通る
CREATE OR REPLACE FUNCTION public.guard_period_close_state()
RETURNS trigger
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

-- 科目: 確定済みの期の数字に影響する値（type・区分・親）の変更を拒否。値が変わらない UPDATE（名前だけの変更）は通す
CREATE OR REPLACE FUNCTION public.guard_account_in_closed_periods()
RETURNS trigger
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

-- 繰越先: 確定済みの期がある会社では、繰越先の値を変更できない
CREATE OR REPLACE FUNCTION public.guard_closed_carry_forward()
RETURNS trigger
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

-- ===== 5b. トリガー =====
DROP TRIGGER IF EXISTS trg_journal_entries_closed_guard ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_closed_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period_journal_entry();

DROP TRIGGER IF EXISTS trg_journal_lines_z_closed_guard ON public.journal_lines;
CREATE TRIGGER trg_journal_lines_z_closed_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period_journal_line();

DROP TRIGGER IF EXISTS trg_pob_sets_closed_guard ON public.period_opening_balance_sets;
CREATE TRIGGER trg_pob_sets_closed_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.period_opening_balance_sets
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period_opening_balance();

DROP TRIGGER IF EXISTS trg_pob_lines_closed_guard ON public.period_opening_balance_lines;
CREATE TRIGGER trg_pob_lines_closed_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.period_opening_balance_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period_opening_balance();

DROP TRIGGER IF EXISTS trg_fiscal_periods_closed_insert ON public.fiscal_periods;
CREATE TRIGGER trg_fiscal_periods_closed_insert
  BEFORE INSERT ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_period_insert();

DROP TRIGGER IF EXISTS trg_fiscal_periods_closed_dates ON public.fiscal_periods;
CREATE TRIGGER trg_fiscal_periods_closed_dates
  BEFORE UPDATE OF start_date, end_date ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_period_dates();

DROP TRIGGER IF EXISTS trg_fiscal_periods_closed_delete ON public.fiscal_periods;
CREATE TRIGGER trg_fiscal_periods_closed_delete
  BEFORE DELETE ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_period_delete();

DROP TRIGGER IF EXISTS trg_fiscal_periods_close_state ON public.fiscal_periods;
CREATE TRIGGER trg_fiscal_periods_close_state
  BEFORE UPDATE OF closed_at ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.guard_period_close_state();

-- 名前は d_ を維持（b_inherit_parent が補助科目の区分を親から埋めた後に動かす）
DROP TRIGGER IF EXISTS trg_accounts_d_guard_closed_periods ON public.accounts;
CREATE TRIGGER trg_accounts_d_guard_closed_periods
  BEFORE UPDATE OF type, bs_category, pl_category, parent_id ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_in_closed_periods();

DROP TRIGGER IF EXISTS trg_companies_guard_closed_carry_forward ON public.companies;
CREATE TRIGGER trg_companies_guard_closed_carry_forward
  BEFORE UPDATE OF carry_forward_account_id ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_carry_forward();

-- ===== 6. RPC =====
CREATE OR REPLACE FUNCTION public.get_period_close_check(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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

-- 事前の advisory lock は取らない。UPDATE 文だけを実行し、トリガーが「期の行 → advisory 排他」の順で取る
CREATE OR REPLACE FUNCTION public.close_fiscal_period(p_period_id uuid, p_memo text DEFAULT NULL)
RETURNS jsonb
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

CREATE OR REPLACE FUNCTION public.reopen_fiscal_period(p_period_id uuid, p_memo text DEFAULT NULL)
RETURNS jsonb
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

-- ===== 7. 権限 =====
-- トリガー関数: PUBLIC のみ外す（トリガー実行に EXECUTE は不要）
REVOKE ALL ON FUNCTION public.guard_closed_period_journal_entry()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_closed_period_journal_line()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_closed_period_opening_balance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_fiscal_period_insert()          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_fiscal_period_dates()           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_fiscal_period_delete()          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_period_close_state()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_account_in_closed_periods()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_closed_carry_forward()          FROM PUBLIC;

-- トリガーから呼ばれる補助関数と RPC: 呼び出し側ロールの権限で評価されるため anon／authenticated に付与（PUBLIC には付与しない）
DO $$
declare
  f text;
begin
  foreach f in array array[
    'public.period_lock_company(uuid, boolean)',
    'public.period_assert_open(uuid)',
    'public.period_close_prev_open(uuid)',
    'public.period_carry_forward_amount(uuid, date)',
    'public.period_close_errors(uuid)',
    'public.period_close_warnings(uuid)',
    'public.guard_period_range(uuid, uuid, date)',
    'public.get_period_close_check(uuid)',
    'public.close_fiscal_period(uuid, text)',
    'public.reopen_fiscal_period(uuid, text)'
  ] loop
    execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    execute format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f);
  end loop;
end;
$$;

NOTIFY pgrst, 'reload schema';
