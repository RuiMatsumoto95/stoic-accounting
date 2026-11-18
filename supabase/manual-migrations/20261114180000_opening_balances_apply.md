# 期首残高（A案＋任意期の手動期首残高）: 適用手順

対象: `20261114180000_opening_balances.sql`（変更）／ `.test.sql`（テスト・66項目）／ `20261112120000_company_support.test.sql`（G1・G2 の期待値を変更。136項目）
設計: Project の `SA_step2_sql_design_v2.md`（ステップ2・DB）

## 開発時の確認結果（2026-11-14・ローカル PostgreSQL 16）

`supabase/schema.sql`（main = dca8e56）を読み込んだ DB に、変更 SQL を適用して確認した。**本番の Supabase は PostgreSQL 17 のため、下記の本番での確認は省略しない。**
ローカルは PG16 のため、`schema.sql` から `transaction_timeout` の行と GRANT 内の `MAINTAIN` を除いたコピーで読み込んだ（本番の権限とは厳密には異なる）。

- 変更 SQL: エラーなしで適用（1トランザクション）。再適用は「already exists」で失敗する（冪等ではない。やり直すときは下の「ロールバック」を使う）。
- 新規テスト（`20261114180000_opening_balances.test.sql`）: **52項目すべて `ALL PASSED`**。
- 既存テスト: `20261112120000_company_support.test.sql` は、G1・G2 の期待値を変更したうえで **136項目すべて `ALL PASSED`**（G2b を1項目追加）。`20261112150000_company_archive.test.sql` は 7 項目 `ALL PASSED`（変更なし）。
- **変更前のテストは G2 で失敗する**（法人Cは繰越先が NULL で、前期に売上があるため `CARRY_FORWARD_NOT_SET`）。G1 は件数が偶然一致して通ってしまうため、期待値を強化した（6-1 の承認済みの変更）。
- **同時実行（2接続）の確認**（2026-11-14・ChatGPT レビューの指摘）: 期首明細の保存（未コミット）と科目の区分変更が同時に走ると、修正前は科目の区分変更が通り、不正な明細が残った（再現した）。明細の科目検証で `FOR SHARE` を取るように修正し、**どちらの順序でも不正な明細が残らない**ことを確認した。手順は `20261114180000_opening_balances_concurrency.md`（本番での再確認用）。
- `p_auto_balance` に null を渡すと、修正前は自動調整に進んでしまった（再現した）。null は false として扱うよう修正し、T7h で確認した。
- 変異テスト（実装をわざと壊してテストが落ちるか）: 遅延制約が新しい期だけを検証／`bs_category` NULL を許可／事業主貸借を畳み込まない／小数第3位の検証なし／期の外部キーを CASCADE／遅延制約トリガーなし／RPC の PUBLIC への EXECUTE／基準の期を使わない／区分変更ガードなし／`period_id` 付け替え禁止なし／繰越先未設定を黙って進む／損益を畳み込まず返す、のいずれも**テストが失敗**した。
- データ入りの DB への適用（法人1社・2期・仕訳1件）: 件数（科目181・仕訳1・明細2）は変わらず、新しい3表は空。**2期の期首残高だけが変わる**（適用前: 現金1000・売上-1000 → 適用後: 現金1000・繰越利益-1000）。これは仕様どおりの変更（損益は繰越先へ畳み込む）。
- **未確認**: 同時実行（同じ期への同時保存。advisory lock の効果）、PostgreSQL 17 固有の挙動、性能（件数が増えたときの導出の重さ）、実機（画面）での確認。

## 適用の順序

**アプリ（Codex）の変更を反映するまでの運用上の制約**
- 変更 SQL を先に適用すると、**繰越先が未設定（NULL）の会社で、前期に損益や事業主貸借の仕訳がある期**の元帳・試算表・補助元帳・補助残高は、`getOpeningBalancesByType` がエラーを握りつぶして**空の期首残高を表示する**（BS はエラー表示）。現在、本番はテストデータのみで、繰越先は全社に設定されているはずなので、実害は出ない見込み（手順 1 で確認する）。
- 手動設定の入力画面が無い間は、新しい RPC は SQL Editor からのみ使う。

1. **適用前の確認**（SQL Editor。結果をメモする）
   ```sql
   select (select count(*) from companies) as companies,
          (select count(*) from companies where carry_forward_account_id is null) as carry_null,
          (select count(*) from fiscal_periods) as periods,
          (select count(*) from journal_entries) as entries,
          (select count(*) from journal_lines) as lines,
          (select count(*) from accounts) as accounts;
   ```
   `carry_null` が 0 であること。0 でない場合は適用を止め、繰越先を設定してから進める。
2. **本番のバックアップ**: 適用前のダンプを取る（Free プランは自動バックアップなし。8-4 の課題）。
3. `20261114180000_opening_balances.sql` を **SQL Editor で全体実行**（1トランザクション）。エラーが出たら、全体がロールバックされるので原因を確認する。
4. `20261114180000_opening_balances.test.sql` を**全体実行**し、`ERROR: TEST RESULT: ALL PASSED (66 checks)` を確認する（最後の意図的な例外でロールバックされる。`ZZOB` の架空データは残らない）。
5. `20261114180000_opening_balances_concurrency.md` の手順で、**2つの SQL Editor タブ**による同時実行の確認を行う（任意だが推奨。本番のテスト会社ではなく、ZZOB の架空データで行う）。
6. `20261112120000_company_support.test.sql`（更新版）を**全体実行**し、`ALL PASSED (136 checks)` を確認する。続けて `20261112150000_company_archive.test.sql`（7項目）。
7. **適用後の確認**（手順 1 と同じ SQL の件数が変わらず、新しい3表が空であること）
   ```sql
   select (select count(*) from period_opening_balance_sets) as sets,
          (select count(*) from period_opening_balance_lines) as lines,
          (select count(*) from period_opening_balance_logs) as logs;   -- すべて 0
   select tablename, rowsecurity from pg_tables where tablename like 'period_opening_balance_%';   -- 3行・すべて true
   select p.proname, has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
     from pg_proc p where p.proname in ('save_period_opening_balances', 'clear_period_opening_balances',
          'get_derived_opening_balances_for_period', 'get_opening_balances_for_period');   -- public_exec は false、anon_exec は true
   ```
8. **実データでの確認**（本番のテスト会社を1つ選ぶ。読み取りのみ）: 2期以上ある会社で、2期の期首残高を取得し、損益科目が返らず、繰越先の行に前期までの損益が入り、合計が 0 であることを確認する。
   ```sql
   select a.code, a.name, o.balance
     from public.get_opening_balances_for_period('<2期目の period_id>') o
     join accounts a on a.id = o.account_id order by a.code;
   select sum(balance) from public.get_opening_balances_for_period('<2期目の period_id>');   -- 0
   ```
9. 適用後、`supabase/schema.sql` を本番のダンプで更新し、`CLAUDE.md` のステップ2の記述を更新する。Project の `schema.sql`・`CLAUDE.md` のコピーも更新する。

## ロールバック（適用後にやり直す場合。手動設定のデータが無いこと）

**手動設定が入っていないことを先に確認する**: `select count(*) from period_opening_balance_sets;` が 0 であること。入っている場合は、先に `clear_period_opening_balances` で解除する（履歴は失われる）。
次の SQL は、そのまま実行できる（旧の `get_opening_balances_for_period`＝損益も返す版は、`supabase/schema.sql`（dca8e56）の定義）。**この SQL は適用前に別ファイルとして保存しておく**。

```sql
begin;

drop trigger if exists trg_accounts_c_guard_opening_lines on public.accounts;
drop function if exists public.clear_period_opening_balances(uuid);
drop function if exists public.save_period_opening_balances(uuid, jsonb, text, boolean);

-- 旧の期首残高関数に戻す（schema.sql dca8e56 の定義）
CREATE OR REPLACE FUNCTION public.get_opening_balances_for_period(target_period_id uuid) RETURNS TABLE(account_id uuid, balance numeric)
    LANGUAGE plpgsql
    AS $$
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
$$;

drop function if exists public.get_derived_opening_balances_for_period(uuid);

drop table if exists public.period_opening_balance_logs;
drop table if exists public.period_opening_balance_lines;
drop table if exists public.period_opening_balance_sets;

drop function if exists public.check_opening_balance_set_balanced();
drop function if exists public.guard_opening_balance_line_accounts();
drop function if exists public.check_opening_balance_line_account();
drop function if exists public.opening_balance_account_ok(text, text, text);
drop function if exists public.forbid_opening_balance_period_change();
drop function if exists public.fill_opening_balance_company();

commit;
```

`get_opening_balances_for_period` の権限は、`create or replace` で既存の権限が保たれる（変更SQLで PUBLIC から外し anon/authenticated に付けた状態のまま）。旧の状態（`schema.sql` の権限）と同じかは、適用前の `\df+` 相当の確認（`select proacl from pg_proc where proname = 'get_opening_balances_for_period'`）をメモしておく。

## 既知の制限（設計メモ v2 の 8 章）
- 古い画面からの上書き（楽観的排他）は未対応。同じ期の同時保存は advisory lock で直列化されるが、後の保存が先の変更を上書きする。
- 履歴（`period_opening_balance_logs`）は INSERT ポリシーが開いており、偽造余地がある（`journal_entry_logs` と同じ。8-4）。
- 期の連続性（重複・空白）は DB では守られていない。導出は日付範囲で数えるので、空白があっても二重計上にはならない（T16）。
- `bs_category` が NULL の BS 科目の動きは、導出では科目として返るが BS には出ない（既存の挙動）。
- アプリ側（`getOpeningBalancesByType` のエラー握りつぶし・`lib/errors.ts`・期の削除エラーの翻訳・入力画面・警告）は、この SQL の承認後に Codex で実装する。

## 適用後の追補（2026-11-14）

本番適用後、anon による保存が 42501（PostgREST は 401）で失敗した。SECURITY INVOKER の明細トリガー `check_opening_balance_line_account()` が呼ぶ補助関数 `opening_balance_account_ok(text,text,text)` に、anon/authenticated の EXECUTE が無かったため。利用者が同日本番へ GRANT を手動適用し、両ロールの権限が false → true になったことを確認済み。

追補 `20261114190000_grant_opening_balance_account_ok.sql` は、この GRANT を記録する冪等なマイグレーション。新規環境向けには180000本体にも同じ GRANT を含めたため、190000を省略してもよく、実行しても問題ない。本体の再適用自体は従来どおり冪等ではない。

更新版テストは既存52項目に、補助関数と4 RPC の anon/authenticated の EXECUTE 確認10項目、法人・個人の anon 保存/解除4項目を加えた **66項目**。ロール作成はローカル環境の準備側で行い、テストSQLには含めない。検証結果と未確認事項は `handover/step2-grant-fix-report.md` を参照。本番での更新版SQLテスト・実機再テストは利用者が実施する（今回未確認）。

追加のanon保存チェックでは、先行するpostgres実行の計画が権限不足を隠さないよう、ロール切替後に `DISCARD PLANS` を実行してから保存する。
