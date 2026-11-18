-- 伝票番号の自動採番（会計期ごとに 1 から・DB 側で確定・手入力可・同じ期内で重複不可）
--
-- 変更内容
--   1. journal_entries.reference_number: text -> integer（既存 37 件はすべて NULL。値があれば中断する）
--      CHECK (1〜999999999)、部分一意インデックス (period_id, reference_number) WHERE NOT NULL
--      ledger_view が列に依存するため、作り直して GRANT SELECT を付け直す
--   2. 補助関数: lock_period_for_numbering / next_reference_number / check_reference_number
--      （VOLATILE・SECURITY INVOKER。最大値の取得は、採番ロックを取った「後」の別 SQL 文で行う）
--   3. create_journal_entry: 引数 p_reference_number を integer に、戻り値を jsonb {id, reference_number} に変更
--      番号が NULL なら自動採番、指定があれば重複・範囲を確認して使う
--   4. update_journal_entry: 引数 p_reference_number を integer に変更。NULL は「変更しない」（補足と同じ扱い）
--      ロック順: 採番ロック -> 仕訳。ロック後に period_id が変わっていないか再確認する
--   5. import_staging_entries: 本登録の各行に、配列順で自動採番する
--
-- ロック規約（デッドロック防止）
--   採番に関わる経路（create / update / import）は、最初に「会計期ごとの採番用アドバイザリロック」を取る。
--   このロックは fiscal_periods の行ロックではない。理由: 既存の一括日付変更（app/journals/page.tsx の executeBulkEdit）は
--   journal_entries を直接 UPDATE し、「仕訳行のロック → trg_journal_entries_check_period による fiscal_periods の FOR SHARE」
--   の順で動く。ここに fiscal_periods の FOR UPDATE を先に取る経路を足すと、同じ仕訳に対する編集 RPC と一括日付変更が
--   相互待ち（デッドロック）になる（ローカルで再現確認済み）。アドバイザリロックは、採番に関わる経路以外は取らず、
--   行ロックとも競合しないため、このサイクルが成立しない。
--   create / update : 採番ロック -> journal_entries
--   import          : import_staging(FOR UPDATE) -> 採番ロック -> journal_entries
--   一括日付変更等の直接 UPDATE は採番ロックを取らない（従来どおり。fiscal_periods は FOR SHARE のみ）。
--
-- 自動採番の保証範囲: 保存 RPC（create / import）経由のみ。REST などから journal_entries へ直接 INSERT すると
-- NULL のまま入る（過去 37 件と同じ。CHECK と一意インデックスだけが DB の保証）。
--
-- 適用順序: この SQL はアプリより「直前」に適用する。create_journal_entry の戻り値が uuid から jsonb に変わるため、
-- 旧アプリのまま適用すると新規保存が失敗する。手順は 20261110170000_auto_reference_number_apply.md を参照。
-- 適用後は、このファイルの .test.sql を SQL Editor で実行し、TEST RESULT: ALL PASSED を確認する。
begin;

-- ============================================================
-- 1. 列の型・制約・インデックス
-- ============================================================
do $guard$
begin
  if exists (select 1 from public.journal_entries where reference_number is not null) then
    raise exception 'reference_number に既存の値があります。text -> integer の変換前に内容を確認してください'
      using errcode = 'P0001';
  end if;
end;
$guard$;

drop view public.ledger_view;

alter table public.journal_entries
  alter column reference_number type integer using null;

alter table public.journal_entries
  add constraint journal_entries_reference_number_range
  check (reference_number >= 1 and reference_number <= 999999999);

create unique index uq_journal_entries_period_reference_number
  on public.journal_entries (period_id, reference_number)
  where reference_number is not null;

create or replace view public.ledger_view as
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
               FROM journal_lines opp
              WHERE opp.entry_id = jl.entry_id AND opp.side <> jl.side)) = 1 THEN ( SELECT ac.name
               FROM journal_lines opp
                 JOIN accounts ac ON opp.account_id = ac.id
              WHERE opp.entry_id = jl.entry_id AND opp.side <> jl.side
             LIMIT 1)
            ELSE (( SELECT ac.name
               FROM journal_lines opp
                 JOIN accounts ac ON opp.account_id = ac.id
              WHERE opp.entry_id = jl.entry_id AND opp.side <> jl.side
              ORDER BY opp.line_number
             LIMIT 1)) || ' ほか'::text
        END AS counter_account_name
   FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id;

-- View を作り直すと権限がリセットされるため、必ず付け直す
grant SELECT on public.ledger_view to anon;
grant SELECT on public.ledger_view to authenticated;

-- ============================================================
-- 2. 補助関数（VOLATILE・SECURITY INVOKER）
-- ============================================================

-- 会計期ごとの採番用ロックを取る（トランザクション終了まで保持）。採番に関わる処理は、必ず最初にこれを呼ぶ。
-- fiscal_periods の行は「存在確認」のみ（ロックしない）。FOR UPDATE にしない理由は、ファイル冒頭の「ロック規約」を参照。
create function public.lock_period_for_numbering(p_period_id uuid)
 returns void
 language plpgsql
 volatile
 security invoker
 set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('stoic.journal_reference_number'), hashtext(p_period_id::text));

  perform 1 from fiscal_periods where id = p_period_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PERIOD_NOT_FOUND',
      detail = format('period_id = %s', p_period_id);
  end if;
end;
$function$;

-- その期の「最大の伝票番号+1」を返す（欠番は埋めない。最後の仕訳を削除した場合は、その番号が再利用される）。
-- ロックを取る文と、最大値を取る文は別にする（VOLATILE 関数では文ごとに新しいスナップショットを取るため、
-- ロック待ちの後の最大値には、先に確定したトランザクションの結果が含まれる）。
create function public.next_reference_number(p_period_id uuid)
 returns integer
 language plpgsql
 volatile
 security invoker
 set search_path to 'public'
as $function$
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
$function$;

-- 手入力された伝票番号の範囲と重複を確認する（呼び出し側が先に採番ロックを取っていること）。
-- p_exclude_entry_id: 編集中の仕訳自身は重複とみなさない。
create function public.check_reference_number(p_period_id uuid, p_reference_number integer, p_exclude_entry_id uuid default null)
 returns void
 language plpgsql
 volatile
 security invoker
 set search_path to 'public'
as $function$
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
$function$;

-- ============================================================
-- 3. 保存 RPC（引数型・戻り値型が変わるため、旧シグネチャを削除して作り直す）
-- ============================================================
drop function public.create_journal_entry(uuid, date, text, text, jsonb, text);
drop function public.update_journal_entry(uuid, date, text, text, jsonb, text);

-- 戻り値: {"id": "<uuid>", "reference_number": <integer>}（PostgREST では単一の JSON オブジェクトとして返る）
create function public.create_journal_entry(
  p_period_id        uuid,
  p_date             date,
  p_description      text,
  p_reference_number integer,
  p_lines            jsonb,
  p_supplement       text DEFAULT NULL
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path TO 'public'
as $function$
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
$function$;

-- 訂正履歴のため、ヘッダー UPDATE → 明細 DELETE → 明細 INSERT の順序を維持する。
-- p_reference_number: NULL は「変更しない」（一度付いた番号を NULL に戻す操作はできない）。
create function public.update_journal_entry(
  p_entry_id         uuid,
  p_date             date,
  p_description      text,
  p_reference_number integer,
  p_lines            jsonb,
  p_supplement       text DEFAULT NULL
)
returns void
language plpgsql
volatile
security invoker
set search_path TO 'public'
as $function$
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
$function$;

-- ============================================================
-- 4. CSV 本登録（配列順に採番）。シグネチャは変更なし（権限はそのまま）
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_staging_entries(p_period_id uuid, p_staging_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ============================================================
-- 5. 権限（PUBLIC には付けない。anon / authenticated のみ）
-- ============================================================
revoke all on function public.lock_period_for_numbering(uuid) from public;
revoke all on function public.next_reference_number(uuid) from public;
revoke all on function public.check_reference_number(uuid, integer, uuid) from public;
revoke all on function public.create_journal_entry(uuid, date, text, integer, jsonb, text) from public;
revoke all on function public.update_journal_entry(uuid, date, text, integer, jsonb, text) from public;
grant EXECUTE on function public.lock_period_for_numbering(uuid) to anon, authenticated;
grant EXECUTE on function public.next_reference_number(uuid) to anon, authenticated;
grant EXECUTE on function public.check_reference_number(uuid, integer, uuid) to anon, authenticated;
grant EXECUTE on function public.create_journal_entry(uuid, date, text, integer, jsonb, text) to anon, authenticated;
grant EXECUTE on function public.update_journal_entry(uuid, date, text, integer, jsonb, text) to anon, authenticated;

commit;

-- PostgREST に関数定義の変更を通知する
NOTIFY pgrst, 'reload schema';
