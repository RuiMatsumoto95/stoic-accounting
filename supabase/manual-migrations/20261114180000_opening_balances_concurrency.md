# 期首残高: 同時実行の確認（科目の区分変更 × 期首明細の保存）

対象: `20261114180000_opening_balances.sql`（`check_opening_balance_line_account()` の `FOR SHARE`）
背景: 外部キーの `FOR KEY SHARE` は、キーを変えない UPDATE（科目の `type`・`bs_category` の変更）を止めない。そのため、明細の保存（未コミット）と科目の区分変更が同時に走ると、両方の検証をすり抜けて、損益科目などを参照した明細が残る余地があった（ChatGPT のレビュー指摘。ローカルで再現）。`FOR SHARE` で科目の行を共有ロックし、区分変更を COMMIT まで待たせる。

## ローカルでの確認結果（2026-11-14・PostgreSQL 16・psql 2接続）
| 順序 | 修正前 | 修正後 |
|---|---|---|
| A: 期首明細を保存（未コミット）→ B: 同じ科目の `bs_category` を NULL に変更 | B が成功し、不正な明細が1行残る | B は A の COMMIT を待ち、`OPENING_BALANCE_INVALID_ACCOUNT` で拒否される。不正な明細は 0 行 |
| B: 科目の区分を変更（未コミット）→ A: 期首明細を保存 | （未確認） | A は B の COMMIT を待ち、`OPENING_BALANCE_INVALID_ACCOUNT` で拒否される。不正な明細は 0 行 |

## 本番（Supabase）での確認手順
**架空データ（ZZOB）で行う。実データの会社では行わない。** 結果は PostgreSQL 17 で確認する。

### 接続について（重要）
- **psql を2つ起動し、それぞれ別のセッションで接続する方法を推奨する**（Supabase の接続文字列。Session pooler または direct connection）。`begin` から `commit` までが同じ接続で保たれることが保証できる。
- Supabase の SQL Editor のタブが、実行ごとに同じ接続・同じトランザクションを維持するかは**未確認**（維持しない可能性がある）。使う場合は、下の確認の「保存側」を**1回の実行にまとめ**（`begin; ...; select pg_sleep(30); commit;`）、30秒の間にもう一方のタブで更新を実行する。
- どちらの方法でも、待たされている側が本当に**ロック待ち**になっているかを、第3の接続で確認する（待ちが無ければ、競合を試せていない）:
  ```sql
  select pid, state, wait_event_type, wait_event, left(query, 80) as query
    from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
   order by backend_start;
  -- 待たされている側は wait_event_type = 'Lock' になる
  ```
- 各接続で `select pg_backend_pid();` を実行し、確認1・確認2で、別々の接続（別の pid）を使っていることを記録する。

### 準備（接続1で実行し、`company_id`・`period_id`・科目 ID をメモする）
```sql
select public.create_company('ZZOB 同時実行', 'CORPORATION', 'EXEMPT', '2098-04-01', '2099-03-31');
-- 戻り値の company_id を <C>、period_id を <P> とする
select id from accounts where company_id = '<C>' and code = '100';   -- <CASH>
select id from accounts where company_id = '<C>' and code = '500';   -- <CAP>
```

### 確認1（保存が先）
1. 接続1: `begin;` → `select public.save_period_opening_balances('<P>', '[{"account_id":"<CASH>","balance":"100"},{"account_id":"<CAP>","balance":"-100"}]'::jsonb);`（**コミットしない**）
2. 接続2: `update accounts set bs_category = null where id = '<CASH>';` → **待たされる**（実行中のまま止まる。第3の接続で `wait_event_type = 'Lock'` を確認）
3. 接続1: `commit;`
4. 接続2: `OPENING_BALANCE_INVALID_ACCOUNT` のエラーになること。
5. 確認: 下の「不正な明細の件数」が **0**。

### 確認1と確認2の間（必須）
確認1が成功すると、科目 `<CASH>` を参照する期首明細が**保存された状態で残る**。そのまま確認2を始めると、手順1の更新が、競合を試す前に既存の明細を守るガードで拒否される。**必ず解除してから始める。**
```sql
select public.clear_period_opening_balances('<P>');
select count(*) from period_opening_balance_lines where period_id = '<P>';   -- 0 であること
select bs_category from accounts where id = '<CASH>';                        -- 'CURRENT_ASSETS'（変わっていないこと）
```

### 確認2（区分変更が先）
1. 接続2: `begin; update accounts set bs_category = null where id = '<CASH>';`（**コミットしない**）
2. 接続1: 確認1の1と同じ `select public.save_period_opening_balances(...)` を実行 → **待たされる**（第3の接続で `wait_event_type = 'Lock'` を確認）
3. 接続2: `commit;`
4. 接続1: `OPENING_BALANCE_INVALID_ACCOUNT` のエラーになること。
5. 確認: 下の「不正な明細の件数」が **0**。
6. 後片付け: 接続2の更新はコミット済みなので、`<CASH>` の `bs_category` が NULL のまま残る。**元に戻す**: `update accounts set bs_category = 'CURRENT_ASSETS' where id = '<CASH>';`（明細は無いのでガードに当たらない）。

### 不正な明細の件数（確認1・確認2の最後に実行）
```sql
select count(*) from period_opening_balance_lines l
  join accounts a on a.id = l.account_id and a.company_id = l.company_id
 where a.bs_category is null or a.type not in ('ASSET', 'LIABILITY', 'EQUITY');   -- 0 であること
```

### 後片付け
作成した ZZOB の会社は、会社の削除機能が無いため残る。名前（`ZZOB 同時実行`）で見分けて、アーカイブする（`company_archive`）。実データの集計に混ざらない運用にする。
