-- ステップ2: 期首残高（A案＋任意期の手動期首残高）
-- 設計: Project の SA_step2_sql_design_v2.md
-- 内容:
--   1. 表3つ（ヘッダー・明細・変更履歴）
--   2. トリガー（period_id 付け替え禁止・貸借の遅延制約・明細の科目検証・科目の区分変更ガード）
--   3. 関数（導出・取得・保存・解除）と get_opening_balances_for_period の作り直し
-- 先に 20261112120000_company_support.sql（会社単位）が適用済みであること。
-- 入出力の形（account_id, balance・借方超過が正）は get_opening_balances_for_period で変えない。

begin;

-- ============================================================
-- 1. 表
-- ============================================================

-- 1-1. ヘッダー（存在する期＝手動で設定した期）
create table public.period_opening_balance_sets (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  period_id  uuid not null,
  memo       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint period_opening_balance_sets_period_key unique (period_id),
  constraint period_opening_balance_sets_period_company_key unique (period_id, company_id),
  constraint period_opening_balance_sets_company_fkey
    foreign key (company_id) references public.companies (id),
  -- ON DELETE は既定（NO ACTION）。ヘッダーのある期は削除できない（決定 18）
  constraint period_opening_balance_sets_period_fkey
    foreign key (period_id, company_id) references public.fiscal_periods (id, company_id)
);

-- 1-2. 明細（借方超過が正の生残高）
create table public.period_opening_balance_lines (
  period_id  uuid not null,
  account_id uuid not null,
  company_id uuid not null,
  balance    numeric(15,2) not null,
  constraint period_opening_balance_lines_pkey primary key (period_id, account_id),
  constraint period_opening_balance_lines_balance_check check (balance <> 0 and balance <> 'NaN'),
  constraint period_opening_balance_lines_set_fkey
    foreign key (period_id, company_id) references public.period_opening_balance_sets (period_id, company_id)
    on delete cascade,
  constraint period_opening_balance_lines_account_fkey
    foreign key (account_id, company_id) references public.accounts (id, company_id)
);

-- 1-3. 変更履歴（期への外部キーは付けない。期が消えても履歴を残す）
create table public.period_opening_balance_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  period_id   uuid not null,
  action      text not null,
  before_data jsonb,
  after_data  jsonb,
  changed_at  timestamptz not null default now(),
  constraint period_opening_balance_logs_action_check check (action in ('SET', 'CLEAR')),
  constraint period_opening_balance_logs_company_fkey
    foreign key (company_id) references public.companies (id)
);

create index period_opening_balance_logs_period_idx on public.period_opening_balance_logs (period_id, changed_at);

-- ============================================================
-- 2. トリガー関数
-- ============================================================

-- company_id を期から自動設定（3表共通）
create function public.fill_opening_balance_company() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.company_id is null then
    select company_id into new.company_id from fiscal_periods where id = new.period_id;
  end if;
  return new;
end;
$$;

-- period_id の付け替え禁止（ヘッダー・明細）。明細を別の期へ移して、移動元の貸借不一致を隠す操作を防ぐ
create function public.forbid_opening_balance_period_change() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.period_id is distinct from old.period_id then
    raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_LINES',
      detail = '期首残高の明細・ヘッダーを別の期へ移動することはできません';
  end if;
  return new;
end;
$$;

-- 手動明細に使える科目か（資産・負債・純資産で、財務諸表区分があり、個人は事業主貸借を除く）
create function public.opening_balance_account_ok(p_type text, p_bs_category text, p_company_kind text) returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select p_type in ('ASSET', 'LIABILITY', 'EQUITY')
     and p_bs_category is not null
     and not (p_company_kind = 'INDIVIDUAL' and p_bs_category in ('OWNER_DRAWINGS', 'OWNER_CONTRIBUTIONS'));
$$;

-- 明細の科目検証（BEFORE INSERT OR UPDATE OF account_id）
create function public.check_opening_balance_line_account() returns trigger
language plpgsql
set search_path to 'public'
as $$
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

-- 明細から参照されている科目の区分変更を拒否（accounts の BEFORE UPDATE）
create function public.guard_opening_balance_line_accounts() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if exists (select 1 from period_opening_balance_lines where account_id = old.id)
     and not opening_balance_account_ok(new.type, new.bs_category, new.company_kind) then
    raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_INVALID_ACCOUNT',
      detail = format('期首残高に使われている科目は、財務諸表区分のある資産・負債・純資産のまま変更できません: %s %s', old.code, old.name);
  end if;
  return new;
end;
$$;

-- 貸借の遅延制約（COMMIT 時）。UPDATE は旧・新の両方の期を検証する
create function public.check_opening_balance_set_balanced() returns trigger
language plpgsql
set search_path to 'public'
as $$
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

-- ============================================================
-- 3. トリガー
-- ============================================================

create trigger trg_pob_sets_a_fill_company before insert on public.period_opening_balance_sets
  for each row execute function public.fill_opening_balance_company();
create trigger trg_pob_sets_company_immutable before update of company_id on public.period_opening_balance_sets
  for each row execute function public.forbid_company_id_change();
create trigger trg_pob_sets_period_immutable before update of period_id on public.period_opening_balance_sets
  for each row execute function public.forbid_opening_balance_period_change();

create trigger trg_pob_lines_a_fill_company before insert on public.period_opening_balance_lines
  for each row execute function public.fill_opening_balance_company();
create trigger trg_pob_lines_company_immutable before update of company_id on public.period_opening_balance_lines
  for each row execute function public.forbid_company_id_change();
create trigger trg_pob_lines_period_immutable before update of period_id on public.period_opening_balance_lines
  for each row execute function public.forbid_opening_balance_period_change();
create trigger trg_pob_lines_check_account before insert or update of account_id on public.period_opening_balance_lines
  for each row execute function public.check_opening_balance_line_account();
create constraint trigger trg_pob_lines_balanced after insert or update or delete on public.period_opening_balance_lines
  deferrable initially deferred for each row execute function public.check_opening_balance_set_balanced();

create trigger trg_pob_logs_a_fill_company before insert on public.period_opening_balance_logs
  for each row execute function public.fill_opening_balance_company();
create trigger trg_pob_logs_company_immutable before update of company_id on public.period_opening_balance_logs
  for each row execute function public.forbid_company_id_change();

-- 名前順で trg_accounts_b_inherit_parent の後・trg_accounts_company_immutable の前に動く
create trigger trg_accounts_c_guard_opening_lines before update of type, bs_category, parent_id on public.accounts
  for each row execute function public.guard_opening_balance_line_accounts();

-- ============================================================
-- 4. 期首残高の導出・取得
-- ============================================================

-- 4-1. その期のヘッダーを無視して、前の期から導出した期首残高を返す（プレビュー・差の表示にも使う）
create function public.get_derived_opening_balances_for_period(target_period_id uuid)
returns table(account_id uuid, balance numeric)
language plpgsql
set search_path to 'public'
as $$
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

-- 4-2. 期首残高（入出力は従来どおり）。ヘッダーがあれば手動の明細、無ければ導出値
create or replace function public.get_opening_balances_for_period(target_period_id uuid)
returns table(account_id uuid, balance numeric)
language plpgsql
set search_path to 'public'
as $$
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

-- ============================================================
-- 5. 保存・解除
-- ============================================================

-- 5-1. 手動の期首残高を保存（ヘッダー＋明細＋履歴を1トランザクションで書く）
create function public.save_period_opening_balances(
  p_period_id uuid,
  p_lines jsonb,
  p_memo text default null,
  p_auto_balance boolean default false
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
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
$$;

-- 5-2. 手動設定を解除（自動計算に戻る）。ヘッダーが無ければ何もしない
create function public.clear_period_opening_balances(p_period_id uuid) returns void
language plpgsql
set search_path to 'public'
as $$
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

-- ============================================================
-- 6. RLS・権限
-- ============================================================

alter table public.period_opening_balance_sets enable row level security;
alter table public.period_opening_balance_lines enable row level security;
alter table public.period_opening_balance_logs enable row level security;

create policy allow_all_period_opening_balance_sets on public.period_opening_balance_sets using (true) with check (true);
create policy allow_all_period_opening_balance_lines on public.period_opening_balance_lines using (true) with check (true);
create policy allow_insert_period_opening_balance_logs on public.period_opening_balance_logs for insert with check (true);
create policy allow_select_period_opening_balance_logs on public.period_opening_balance_logs for select using (true);

-- 既定の権限（Supabase は新しい表に anon/authenticated へ全権限を付ける）を外してから、必要なものだけ付ける
revoke all on table public.period_opening_balance_sets from public, anon, authenticated;
revoke all on table public.period_opening_balance_lines from public, anon, authenticated;
revoke all on table public.period_opening_balance_logs from public, anon, authenticated;
grant select, insert, update, delete on table public.period_opening_balance_sets to anon, authenticated;
grant select, insert, update, delete on table public.period_opening_balance_lines to anon, authenticated;
grant select, insert on table public.period_opening_balance_logs to anon, authenticated;

-- トリガー関数・補助関数: PUBLIC から外す
revoke all on function public.fill_opening_balance_company() from public;
revoke all on function public.forbid_opening_balance_period_change() from public;
-- 2026-11-14: 適用済みSQLも修正し、新規環境で補助関数の EXECUTE 付与漏れを再発させない。
revoke all on function public.opening_balance_account_ok(text, text, text) from public;
grant execute on function public.opening_balance_account_ok(text, text, text) to anon, authenticated;
revoke all on function public.check_opening_balance_line_account() from public;
revoke all on function public.guard_opening_balance_line_accounts() from public;
revoke all on function public.check_opening_balance_set_balanced() from public;

-- 呼び出す関数: PUBLIC から外し、anon/authenticated にだけ明示的に付ける
revoke all on function public.get_derived_opening_balances_for_period(uuid) from public;
revoke all on function public.get_opening_balances_for_period(uuid) from public;
revoke all on function public.save_period_opening_balances(uuid, jsonb, text, boolean) from public;
revoke all on function public.clear_period_opening_balances(uuid) from public;
grant execute on function public.get_derived_opening_balances_for_period(uuid) to anon, authenticated;
grant execute on function public.get_opening_balances_for_period(uuid) to anon, authenticated;
grant execute on function public.save_period_opening_balances(uuid, jsonb, text, boolean) to anon, authenticated;
grant execute on function public.clear_period_opening_balances(uuid) to anon, authenticated;

commit;
