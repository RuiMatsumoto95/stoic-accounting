# 会社単位（法人／個人）と初期科目セット: 適用手順

対象: `20261112120000_company_support.sql`（変更）／ `.test.sql`（テスト・135項目）
設計: ステップ1a・DB（複数会社対応）

## 開発時の確認結果（2026-11-12・ローカル PostgreSQL 16）

`supabase/schema.sql`（第14弾までの内容）を読み込み、本番に近い架空データ（科目188＝補助科目6を含む・会計期間2・仕訳40・明細80・
取込データ1・置換ルール2・テンプレート1＋明細2・エイリアス1・`system_settings.tax_method`）へ変更 SQL を適用した。
本番の Supabase は PostgreSQL 17 のため、下記の本番での確認は省略しない。

- 変更 SQL: エラーなしで適用。適用後も件数は変わらず（科目188・仕訳40・明細80）、仕訳の `updated_at` は不変、
  `journal_entry_logs` は 0 件のまま（列追加は DEFAULT 付きで行を書き換えない）。既存の科目は全件がデフォルト会社（法人）に付き、
  繰越先は `540 繰越利益`、`tax_method` は `system_settings` の値を引き継いだ。
- テスト SQL: **135項目すべて `ALL PASSED`**（空のスキーマに適用した DB と、上の架空データを入れた DB の両方）。
  `anon` ロールでの会社作成→保存を含む。
- 変異テスト（実装をわざと壊してテストが落ちるか）: 複合外部キーを単独に戻す（仕訳明細の科目・仕訳の期・補助科目の親・置換ルール）／
  区分のCHECKを削除（会社区分別・種別別・税区分）／繰越先の保護（FK・トリガー）を削除／補助科目の継承・伝播トリガーを削除／
  `company_id` の自動設定・変更禁止トリガーを削除／会社区分の不変を削除／当期の一意を会社なしに戻す／`code` の一意を全体に戻す／
  期首残高の会社絞りを外す／PUBLIC への EXECUTE／`companies` の DELETE・TRUNCATE 付与・RLS 無効／
  `ON DELETE SET NULL` を列指定なしに戻す、のいずれも**テストが失敗**した（一部は準備の途中で例外になって失敗）。
- pgbench（8接続×15秒・2社の仕訳作成／編集／日付の一括 UPDATE の混在）: 7,274 トランザクション、**失敗0・デッドロック0**、
  伝票番号は各期で重複なし（1〜n の連番）、`journal_lines.company_id` と仕訳の `company_id` の不一致 0 件。

### 回帰について（重要）

- 伝票番号の 45 項目テスト（`20261110170000_auto_reference_number.test.sql`）は、会社を指定せずに科目・期間を作るため、
  **このマイグレーション以降はそのままでは実行できない**（`company_id` が必須）。検証時は、一時的に `company_id` の DEFAULT を付けた
  DB で実行し、45項目が通ることを確認した。保存・編集・取込・伝票番号の回帰は、今回のテストの H・I で確認している。
- `20261101180000_atomic_journal_save.test.sql` / `20261101180100_enforce_journal_balance.test.sql` /
  `20261104180000_add_entry_supplement.test.sql` は、**今回の変更の前から失敗する**（伝票番号の自動採番で、`create_journal_entry` の
  戻り値が `jsonb`・番号が `integer` になったのに、テスト側が未更新のため。変更前のスキーマでも同じエラーになることを確認）。
  今回は直していない。更新するか、役目を終えたものとして整理するかは別途決める。

---

## 適用の順序

**1b（アプリ側）を反映するまでの運用上の制約（レビュー指摘を反映）**

- **2社目の会社を永続的に作らない。** 現行アプリの `getCurrentPeriod()`（`lib/fiscal-period.ts`）は `is_current = true` ＋ `.single()` で当期を取るため、
  2社に当期があると複数行が返って失敗し、`FiscalPeriodContext` が `period = null` になって画面が使えなくなる。DB のバグではなく、1a と 1b の境界の問題。
  このため、下の「動作の確認」は 1b の後に行う（テスト SQL は何も残さないので、適用直後でも実行してよい）。
- **科目マスタ画面（`/accounts`）で科目を新規作成・編集しない。** 画面の税区分の選択肢（`課税10%`・`課税8%`・`非課税`・`不課税`・`免税`）は、
  新しい制約 `accounts_default_tax_code_check`（`NONE` `SALES` `SALES_RETURN` `PURCHASE` `PURCHASE_RETURN` `NON_TAXABLE_SALES`）に通らず、
  `company_id` も渡さないため。税区分グループを実際の `tax_codes.id` に変換する役割（課税方式・取引日・税率に応じる）は 1b で明確にする。
  なお `default_tax_code` を仕訳入力側で使う処理は現状ない（`journals/page.tsx` は取得するだけ）ので、仕訳の入力・表示には影響しない。

この SQL を適用すると、**旧アプリは「科目・会計期間・取込データ（CSV取込）・置換ルールの新規作成」ができなくなる**
（`company_id` が必須のため）。仕訳の保存（新規・編集・CSV本登録）と、既存データの表示は、旧アプリのままで動く。
ステップ1b（アプリ側）を反映するまでは、これらの作成をしない。

1. （強く推奨）適用前に、DB のダンプ（`pg_dump`）を取り、**復元できることまで確認する**。CSV のエクスポートはデータだけで、制約・トリガー・関数・権限は戻せない。Free プランには自動バックアップがない。今回の既存データはテスト用なので被害は限定的だが、本番運用の前に一度は復元の手順を通しておく。
2. **開発サーバーを止める。** 以降、手順 6 が終わるまで画面から保存・編集をしない。
3. 下の「事前の確認」を実行し、結果を控える（SQL Editor は最後の結果しか表示しないため、**1文ずつ**実行する）。
4. SQL Editor で `20261112120000_company_support.sql` を**全体**実行する。
   - 途中でエラーが出たらトランザクション全体が取り消される（`begin; … commit;`）。何も変わらない。
   - 想定外の `default_tax_code` の値があると、`accounts_default_tax_code_check` で止まる。値を確認して SQL を直す。
5. `20261112120000_company_support.test.sql` を**全体**実行し、`ERROR: TEST RESULT: ALL PASSED (135 checks)` を確認する。
   **これ以外の表示は成功と判断しない。**
6. 下の「事後の確認」を実行し、事前の控えと突き合わせる。続けて、`20261101180100_concurrency_test.md` の手順 0
   （COMMIT 経路）を1回実行する。期待: `INVALID_JOURNAL_LINES`（明細不足）で拒否され、`count(*)` が 0。
7. `supabase/schema.sql` と `CLAUDE.md` を更新し、Project のコピーも差し替える（DB 変更の手順 3）。
8. ステップ1b（アプリ側）に進む。

### 戻す場合

この変更を取り消す SQL は用意していない（未検証のため）。適用前のエクスポートと、`supabase/schema.sql` の適用前の版から戻す。

---

## 事前の確認（適用前・1文ずつ実行）

```sql
select count(*) as accounts from accounts;
```

```sql
select count(*) as fiscal_periods from fiscal_periods;
```

```sql
select (select count(*) from journal_entries) as entries, (select count(*) from journal_lines) as lines,
       (select count(*) from import_staging) as staging, (select count(*) from mapping_rules) as rules,
       (select count(*) from journal_templates) as templates, (select count(*) from journal_template_lines) as template_lines,
       (select count(*) from journal_entry_logs) as logs;
```

```sql
select default_tax_code, count(*) from accounts group by 1 order by 2 desc;
```

```sql
select value from system_settings where key = 'tax_method';
```

```sql
select code, name, type, bs_category, pl_category from accounts where parent_id is not null order by code;
```

## 事後の確認（適用後・1文ずつ実行）

```sql
select id, name, kind, tax_method, carry_forward_account_id from companies;
```

```sql
select count(*) as accounts, count(*) filter (where company_id = (select id from companies)) as in_default_company from accounts;
```

```sql
select (select count(*) from fiscal_periods) as fiscal_periods, (select count(*) from journal_entries) as entries,
       (select count(*) from journal_lines) as lines, (select count(*) from import_staging) as staging,
       (select count(*) from mapping_rules) as rules, (select count(*) from journal_templates) as templates,
       (select count(*) from journal_template_lines) as template_lines, (select count(*) from journal_entry_logs) as logs;
```

期待: 事前の件数と同じ。`logs` も変わらない（訂正履歴を増やさない作りにしている）。

```sql
select default_tax_code, count(*) from accounts group by 1 order by 2 desc;
```

期待: 想定どおりの変換（`OUT_OF_SCOPE`・不課税 → `NONE`、課税10% → 収益は `SALES`、それ以外は `PURCHASE`）。

```sql
select a.code, a.name, a.type, a.bs_category from companies c join accounts a on a.id = c.carry_forward_account_id;
```

期待: `540 繰越利益`（`EQUITY`）。

```sql
select code, name, type, bs_category, pl_category from accounts where parent_id is not null order by code;
```

期待: 補助科目の `type` / 区分が親と一致している（`700-0002` の区分の欠けが直っている）。

## 動作の確認（**1b の反映後**。任意・テスト SQL とは別に、実際に会社を作る）

テスト SQL はデータを残さない。実際に会社を作って確認するときは、上記の理由で**1b を反映してから**、次を**1文ずつ**実行する（作った会社は残る）。

```sql
select create_company('動作確認用 個人', 'INDIVIDUAL', 'EXEMPT', '2026-01-01', '2026-12-31');
```

期待: `account_count` が 141 の jsonb が返る。

```sql
select count(*) as accounts, count(*) filter (where bs_category = 'OWNER_DRAWINGS') as drawings,
       count(*) filter (where bs_category = 'OWNER_CONTRIBUTIONS') as contributions
  from accounts where company_id = (select id from companies where name = '動作確認用 個人');
```

期待: 141 / 2 / 4。不要になったら、その会社を作った直後であれば、科目・期間を消してから会社を消す（会社の削除機能は無いため手作業になる）。

---

## 確認できていないこと

- 本番（PostgreSQL 17）での適用結果。上の事前・事後の確認とテスト SQL で確かめる。
- 既存DBのエイリアス（読み・ローマ字）は、同名の親科目に限って初期セットへ取り込んだ（法人207件・個人179件。補助科目の分は除外）。
  元データの `yakumushueки`（役務収益）にキリル文字が混ざっていたため、取り込み側は ASCII の `yakumushueki` に直した。
  既存DB側の同じ別名は直していない（直す場合は `update account_aliases` を別途）。
- 実データの `default_tax_code`・補助科目の区分（事前の確認で見る）。想定外の値があれば適用が止まる。
- アプリ側（ステップ1b）。`CompanyContext`、会社での絞り込み、会社の作成・切替 UI、`translateSupabaseError` への新エラーコード
  （`COMPANY_MISMATCH` `INVALID_COMPANY` `COMPANY_KIND_IMMUTABLE` `COMPANY_ID_IMMUTABLE` `INVALID_ACCOUNT_HIERARCHY`
  `INVALID_CARRY_FORWARD_ACCOUNT`）と、複合外部キー・`accounts_company_code_key` の 23503／23505 の変換は未着手。
  他社の科目で保存しようとした場合、いまは DB の外部キー違反（23503）がそのまま返る。
- 個人の損益計算書・貸借対照表の画面表示（事業主貸・事業主借、繰戻額等・繰入額等）は、1-8 の決定後。DB には区分だけ用意した。
- 同時実行（2セッション）の確認は、ローカルの pgbench のみ。
- RLS は従来どおり `allow_all`。会社の分離は参照整合性（複合外部キー）までで、他社の帳簿を読み書きできないようにする認可ではない。複数ユーザー・顧問先ごとのアカウントに進む前に、認証・会社へのアクセス権・RPC の実行権限を再設計する。
- 個人の `810 専従者給与` は `RESERVE_PROVISION`（繰入額等）にしている（弥生の分類どおり）。青色申告決算書では引当金等の繰入額と別項目のため、個人の損益計算書の表示方針（1-8）を決めるときに、独立した区分にするかを一緒に決める。
