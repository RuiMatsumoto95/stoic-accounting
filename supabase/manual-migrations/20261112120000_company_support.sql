-- 会社単位（複数会社・法人/個人区分）と、区分別の初期科目セット【ステップ1a・DB】
--
-- 変更内容
--   1. companies（会社）: name / kind(CORPORATION|INDIVIDUAL・変更不可) / tax_method / carry_forward_account_id
--   2. company_id（NOT NULL）を持たせる表: accounts fiscal_periods journal_entries journal_lines import_staging
--      mapping_rules journal_templates journal_template_lines。既存データは「デフォルト会社（法人）」に寄せる
--      （DEFAULT 付きの列追加→DEFAULT 削除。行を書き換えないので、訂正履歴・updated_at は変わらない）
--   3. 会社をまたぐ参照を複合外部キーで拒否する（各表 UNIQUE (id, company_id) ← 子の (xxx_id, company_id)）
--      journal_entries / journal_lines の company_id は BEFORE INSERT トリガーが期・仕訳から自動設定する
--      （保存 RPC は引数も本体も変えない）
--   4. accounts: UNIQUE(code) → UNIQUE(company_id, code)、company_kind、区分の CHECK（種別との整合・会社区分別）、
--      補助科目は親の type / 区分を継承、default_tax_code は「税区分グループ」に変更
--   5. 繰越先の科目: companies.carry_forward_account_id（参照中の科目は削除不可・EQUITY 以外に変更不可）
--   6. fiscal_periods: is_current の部分ユニークを会社ごとに変更
--   7. get_opening_balances_for_period: 期の会社の仕訳だけを累計するよう暫定修正（本格的な作り直しはステップ2）
--   8. import_staging_entries: 取込行の会社と期の会社が違えば拒否（COMPANY_MISMATCH）。それ以外は従来どおり
--   9. company_seed_accounts(kind) / create_company(...): 区分別の初期科目（法人181・個人141）と最初の会計期を1トランザクションで作成
--
-- 適用順序: この SQL を適用すると、旧アプリは「科目・会計期間・取込データ・置換ルールの新規作成」ができなくなる
--   （company_id が必須のため）。仕訳の保存 RPC（新規・編集・取込本登録）は旧アプリのままで動く。
--   手順は 20261112120000_company_support_apply.md を参照。適用後は .test.sql を SQL Editor で実行し、
--   ERROR: TEST RESULT: ALL PASSED を確認する。
begin;

-- ============================================================
-- 1. companies
-- ============================================================
create table public.companies (
  id uuid not null default gen_random_uuid(),
  name text not null,
  kind text not null,
  tax_method text not null default 'EXEMPT',
  carry_forward_account_id uuid,
  created_at timestamptz not null default now(),
  constraint companies_pkey primary key (id),
  constraint companies_name_key unique (name),
  constraint companies_name_not_blank check (btrim(name) <> ''),
  constraint companies_kind_check check (kind in ('CORPORATION', 'INDIVIDUAL')),
  constraint companies_tax_method_check check (tax_method in ('EXEMPT', 'SIMPLE', 'STANDARD_INDIVIDUAL', 'STANDARD_PROPORTIONAL')),
  constraint companies_id_kind_key unique (id, kind)
);

-- 既存データの受け皿（本番はテストデータのみ。tax_method は system_settings から引き継ぐ）
insert into public.companies (id, name, kind, tax_method)
select '0f4cec31-c047-415b-8c64-18a21932620e'::uuid,
       'デフォルト会社',
       'CORPORATION',
       coalesce((select value from public.system_settings where key = 'tax_method'), 'EXEMPT');

create or replace function public.forbid_company_kind_change()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.kind is distinct from old.kind then
    raise exception using errcode = 'P0001', message = 'COMPANY_KIND_IMMUTABLE',
      detail = '会社の区分（法人／個人）は変更できません。法人成りなどは別の会社として作成してください';
  end if;
  return new;
end;
$function$;

create trigger trg_companies_kind_immutable
  before update of kind on public.companies
  for each row execute function public.forbid_company_kind_change();

-- ============================================================
-- 2. company_id 列（既存行はデフォルト会社。DEFAULT は付けっぱなしにしない）
-- ============================================================
alter table public.accounts
  add column company_id uuid not null default '0f4cec31-c047-415b-8c64-18a21932620e',
  add column company_kind text not null default 'CORPORATION';
alter table public.accounts alter column company_id drop default, alter column company_kind drop default;

alter table public.fiscal_periods     add column company_id uuid not null default '0f4cec31-c047-415b-8c64-18a21932620e';
alter table public.journal_entries    add column company_id uuid not null default '0f4cec31-c047-415b-8c64-18a21932620e';
alter table public.journal_lines      add column company_id uuid not null default '0f4cec31-c047-415b-8c64-18a21932620e';
alter table public.import_staging     add column company_id uuid not null default '0f4cec31-c047-415b-8c64-18a21932620e';
alter table public.mapping_rules      add column company_id uuid not null default '0f4cec31-c047-415b-8c64-18a21932620e';
alter table public.journal_templates  add column company_id uuid not null default '0f4cec31-c047-415b-8c64-18a21932620e';
alter table public.journal_template_lines add column company_id uuid not null default '0f4cec31-c047-415b-8c64-18a21932620e';

alter table public.fiscal_periods     alter column company_id drop default;
alter table public.journal_entries    alter column company_id drop default;
alter table public.journal_lines      alter column company_id drop default;
alter table public.import_staging     alter column company_id drop default;
alter table public.mapping_rules      alter column company_id drop default;
alter table public.journal_templates  alter column company_id drop default;
alter table public.journal_template_lines alter column company_id drop default;

-- 親になる表の UNIQUE (id, company_id)
alter table public.accounts        add constraint accounts_id_company_key unique (id, company_id);
alter table public.fiscal_periods  add constraint fiscal_periods_id_company_key unique (id, company_id);
alter table public.journal_entries add constraint journal_entries_id_company_key unique (id, company_id);
alter table public.journal_templates add constraint journal_templates_id_company_key unique (id, company_id);

-- 会社への外部キー
alter table public.accounts        add constraint accounts_company_fkey foreign key (company_id) references public.companies(id);
alter table public.fiscal_periods  add constraint fiscal_periods_company_fkey foreign key (company_id) references public.companies(id);
alter table public.import_staging  add constraint import_staging_company_fkey foreign key (company_id) references public.companies(id);
alter table public.mapping_rules   add constraint mapping_rules_company_fkey foreign key (company_id) references public.companies(id);
alter table public.journal_templates add constraint journal_templates_company_fkey foreign key (company_id) references public.companies(id);
-- journal_entries / journal_lines / journal_template_lines の会社は、親（期・仕訳・テンプレート）経由の複合外部キーで守る

-- accounts.company_kind: 会社の区分を持たせ、区分別の CHECK を宣言的に書けるようにする
alter table public.accounts
  add constraint accounts_company_kind_fkey foreign key (company_id, company_kind) references public.companies(id, kind);

-- ============================================================
-- 3. 複合外部キー（会社をまたぐ参照の拒否）。旧の単独外部キーは同じ名前の別定義に置き換える
-- ============================================================
-- accounts.parent_id（補助科目は同じ会社の親だけ。parent_id が NULL の行は検査されない）
alter table public.accounts drop constraint accounts_parent_id_fkey;
alter table public.accounts
  add constraint accounts_parent_id_fkey foreign key (parent_id, company_id) references public.accounts(id, company_id);

-- journal_entries.period_id
alter table public.journal_entries drop constraint journal_entries_period_id_fkey;
alter table public.journal_entries
  add constraint journal_entries_period_id_fkey foreign key (period_id, company_id) references public.fiscal_periods(id, company_id);

-- journal_lines.entry_id / account_id
alter table public.journal_lines drop constraint journal_lines_entry_id_fkey;
alter table public.journal_lines drop constraint journal_lines_account_id_fkey;
alter table public.journal_lines
  add constraint journal_lines_entry_id_fkey foreign key (entry_id, company_id) references public.journal_entries(id, company_id) on delete cascade;
alter table public.journal_lines
  add constraint journal_lines_account_id_fkey foreign key (account_id, company_id) references public.accounts(id, company_id);

-- import_staging の科目4列（ON DELETE SET NULL は列を指定して company_id を巻き込まない。PostgreSQL 15 以降）
alter table public.import_staging drop constraint import_staging_counter_account_id_fkey;
alter table public.import_staging drop constraint import_staging_credit_sub_account_id_fkey;
alter table public.import_staging drop constraint import_staging_debit_sub_account_id_fkey;
alter table public.import_staging drop constraint import_staging_predicted_account_id_fkey;
alter table public.import_staging
  add constraint import_staging_counter_account_id_fkey foreign key (counter_account_id, company_id) references public.accounts(id, company_id);
alter table public.import_staging
  add constraint import_staging_predicted_account_id_fkey foreign key (predicted_account_id, company_id) references public.accounts(id, company_id);
alter table public.import_staging
  add constraint import_staging_credit_sub_account_id_fkey foreign key (credit_sub_account_id, company_id) references public.accounts(id, company_id) on delete set null (credit_sub_account_id);
alter table public.import_staging
  add constraint import_staging_debit_sub_account_id_fkey foreign key (debit_sub_account_id, company_id) references public.accounts(id, company_id) on delete set null (debit_sub_account_id);

-- mapping_rules
alter table public.mapping_rules drop constraint mapping_rules_account_id_fkey;
alter table public.mapping_rules
  add constraint mapping_rules_account_id_fkey foreign key (account_id, company_id) references public.accounts(id, company_id);

-- journal_template_lines
alter table public.journal_template_lines drop constraint journal_template_lines_account_id_fkey;
alter table public.journal_template_lines drop constraint journal_template_lines_template_id_fkey;
alter table public.journal_template_lines
  add constraint journal_template_lines_template_id_fkey foreign key (template_id, company_id) references public.journal_templates(id, company_id) on delete cascade;
alter table public.journal_template_lines
  add constraint journal_template_lines_account_id_fkey foreign key (account_id, company_id) references public.accounts(id, company_id) on delete set null (account_id);

-- 子の複合外部キーの検索を支えるインデックス（既存の単独インデックスはそのまま）
create index idx_journal_entries_period_company on public.journal_entries (period_id, company_id);

-- ============================================================
-- 4. 会社ごとの一意性
-- ============================================================
alter table public.accounts drop constraint accounts_code_unique;
alter table public.accounts add constraint accounts_company_code_key unique (company_id, code);

drop index public.idx_fiscal_periods_single_current;
create unique index idx_fiscal_periods_single_current on public.fiscal_periods (company_id) where (is_current = true);

-- ============================================================
-- 5. company_id の自動設定・変更禁止（保存 RPC は変更しない）
-- ============================================================
create or replace function public.fill_journal_entry_company()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.company_id is null then
    select company_id into new.company_id from fiscal_periods where id = new.period_id;
  end if;
  return new;
end;
$function$;

create or replace function public.fill_journal_line_company()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.company_id is null then
    select company_id into new.company_id from journal_entries where id = new.entry_id;
  end if;
  return new;
end;
$function$;

create or replace function public.fill_template_line_company()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.company_id is null then
    select company_id into new.company_id from journal_templates where id = new.template_id;
  end if;
  return new;
end;
$function$;

create or replace function public.fill_account_company_kind()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- 呼び出し側が company_kind を指定しても、会社の区分で上書きする（会社が無ければ外部キーが拒否する）
  select kind into new.company_kind from companies where id = new.company_id;
  if new.company_kind is null then
    raise exception using errcode = '23503', message = 'company_id の会社が存在しません',
      detail = format('company_id = %s', new.company_id);
  end if;
  return new;
end;
$function$;

create or replace function public.forbid_company_id_change()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.company_id is distinct from old.company_id then
    raise exception using errcode = 'P0001', message = 'COMPANY_ID_IMMUTABLE',
      detail = format('%s の company_id は変更できません', tg_table_name);
  end if;
  return new;
end;
$function$;

-- 名前の先頭を "a_" にして、既存の BEFORE トリガー（trg_journal_entries_check_period など）より先に動かす
create trigger trg_journal_entries_a_fill_company
  before insert on public.journal_entries
  for each row execute function public.fill_journal_entry_company();
create trigger trg_journal_lines_a_fill_company
  before insert on public.journal_lines
  for each row execute function public.fill_journal_line_company();
create trigger trg_journal_template_lines_a_fill_company
  before insert on public.journal_template_lines
  for each row execute function public.fill_template_line_company();
create trigger trg_accounts_a_fill_company_kind
  before insert or update of company_id on public.accounts
  for each row execute function public.fill_account_company_kind();

create trigger trg_accounts_company_immutable          before update of company_id on public.accounts          for each row execute function public.forbid_company_id_change();
create trigger trg_fiscal_periods_company_immutable    before update of company_id on public.fiscal_periods    for each row execute function public.forbid_company_id_change();
create trigger trg_journal_entries_company_immutable   before update of company_id on public.journal_entries   for each row execute function public.forbid_company_id_change();
create trigger trg_journal_lines_company_immutable     before update of company_id on public.journal_lines     for each row execute function public.forbid_company_id_change();
create trigger trg_import_staging_company_immutable    before update of company_id on public.import_staging    for each row execute function public.forbid_company_id_change();
create trigger trg_mapping_rules_company_immutable     before update of company_id on public.mapping_rules     for each row execute function public.forbid_company_id_change();
create trigger trg_journal_templates_company_immutable before update of company_id on public.journal_templates for each row execute function public.forbid_company_id_change();
create trigger trg_journal_template_lines_company_immutable before update of company_id on public.journal_template_lines for each row execute function public.forbid_company_id_change();

-- ============================================================
-- 6. 科目の区分・税区分グループ・補助科目の継承
-- ============================================================
-- 6-1. 既存の補助科目の区分を親に揃える（本番に 700-0002 の区分が NULL という不整合がある）
update public.accounts c
   set type = p.type, bs_category = p.bs_category, pl_category = p.pl_category
  from public.accounts p
 where c.parent_id = p.id
   and (c.type, c.bs_category, c.pl_category) is distinct from (p.type, p.bs_category, p.pl_category);

-- 6-2. default_tax_code: 表示名・tax_codes.id → 税区分グループ（NONE / SALES / SALES_RETURN / PURCHASE / PURCHASE_RETURN / NON_TAXABLE_SALES）
--      OUT_OF_SCOPE・不課税 → NONE。課税10% → 収益は SALES、それ以外は PURCHASE。NULL はそのまま。想定外の値は CHECK で止まる
update public.accounts
   set default_tax_code = case
         when default_tax_code in ('OUT_OF_SCOPE', '不課税') then 'NONE'
         when default_tax_code = '課税10%' and type = 'REVENUE' then 'SALES'
         when default_tax_code = '課税10%' then 'PURCHASE'
         else default_tax_code
       end
 where default_tax_code in ('OUT_OF_SCOPE', '不課税', '課税10%');

alter table public.accounts
  add constraint accounts_default_tax_code_check
  check (default_tax_code is null or default_tax_code in ('NONE', 'SALES', 'SALES_RETURN', 'PURCHASE', 'PURCHASE_RETURN', 'NON_TAXABLE_SALES'));

-- 6-3. 区分の値・種別との整合・会社区分別の制約
alter table public.accounts
  add constraint accounts_bs_category_check check (bs_category is null or bs_category in
    ('CURRENT_ASSETS', 'FIXED_ASSETS', 'DEFERRED_ASSETS', 'OWNER_DRAWINGS',
     'CURRENT_LIABILITIES', 'FIXED_LIABILITIES', 'OWNER_CONTRIBUTIONS', 'EQUITY')),
  add constraint accounts_pl_category_check check (pl_category is null or pl_category in
    ('REVENUE', 'NON_OP_INCOME', 'EXTRA_INCOME', 'RESERVE_REVERSAL',
     'COGS', 'SGA', 'NON_OP_EXPENSE', 'EXTRA_LOSS', 'TAX', 'RESERVE_PROVISION')),
  add constraint accounts_category_by_type_check check (
    (bs_category is null or (
       (type = 'ASSET'     and bs_category in ('CURRENT_ASSETS', 'FIXED_ASSETS', 'DEFERRED_ASSETS', 'OWNER_DRAWINGS')) or
       (type = 'LIABILITY' and bs_category in ('CURRENT_LIABILITIES', 'FIXED_LIABILITIES', 'OWNER_CONTRIBUTIONS')) or
       (type = 'EQUITY'    and bs_category = 'EQUITY')))
    and
    (pl_category is null or (
       (type = 'REVENUE' and pl_category in ('REVENUE', 'NON_OP_INCOME', 'EXTRA_INCOME', 'RESERVE_REVERSAL')) or
       (type = 'EXPENSE' and pl_category in ('COGS', 'SGA', 'NON_OP_EXPENSE', 'EXTRA_LOSS', 'TAX', 'RESERVE_PROVISION'))))
  ),
  add constraint accounts_category_by_kind_check check (
    (company_kind = 'CORPORATION'
       and coalesce(bs_category, '') not in ('OWNER_DRAWINGS', 'OWNER_CONTRIBUTIONS')
       and coalesce(pl_category, '') not in ('RESERVE_REVERSAL', 'RESERVE_PROVISION'))
    or
    (company_kind = 'INDIVIDUAL'
       and coalesce(pl_category, '') not in ('NON_OP_INCOME', 'NON_OP_EXPENSE', 'EXTRA_INCOME', 'EXTRA_LOSS', 'TAX'))
  );

-- 6-4. 補助科目: 親の type / 区分を継承する。補助科目の下に補助科目は作れない
create or replace function public.inherit_parent_account_attrs()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
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
$function$;

create trigger trg_accounts_b_inherit_parent
  before insert or update of parent_id, type, bs_category, pl_category on public.accounts
  for each row execute function public.inherit_parent_account_attrs();

create or replace function public.propagate_parent_account_attrs()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  update accounts
     set type = new.type, bs_category = new.bs_category, pl_category = new.pl_category
   where parent_id = new.id
     and (type, bs_category, pl_category) is distinct from (new.type, new.bs_category, new.pl_category);
  return null;
end;
$function$;

create trigger trg_accounts_propagate_to_children
  after update of type, bs_category, pl_category on public.accounts
  for each row when (new.parent_id is null)
  execute function public.propagate_parent_account_attrs();

-- ============================================================
-- 7. 繰越先の科目（companies.carry_forward_account_id）
-- ============================================================
-- (carry_forward_account_id, id) → accounts (id, company_id): 自社の科目だけを指せる。参照されている科目は削除できない
alter table public.companies
  add constraint companies_carry_forward_fkey foreign key (carry_forward_account_id, id) references public.accounts(id, company_id);

create or replace function public.check_company_carry_forward()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
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
$function$;

create trigger trg_companies_check_carry_forward
  before insert or update of carry_forward_account_id on public.companies
  for each row execute function public.check_company_carry_forward();

create or replace function public.guard_carry_forward_account()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if exists (select 1 from companies where carry_forward_account_id = old.id)
     and (new.type <> 'EQUITY' or new.bs_category is distinct from 'EQUITY' or new.parent_id is not null) then
    raise exception using errcode = 'P0001', message = 'INVALID_CARRY_FORWARD_ACCOUNT',
      detail = format('繰越先に設定されている科目は、純資産（EQUITY）の親科目のまま変更できません: %s %s', old.code, old.name);
  end if;
  return new;
end;
$function$;

create trigger trg_accounts_guard_carry_forward
  before update of type, bs_category, parent_id on public.accounts
  for each row execute function public.guard_carry_forward_account();

-- 既存のデフォルト会社の繰越先は 540（繰越利益）。無ければ NULL のまま（ステップ2で「未設定」エラーにする）
update public.companies c
   set carry_forward_account_id = a.id
  from public.accounts a
 where c.id = '0f4cec31-c047-415b-8c64-18a21932620e'
   and a.company_id = c.id and a.code = '540' and a.parent_id is null
   and a.type = 'EQUITY' and a.bs_category = 'EQUITY';

-- ============================================================
-- 8. get_opening_balances_for_period: 期の会社の仕訳だけを累計する（暫定修正）
-- ============================================================
create or replace function public.get_opening_balances_for_period(target_period_id uuid)
 returns table(account_id uuid, balance numeric)
 language plpgsql
as $function$
begin
  return query
    with target_period as (
      select start_date, company_id
        from fiscal_periods
       where id = target_period_id
    ),
    relevant_lines as (
      select
        l.account_id,
        l.side,
        l.amount
      from journal_lines as l
      join journal_entries as e on l.entry_id = e.id
      where e.date < (select start_date from target_period)
        and e.company_id = (select company_id from target_period)
    )
    select
      rl.account_id,
      sum(
        case when rl.side = 'DEBIT' then rl.amount else -rl.amount end
      )::numeric as balance
    from relevant_lines as rl
    group by rl.account_id
    having sum(
      case when rl.side = 'DEBIT' then rl.amount else -rl.amount end
    ) <> 0;
end;
$function$;

-- ============================================================
-- 9. 区分別の初期科目セット（弥生会計の標準勘定科目から諸口を除いたもの）
--    法人 181科目 / 個人 141科目。生成元: 弥生の勘定科目一覧表（法人・個人）
--    default_tax_code は税区分グループ（弥生の 対象外/課税売倒/有価譲渡/仮払・仮受消費税等 は NONE）
--    aliases は、弥生のサーチキー英字（ROMAN）＋既存DBの読み（KANA）・ローマ字・略称（同名の親科目のみ。補助科目は除く）。
--    normalized_alias は lib/account-search.ts の normalizeText と同じ変換済み。法人388件・個人320件
--    繰越先: 法人 = 540 繰越利益、個人 = 400 元入金
-- ============================================================
create or replace function public.company_seed_accounts(p_kind text)
 returns jsonb
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
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
$function$;

create or replace function public.create_company(
  p_name        text,
  p_kind        text,
  p_tax_method  text,
  p_start_date  date,
  p_end_date    date
)
 returns jsonb
 language plpgsql
 volatile
 security invoker
 set search_path to 'public'
as $function$
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
$function$;

-- import_staging_entries: 取込行と期の会社の一致確認を追加（それ以外は 20261110170000 の定義のまま）
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
$function$;

-- ============================================================
-- 10. 権限・RLS（新テーブル companies / 新関数）
-- ============================================================
alter table public.companies enable row level security;
create policy allow_all_companies on public.companies as permissive for all to public using (true) with check (true);
-- 会社の削除機能は無いため DELETE は付与しない
grant select, insert, update on public.companies to anon, authenticated;
-- 新テーブルには TRUNCATE / REFERENCES / TRIGGER が既定で再付与されるため、剥奪し直す
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke all on function public.forbid_company_kind_change() from public;
revoke all on function public.fill_journal_entry_company() from public;
revoke all on function public.fill_journal_line_company() from public;
revoke all on function public.fill_template_line_company() from public;
revoke all on function public.fill_account_company_kind() from public;
revoke all on function public.forbid_company_id_change() from public;
revoke all on function public.inherit_parent_account_attrs() from public;
revoke all on function public.propagate_parent_account_attrs() from public;
revoke all on function public.check_company_carry_forward() from public;
revoke all on function public.guard_carry_forward_account() from public;
revoke all on function public.company_seed_accounts(text) from public;
revoke all on function public.create_company(text, text, text, date, date) from public;
grant execute on function public.company_seed_accounts(text) to anon, authenticated;
grant execute on function public.create_company(text, text, text, date, date) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
