# ステップ3: 同時実行の確認手順（psql 2接続）

SQL Editor は1回の実行を自動コミットするため使えない。psql を2つ開く（接続文字列は環境変数 `$SUPABASE_DB_URL` で渡し、貼らない）。
**本番では、テスト用の会社を `create_company` で作ってから行い、終わったら会社ごとアーカイブする**（会社は削除できない）。既存の本番データの期は確定しない。

## 準備（接続A・Bの両方で最初に実行）

テスト用の会社 `CC`（3期: P1=2025・P2=2026・P3=2027、各期に科目 100/700 の仕訳）を作っておく。変数は psql の `\gset`。

```sql
select id as p1 from fiscal_periods where name='P1' and company_id=(select id from companies where name='CC') \gset
select id as p2 from fiscal_periods where name='P2' and company_id=(select id from companies where name='CC') \gset
select id as p3 from fiscal_periods where name='P3' and company_id=(select id from companies where name='CC') \gset
```

以降、「先」は接続Aで `begin;` のあと実行して**コミットしない**。「後」は接続Bで実行する。Bが止まる（待つ）ことを `\timing on` か、別窓の
`select pid, state, wait_event_type, wait_event, left(query,60) from pg_stat_activity where datname=current_database();` で確認してから、Aで `commit;`（または `rollback;`）する。

## 結果（ローカル PostgreSQL 16.15・2接続・先に4秒保持。すべて期待どおり）

| # | 先（A・未コミット） | 後（B） | 結果 |
|---|---|---|---|
| C1 | `create_journal_entry(p1, …)` | `close_fiscal_period(p1)` | Bは A の commit まで待ち（約2.5秒）、成功。新しい仕訳は確定した期に含まれた |
| C2a | `close_fiscal_period(p1)` | `create_journal_entry(p1, …)` | Bは待ち、A の commit 後に `PERIOD_CLOSED` |
| C2b | 同上 | 仕訳ヘッダーの直接 UPDATE | 待ち → `PERIOD_CLOSED` |
| C2c | 同上 | 仕訳の直接 DELETE | 待ち → `PERIOD_CLOSED` |
| C2d | 同上 | 日付の一括変更（`update … where id = any(…)`） | 待ち → `PERIOD_CLOSED` |
| C3 | 科目の区分変更（確定済みの使用なし） | `close_fiscal_period(p1)` | Bは待ち、成功 |
| C4 | `close_fiscal_period(p1)` | その期の明細を持つ科目の区分変更 | Bは待ち → `ACCOUNT_IN_CLOSED_PERIOD` |
| C5a | `close_fiscal_period(p1)` | `close_fiscal_period(p2)` | Bは待ち、A の commit 後に成功（P1・P2 とも確定） |
| C5b | 同上（A を ROLLBACK） | 同上 | Bは待ち → `PERIOD_CLOSE_PREVIOUS_OPEN`（どちらも未確定のまま） |
| C7a | `close_fiscal_period(p1)` | 確定対象と重なる期の INSERT | Bは待ち → `PERIOD_OVERLAPS_CLOSED` |
| C7b | 同上 | P2 の開始日を P1 の内側へ UPDATE | Bは待ち → `PERIOD_OVERLAPS_CLOSED` |
| C8 | **重なる期の INSERT（未コミット）** | `close_fiscal_period(p1)` | Bは待ち、A の commit 後に `PERIOD_CLOSE_CHECK_FAILED`（E5: 重なる期 OV） |
| C9a | P1 の終了日の UPDATE | `close_fiscal_period(p1)`（RPC） | **デッドロックなし**。Bは待ち、成功（新しい日付で評価） |
| C9b | 同上 | `update fiscal_periods set closed_at = now()`（直接） | 同上 |
| C9c | `close_fiscal_period(p1)` | P1 の終了日の UPDATE | Bは待ち → `PERIOD_CLOSED_FIELDS` |
| C9d | 直接 UPDATE で確定 | P1 の終了日の UPDATE | Bは待ち → `PERIOD_CLOSED_FIELDS` |
| C9e | P1 の終了日の UPDATE（ROLLBACK） | `close_fiscal_period(p1)` | Bは待ち、成功 |

各シナリオは、毎回DBを作り直して実行した。未実施: 本番での実行。PostgreSQL 17.12 では C1〜C5・C7〜C9 と C10 を実行済み。C6（pgbench）は PG16 のみ。 [SQLテストの記録](../../docs/60-testing/sql-tests.md#記録にある検証範囲)

## 手順（C1〜C9 すべて）

以降の SQL は、準備で `\gset` した `:p1`・`:p2`・`:p3` と、次の2つの変数を使う（接続A・Bの両方で）。

```sql
select company_id as c from fiscal_periods where id = :'p1' \gset
select id as cash from accounts where company_id = :'c' and code = '100' \gset
select id as rev  from accounts where company_id = :'c' and code = '700' \gset
select id as e1 from journal_entries where period_id = :'p1' order by created_at limit 1 \gset   -- P1 の仕訳（C2b〜d 用）
```

仕訳の INSERT（`INS1` と呼ぶ。P1 向け）:
```sql
select create_journal_entry(:'p1','2025-05-01','c',null,
  jsonb_build_array(jsonb_build_object('side','DEBIT','account_id',:'cash','amount','1','tax_code',null),
                    jsonb_build_object('side','CREDIT','account_id',:'rev','amount','1','tax_code',null)),null);
```
確定（`CL1`）: `select close_fiscal_period(:'p1','test');`　P2 の確定（`CL2`）: `select close_fiscal_period(:'p2','test');`

各シナリオは「接続A: `begin;` → 『先』を実行（commit しない）／ 接続B: 『後』を実行（止まることを確認）／ 接続A: `commit;`（C5b と C9e は `rollback;`）」。毎回、結果を確認したら次のシナリオの前に状態を戻す（確定した期は `reopen_fiscal_period`、追加した期は削除）。

| # | 接続A（先） | 接続B（後） | 期待 |
|---|---|---|---|
| C1 | `INS1` | `CL1` | Bは待ち、commit 後に成功 |
| C2a | `CL1` | `INS1` | Bは待ち、commit 後 `PERIOD_CLOSED` |
| C2b | `CL1` | `update journal_entries set description='x' where id=:'e1';` | 待ち → `PERIOD_CLOSED` |
| C2c | `CL1` | `delete from journal_entries where id=:'e1';` | 待ち → `PERIOD_CLOSED` |
| C2d | `CL1` | `update journal_entries set date='2025-03-02' where id = any(array[:'e1']::uuid[]);` | 待ち → `PERIOD_CLOSED` |
| C3 | `update accounts set bs_category = case when bs_category='FIXED_ASSETS' then 'CURRENT_ASSETS' else 'FIXED_ASSETS' end where id=:'cash';` | `CL1` | Bは待ち、成功 |
| C4 | `CL1` | 上と同じ科目の区分変更 | 待ち → `ACCOUNT_IN_CLOSED_PERIOD` |
| C5a | `CL1` | `CL2` | Bは待ち、commit 後に成功 |
| C5b | `CL1`（`rollback`） | `CL2` | Bは待ち → `PERIOD_CLOSE_PREVIOUS_OPEN` |
| C7a | `CL1` | `insert into fiscal_periods (company_id,name,start_date,end_date) values (:'c','OV','2025-12-31','2026-01-05');` | 待ち → `PERIOD_OVERLAPS_CLOSED` |
| C7b | `CL1` | `update fiscal_periods set start_date='2025-12-01' where id=:'p2';` | 待ち → `PERIOD_OVERLAPS_CLOSED` |
| C8 | `insert into fiscal_periods (company_id,name,start_date,end_date) values (:'c','OV','2025-06-01','2025-09-30');` | `CL1` | Bは待ち、commit 後 `PERIOD_CLOSE_CHECK_FAILED`（E5） |
| C9a | `update fiscal_periods set end_date='2025-12-30' where id=:'p1';` | `CL1` | **デッドロックなし**。待ち → 成功 |
| C9b | 同上 | `update fiscal_periods set closed_at=now() where id=:'p1';` | 同上 |
| C9c | `CL1` | `update fiscal_periods set end_date='2025-12-30' where id=:'p1';` | 待ち → `PERIOD_CLOSED_FIELDS` |
| C9d | `update fiscal_periods set closed_at=now() where id=:'p1';` | 同上の日付変更 | 待ち → `PERIOD_CLOSED_FIELDS` |
| C9e | 日付変更（`rollback`） | `CL1` | Bは待ち、成功 |
| **C10** | `begin; CL1;`（P1 を確定。**commit せず**、続けて下の `CL2` を実行する） | `begin; update fiscal_periods set end_date='2026-12-30' where id=:'p2';`（P2 の行を持ったまま、会社の advisory ロックを待つ） | **デッドロックする**（`40P01`）。PostgreSQL が片方を中断し、データは壊れない。**1トランザクションで複数期を確定・解除してはいけない**（下記） |

**C10（複数期を同じトランザクションで扱う場合・既知の制限）**: 確定・解除は「期の行 → 会社の advisory ロック」の順で取るが、1つのトランザクションが先に advisory ロックを持ったまま別の期の行を取りにいくと、他のトランザクションの「期の行 → advisory」と循環する。接続Aで P1 の確定後に P2 の確定（`CL2`）を実行すると、Aが P2 の行を待つ側に回り、`deadlock detected` が起きる（ローカルで再現。Aが中断された）。通常の操作（1回の RPC＝1期）では起きない。**確定・解除は1トランザクションにつき1期**とし、将来の一括確定を実装するときにロック設計を見直す。

待ちの確認（別窓）: `select pid, wait_event_type, wait_event, left(query,60) from pg_stat_activity where datname = current_database() and state = 'active';`
デッドロックの有無: Bが `deadlock detected` で失敗しないこと（失敗した場合は、そのシナリオを報告する）。

ローカルでは、同じ表を2接続の自動スクリプト（Aが `begin` → 実行 → 4秒待機 → `commit`、Bが1.5秒後に実行）で実行した。

## C6（pgbench）

ローカルの PostgreSQL 16.15 で実施。書き込みクライアント6 ＋ 確定・解除クライアント1（別の pgbench で実行。確定→50ms→解除→20ms の繰り返し）。
書き込みは作成（RPC）・編集（RPC）・日付の一括 UPDATE・一括 DELETE。各クライアントは**自分の仕訳だけ**を操作する（IDが重ならない）。
「確定済みの期への書き込みの成功」は、**確定の commit 後に開始し、解除の開始前に完了した、行を変更した書き込み**で数える（確定中に待たされて解除後に通った書き込みは含めない。行を変更しない一括 UPDATE／DELETE は除く）。
