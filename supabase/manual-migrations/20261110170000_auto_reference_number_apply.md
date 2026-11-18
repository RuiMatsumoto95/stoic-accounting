# 伝票番号の自動採番: 適用手順と同時実行テスト

対象: `20261110170000_auto_reference_number.sql`（変更）／ `.test.sql`（テスト・45項目）

現行のテスト準備は1a（`20261112120000_company_support.sql`）適用後のDBが前提。過去の適用履歴は以下に残すが、現行 `schema.sql` を読み込んだローカルDBで、適用済みの変更SQLを再実行しない。

## 開発時の確認結果（2026-11-10・ローカル PostgreSQL 16）

`supabase/schema.sql`（`ed67125` 時点）を読み込み、変更 SQL → テスト SQL の順に実行した結果。
本番の Supabase は PostgreSQL 17 のため、下の「同時実行テスト」は本番でも実施する。

- テスト SQL: **45項目すべて `ALL PASSED`**（`anon` ロールでの保存・編集を含む）。
- 変異テスト（実装をわざと壊してテストが落ちるか）: 採番の +1 を外す／編集で NULL が番号を消す／自分自身を重複扱い／
  作成時の重複確認なし／取込が採番しない／`ledger_view` の GRANT なし／PUBLIC に EXECUTE が残る／
  採番ロックを期の行 `FOR UPDATE` に戻す／採番ロックなし／取込の失敗を握りつぶす、のいずれも**テストが失敗**した。
- 2セッションの競合（T1〜T3）と、pgbench（10接続×20秒・作成／編集／取込／**一括日付変更**の混在）。

### レビュー指摘による設計変更（ロック方式）

初版は「会計期の行を `FOR UPDATE` でロックしてから採番」だったが、既存の**一括日付変更**
（`app/journals/page.tsx` の `executeBulkEdit`。`journal_entries` を直接 `UPDATE`）と、同じ仕訳に対する編集 RPC が
**デッドロックし得る**ことが分かった。一括日付変更は「仕訳行のロック → `trg_journal_entries_check_period` による
会計期の `FOR SHARE`」の順で動き、初版の編集 RPC は「会計期の `FOR UPDATE` → 仕訳行」の順で、順序が逆になるため。

- ローカルで再現した（遅延トリガーで窓を広げた確定的な再現）: `ERROR: deadlock detected`。
- pgbench（一括日付変更を混在）: 修正前は 9,092 トランザクション中 **デッドロック 18 件（うち編集 RPC×一括変更 16 件）**。
- **修正**: 採番ロックを、会計期ごとの**アドバイザリロック**（`pg_advisory_xact_lock`）に変更した。採番に関わる経路
  （create / update / import）以外は取らず、行ロックとも競合しないため、このサイクルが成立しない。一括日付変更は従来どおり
  採番ロックを取らない（アプリの変更は不要）。
- 修正後: 同じ再現手順（T6）で**デッドロックなし**（編集 RPC は一括変更のコミットまで待つだけ）。
  pgbench は 12,690 と 10,742 トランザクション（2回）で **デッドロック 0 件・失敗 0 件・番号の重複 0 件**。
- 参考: 一括変更どうし（複数行を別々の順で行ロックする）は、従来から相互待ちになり得る。採番とは無関係で、今回は変えない
  （画面は1人で操作するため、同時に2つの一括変更は通常起きない）。

---

## 適用の順序（DB とアプリは一組で扱う）

`create_journal_entry` の戻り値が `uuid` から `jsonb`（`{id, reference_number}`）に、`p_reference_number` の型が
`text` から `integer` に変わる。**旧アプリのまま SQL だけ適用すると、新規保存・編集が失敗する。**
逆に、新アプリのまま SQL を適用しないと、同じく失敗する。

1. アプリの変更（Codex）を `main` に反映し、ローカルで `npm test` / `npm run typecheck` / `npm run build` を通す。
2. **開発サーバー（`npm run dev`）を止める。** 以降、手順 7 が終わるまで、画面から保存・編集・一括変更をしない。
3. （推奨）適用前に、Supabase のダッシュボードで `journal_entries` を CSV などでエクスポートしておく。
   Free プランには自動バックアップがない（`CLAUDE.md` の「次にやること」4）。今回は 37 件がすべて NULL の列の型変更で、
   データを書き換えないが、保険として。
4. Supabase の SQL Editor で `20261110170000_auto_reference_number.sql` を**全体**実行する。
   - 途中でエラーが出たらトランザクション全体が取り消される（`begin; … commit;`）。何も変わらない。
   - 既に `reference_number` に値がある場合は、先頭のガードで中断する（今回は 37 件すべて NULL のため通る想定）。
5. SQL Editor で `20261110170000_auto_reference_number.test.sql` を全体実行し、
   `ERROR: TEST RESULT: ALL PASSED (45 checks)` を確認する。**これ以外の表示は成功と判断しない。**
6. `20261101180100_concurrency_test.md` の手順 0（COMMIT 経路）を1回実行する。
   期待: `INVALID_JOURNAL_LINES`（明細不足）で拒否され、`count(*)` が 0。
7. **同時実行テスト（下記 T1〜T5）を実施する。** 変更 SQL を適用した後でないと実行できない（新しい RPC が必要）ため、
   **適用後・アプリ再開前**に行う。テスト用の会計期間・科目を使い、終わったら「後片付け」を実行する。
8. 新アプリを起動し、実機で確認する（確認項目は Codex 指示文に書く）。
9. `supabase/schema.sql` と `CLAUDE.md` を更新し、Project のコピーも差し替える（DB 変更の手順 3）。

### 戻す場合

この変更を取り消す SQL は用意していない（未検証のため）。戻す必要が出たときは、`supabase/schema.sql`（`ed67125`）の
`create_journal_entry` / `update_journal_entry` / `import_staging_entries` の定義で作り直し、新しい補助関数を DROP し、
列を `text` に戻し、`ledger_view` を作り直して GRANT する、という手順になる。適用前のエクスポート（手順 3）は、この意味でも有用。

---

## 同時実行テスト（独立した2接続が必要・適用後・アプリ再開前に実施）

SQL Editor は同じ接続が維持される保証がないため、**psql を2つ起動**して行う。
接続文字列・準備は `20261101180100_concurrency_test.md` と同じ（Session pooler または Direct connection。
Transaction pooler（6543）は使わない）。**本番とは別の、テスト用の会計期間・科目を使う**（下の準備でコミットされる）。
本番に残る痕跡は、テスト用の仕訳・科目・期間と、削除時の訂正履歴（後片付けで削除できる）。

### 準備（どちらか片方で1回・コミットされる）

```sql
insert into companies (name, kind, tax_method)
values ('ZZNUMBERING' || replace(gen_random_uuid()::text, '-', ''), 'CORPORATION', 'EXEMPT')
returning id as "COMPANY" \gset
insert into fiscal_periods (company_id, name, start_date, end_date, is_current)
values (:'COMPANY', 'ZZTEST 採番', '2099-04-01', '2100-03-31', false)
returning id as "P" \gset
insert into accounts (company_id, code, name, type, bs_category)
values (:'COMPANY', 'ZZTEST-R1', 'テスト現金', 'ASSET', 'CURRENT_ASSETS')
returning id as "CASH" \gset
insert into accounts (company_id, code, name, type, pl_category)
values (:'COMPANY', 'ZZTEST-R2', 'テスト売上', 'REVENUE', 'REVENUE')
returning id as "SALES" \gset
\echo COMPANY :COMPANY P :P CASH :CASH SALES :SALES
```

両方のターミナルで `\set COMPANY '...'` `\set P '...'` `\set CASH '...'` `\set SALES '...'` を実行し、続けて明細を定義する（準備した側は `\gset` で設定済み）。会社IDは架空の会社のものを使い、既存の当期は変更しない。

```sql
\set L '[{"side":"DEBIT","account_id":"':CASH'","amount":"100"},{"side":"CREDIT","account_id":"':SALES'","amount":"100"}]'
```

以下の `create_journal_entry(...)` の呼び出しは、すべて次の形で書く（戻り値は `{"id": …, "reference_number": …}`）。

```sql
select create_journal_entry(:'P', '2099-05-01', 'ZZTEST A', null, :'L'::jsonb);
```

### T1: 自動採番どうしの競合（連番になる・重複しない）

| 順 | ターミナル A | ターミナル B | 期待 |
|---|---|---|---|
| 1 | `begin;` | `begin;` | |
| 2 | `select create_journal_entry(:'P','2099-05-01','ZZTEST A',null,:'L'::jsonb);` | | `reference_number: 1` |
| 3 | | `select create_journal_entry(:'P','2099-05-01','ZZTEST B',null,:'L'::jsonb);` | **待たされる** |
| 4 | `commit;` | | B の手順3が完了し **`reference_number: 2`** |
| 5 | | `commit;` | |

### T2: 手入力（保持中）と自動採番の競合（ロック待ちの後に最新の最大値を見る）

| 順 | ターミナル A | ターミナル B | 期待 |
|---|---|---|---|
| 1 | `begin;` | `begin;` | |
| 2 | `select create_journal_entry(:'P','2099-05-02','ZZTEST A10',10,:'L'::jsonb);` | | `reference_number: 10` |
| 3 | | `select create_journal_entry(:'P','2099-05-02','ZZTEST Bauto',null,:'L'::jsonb);` | **待たされる** |
| 4 | `commit;` | | B の手順3が完了し **`reference_number: 11`**（1 や 3 ではない） |
| 5 | | `commit;` | |

### T3: 同じ番号の同時手入力（重複不可）

| 順 | ターミナル A | ターミナル B | 期待 |
|---|---|---|---|
| 1 | `begin;` | `begin;` | |
| 2 | `select create_journal_entry(:'P','2099-05-03','ZZTEST A50',50,:'L'::jsonb);` | | `reference_number: 50` |
| 3 | | `select create_journal_entry(:'P','2099-05-03','ZZTEST B50',50,:'L'::jsonb);` | **待たされる** |
| 4 | `commit;` | | B の手順3が **`ERROR: DUPLICATE_REFERENCE_NUMBER`** |
| 5 | | `rollback;` | |

確認: `select count(*) from journal_entries where period_id = :'P' and reference_number = 50;` → **1**

### T4: 編集 RPC と新規 RPC の競合（デッドロックにならない）

| 順 | ターミナル A | ターミナル B | 期待 |
|---|---|---|---|
| 1 | `begin;` | `begin;` | |
| 2 | `select update_journal_entry((select id from journal_entries where period_id=:'P' and description='ZZTEST A'), '2099-05-04', 'ZZTEST A2', null, :'L'::jsonb);` | | 即完了 |
| 3 | | `select create_journal_entry(:'P','2099-05-04','ZZTEST C',null,:'L'::jsonb);` | **待たされる** |
| 4 | `commit;` | | B の手順3が完了し、**デッドロックにならない** |
| 5 | | `commit;` | |

逆順（B が先に `create_journal_entry` を実行して保持、A が `update_journal_entry` を実行）も、待たされるだけでデッドロックにならないこと。

### T5: 会計期間の短縮との競合

`20261101180100_concurrency_test.md` の手順2（登録と期間短縮の競合）を、そのまま実施して結果が変わらないこと。
今回の採番ロックは `fiscal_periods` の行をロックしないので、期間の更新が待たされるタイミングは従来（登録の
INSERT で期間チェック Trigger が `FOR SHARE` を取った時点から）と同じ。

### T6: 編集 RPC と一括日付変更の競合（検証環境のみ・本番では実施しない）

一括日付変更（`journal_entries` を直接 `UPDATE`）は、仕訳行をロックしてから期間チェック Trigger で会計期の `FOR SHARE` を取る。
この間隔は極めて短く、通常は再現しないため、**一時的な遅延 Trigger で間隔を広げて**確認する。
本番に一時 Trigger を作るのは避け、**ローカルの PostgreSQL、または使い捨ての Supabase プロジェクト**
（`schema.sql` → 既存 migration → 今回の SQL を適用したもの）で行う。ローカルでは実施済み（上記）。

```sql
-- 準備（検証環境のみ）: check_period より前に発火する遅延 Trigger（名前順で先に発火する）
create function zz_sleep() returns trigger language plpgsql as $f$ begin perform pg_sleep(3); return new; end $f$;
create trigger trg_journal_entries_a_zz_sleep before update of date on journal_entries
  for each row execute function zz_sleep();
```

| 順 | ターミナル A（一括日付変更の再現） | ターミナル B（編集 RPC） | 期待 |
|---|---|---|---|
| 1 | `begin;` | `begin;` | |
| 2 | `update journal_entries set date = '2099-05-10' where id = :'E';` | | 仕訳行をロックし、Trigger で3秒待つ |
| 3 | | （A の開始から1秒後）`select update_journal_entry(:'E','2099-05-11','ZZTEST E2',null,:'L'::jsonb);` | **待たされる** |
| 4 | `commit;` | | B の手順3が完了する。**`deadlock detected` が出ない** |
| 5 | | `commit;` | |

（採番ロックを `fiscal_periods` の `FOR UPDATE` にすると、手順 3〜4 で `ERROR: deadlock detected` になる。）
終わったら `drop trigger trg_journal_entries_a_zz_sleep on journal_entries; drop function zz_sleep();`

### 後片付け（準備でコミットしたテストデータの削除）

```sql
begin;
delete from journal_entries where company_id = :'COMPANY';
delete from journal_entry_logs where before_data->'entry'->>'company_id' = :'COMPANY';
delete from import_staging where company_id = :'COMPANY';
delete from accounts where company_id = :'COMPANY';
delete from fiscal_periods where company_id = :'COMPANY';
delete from companies where id = :'COMPANY';
commit;
```

最後の確認: `select count(*) from journal_entries where company_id = :'COMPANY';` → 0、
`select count(*) from journal_entry_logs where before_data->'entry'->>'company_id' = :'COMPANY';` → 0、
`select count(*) from companies where id = :'COMPANY';` → 0。会社・ログの削除はpostgres等の管理権限で実行する。

---

## 自動採番の保証範囲（`CLAUDE.md` に明記する内容）

- 自動採番は**保存 RPC（`create_journal_entry`・`import_staging_entries`）経由のみ**。REST などから `journal_entries` に
  直接 INSERT すると NULL のまま入る（過去 37 件と同じ。NULL は正当な値）。
- DB が常に保証するのは、CHECK（1〜999999999）と、同じ会計期内の重複不可（部分一意インデックス）まで。
- **採番の直列化は、会計期ごとのアドバイザリロックで行う。** `fiscal_periods` の行ロックにしないこと
  （一括日付変更など、行ロック → 期の `FOR SHARE` の順で動く直接 UPDATE とデッドロックするため）。
  新しい保存処理を作るときは、採番に関わるなら最初にこのロックを取る。
- 欠番は埋めない。最後の仕訳を削除した場合だけ、その番号が次の自動採番で再利用される。削除された仕訳の番号は訂正履歴に残る。
- 編集で番号を空にしても「変更しない」。一度付いた番号を NULL に戻す操作はできない。
- CSV の再取込では、元の伝票番号は引き継がず、取込時に新しく採番する（取込用ステージングに列がないため）。

## アプリ側の対応（Codex 指示文に入れる項目）

- `lib/errors.ts` に `DUPLICATE_REFERENCE_NUMBER` / `INVALID_REFERENCE_NUMBER` / `ENTRY_PERIOD_CHANGED` を追加し、
  `DOMAIN_ERRORS` に登録する。
- `translateSupabaseError` の `23505` は、メッセージに制約名 `uq_journal_entries_period_reference_number` が含まれるときだけ
  `DUPLICATE_REFERENCE_NUMBER` にする（既存の科目コード重複は従来どおり）。
- `lib/journal-save.ts`: `p_reference_number` は `number | null` を送る。`createJournalEntry` は `{ id, referenceNumber }` を返す。
  全角数字は半角に直し、半角数字以外は送る前に弾く純関数を作る（テスト対象）。
- 型: `reference_number: string | null` の宣言（10 か所）を `number | null` に。テストデータの `'R-1'` なども直す。
- 仮の行は「…」、確定後は DB が返した番号。保存に失敗したら行ごと消す（番号を出さない）。
- 編集で番号を空にして保存したとき、画面側の行を `null` にしない（元の番号を保つ）。
- 伝票番号の入力欄は `type="number"` にしない（IME 対策）。
- 一括日付変更（`executeBulkEdit`）は変更しない（採番ロックを取らない現状のままでデッドロックにならない）。
