-- 2026-11-01  Migration B: 借貸一致の DB 側保証（遅延制約 Trigger）＋明細変更の直列化
--
-- 適用方法: Supabase の SQL Editor で手動実行（Supabase CLI の migration 履歴には登録されない）。
-- 前提:     20261101180000_atomic_journal_save.sql（A）適用済み、かつ
--           アプリの全保存経路（JournalForm / InlineJournalForm / 一覧のインライン編集 / CSV本登録）が RPC 呼び出しに差し替え済み。
--
-- ★ 適用直前のチェックリスト
--   1. 差し替え後のアプリで npm run build → 起動し直し、旧コードの開発サーバーが残っていないこと
--   2. ブラウザで開いているアプリのタブをすべて再読み込み（旧画面のままだと保存時に必ず失敗する）
--   3. 既存データの確認（下の DO ブロックが自動で行い、違反があれば適用せずに中断する）
--
-- 何を保証するか:
--   ・COMMIT 時点で、存在するすべての仕訳が「明細2行以上・借方/貸方それぞれ1行以上・借方合計 = 貸方合計」
--     → PostgREST から journal_entries / journal_lines を直接書き換えても、崩れた仕訳は COMMIT できない
--   ・明細の entry_id 付け替えを禁止（明細を別の仕訳へ移す業務上の必要がないため）
--   ・同じ仕訳への明細変更は、親の仕訳行のロック（FOR NO KEY UPDATE）で直列化する
--     （bump_parent_entry_updated_at の UPDATE による副次的なロックに依存しない）
--
-- テスト: 20261101180100_enforce_journal_balance.test.sql（遅延制約は SET CONSTRAINTS ... IMMEDIATE で前倒し検証）
--         同時更新: 20261101180100_concurrency_test.md
--
-- 元に戻す: ファイル末尾の「ロールバック用 SQL」を参照。

begin;

-- ============================================================
-- 0. 既存データの事前チェック（違反があれば中断）
-- ============================================================
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from (
    select e.id
      from journal_entries e
      left join journal_lines l on l.entry_id = e.id
     group by e.id
    having count(l.id) < 2
        or count(l.id) filter (where l.side = 'DEBIT') = 0
        or count(l.id) filter (where l.side = 'CREDIT') = 0
        or coalesce(sum(case when l.side = 'DEBIT' then l.amount else -l.amount end), 0) <> 0
  ) as bad;

  if v_bad > 0 then
    raise exception '借貸が一致しない、または明細が不足している仕訳が % 件あります。修正してから再実行してください', v_bad;
  end if;
end;
$$;

-- ============================================================
-- 1. 明細変更のガード（即時・BEFORE ROW）
-- ============================================================
create or replace function public.guard_journal_line_change()
returns trigger
language plpgsql
set search_path = public
as $function$
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
$function$;

create trigger trg_journal_lines_guard
  before insert or update or delete on public.journal_lines
  for each row execute function public.guard_journal_line_change();

-- ============================================================
-- 2. 借貸一致の遅延チェック（COMMIT 時）
-- ============================================================
create or replace function public.check_journal_entry_balance()
returns trigger
language plpgsql
set search_path = public
as $function$
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
$function$;

create constraint trigger trg_journal_lines_balance
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function public.check_journal_entry_balance();

-- 明細なしのヘッダーだけの INSERT を拒否する
create constraint trigger trg_journal_entries_balance
  after insert on public.journal_entries
  deferrable initially deferred
  for each row execute function public.check_journal_entry_balance();

-- ============================================================
-- 3. 権限（Trigger 関数は直接呼べないが、念のため PUBLIC の実行権限を外す）
-- ============================================================
revoke all on function public.guard_journal_line_change() from public;
revoke all on function public.check_journal_entry_balance() from public;

commit;

-- ============================================================
-- ロールバック用 SQL（必要な場合のみ・手動で実行）
-- ============================================================
-- begin;
-- drop trigger if exists trg_journal_entries_balance on public.journal_entries;
-- drop trigger if exists trg_journal_lines_balance on public.journal_lines;
-- drop trigger if exists trg_journal_lines_guard on public.journal_lines;
-- drop function if exists public.check_journal_entry_balance();
-- drop function if exists public.guard_journal_line_change();
-- commit;
