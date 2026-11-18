-- 2026-11-01  Migration A: 仕訳保存の原子化（RPC）＋金額・期間の DB 側チェック
--
-- 適用方法: Supabase の SQL Editor で手動実行（Supabase CLI の migration 履歴には登録されない）。
-- 前提:     20261101000000_suppress_chained_update_logs.sql 適用済み。
-- 導入順:   本ファイル（A）→ アプリを RPC 呼び出しに差し替え・動作確認 → 20261101180100（B: 借貸一致の制約Trigger）
--           A の時点では旧アプリの保存処理（複数リクエスト方式）もそのまま動く。
-- テスト:   20261101180000_atomic_journal_save.test.sql（全体を自動ロールバックする DO ブロック）
--
-- エラーの形式:
--   RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<lib/errors.ts の ERROR_CODES のキー>', DETAIL = '<補足>'
--   アプリ側は translateSupabaseError で message をキーに AccountingError へ変換する。
--
-- 権限:
--   SQL Editor（postgres ロール）で作った関数は既定で anon から実行できない（pg_default_acl: {postgres=X}）。
--   そのため RPC は明示的に GRANT EXECUTE する。PUBLIC には付けない。
--   関数は SECURITY INVOKER（呼び出し側の権限で動く）。FOR SHARE / FOR UPDATE を使うため、
--   呼び出し側には fiscal_periods / journal_entries の UPDATE 権限が必要（現状 anon にあり）。
--
-- 元に戻す: ファイル末尾の「ロールバック用 SQL」を参照。

begin;

-- ============================================================
-- 1. CHECK 制約（既存行も検証される。違反があればここで失敗して全体がロールバックされる）
-- ============================================================

-- NaN は PostgreSQL では「どの数値よりも大きい」扱いのため amount > 0 を通ってしまう。明示的に除外する
alter table public.journal_lines
  add constraint journal_lines_amount_positive
  check (amount > 0 and amount <> 'NaN'::numeric);

alter table public.fiscal_periods
  add constraint fiscal_periods_date_order
  check (start_date <= end_date);

-- ============================================================
-- 2. 明細の検証関数（データを変更しない）
-- ============================================================
-- p_lines: [{ "side": "DEBIT"|"CREDIT", "account_id": "<uuid>", "amount": "<文字列>", "tax_code": "<text>"|null }, ...]
--   amount は JSON の文字列のみ受け付ける（JS の float を経由させないため）。
--   書式は ^[0-9]{1,13}(\.[0-9]{1,2})?$ に限定 = numeric(15,2) に丸めなしで収まる正の値のみ。
--   これで NaN / Infinity / 指数表記 / 負数 / 小数3桁以上 / 桁あふれ をまとめて拒否する。
create or replace function public.validate_journal_lines(p_lines jsonb)
returns void
language plpgsql
stable
set search_path = public
as $function$
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
$function$;

-- ============================================================
-- 3. 明細の INSERT（RPC 内部用）
-- ============================================================
-- 呼び出し側権限で動く RPC から呼ぶため anon にも EXECUTE を付ける（= PostgREST からも直接呼べてしまう）。
-- 単独で呼ばれても不正な明細を入れられないよう、ここでも検証する。
create or replace function public.insert_journal_lines(p_entry_id uuid, p_lines jsonb)
returns void
language plpgsql
set search_path = public
as $function$
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
$function$;

-- ============================================================
-- 4. RPC: 新規仕訳
-- ============================================================
create or replace function public.create_journal_entry(
  p_period_id        uuid,
  p_date             date,
  p_description      text,
  p_reference_number text,
  p_lines            jsonb
)
returns uuid
language plpgsql
set search_path = public
as $function$
declare
  v_entry_id uuid;
begin
  perform validate_journal_lines(p_lines);

  -- 会計期間のチェックは trg_journal_entries_check_period が行う
  insert into journal_entries (period_id, date, description, reference_number, is_opening_balance)
  values (p_period_id, p_date, p_description, nullif(p_reference_number, ''), false)
  returning id into v_entry_id;

  perform insert_journal_lines(v_entry_id, p_lines);

  return v_entry_id;
end;
$function$;

-- ============================================================
-- 5. RPC: 仕訳の編集
-- ============================================================
-- 順序は「ヘッダー UPDATE → 明細 DELETE → 明細 INSERT」を厳守する。
-- trg_journal_entry_changes はヘッダー UPDATE（Trigger 階層1）で変更前の entry + 全明細を記録し、
-- 明細変更に伴う updated_at の連鎖更新（階層2）は記録しない。この順序を崩すと訂正履歴が残らない。
create or replace function public.update_journal_entry(
  p_entry_id         uuid,
  p_date             date,
  p_description      text,
  p_reference_number text,
  p_lines            jsonb
)
returns void
language plpgsql
set search_path = public
as $function$
declare
  v_is_opening boolean;
begin
  perform validate_journal_lines(p_lines);

  -- 存在確認と同時に行ロックを取り、確認後に他の処理で削除・変更される余地をなくす
  select coalesce(is_opening_balance, false)
    into v_is_opening
    from journal_entries
   where id = p_entry_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ENTRY_NOT_FOUND',
      detail = format('entry_id = %s', p_entry_id);
  end if;

  if v_is_opening then
    raise exception using errcode = 'P0001', message = 'OPENING_BALANCE_EDIT_FORBIDDEN';
  end if;

  update journal_entries
     set date             = p_date,
         description      = p_description,
         reference_number = nullif(p_reference_number, ''),
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
-- 6. RPC: CSV 本登録（import_staging → 仕訳）
-- ============================================================
-- ・指定 ID が全件存在・全件未処理・重複なしであることを確認してから登録（二重登録防止）
-- ・処理順は p_staging_ids の配列順。エラーは最初の1件で全体を中断し、DETAIL に「n行目（摘要）: 理由」を付ける
-- ・1トランザクションなので、失敗時に取り消し用の DELETE（と DELETE ログ）は発生しない
-- ・補助科目（debit_sub_account_id / credit_sub_account_id）は従来どおり未対応
create or replace function public.import_staging_entries(
  p_period_id   uuid,
  p_staging_ids uuid[]
)
returns integer
language plpgsql
set search_path = public
as $function$
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

      insert into journal_entries (period_id, date, description, reference_number, is_opening_balance)
      values (p_period_id, v_date, r.raw_description, null, false)
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
$function$;

-- ============================================================
-- 7. 会計期間のチェック（Trigger）
-- ============================================================
-- 仕訳側: 期間の行を FOR SHARE で読み、検証から COMMIT までの間に期間が変更されるのを防ぐ
--         （期間の UPDATE はこの仕訳のトランザクション終了を待ち、その後に下の期間側 Trigger で再検証される）
create or replace function public.check_journal_entry_period()
returns trigger
language plpgsql
set search_path = public
as $function$
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
$function$;

-- UPDATE OF date, period_id 指定なので、明細変更に伴う updated_at の連鎖更新では発火しない
create trigger trg_journal_entries_check_period
  before insert or update of date, period_id on public.journal_entries
  for each row execute function public.check_journal_entry_period();

-- 期間側: 開始日・終了日の変更で既存仕訳が範囲外になる場合は拒否する
create or replace function public.check_fiscal_period_entries()
returns trigger
language plpgsql
set search_path = public
as $function$
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
$function$;

create trigger trg_fiscal_periods_check_entries
  before update of start_date, end_date on public.fiscal_periods
  for each row execute function public.check_fiscal_period_entries();

-- ============================================================
-- 8. 権限
-- ============================================================
-- RPC（PostgREST から呼ぶもの）と、RPC が呼び出し側権限で呼ぶ内部関数
revoke all on function public.validate_journal_lines(jsonb) from public;
revoke all on function public.insert_journal_lines(uuid, jsonb) from public;
revoke all on function public.create_journal_entry(uuid, date, text, text, jsonb) from public;
revoke all on function public.update_journal_entry(uuid, date, text, text, jsonb) from public;
revoke all on function public.import_staging_entries(uuid, uuid[]) from public;

grant execute on function public.validate_journal_lines(jsonb) to anon, authenticated;
grant execute on function public.insert_journal_lines(uuid, jsonb) to anon, authenticated;
grant execute on function public.create_journal_entry(uuid, date, text, text, jsonb) to anon, authenticated;
grant execute on function public.update_journal_entry(uuid, date, text, text, jsonb) to anon, authenticated;
grant execute on function public.import_staging_entries(uuid, uuid[]) to anon, authenticated;

-- Trigger 関数は直接呼べないが、念のため PUBLIC の実行権限を外す（Trigger の発火には EXECUTE 権限は不要）
revoke all on function public.check_journal_entry_period() from public;
revoke all on function public.check_fiscal_period_entries() from public;

commit;

-- ============================================================
-- ロールバック用 SQL（必要な場合のみ・手動で実行）
-- ============================================================
-- begin;
-- drop trigger if exists trg_fiscal_periods_check_entries on public.fiscal_periods;
-- drop trigger if exists trg_journal_entries_check_period on public.journal_entries;
-- drop function if exists public.check_fiscal_period_entries();
-- drop function if exists public.check_journal_entry_period();
-- drop function if exists public.import_staging_entries(uuid, uuid[]);
-- drop function if exists public.update_journal_entry(uuid, date, text, text, jsonb);
-- drop function if exists public.create_journal_entry(uuid, date, text, text, jsonb);
-- drop function if exists public.insert_journal_lines(uuid, jsonb);
-- drop function if exists public.validate_journal_lines(jsonb);
-- alter table public.fiscal_periods drop constraint if exists fiscal_periods_date_order;
-- alter table public.journal_lines drop constraint if exists journal_lines_amount_positive;
-- commit;
