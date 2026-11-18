-- 補足（仕訳単位）。同じトランザクションで旧5引数関数を削除し、末尾引数を追加する。
-- 旧UIからの5引数呼び出しは DEFAULT NULL で継続できる。
begin;

alter table public.journal_entries add column supplement text NULL;

drop function public.create_journal_entry(uuid, date, text, text, jsonb);
drop function public.update_journal_entry(uuid, date, text, text, jsonb);

create function public.create_journal_entry(
  p_period_id        uuid,
  p_date             date,
  p_description      text,
  p_reference_number text,
  p_lines            jsonb,
  p_supplement       text DEFAULT NULL
)
returns uuid
language plpgsql
security invoker
set search_path TO 'public'
as $function$
declare
  v_entry_id uuid;
begin
  perform validate_journal_lines(p_lines);

  -- 会計期間のチェックは trg_journal_entries_check_period が行う
  insert into journal_entries (period_id, date, description, reference_number, is_opening_balance, supplement)
  values (p_period_id, p_date, p_description, nullif(p_reference_number, ''), false, nullif(p_supplement, ''))
  returning id into v_entry_id;

  perform insert_journal_lines(v_entry_id, p_lines);

  return v_entry_id;
end;
$function$;

-- 訂正履歴のため、ヘッダー UPDATE → 明細 DELETE → 明細 INSERT の順序を維持する。
create function public.update_journal_entry(
  p_entry_id         uuid,
  p_date             date,
  p_description      text,
  p_reference_number text,
  p_lines            jsonb,
  p_supplement       text DEFAULT NULL
)
returns void
language plpgsql
security invoker
set search_path TO 'public'
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

revoke all on function public.create_journal_entry(uuid, date, text, text, jsonb, text) from public;
revoke all on function public.update_journal_entry(uuid, date, text, text, jsonb, text) from public;

grant execute on function public.create_journal_entry(uuid, date, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.update_journal_entry(uuid, date, text, text, jsonb, text) to anon, authenticated;

NOTIFY pgrst, 'reload schema';
commit;
