@AGENTS.md

# Stoic Accounting — Claude Code 実務ルール集

> **公開版の注記**: `handover/`（設計メモ・作業報告）と `ops/backup/` は、この公開リポジトリに含まれません。本文中のそれらへのリンクと、一部のコミットハッシュ（旧リポジトリのもの）は、公開版では参照できません。

> 詳細設計メモ・完了済み実装の記録は [`handover/`](./handover/) を参照
> （[`journal-design.md`](./handover/journal-design.md) / [`implementation-details.md`](./handover/implementation-details.md) / [`completed-features.md`](./handover/completed-features.md)）
> DBスキーマの実体: [`supabase/schema.sql`](./supabase/schema.sql)（2026-11-15、ステップ3の本番適用後に利用者が取得したschema-only・public・`--no-owner`のpg_dump。DB 17.6 / pg_dump 17.12。前版との差分は追加909行・削除35行。列・履歴表・関数・トリガー・権限を含む。表データは含まない。適用の詳細は「ステップ3: 年度の確定・ロック」節。DB変更時は手動で更新する）
> 最終更新: 2026-11-15（ステップ3のDBを本番適用、アプリ側は実装・実機確認済み（86dfd08）。利用者・Windows／Chrome・日本語入力ON・テスト用会社で7項目問題なし。schema.sqlは同日の本番ダンプ）。前回: 2026-11-14（ステップ2：期首残高・繰越を本番DBへ適用し `main` へマージ（`370d56d`）。詳細は「ステップ2: 期首残高・繰越」節。`supabase/schema.sql` は同日の本番ダンプで更新）。前回: 2026-11-13（ステップ1b A〜D完了後のスキーマ照合・文書整理。A=`54107d7`、B=`d681848`、B2=`bc91f55`、C=`66933eb`、D=`c5266a6`、アーカイブ列マイグレーション=`5c1d2c4`。`npm test` 1,153件／41ファイル・型チェック・ビルド成功、lintは28エラー・12警告で増加なし。A〜Dの実機確認は利用者が実施済み（Windows／Chrome・日本語入力ON、今回の利用者報告））。
> 過去の記録: 2026-11-12（ステップ1a：会社単位（法人／個人）と初期科目セットのDB変更を本番へ適用。変更SQL・テスト 135項目通過・事前事後の件数一致（科目188・期3・仕訳40・明細83・取込40・ルール2・テンプレート3／8・訂正履歴29）・COMMIT経路の確認済み。コミットは `a68c816`。適用前に `pg_dump`（public スキーマ）を取得済み。復元確認は、データがテスト用のため省略）。2026-11-11（第14弾：伝票番号を会計期ごとにDB側で自動採番。DBの変更SQLは適用済み、テスト 45項目通過（本番）。アプリ側のコードは `7f20c74`。`main` へマージ・push 済み（`ed67125..5b9d83a`、fast-forward。CI の `test` は緑＝利用者の報告）。`npm test` 852件／24ファイル・型チェック・ビルド成功、lintは全体28エラー・12警告でファイル別も増加なし（いずれも Codex の報告）。利用者の実機確認8項目はすべて問題なし（OS・ブラウザは報告になし）。本番での同時実行テスト T1〜T5 は未実施）。2026-11-08（第12弾：新規入力・編集ボタンとテンプレート画面を削除、単純仕訳の複製を入力フォームへ移し、複合仕訳の複製後にフォームを閉じる。771件／21ファイルのテスト・型チェック・ビルド成功、lintは全体28エラー・12警告でファイル別も増加なし。第12弾は利用者の実機確認済み（Windows／Chrome・日本語入力ON・12項目すべて問題なし）。CI に型チェックを追加（第11弾）。第9弾：インライン新規・編集の借貸金額を条件付きで自動コピーし、Enter保存・保存前の同期に対応。第10弾：摘要・補足のEnter／Escapeを `isImeInput` に統一、PDF明細検索の失敗を例外化、テストデータの型を修正。コードコミット後の `npm test` は757件成功、型チェック・ビルド成功、lintは全体28エラー・12警告でファイル別も増加なし。第8弾は利用者の実機確認済み（問題なし）。第4弾IMEはWindows／Chrome 156・日本語入力ONで入力移動後も摘要が日本語、金額へのTabで全選択・`/`で000を利用者確認済み。v5コミットA・Bはいずれも実機確認OK。第9弾の確認済み・未確認項目は各節参照、第10弾の摘要・補足の変換確定Enter／変換中Escapeは実機確認済み（Chrome・2026-11-07）、Edge・Google日本語入力は未確認）。過去のDB適用・確認履歴は各節を参照。コード・DBと突き合わせた事実と利用者の確認報告を記載し、未確認の点は「未確認」と書く。
> 製品の方向性・中長期方針は Project 資料の最新版（`SA_context_v30.txt` 以降）が正。このファイルは**実装の事実とルール**を扱う。

---

## 技術スタック

- **DB**: Supabase (PostgreSQL) — `lib/supabase.ts` の `supabase` クライアントを使う
- **フロントエンド**: Next.js 16.4.6 (App Router / `'use client'`)
  - 開発サーバーは `npm run dev`（= `next dev --webpack`）。Turbopack ではこの環境で `next/font/google` が解決できずエラーになるため webpack を使う（2026-11-03・`7f1f65c`）。`.env.local`（Supabase の URL と anon キー）が無いと起動しても DB に接続できない
- **UI**: shadcn/ui (Nova preset) + Tailwind CSS v4
  - 使用中コンポーネント: `button`, `input`, `label`, `select`, `table`, `dialog`, `switch`, `card`, `collapsible`, `badge`, `alert`, `tabs`
  - 追加する場合: `npx shadcn@latest add <name>`
- **Toast通知**: `lib/toast.tsx` の `ToastProvider` / `useToast`（外部ライブラリ不使用）
- **CSVエクスポート**: `lib/csv-export.ts` の共通関数を使う（外部ライブラリ不使用）
- **CSVインポート**: Papa Parse（ブラウザ上で解析）
- **PDF出力**: `@react-pdf/renderer` + Noto Sans CJK JP Regular 2.004 の OTF（ファイル名は `public/fonts/NotoSansJP-Regular.otf`。ライセンスは `public/fonts/OFL.txt`）
  - API Route（Node.js runtime）で `renderToBuffer()` → クライアント側で blob ダウンロード
  - 日本語フォントは `lib/pdf/fonts.ts` の `registerFonts()`（シングルトン）で登録

---

## 指示フォーマット

Claude Code への実装依頼は以下の3点セットで記述する。

| 項目 | 内容 |
|---|---|
| **Goal** | 何を実現したいか（機能・目的） |
| **Constraints** | 守るべき制約（既存コードへの影響範囲・使用禁止事項・型の互換性など） |
| **Acceptance criteria** | 完了の判断基準（ビルドが通る・特定の動作をする・特定のファイルのみ変更されるなど） |

---

## 重要な定数

- `PERIOD_ID` のハードコードは撤廃済み。全画面で `useCurrentPeriod().period.id` を使う。
- 税区分は **`tax_codes` テーブル**で管理（旧 `TAX_CODES` 定数は存在しない）。
  - 取得・絞り込み: `lib/tax-codes.ts`（`getAllTaxCodes` / `filterTaxCodes(allCodes, method, side?, includeLegacy?)`）
  - 事業者タイプ: 会社ごとの `companies.tax_method`（`EXEMPT | SIMPLE | STANDARD_INDIVIDUAL | STANDARD_PROPORTIONAL`、DBの初期値 `EXEMPT`）。取得は `getTaxMethod(companyId)`、更新は `updateTaxMethod(companyId, method)`。1bで会社単位へ移行した。旧 `system_settings.tax_method` の行は未使用のまま残る（利用者申告。今回のschema-onlyダンプでは行データは未確認）。
  - `tax_codes.applies_to` は事業者タイプの配列（`ALL` は全タイプ）。`is_current = false` は旧税率で、通常は非表示
  - 消費税集計表は `getTaxSummaryReport(params, taxCodes)` に `TaxCode[]` を渡す

---

## コーディングルール

- **新しいnpmパッケージを追加しない**（既存パッケージで解決する）
  - 例外: `@react-pdf/renderer`（PDF生成）・`papa parse`（CSVインポート）は導入済み
  - 例外（devDependency）: `vitest`（自動テスト。2026-11-01 導入）。テスト専用で本番バンドルには入らない。React コンポーネントのテストに広げるときは `jsdom` / `@testing-library/react` / `@vitejs/plugin-react` を追加してよい
- **自動テスト**: `npm test`（= `vitest run`）。テストは `__tests__/` に置き（例: `__tests__/csv-amount.test.ts`）、純粋関数から対象にする。`lib/supabase` を import するモジュールは `vi.mock('@/lib/supabase', ...)` で差し替える（import 時に `createClient` が走るため）。金額まわり（`lib/csv-amount.ts` / `lib/journal-save.ts`）を変更したら `npm test` を通すこと。CI は `.github/workflows/test.yml`（`npm ci` と `npm test` のみ。`npm run build` は `/settings` がビルド時に DB へ接続するため CI に含めない。lint は既存の `react-hooks/set-state-in-effect` 指摘が残るため未導入）
- **型チェック**: `npm run typecheck`（= `tsc --noEmit`）。CI（GitHub Actions の `test`）は `npm test` に続けて実行する。`build` と `lint` は CI に含めない（理由は `.github/workflows/test.yml` のコメント）。
- **TypeScript の型エラーを出さない**
- **実装後に `npm run build` を実行**してエラーがないことを確認する
- 残高計算・集計は原則アプリ側で行う。期首は PostgreSQL 関数 `get_opening_balances_for_period(target_period_id)` をRPCで取得する（SECURITY INVOKER）。手動設定のある期はその明細、なければ前の期からの導出値（損益・個人の事業主貸借は繰越先へ畳み込み済み。ステップ2）。PL/BSの当期明細は `lib/financial-statements.ts` の直接クエリで取得し、純粋関数で集計する。DBの `get_pl_data` は残るが、アプリコードに呼び出しはない。
- CSVエクスポートは既存 state のデータをそのまま使う（追加のAPI呼び出しなし）
- 既存画面の表示・動作を変更するときは該当ページのみ修正する
- コメントは「なぜそうするか」が自明でない箇所のみ書く
- **仕訳の保存（新規・編集・CSV本登録）は `lib/journal-save.ts` の RPC 経由のみ**（`createJournalEntry` / `updateJournalEntry` / `importStagingEntries`）。`journal_entries` / `journal_lines` を直接 insert / update / delete する保存処理を新たに作らない。理由: ① ヘッダーと明細を1トランザクションにするため ② 訂正履歴が「ヘッダー UPDATE から始まる」前提に依存しているため ③ DB 側の検証（借貸一致・金額・会計期間）を通すため。例外は1文で完結する一括変更・一括削除・単票削除（`app/journals/page.tsx`）。
- 金額は RPC に**文字列**（小数第2位まで・正の数）で送る。`amountToRpcString()` が小数第3位以下・13桁超・カンマ・NaN などをエラーにする（黙って丸めない）。画面側の入力チェックは即時フィードバック用で、最終判定は DB が行う。

---

## DBルール

### 複式簿記の整合性（最重要）
- 同じ `entry_id` の明細は **借方合計 = 貸方合計**。2026-11-01 から **DB 側でも保証**している（Migration A / B。詳細は下記「仕訳保存の RPC と整合性の制約」）。アプリ側のチェックは即時フィードバック用に残す。
- 保証の範囲: 保存 RPC 内の検証（明細2行以上・借方/貸方が各1行以上・金額は小数第2位までの正の数・借貸合計の一致）と、COMMIT 時の遅延制約 Trigger（REST から `journal_entries` / `journal_lines` を直接書き換えても、崩れた仕訳は COMMIT できない）。
- 保証しないもの: 期首残高仕訳（`is_opening_balance`）の削除・一括変更の禁止（編集は RPC が拒否する。削除・一括変更は UI のみ）。

### 仕訳保存の RPC と整合性の制約（2026-11-01 適用）
- 実体: `supabase/manual-migrations/20261101180000_atomic_journal_save.sql`（A）/ `20261101180100_enforce_journal_balance.sql`（B）。テストは各 `.test.sql`（SQL Editor に貼って実行。結果は意図的な ERROR として表示され、データは残らない）。同時更新の確認手順は `20261101180100_concurrency_test.md`。
- RPC（すべて SECURITY INVOKER・anon/authenticated に EXECUTE 付与・PUBLIC には付与しない）:
  - `create_journal_entry(p_period_id, p_date, p_description, p_reference_number integer, p_lines jsonb, p_supplement text DEFAULT NULL)` → **jsonb `{id, reference_number}`**（2026-11-11 から。以前は uuid）。`p_reference_number` が NULL なら会計期ごとに自動採番、値があれば手入力として検証する（下記「伝票番号の自動採番」）。補足は `nullif(p_supplement, '')` で保存
  - `update_journal_entry(p_entry_id, p_date, p_description, p_reference_number integer, p_lines jsonb, p_supplement text DEFAULT NULL)` → 順序は **ヘッダー UPDATE → 明細 DELETE → 明細 INSERT**（先に採番ロックを取り、仕訳を `FOR UPDATE` でロックして、存在・会計期間が変わっていないこと・期首残高仕訳でないことを確認）。補足は NULL＝変更しない、空文字＝削除。**`p_reference_number` は NULL＝番号を変更しない**（NULL に戻す操作は無い）、値あり＝検証して更新
  - `import_staging_entries(period_id, staging_ids uuid[])` → 登録件数。指定 ID が全件存在・全件未処理・重複なしであることを確認してから、配列順に登録（伝票番号も配列順に自動採番）して `is_processed` を更新する。1件でも失敗すれば全件取り消し（DELETE ログも出ない）。借方・貸方がともに正で金額が違う行・負数・日付が `YYYY-MM-DD` でない行は拒否する
  - `validate_journal_lines` / `insert_journal_lines`（RPC の内部用だが、呼び出し側権限で動くため anon にも EXECUTE が必要＝ PostgREST から直接呼べる。`insert_journal_lines` 自身も検証する）
- 補足追加（2026-11-04 適用済み・テスト 20/20 通過）: `supabase/manual-migrations/20261104180000_add_entry_supplement.sql` と `.test.sql`。上記の6引数定義はこのSQL適用後の仕様。旧5引数の関数を同一トランザクション内で削除して作り直すが、末尾の DEFAULT NULL により5引数での呼び出しも継続できる。`SECURITY INVOKER`・`SET search_path TO 'public'` を維持し、6引数の定義に `REVOKE ALL ... FROM public`・`GRANT EXECUTE ... TO anon, authenticated` を明記。`NOTIFY pgrst, 'reload schema'` でPostgRESTに再読み込みを通知する。
- `journal_entries.supplement` は nullable text（仕訳単位）。既存の履歴トリガーが変更前のヘッダー全体をJSONにするため、補足も `journal_entry_logs.before_data.entry.supplement` に残る。`import_staging_entries` は変更しない（補足はNULLのまま）。
- アプリの補足: `lib/journal-save.ts` の `supplement?: string | null` を `p_supplement: input.supplement ?? null` で送る。入力・編集・複製のUIは補足を渡し、空欄は空文字で削除する。補足は検索・一括変更・PDFの対象外。SQLテストは最後の意図的な例外による `TEST RESULT: ALL PASSED` を確認する。
- 制約・Trigger:
  - CHECK `journal_lines_amount_positive`（`amount > 0 AND amount <> 'NaN'`。NaN は PostgreSQL では `> 0` を通ってしまう）、CHECK `fiscal_periods_date_order`
  - `trg_journal_entries_check_period`（journal_entries の BEFORE INSERT / UPDATE OF date, period_id）: 日付が会計期間外なら拒否し、期間の行を `FOR SHARE` でロック。新規・編集・CSV・一括変更のすべてに効く
  - `trg_fiscal_periods_check_entries`（fiscal_periods の BEFORE UPDATE OF start_date, end_date）: 変更後に範囲外になる仕訳があれば拒否
  - `trg_journal_lines_guard`（journal_lines の BEFORE ROW）: `entry_id` の付け替えを禁止。親の仕訳を `FOR NO KEY UPDATE` でロックして、同じ仕訳への明細変更を直列化する（`bump_parent_entry_updated_at` の副次的なロックには依存しない）
  - `trg_journal_lines_balance` / `trg_journal_entries_balance`（CONSTRAINT TRIGGER・`DEFERRABLE INITIALLY DEFERRED`）: COMMIT 時に借貸一致・2行以上・借方/貸方が各1行以上を検証。明細のないヘッダーだけの INSERT も拒否する
- エラーは `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='<コード>', DETAIL='<補足>'`。コードは `lib/errors.ts` の `ERROR_CODES`（`DEBIT_CREDIT_MISMATCH` `OUT_OF_PERIOD` `OPENING_BALANCE_EDIT_FORBIDDEN` `INVALID_JOURNAL_LINES` `ENTRY_NOT_FOUND` `INVALID_STAGING_ROWS` `INVALID_DATE` `PERIOD_NOT_FOUND` `PERIOD_HAS_OUTSIDE_ENTRIES` `DUPLICATE_REFERENCE_NUMBER` `INVALID_REFERENCE_NUMBER` `ENTRY_PERIOD_CHANGED`）。`translateSupabaseError` が `P0001` の message をキーに `AccountingError` / `ValidationError` / `NotFoundError` へ変換し、DETAIL（「2行目（摘要）: …」など）を画面メッセージに付ける。
- **遅延制約を入れた後の注意**: 新しい保存処理を作るときは、ヘッダーと明細を**同じトランザクション**で書くこと。ヘッダーだけ・明細だけを別リクエストでコミットすると B が拒否する。
- 関数・Trigger を追加するとき: SQL Editor（postgres ロール）で作った関数は、既定で anon から実行できない（`pg_default_acl` の functions が `{postgres=X}`）。`GRANT EXECUTE ... TO anon, authenticated` を明記すること（PUBLIC には付けない）。
- `FOR SHARE` / `FOR UPDATE` を使うため、呼び出し側ロールには `fiscal_periods` / `journal_entries` の UPDATE 権限が必要（現状 anon にある）。権限を最小化・認証を導入するときに忘れないこと。

### 伝票番号の自動採番（2026-11-11 までに適用・第14弾）
- 実体: `supabase/manual-migrations/20261110170000_auto_reference_number.sql`（変更）/ `.test.sql`（テスト 45項目）/ `_apply.md`（適用順序・同時実行テスト T1〜T6・後片付け）。
- 仕様（利用者の決定）: 会計期（`period_id`）ごとに 1 から、DB 側で採番する。同じ会計期内の重複は不可。手入力も可（1〜999999999 の整数）。既存の37件は NULL のまま（過去分の採番はしていない）。基準は同じ期の `max(reference_number) + 1` で、欠番は埋めない。最後の仕訳を削除すると、次の仕訳が同じ番号になる。
- 型と制約: `journal_entries.reference_number` は `integer`（以前は `text`）。CHECK `journal_entries_reference_number_range`（1〜999999999）、部分ユニークインデックス `uq_journal_entries_period_reference_number (period_id, reference_number) WHERE reference_number IS NOT NULL`。`ledger_view` は列型変更のため DROP → 再作成し、`GRANT SELECT` を付け直した。
- 補助関数（VOLATILE・SECURITY INVOKER・`search_path` は public・anon/authenticated に EXECUTE・PUBLIC には付与しない）: `lock_period_for_numbering(period_id)` / `next_reference_number(period_id)` / `check_reference_number(period_id, 番号, 除外する仕訳ID)`。
- **ロックの規則（重要）**: 採番に関わる処理は、最初に会計期ごとのアドバイザリロック `pg_advisory_xact_lock(hashtext('stoic.journal_reference_number'), hashtext(period_id::text))` を取る。順序は、新規・編集が「採番ロック → `journal_entries`」、CSV 本登録が「`import_staging` の行を `FOR UPDATE` → 採番ロック → `journal_entries`」。**`fiscal_periods` の行を `FOR UPDATE` でロックして採番に使ってはいけない。** 一括日付変更（`app/journals/page.tsx` の `executeBulkEdit`）は「仕訳行のロック → 会計期の `FOR SHARE`（`trg_journal_entries_check_period`）」の順なので、逆順になってデッドロックする（ローカルで再現・修正を確認した）。一括変更など直接 UPDATE は採番ロックを取らない。
- 保証の範囲: 自動採番と手入力の検証は、保存 RPC（`create_journal_entry` / `update_journal_entry` / `import_staging_entries`）経由だけ。REST から `journal_entries` を直接 INSERT すると NULL のままになり得る。重複・範囲外は、一意インデックスと CHECK が拒否する（23505 / 23514）。
- エラー: `DUPLICATE_REFERENCE_NUMBER` / `INVALID_REFERENCE_NUMBER` / `ENTRY_PERIOD_CHANGED`（編集で、行ロック後に仕訳の会計期が変わっていた場合）。`translateSupabaseError` は、23505 を制約名 `uq_journal_entries_period_reference_number` で `DUPLICATE_REFERENCE_NUMBER` に、23514 を制約名 `journal_entries_reference_number_range` で `INVALID_REFERENCE_NUMBER` に変換する（それ以外の 23505 は従来どおり）。
- アプリ側: `lib/reference-number.ts` の `parseReferenceNumberInput` が、前後の空白を除き、全角数字を半角にし、空を `null`、半角の整数（1〜999999999）以外をエラーにする。入力欄は `type="text"`（IME のため `number` にしない）。新規保存は常に自動採番（下の入力フォームに欄はない）。手入力は、一覧で伝票番号のセルを選び Enter／F2 で編集に入る方法（`InlineEditRow` の欄）と、複合仕訳フォームの欄。**編集で空欄は「変更しない」**（RPC には `null`、画面には元の番号を残す）。新規保存の仮の行は `referenceNumberPending` で「…」を表示し、保存完了後は RPC が返した確定番号に置き換わる。複製は新しい番号が付く。複合仕訳フォームの新規・複製は、番号の形式チェックを仮行の追加より前に行う。CSV・PDF の出力では文字列にする。列が整数になったため、一覧・PDF の並びは数値順（`1 → 2 → 10`）。
- 確認の状況（2026-11-11）: **ローカル PostgreSQL 16** でテスト 45項目、変異テスト、pgbench（修正前：デッドロック 18件／9,092 トランザクション、修正後：0件／23,432 トランザクション・番号の重複 0）。**本番（Supabase・PostgreSQL 17）** でテスト SQL が `ALL PASSED (45 checks)`、COMMIT 経路（`20261101180100_concurrency_test.md` の手順 0）が `INVALID_JOURNAL_LINES`・`count(*)` 0（いずれも利用者の報告）。**利用者の実機確認（8項目・すべて問題なし）**: 入力で「…」から番号 1 へ、続けて 2・3／既存37件は `-` のまま／グリッドでの手入力（重複はエラー・全角「１２」は 12）／編集で空欄にしても元の番号が残る／複製で新しい番号／複合仕訳（借方＋）の保存で番号が付く／CSV 取込で番号が付く。
- **未確認**: 本番での同時実行テスト T1〜T5（`_apply.md`。T6 は検証環境のみ）、`ENTRY_PERIOD_CHANGED` の分岐（競合を起こさないと通らず未テスト）、PostgreSQL 17 での負荷試験。一括変更どうしのデッドロック（行ロックの順序が不定）は従来からあり、採番とは無関係なので変えていない。画面の保存まわりの自動テストは、Codex が追加したもの（`journal-reference-ui.test.ts` ほか）で、実機確認の代わりではない。

### 会社単位（法人／個人）と初期科目セット（2026-11-12 適用・ステップ1a）
- 実体: `supabase/manual-migrations/20261112120000_company_support.sql`（変更）/ `.test.sql`（テスト 135項目）/ `_apply.md`（適用手順・事前事後の確認）。コミット `a68c816`。設計の元は Project の `SA_step1_design_v1.md`、作成結果と設計差分は `SA_step1_1a_result_v1.md`。
- 利用者の決定: 法人の初期科目＝弥生の法人標準−諸口＝181科目（`753` は「交際費」）、個人＝弥生の個人標準−諸口＝141科目。税区分は事業者タイプに依存しない「グループ」で持つ。会社間の越境は複合外部キーで防ぐ。個人の `810 専従者給与` は弥生の標準どおり `RESERVE_PROVISION`（繰入額等）のまま（2026-11-12 決定。1b-Dで個人PLの「繰入額等」に実装済み）。
- `companies`（`id, name, kind CORPORATION|INDIVIDUAL, tax_method, carry_forward_account_id, created_at, is_archived`）。会社区分 `kind` は変更不可、会社名は重複不可、改名・削除機能なし（anon/authenticatedに `DELETE` は付与していない）。RLS は有効だが policy は `allow_all_companies`（他テーブルと同じ。認証前の暫定）。既存データは固定ID `0f4cec31-c047-415b-8c64-18a21932620e` の「デフォルト会社」（CORPORATION・`STANDARD_PROPORTIONAL`）に紐づけた。
- `company_id uuid NOT NULL` を8表に追加: `accounts` `fiscal_periods` `journal_entries` `journal_lines` `import_staging` `mapping_rules` `journal_templates` `journal_template_lines`。移行は `ADD COLUMN … DEFAULT '<デフォルト会社>'` → DEFAULT 削除（行を書き換えないため、訂正履歴・`updated_at` は動かない）。`company_id` の変更は全表でトリガーが禁止する。
- **複合外部キー**: 親に `UNIQUE (id, company_id)`、子は `(xxx_id, company_id)` で参照する（`journal_entries → fiscal_periods`、`journal_lines → journal_entries / accounts`、`accounts.parent_id`、`import_staging`・`mapping_rules`・テンプレート明細 → `accounts` など）。`ON DELETE SET NULL` は **列リスト形式**（`SET NULL (account_id)`。PG15+）。単なる `SET NULL` は `company_id` まで NULL にしてしまう。他社の科目・期・仕訳を指す保存は外部キー違反 **23503** になる（既存テスト NG-20 が「存在しない科目は 23503」を期待するため、保存RPCは変えていない。画面メッセージへの変換は 1b で制約名から実装済み）。
- `journal_entries.company_id` / `journal_lines.company_id` / `journal_template_lines.company_id` は **BEFORE INSERT トリガー**（名前は `trg_*_a_fill_*`）が期・仕訳・テンプレートから自動設定する。**保存RPC（`create_journal_entry` / `update_journal_entry`）の本体・引数は変更していない**。`accounts` `fiscal_periods` `import_staging` `mapping_rules` `journal_templates` は呼び出し側が `company_id` を渡す（必須）。1bの作成処理はこの5表に会社IDを渡す。
- `accounts`: `company_kind` を持ち、複合外部キー `(company_id, company_kind) → companies(id, kind)` で会社区分をチェック制約で使えるようにしてある（トリガーが上書きする）。コードの一意は `(company_id, code)`（旧 `accounts_code_unique` は廃止）。`bs_category` / `pl_category` の値リストと `type` との整合、会社区分ごとの区分（法人は `OWNER_*`・`RESERVE_*` 不可、個人は `NON_OP_*`・`EXTRA_*`・`TAX` 不可）、`default_tax_code` を税区分**グループ**（`NONE` `SALES` `SALES_RETURN` `PURCHASE` `PURCHASE_RETURN` `NON_TAXABLE_SALES`）に限る CHECK `accounts_default_tax_code_check`。既存の値は変換した（`OUT_OF_SCOPE`・不課税→`NONE`、課税10%→収益は `SALES`・それ以外は `PURCHASE`）。個人用PL区分は `RESERVE_REVERSAL`（繰戻額等・REVENUE型）／`RESERVE_PROVISION`（繰入額等・EXPENSE型）。1b-Cの科目マスタは6グループ＋NULLを保存する。`default_tax_code` から実際の `tax_codes.id` への変換は未実装。
- 補助科目: トリガー（`inherit_parent_account_attrs`）が親から `type` と区分を引き継ぐ。補助科目の下に補助科目は作れず、自分自身を親にもできない（`INVALID_ACCOUNT_HIERARCHY`）。親の変更は子へ伝播する（`propagate_parent_account_attrs`）。
- 繰越先: `companies.carry_forward_account_id`（法人＝`540 繰越利益`、個人＝`400 元入金`）。複合外部キー `(carry_forward_account_id, id) → accounts(id, company_id)`。純資産の親科目に限り、参照されている科目は削除できない（23503）。
- `fiscal_periods`: `idx_fiscal_periods_single_current` は**会社ごと**に当期1件（`UNIQUE (company_id) WHERE is_current`）。`get_opening_balances_for_period` は期の会社で絞り込むように直した（暫定。ステップ2で作り直した）。
- `import_staging_entries` は、期が存在しなければ従来の `PERIOD_NOT_FOUND`、取込行の会社が期と違えば `COMPANY_MISMATCH`。
- 関数（新規）: `company_seed_accounts(kind) → jsonb`（IMMUTABLE・初期科目セット。ROMAN は弥生のサーチキー、KANA／ROMAN は既存DBの読み・略称から。`normalized_alias` は `normalizeText` 相当）、`create_company(name, kind, tax_method, start_date, end_date) → {company_id, period_id, account_count}`（1トランザクションで会社・当期・科目・エイリアス・繰越先を作る。個人の期は同じ年の 1/1〜12/31 のみ、違えば `INVALID_COMPANY`）、その他トリガー関数（`fill_*_company` `forbid_company_id_change` `forbid_company_kind_change` `inherit_parent_account_attrs` `propagate_parent_account_attrs` `guard_carry_forward_account` `check_company_carry_forward`）。どれも SECURITY INVOKER・PUBLIC に EXECUTE を付与しない。`create_company` と `company_seed_accounts` には anon / authenticated に明示的に付与した。
- 会社関連エラーは実装済み。`lib/errors.ts` の `ERROR_CODES` に `STALE_COMPANY` `COMPANY_MISMATCH` `INVALID_COMPANY` `COMPANY_KIND_IMMUTABLE` `COMPANY_ID_IMMUTABLE` `INVALID_ACCOUNT_HIERARCHY` `INVALID_CARRY_FORWARD_ACCOUNT` `DUPLICATE_COMPANY_NAME` `REFERENCE_NOT_FOUND_OR_OTHER_COMPANY` がある。DBの会社関連P0001コード6種は `translateSupabaseError` の `DOMAIN_ERRORS` で日本語の `ValidationError` に変換する。23505は会社名/科目コード、23503は期/仕訳/テンプレート参照と科目参照を制約名で判定する。

- 確認の状況: ローカル PostgreSQL 16 で、空スキーマと本番に近い架空データ入り（科目188・仕訳40ほか）の両方で、テスト 135項目通過。変異テスト（自己参照チェックの削除を含む）でテストが落ちることを確認。pgbench（2社・作成／編集／日付の一括UPDATE混在）7,274トランザクションで失敗・デッドロック・伝票番号の重複とも 0。**本番（PostgreSQL 17）**: 変更SQL成功、テストSQL `ALL PASSED (135 checks)`、事前事後の件数一致、会社は1社、`INVALID_JOURNAL_LINES` による COMMIT 経路の拒否とテスト行0件（いずれも利用者の実行結果）。ChatGPT のレビュー（自己参照・A13c／A14 の範囲限定・運用制限の明記・ダンプ推奨）は反映済み。
- 確認状況（1b完了後）: A〜Dの実機確認は利用者が実施済み（Windows／Chrome・日本語入力ON）。2026-11-13、現行 `schema.sql` を空のローカルPostgreSQL 17.12へ読み込み、旧SQLテストの会社別準備と現行RPCへの追随を確認した。4本とも `ALL PASSED`（A=88、B=18、補足=20、伝票番号=45、項目数変更なし）。会社単位135項目・アーカイブ7項目も通過。A/B/補足の指定変異を検出し、復元前後のカタログハッシュ一致、再実行の全件通過、public全13表の残存0件を確認した（`handover/step1b-sqltests-report.md`）。更新版の本番SQL Editorでの実行は未実施。本番のデータを含むバックアップの復元は未確認。実機確認の個別ログや `create_company` の本番実行記録は今回参照していない。既存DBの別名 `yakumushueки`（役務収益）のキリル文字混在は以前の記録で、今回のschema-onlyダンプでは既存行の修正有無は未確認（初期セット側はASCII）。

### 会社切替・アーカイブ・帳票の会社分離（1b）

- 会社の選択は非HttpOnly cookie `sa_company_id`（Path=/・SameSite=Lax・1年）と `CompanyContext` / `useCompany()`。アーカイブ済み会社は通常の候補から除外し、選択中の会社のアーカイブはServer Action側でも拒否する。会社名はアーカイブ後も一意制約により予約されたまま。アーカイブはアクセス制御ではなく、帳票の直接参照はできる。
- 書き込み前の `assertActiveCompany` / `assertServerCompany` は、画面の期待会社とcookieの食い違いによる取り違え防止。認可ではなく、認証導入前の暫定。照合後の通信中の切替をDBトランザクションで排除するものではない。
- `createJournalEntry` / `updateJournalEntry` / `importStagingEntries` は、RPC呼び出し前に対象の期/仕訳が引数の会社に属することを照会し、不一致は `COMPANY_MISMATCH` で拒否する。保存RPCの本体・引数は1bで変更していない。
- テンプレートのヘッダー/明細、科目＋別名の保存は複数リクエストで原子的ではない。途中の通信失敗等で部分保存が残り得る。テンプレートは開始時の会社へ完了させ、科目＋別名は後続リクエスト前にも会社ガードを行う（`lib/journal-templates.ts` / `lib/account-master.ts`、B2/Cの報告）。
- 帳票の会社はcookieでなく対象期から解決する。PL/BSレポートはその会社の `companies.kind` から法人/個人をサーバーで決定し、画面は `useCompany().kind` で対応する表を使う。PDF全9ルートは、別会社の `prevPeriodId` を400、別会社・不存在の `accountId` を404にする。期名はURLでなくDBの期の行から取得する（`lib/reports/scope.ts`）。
- PL/BSは全科目を取得し、補助科目の明細・期首を親へ合算して親の区分で集計する。期首は `normalizeOpeningBalance` で正常残高方向に統一（`getOpeningBalancesByType` も共用）。PL/BSの仕訳ID・科目は1,000件ずつページ取得、仕訳IDは100件ずつに分け、明細も1,000行ずつ全ページ取得する。他帳票まで全件取得を保証する変更ではない。
- 個人PL: 収入金額→売上原価→**売上総損益**→経費→**差引金額**→繰戻額等→繰入額等（専従者給与810を含む）→**控除前所得金額**。青色申告特別控除・控除後所得は出さない。個人BS: 事業主貸は資産、事業主借は負債、資本＝元入金＋控除前所得金額。見出し・順序・科目行・小計は `lib/individual-statement-rows.ts` を画面/PDFで共有する。
- 根拠: `handover/step1b-a-report.md` / `step1b-b-report.md`（B2追補含む）/ `step1b-c-report.md` / `step1b-d-report.md` と各実装。A〜Dの実機確認完了は今回の利用者報告に基づく（各報告の「実機未実施」は当時のCodex作業範囲の記録）。

### ステップ2: 期首残高・繰越（2026-11-14・本番DB適用・`main` マージ済み）

- EXECUTE 付与漏れ（2026-11-14 発見）: SECURITY INVOKER の `check_opening_balance_line_account()` が呼ぶ補助関数 `opening_balance_account_ok(text,text,text)` に anon/authenticated の EXECUTE が無く、anon の保存が 42501（PostgREST は 401）で失敗。利用者が同日本番へ GRANT を手動適用済み（両ロールの権限 false → true を確認）。`20261114190000_grant_opening_balance_account_ok.sql` に記録し、180000本体・schema.sql にも反映。既存52項目に権限10項目・法人/個人のanon保存/解除4項目を追加（計66項目）。検証結果・未確認事項は `handover/step2-grant-fix-report.md`。
- 方式: 期首残高は、通常は前期以前の全仕訳から**自動導出**する。損益科目と、個人の事業主貸・事業主借は、繰越先（`companies.carry_forward_account_id`＝法人 `540 繰越利益`／個人 `400 元入金`）へ畳み込む。任意の期に**手動の期首残高**を設定でき、ヘッダー行がある期＝手動設定中（以後その期は前期の変更で動かない）。年度ロックのDBはステップ3で本番適用済み。アプリ側は実装・テスト用会社で実機確認済み（86dfd08、2026-11-15）。
- DB（`supabase/manual-migrations/20261114180000_opening_balances.sql`・テスト `.test.sql` 66項目（当初52項目）・`_apply.md`・`_concurrency.md`）:
  - 表: `period_opening_balance_sets`（存在＝手動設定）、`period_opening_balance_lines`（BS科目のみ・`balance numeric(15,2)`・借方超過が正）、`period_opening_balance_logs`（履歴。FKなし）。RLS有効・`allow_all`。
  - 関数: `get_derived_opening_balances_for_period`（手動設定を無視した導出値。基準＝直前の手動設定のある期、無ければ会社の最初の期。日付範囲で数えるため期の空白・重複でも二重計上しない）、`get_opening_balances_for_period`（手動設定があればその明細、なければ導出値。入出力は従来どおり）、`save_period_opening_balances(p_period_id, p_lines jsonb, p_memo, p_auto_balance boolean default false) → {period_id, line_count, auto_balanced, adjustment}`、`clear_period_opening_balances(p_period_id)`。RPCのEXECUTEは anon／authenticated のみ（PUBLICなし）。
  - 検証: 配列・uuid・重複・数値形式・小数第2位まで（丸めない）・13桁以内・他社科目。期ごとの advisory lock。貸借不一致は `OPENING_BALANCE_UNBALANCED`、`p_auto_balance=true`（null は false 扱い）のときだけ差額を繰越先へ加算（繰越先NULLは `CARRY_FORWARD_NOT_SET`）。
  - 整合性トリガー: 明細の `period_id` 変更禁止、遅延制約で期ごとの合計0をCOMMIT時に検査、科目の適格性（ASSET／LIABILITY／EQUITY・`bs_category` あり・個人は `OWNER_DRAWINGS`／`OWNER_CONTRIBUTIONS` 不可。`FOR SHARE` で科目の区分変更との競合を防止）、参照中の科目の区分変更を禁止。手動設定のある期は削除不可（FK NO ACTION・`period_opening_balance_sets_period_fkey`）、明細が参照する科目も削除不可（`period_opening_balance_lines_account_fkey`）。
  - エラー（P0001のメッセージ）: `OPENING_BALANCE_UNBALANCED` `OPENING_BALANCE_INVALID_LINES` `OPENING_BALANCE_INVALID_ACCOUNT` `OPENING_BASE_UNDETERMINED`（第1期より前の仕訳）`CARRY_FORWARD_NOT_SET`。
  - `20261112120000_company_support.test.sql` のG1を強化、G2を `CARRY_FORWARD_NOT_SET` 期待に変更、G2bを追加（136項目）。
- 本番適用（2026-11-14・Supabase SQL Editor・PG 17.6）: 適用前 `carry_null=0`・会社4・期6・科目651・財務諸表区分なしでBS科目に仕訳のある科目0件。変更SQLはエラーなしで適用。新規テスト52項目・company_support 136項目・company_archive 7項目がすべて `ALL PASSED`。新3表は空・RLS有効・4関数の `public_exec=false`／`anon_exec=true`。実データ（デフォルト会社・2026年10月期）の期首残高は損益科目なし・繰越利益（540）の行に前期までの損益が入り、合計 0.00。適用作業中に利用者が確認用仕訳（2025-10-01「繰り越し処理機能確認用仕訳」）を1件登録したため、件数は仕訳45・明細93。**手順5（2接続の同時実行確認）は未実施。バックアップ取得は利用者の報告にない。**
- アプリ（`handover/step2-app-report.md`）: コミット `e80b3ce`（エラー処理）`202216d`（データ層）`a9276ba`（画面）`dcc13ac`（翌期通知）`d91dedc`（2期目BSテスト）`f0a45b9`（PDFエラー）`594c990`（報告書）、`main` へマージ `370d56d`（push: `dca8e56..370d56d`）。`npm test` 1,236件・型チェック・ビルド成功、lint 28エラー／12警告で増加なし（いずれもCodexの報告）。
  - エラー: `ERROR_CODES` と `DOMAIN_ERRORS` に上記コードと `REFERENCE_NOT_FOUND_OR_OTHER_COMPANY`（P0001）を追加。23503は制約名で `OPENING_BALANCE_MANUAL_SET_EXISTS`／`OPENING_BALANCE_ACCOUNT_IN_USE` に分岐。`getOpeningBalancesByType` と `fetchOpeningBalances` は失敗時に翻訳した例外を投げる（以前は空のMapを返していた）。元帳・補助元帳・補助残高・試算表・損益試算表は取得失敗の文言を表示し、`PDFButton` はサーバーの `error` を表示。`deletePeriodForCompany` は手動設定のある期を拒否（テーブル未作成 `42P01`／`PGRST205` は従来どおり削除へ進む）。
  - データ層 `lib/opening-balances.ts`（整数の銭単位で検証・合計。符号変換は `normalizeOpeningBalance` に集約。DB・RPCは生残高＝借方超過が正、画面と導出値との差は正常残高方向）。
  - 画面 `app/opening-balances/page.tsx`・`components/opening-balances/OpeningBalanceEditor.tsx`・ナビに「期首残高」。手動設定のない期は導出値を読み取り専用で表示し保存ボタンなし。「手動設定を開始」で入力可、「やめる」で破棄、保存するまでDBに書かない。差額≠0 は確認ダイアログ（繰越先の名前入り）→ `p_auto_balance=true`。手動設定中は「手動設定を解除」（確認あり）・導出値との差の強調と件数。個人は事業主貸・事業主借を表示しない。画面内の期選択は `useCurrentPeriod()` を変えない。
  - 通知 `components/OpeningBalanceImpactNotice.tsx`・`lib/opening-balance-impact.ts`: 仕訳画面とCSV取込画面の上部に、翌期があり直後の期に手動設定がないときだけ「この期の仕訳を変更すると、翌期以降の期首残高も自動で再計算されます」を表示（保存はブロックしない）。
- 利用者の画面確認（2026-11-14・`step2-app` ブランチをローカル `npm run dev`・本番DB接続）: 2025年10月期の仕訳変更が2026年10月期の期首に反映／「期首残高」画面の導出値表示・手動設定の開始と「やめる」／保存と解除の4項目は問題なし。**未確認**: 個人（事業主貸借の除外・BS一致）、手動設定のある期の削除拒否、繰越先NULL時のエラー表示（画面・PDF）、PDFエラー表示、IME・Edge、本番デプロイ後の表示、同時編集。
- 既知の限界: 楽観的排他は未実装。年度確定・ロックはステップ3で実装済み。履歴表のINSERTポリシーが開いている（偽造余地・8-4）。期の連続性はDBで守られない。`bs_category` が NULL のBS科目の動きは導出値には出るが入力表に出ない。保存/解除後の再取得だけ失敗した場合は再読込で確認。手動設定は全科目一括。他帳票の大量取得は未対応のまま。

### ステップ3: 年度の確定・ロック（2026-11-15・本番DB適用済み・アプリ実装/実機確認済み）

- 実体: `supabase/manual-migrations/20261115120000_period_close.sql`（変更）／`.test.sql`（テスト165項目）／`.test_local.sql`（ローカル専用4項目。`session_replication_role = replica` を使うため**本番では実行しない**）／`_apply.md`（適用手順・ロールバック・既知の制限）／`_concurrency.md`（C1〜C10）。設計は Project の `SA_step3_design_v1_1.md`・`SA_step3_sql_design_v1.md`。SQLの検証報告は `supabase/manual-migrations/step3-sql-report.md`、PG17.12 の回帰は `handover/step3-pg17-regression-report.md`。
- 状態: `fiscal_periods.closed_at`（NULL＝未確定）。確定は**順序つき**: N期を確定するには N−1 期が確定済み、N期を解除するには N+1 期が未確定。履歴表 `fiscal_period_close_logs`（RLS有効・SELECT/INSERTのみのpolicy）に確定・解除を記録する。
- RPC（SECURITY INVOKER・anon/authenticated のみ EXECUTE）: `get_period_close_check(period_id)`（確定前の確認。errors／warnings）、`close_fiscal_period(period_id, memo)`、`reopen_fiscal_period(period_id, memo)`。**確定・解除は1トランザクションにつき1期**（複数期を同じトランザクションで扱うと他の期の更新と循環待ち＝デッドロック `40P01` になり得る。C10・片方が中断されるだけでデータは壊れない）。
- 確定前チェック（確認関数5本。**意図して VOLATILE**）: E1〜E5（エラー＝確定不可）と W1／W3（警告）。チェックは BEFORE UPDATE トリガーが行うため、REST から `closed_at` を直接更新しても回避できない。E3＝繰越先と損益の整合、E4＝財務諸表区分の未設定、E5＝期間の重なり（E2＝最初の期より前の仕訳は、あり得ないデータが必要なためローカル専用テストで確認）。
- 確定済みの期で拒否されるもの（トリガー10本）: その期の仕訳・明細の追加／変更／削除、期首残高（sets／lines）の変更、期の日付変更・削除、確定済みの期の前方への期の挿入・重なり、科目の種別／区分／親の変更（確定済みの期に使われている科目）、繰越先の変更。`closed_at` と日付の**同時変更**は `PERIOD_CLOSED_FIELDS`（手順0）。`trg_journal_lines_z_closed_guard` の `z_` は、`trg_journal_lines_guard` より後に動かすため。
- エラー（P0001）10種: `PERIOD_CLOSED` `PERIOD_CLOSE_PREVIOUS_OPEN` `PERIOD_REOPEN_NEXT_CLOSED` `PERIOD_CLOSE_CHECK_FAILED` `ACCOUNT_IN_CLOSED_PERIOD` `CARRY_FORWARD_LOCKED` `PERIOD_CLOSED_FIELDS` `PERIOD_OVERLAPS_CLOSED` `PERIOD_ALREADY_CLOSED` `PERIOD_NOT_CLOSED`。アプリ側の `ERROR_CODES`／`DOMAIN_ERRORS` へ追加済み（86dfd08）。
- ロック順序: 確定・解除・日付変更は「期の行 → 会社の advisory ロック（排他／共有）」、書き込み側は「仕訳の行 → 期の `FOR SHARE`（advisory は取らない）」、科目・繰越先のガードは「対象行 → advisory 共有」。`fiscal_periods` の行ロックを採番に使ってはいけない規則（第14弾）は従来どおり。
- **保証の範囲**: 「確定」が保証するのは**会計上の残高が動かないこと**だけ（仕訳・期首残高・科目の種別／区分／親・繰越先・期間）。税区分マスタ・`tax_method`・科目名・補助科目の追加などは固定されない。認証がないため**解除は誰でもできる**。履歴は操作の記録であり、改ざん防止ではない（anon に INSERT が許可）。
- 本番適用（2026-11-15・Supabase SQL Editor・PG 17.6。以下は利用者の報告で、Codexによる本番接続はなし）: 事前に `pg_dump -n public -Fc`（399,453バイト）を取得。事前確認: 件数（会社6・期10・科目973・仕訳48・明細99・取込40・期首残高 sets0／lines0／logs16）・期間の重なり0・繰越先未設定0・区分未設定で仕訳のある科目0・既存の列と表なし。変更SQLはエラーなしで適用、件数は適用前と完全一致、確定済みの期0／10・履歴0・トリガー10本。新テスト `ALL PASSED (165 checks)`、既存の `opening_balances`（66）・`company_support`（136）・`company_archive`（7）も `ALL PASSED`。`supabase/schema.sql` は同日の本番ダンプ（schema-only・public・`--no-owner`）で置換（差分は追加909行・削除35行。削除はダンプ付属行と並び順の変化で、関数は残っていることを確認）。
- ローカル検証: Claude は PG16.15 で新テスト165項目・変異テスト・同時実行（pgbench を含む）を確認。**PG17.12 の回帰は Codex が実施**（既存7テスト380項目が適用前後とも通過、新テスト165項目、ローカル専用4項目、同時実行17シナリオ＋C10、変異5種）。
- **注意（テストSQL）**: Supabase は `public` に作った新テーブルの RLS を自動で有効にする（`rls_auto_enable`）。テストが作る結果記録用テーブルも対象になり、anon での記録が拒否される。今回のテストは `t_results` に `DISABLE ROW LEVEL SECURITY` を入れて対処した。ローカルPGでは再現しないため、新しい `.test.sql` で anon に切り替えて記録する場合は同じ対応が要る。
- **アプリ側は 2026-11-15 に実装・実機確認済み（コミット 86dfd08）**。利用者・Windows／Chrome・日本語入力ON・テスト用の会社で次の7項目すべて問題なし（利用者報告。Codexによる再実機確認はしていない）。詳細・残る確認項目は `handover/step3-app-report.md`。

  1. 設定画面で確定前チェックの結果が表示される。
  2. 古い期から確定でき、新しい期を先に確定しようとすると理由が出る。
  3. 確定済みの期で仕訳の入力・編集・削除が拒否され、日本語メッセージが出る。
  4. 確定を解除すると元どおり入力できる。
  5. 科目名の変更は、確定済みの期があっても通る。
  6. 期首残高画面・CSV取込画面に確定済みの表示が出る。
  7. 解除は新しい期から順にしかできない。

- **未確認**: Edge・Google日本語入力、本番の会社での確定・解除の実操作、同時編集（別タブとの競合を含む）、確定済みの期でのCSV本登録の拒否表示、科目マスタの `ACCOUNT_IN_CLOSED_PERIOD` の表示。本番での同時実行確認（C1〜C10）は未実施、pgbench（C6）はPG16のみ。
- 既知の限界: 期の連続性（空白・重複）の一般的なDB強制はしない（確定済みの期との関係と E5 のみ）。一括変更どうしのデッドロックは従来からあり、変えていない。`ledger_view`・RLS・grant の最小化は未対応。

### 既知の限界・未対応（1b完了時点）

- 前期以前の累積損益の繰越先への振替は、ステップ2で実装済み（「ステップ2: 期首残高・繰越」節）。BSの不一致警告は残す。
- 他帳票の大量取得は未対応: 試算表、補助残高、消費税集計、仕訳、元帳、補助元帳（`lib/reports/{trial-balance,subsidiary-balance,tax-summary,journal,ledger,subsidiary-ledger}.ts`）と `getClosingBalance`。行数上限と全IDを単一inへ渡す箇所が残る。詳細はD報告のファイル/箇所一覧を参照。
- 科目マスタの税区分グループ→`tax_codes.id` 変換は未実装。旧 `system_settings.tax_method` 行は未使用のまま残る（利用者申告、行データは今回未確認）。
- 会社の改名・削除は未対応。認証・会社間のアクセス認可/RLSは未設計。現在のcookie照合・会社条件・複合外部キーは認可を代替しない。

### 補助科目の構造
- `accounts.parent_id` が `NULL` → 親科目
- `accounts.parent_id` に値あり → 補助科目（親科目のIDを参照）

### ledger_view の権限
- View を `CREATE OR REPLACE` で再作成すると権限がリセットされる
- 再作成後は必ず実行: `GRANT SELECT ON ledger_view TO anon, authenticated;`
- `ledger_view` は `security_invoker` 未設定（所有者権限で動くため RLS を素通りする）。RLS を本格化する際は要修正

### 科目区分と残高の増減方向
- ASSET・EXPENSE: 借方が増加
- LIABILITY・EQUITY・REVENUE: 貸方が増加

### account_aliases テーブル
- カラム: `id, account_id, alias, normalized_alias, alias_type, sort_order`
- `alias_type`: `KANA | ROMAN | ABBREV | OTHER`
- `normalized_alias` は保存時に必ず `normalizeText(alias)` で生成する（`lib/account-search.ts`）
- `accounts` テーブルと JOIN する場合: `.select('*, account_aliases(id, alias, normalized_alias, alias_type, sort_order)')`

### journal_templates / journal_template_lines テーブル
- `journal_templates` カラム: `id, name, default_description, sort_order, created_at, updated_at, company_id`
- `journal_template_lines` カラム: `id, template_id, line_number, side, account_id, amount, tax_code, description, company_id`
  - `account_id` / `amount` は `null` 可（科目未設定・金額省略を許容）
  - `template_id` は `journal_templates.id` への外部キー（CASCADE DELETE）
- ネスト取得: `.select('*, journal_template_lines(*)')` → JS側で `line_number` 昇順ソート
- `templateToLines()` で `TemplateLine[]` → `LineState[]` に変換。`account_id = null` の行があれば `hasOrphanedAccounts: true`

### スキーマの実態（2026-11-15 本番ダンプと照合・`supabase/schema.sql` 参照）
- テーブル17（2026-11-15 に `fiscal_period_close_logs`、2026-11-14 に期首残高の3表を追加。2026-11-12 に `companies` を追加）: `account_aliases` `accounts` `companies` `fiscal_periods` `import_staging` `journal_entries` `journal_entry_logs` `journal_lines` `journal_template_lines` `journal_templates` `mapping_rules` `period_opening_balance_lines` `period_opening_balance_logs` `period_opening_balance_sets` `system_settings` `tax_codes` `fiscal_period_close_logs`、View `ledger_view`
- `accounts.default_tax_code` は `text` で外部キー無し。1a以降は `tax_codes.id` でなく6つの税区分グループをCHECKで制約する（上記参照）。
- `journal_lines.tax_code` も `text`（外部キー無し）。`import_staging.debit_tax_code_id` / `credit_tax_code_id` のみ `tax_codes` への外部キーあり
- `mapping_rules.priority` のデフォルトは `0`、`keyword` に UNIQUE 制約は無い
- `journal_entries.period_id` 単独のインデックスは無い（件数が増えたら追加を検討）。`accounts.code` の一意は `(company_id, code)`。採番用の部分ユニークインデックス `(period_id, reference_number)`（`reference_number` が NULL でない行）は有る
- `journal_lines.account_id → accounts` は ON DELETE 制限なし（= 削除不可）、`journal_template_lines.account_id` は SET NULL、`journal_lines.entry_id` は CASCADE
- 関数: `bump_parent_entry_updated_at` `get_opening_balances_for_period` `get_pl_data` `log_journal_entry_changes` `rls_auto_enable`（既存）＋ 仕訳保存まわり 9 個（上記「仕訳保存の RPC と整合性の制約」）＋ 伝票番号の採番まわり 3 個（上記「伝票番号の自動採番」）＋ 会社単位まわり（`company_seed_accounts` `create_company` とトリガー関数。上記「会社単位（法人／個人）と初期科目セット」）＋ 期首残高まわり（ステップ2。`get_derived_opening_balances_for_period` `save_period_opening_balances` `clear_period_opening_balances` と補助・トリガー関数。上記「ステップ2: 期首残高・繰越」）。`import_staging_entries` と `get_opening_balances_for_period` は会社単位のために更新し、後者はステップ2で作り直した（手動設定または導出値を返す）。ステップ3の確認関数（VOLATILE）・確定/解除RPC・ロック補助・ガード関数も追加済み（上記「ステップ3」）。`fiscal_periods.closed_at` で確定状態を保持する。`journal_lines (entry_id, line_number)` の UNIQUE 制約は無い（検討課題）
- 期首残高仕訳（`is_opening_balance = true`）は 2026-11-01 時点で 0 件。コード上にも作成経路は無い（作成元は未確認）
- `import_staging.raw_debit_amount` / `raw_credit_amount` は `numeric(15,2)`。CSV はパーサー側で整数円以外を弾く対応済みのため丸めは起きないが、CSV を経由しない直接書き込みでは丸めが残り、丸め後の値を見る RPC の検証では防げない。

### 訂正削除履歴（journal_entry_logs）
- Trigger `trg_journal_entry_changes`（journal_entries の BEFORE UPDATE/DELETE）が変更前の entry + lines を記録する。Trigger `trg_lines_changes_bump_parent`（journal_lines の AFTER INSERT/UPDATE/DELETE）は親の `updated_at` を更新する。
- **2026-11-01 に修正済み**: `log_journal_entry_changes()` は、`pg_trigger_depth() > 1` の UPDATE（= 明細 Trigger 経由の連鎖更新）を記録しない。DELETE は常に記録する。修正前は、明細1行の INSERT/DELETE ごとに UPDATE ログが増え（新規入力で行数分、編集で 1 + 削除行数 + 挿入行数）、変更前として不正確なスナップショットも混ざっていた。
- 現在の記録: 新規入力 0件 / 編集 1件（変更前の entry + 全明細）/ 一括変更 1件×件数 / 削除 1件×件数。アプリでも確認済み（編集2回＋一括変更2件＝UPDATE 4件、一括削除2件＝DELETE 2件）。
- **守るべき前提**: 仕訳の編集は必ず `journal_entries` のヘッダー UPDATE から始めること。`update_journal_entry`（RPC）がこの順序を保証している。明細だけを変更してヘッダーを触らない処理（`journal_lines` の直接 UPDATE/DELETE/INSERT）を作ると、履歴が残らない。
- 修正前のログは開発用テストデータ時点で全件リセットした（2026-11-01）。それ以降のログは「ノイズ除去後の動作検証の基準点」であり、改ざん耐性の保証ではない。
- 残る課題: ① `journal_entry_logs` への INSERT が anon/authenticated に許可されている（Trigger が呼び出し側権限で INSERT するため）。ログの偽造余地がある。② `changed_by` は `'user'` 固定。③ `journal_lines` を REST から直接変更すると、ヘッダーを経由しないため履歴に残らない（`insert_journal_lines` の直接呼び出しも同様）。
- 解消済み（2026-11-01）: CSV 取り込み失敗時の DELETE ログ（`import_staging_entries` が1トランザクションのため、失敗時は取り消し用の DELETE 自体が発生しない）、保存処理の非原子性。

### DB変更の手順
1. 変更 SQL を `supabase/manual-migrations/<timestamp>_<内容>.sql` に保存する（`supabase/migrations/` は Supabase CLI の履歴用なので使わない）。
2. Supabase の SQL Editor で手動実行する（CLI の migration 履歴には登録されない）。
3. `supabase/schema.sql` と本ファイルを更新し、Project のコピーも差し替える。
4. 新しいテーブルを作ったら、`REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;` を再実行する。`pg_default_acl`（2026-11-01 確認）で、public スキーマの新しいテーブルには anon/authenticated に `Dxtm`（TRUNCATE・REFERENCES・TRIGGER・MAINTAIN）が**再付与される**ことが確定している。MAINTAIN（PG17）は 11/1 の REVOKE に含めていない（REST から実行できないため低リスク。権限の最小化時に整理する）。
5. 新しい関数を作ったら、`GRANT EXECUTE` を明記する（既定では postgres のみ。理由は上記）。**トリガー関数や RPC から呼ばれる補助関数にも必要**（SECURITY INVOKER のため呼び出し側ロールの権限で評価される）。
6. テスト（`.test.sql`）は、DO ブロック1つで完結させ、最後に意図的な例外でロールバックする方式にする（SQL Editor は1回の実行を1トランザクションとしてコミットするため）。遅延制約を検証するときは `SET CONSTRAINTS <名前> IMMEDIATE` で前倒しし、異常系は EXCEPTION 付きのブロック（= SAVEPOINT）で分離する。実際のコミット経路と同時更新は、別接続（psql 2つ）で確認する。
   - Supabaseでは新テーブルにRLSが自動で有効になるため、anonで結果を記録するテスト専用の `t_results` は必要に応じてトランザクション内で `DISABLE ROW LEVEL SECURITY` にする（アプリ・本番の業務テーブルには行わない）。

### fiscal_periods テーブル
- カラム: `id, name, start_date, end_date, is_current, company_id, closed_at`（closed_atは2026-11-15追加、NULL＝未確定）（2026-11-12 から。`company_id` は必須）
- `is_current` は会社ごとに1件のみ（`PARTIAL UNIQUE INDEX (company_id) WHERE is_current = true`）。1bの `getCurrentPeriod(companyId)` は `is_current = true` と `company_id` の両方で絞る。
- `journal_entries` との結合カラムは **`period_id`**（`fiscal_period_id` ではない）
- 期名は終了日から自動生成: `generatePeriodName` は `end_date` を使う（例: 2026-03-31 → "2026年3月期"）

---

## セキュリティルール（必読）

### 環境変数・秘密情報
- `.env.local` は `.gitignore` 済み。**絶対にコミットしない**
- `NEXT_PUBLIC_` prefix を付けてよいのは **Supabase URL と anon key のみ**
  - `NEXT_PUBLIC_*` の値はビルド成果物（クライアント JS）にそのまま埋め込まれる
  - service_role key・webhook secret など他の機密情報には絶対に付けない
- 将来 `SUPABASE_SERVICE_ROLE_KEY` 等を追加する場合はサーバー専用変数（`NEXT_PUBLIC_` なし）にし、`app/api/**` 内でのみ使う
- シークレット・認証情報・個人情報・生の CSV 内容を `console.log` やサーバーログに出力しない

### Supabase・データアクセス
- anon key はクライアント公開設計。**Supabase RLS (Row Level Security) が唯一のアクセス制御ライン** — RLS に不備があると anon key を知る誰でもデータを読み書きできる。RLS を無効化しない
- **【現状の実態】** 主要7テーブルは RLS 有効だが、policy は全て `allow_all_*`（role `public` / `using (true)` / `with check (true)`）で**実質アクセス制御は無い**。RLS 無効のテーブル: `account_aliases` `journal_templates` `journal_template_lines` `system_settings` `tax_codes`。`companies`（2026-11-12 追加）は RLS 有効だが policy は `allow_all_companies` で、会社間の認可にはなっていない（複合外部キーによる越境防止はデータの整合性であって、アクセス制御ではない）。`journal_entry_logs` のみ INSERT/SELECT の policy で、UPDATE/DELETE は REST API から拒否される。
- 上記は**ローカル単一ユーザー運用（未公開）が前提**で許容している状態。公開・共同利用の前に認証・テナント分離・policy 再設計・`ledger_view` の `security_invoker`・grant の最小化・バックアップ（Free プランは自動バックアップなし）が必須。
- anon/authenticated の `TRUNCATE` / `REFERENCES` / `TRIGGER` は、2026-11-13の本番ダンプで既存13表に付与がないことを再確認。MAINTAINは残り、service_roleには `REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` の明示付与がある。新規表の既定権限は既存表と別で、上記「DB変更の手順」のとおり再付与に注意する。認証導入時の権限最小化は未対応。
- `rls_auto_enable()`（SECURITY DEFINER）が存在し、public スキーマの新規テーブルは RLS が自動有効化される想定（イベントトリガー本体は未確認）。policy を作るまでアプリからはアクセスできない。
- クエリは常に Supabase query builder（`.from().select().eq()` 等）を使う。RPC 引数や filter に文字列を連結して SQL を組み立てない
- 新テーブルを追加するときは **RLS policy を設定してから** アプリに組み込む

### API Route（`app/api/pdf/**`）
- 現在すべての PDF API Route は**認証なし** — ローカル単一ユーザー運用が前提。外部公開時は認証ミドルウェアを追加する
- クエリパラメータの数値（`amountMin` / `amountMax` 等）は `Number()` 変換後に `isNaN()` チェックを入れる
- `Content-Disposition` ヘッダーのファイル名に動的値を使う場合は必ず `encodeURIComponent()` を適用する（`ledger/route.ts` で実施済み。他は固定文字列）

### フロントエンド
- `dangerouslySetInnerHTML` は使わない（React JSX のエスケープに依存する）
- CSV インポートの文字列データは React JSX でレンダリングするため XSS リスクなし。この前提を崩す実装（innerHTML 等）をしない

### テスト・開発データ
- 本番データ・実在の個人情報をローカル検証・テスト・サンプル CSV に使わない

---

## ファイル構成（簡略）

```
app/
  accounts/page.tsx          ← 勘定科目マスタ
  journals/page.tsx          ← 仕訳日記帳
  ledger/page.tsx            ← 総勘定元帳
  trial-balance/page.tsx     ← 残高試算表
  subsidiary-ledger/page.tsx ← 補助元帳
  subsidiary-balance/page.tsx← 補助残高一覧表
  tax-summary/page.tsx       ← 消費税集計表
  income-statement/page.tsx  ← 損益計算書
  balance-sheet/page.tsx     ← 貸借対照表
  settings/page.tsx          ← 設定画面（Server Component）
  layout.tsx                 ← ナビゲーションバー（上部に常時表示・headerごと印刷対象外）

actions/
  fiscal-period-actions.ts   ← 会計期間の Server Actions（create/update/delete/setCurrent）

contexts/
  DisplaySettingsContext.tsx ← 表示設定（localStorage）の Context
  FiscalPeriodContext.tsx    ← 当期の FiscalPeriod を全体に提供する Context

components/
  journals/
    JournalForm.tsx          ← 仕訳入力フォーム（JournalEntryWithLines 型・JournalFormHandle 型を export）
    JournalLineRow.tsx       ← 明細1行（Account 型・LineState 型を export）
    JournalList.tsx          ← 仕訳一覧グリッド（仕訳を分割しない12表示行の窓・JournalListHandle 型を export）
    JournalSearch.tsx        ← 検索フォーム（Collapsible・SearchParams 型・EMPTY_SEARCH を export）
    InlineJournalForm.tsx    ← 共通グリッドの入力フォーム（摘要→補足→保存のDOM順・InlineJournalFormHandle 型を export）
    InlineEditRow.tsx        ← 単純仕訳のグリッド編集行（保存失敗時は入力を保持）
    AccountCombobox.tsx      ← 科目選択コンボボックス（forwardRef・createPortal・エイリアス検索対応）
    DateInput.tsx            ← 弥生式日付入力（MMDD → MM/DD 表示 → YYYY-MM-DD）
    TemplateSelector.tsx     ← テンプレート選択UI（第12弾で削除。過去の構成）
    TemplateManager.tsx      ← テンプレート管理カード（第12弾で削除。過去の構成）
  settings/
    DisplaySettings.tsx      ← 表示設定カード（Switch・仕訳日記帳の文字サイズ）
    FiscalPeriodSettings.tsx ← 会計期間一覧カード
    FiscalPeriodModal.tsx    ← 会計期間の追加・編集モーダル
  ledger/
    LedgerTable.tsx          ← 総勘定元帳テーブル（8列）
  tax-summary/
    TaxSummaryTable.tsx      ← 消費税集計テーブル（props: rows/grandDebit/grandCredit/loading。整形済みデータを受け取る）
  financial-statements/
    SectionHeader.tsx        ← セクション見出し行（colSpan対応）
    FinancialRow.tsx         ← 明細・小計行（前期比較列対応）
    PLTable.tsx              ← 損益計算書テーブル（8区分・前期比較・hideZero）
    BSTable.tsx              ← 貸借対照表テーブル（資産・負債・純資産の部・hideZero）
  print/
    PrintButton.tsx          ← window.print() ボタン（no-print クラス付き）
  pdf/
    PDFButton.tsx            ← fetch → blob → a.click() ダウンロードボタン（loading状態あり）
    common/
      PDFStyles.ts           ← @react-pdf/renderer 共通 StyleSheet
      PDFHeader.tsx          ← PDFヘッダー（タイトル・期名）
      PDFFooter.tsx          ← PDFフッター（ページ番号・fixed）
    documents/
      PLDocument.tsx              ← 損益計算書 PDF ドキュメント
      BSDocument.tsx              ← 貸借対照表 PDF ドキュメント（3部構成・当期純損益固定行）
      TrialBalanceDocument.tsx    ← 残高試算表 PDF ドキュメント（6列・グループ小計）
      TaxSummaryDocument.tsx      ← 消費税集計表 PDF ドキュメント（3列・集計期間表示）
      JournalDocument.tsx         ← 仕訳日記帳 PDF ドキュメント（A4横・7列・弥生方式展開）
      LedgerDocument.tsx          ← 総勘定元帳 PDF ドキュメント（A4横・8列・前期繰越行）
      SubsidiaryBalanceDocument.tsx ← 補助残高一覧表 PDF ドキュメント（6列・グループ小計）
      SubsidiaryLedgerDocument.tsx  ← 補助元帳 PDF ドキュメント（A4横・7列・前期繰越行）
  ui/                             ← shadcn/ui コンポーネント

app/
  api/pdf/
    income-statement/route.ts   ← 損益計算書 PDF API（runtime='nodejs'）
    balance-sheet/route.ts      ← 貸借対照表 PDF API（runtime='nodejs'）
    trial-balance/route.ts      ← 残高試算表 PDF API（runtime='nodejs'）
    tax-summary/route.ts        ← 消費税集計表 PDF API（periodId・startDate・endDate 必須）
    journal/route.ts            ← 仕訳日記帳 PDF API（periodId 必須・検索条件全対応）
    ledger/route.ts             ← 総勘定元帳 PDF API（periodId・accountId・accountType 必須）
    subsidiary-balance/route.ts ← 補助残高一覧表 PDF API（periodId 必須）
    subsidiary-ledger/route.ts  ← 補助元帳 PDF API（periodId・accountId・accountType 必須）

lib/
  supabase.ts                ← Supabase クライアント
  balance-calculator.ts      ← getPreviousPeriod / getClosingBalance / getOpeningBalancesByType
  csv-export.ts              ← buildCsv / downloadCsv / todayYYYYMMDD / formatDateSlash / exportJournalsToCsv
  display-settings.ts        ← DisplaySettings 型 / getDisplaySettings / saveDisplaySettings
  fiscal-period.ts           ← FiscalPeriod 型 / getCurrentPeriod / getAllPeriods / resolveYearFromMonth / generatePeriodName
  toast.tsx                  ← ToastProvider / useToast（固定bottom-right、3秒自動消去）
  account-search.ts          ← AccountWithAliases 型 / normalizeText / searchAccounts（エイリアス検索）
  financial-statements.ts    ← getPLData / getBSData（損益計算書・貸借対照表のデータ取得・集計）
  financial-statements-ui.ts ← formatAmount（△表記）/ formatRate（増減率）
  journal-templates.ts       ← TemplateLine / JournalTemplate 型 / fetchTemplates / createTemplate / deleteTemplate / templateToLines
  pdf/
    fonts.ts                 ← registerFonts()（NotoSansJP OTF 登録・シングルトン）
    pdf-utils.ts             ← fmt / fmtAmount / fmtDiff / fmtOb（PDF用フォーマット関数）
  reports/
    income-statement.ts      ← PLReport 型 / getPLReport()（画面・PDF共用データ層）
    balance-sheet.ts         ← BSReport 型 / getBSReport()（PL→BS の順で取得）
    trial-balance.ts         ← TrialBalanceReport 型 / getTrialBalanceReport()
    tax-summary.ts           ← TaxSummaryReport 型 / getTaxSummaryReport(params, taxCodes)
    journal.ts               ← JournalDisplayRow 型 / JournalReport 型 / getJournalReport()
    ledger.ts                ← LedgerRow 型 / LedgerReport 型 / getLedgerReport()
    subsidiary-balance.ts    ← TYPE_LABELS 定数 / SubsidiaryBalanceReport 型 / getSubsidiaryBalanceReport()
    subsidiary-ledger.ts     ← SubsidiaryLedgerRow 型 / SubsidiaryLedgerReport 型 / getSubsidiaryLedgerReport()
  utils.ts
```

### 追加ファイル（上の簡略図に未記載・2026-05 以降）

```
app/csv-import/page.tsx            ← CSVインポート（本登録・ルール管理）
app/pl-trial-balance/page.tsx      ← 残高試算表（損益）。/trial-balance は貸借のみ
app/api/pdf/pl-trial-balance/route.ts
components/csv-import/             ← CsvUploader.tsx / StagingTable.tsx
components/journals/               ← TemplateEditModal.tsx / TemplateFormFields.tsx（第12弾で削除。過去の構成）
components/ui/                     ← alert.tsx / tabs.tsx
lib/errors.ts                      ← AppError 系クラス・ERROR_CODES・isAppError
lib/supabase-error-handler.ts      ← translateSupabaseError / wrapSupabase（P0001 の DOMAIN_ERRORS 変換を含む）
lib/journal-save.ts                ← 仕訳保存 RPC のラッパー（createJournalEntry / updateJournalEntry / importStagingEntries / amountToRpcString）
lib/amount-sync.ts                 ← 単純仕訳の借貸金額の自動コピー判定（syncAmounts）
__tests__/amount-sync.test.ts      ← 借貸金額の自動コピーの純関数テスト（87件）
lib/journal-duplicate.ts           ← InlineLine / InlineDraft 型・単純仕訳の判定と入力フォームへの複製変換
lib/reference-number.ts            ← parseReferenceNumberInput（伝票番号の入力文字列を number | null に変換。全角数字対応）
__tests__/journal-duplicate.test.ts ← 単純仕訳の判定・複製変換の純関数テスト（14件）
__tests__/reference-number.test.ts ← 伝票番号の入力変換のテスト
__tests__/supabase-error-handler.test.ts ← 制約名による 23505／23514 の変換など
__tests__/journal-reference-ui.test.ts ← 伝票番号の編集時の保持・保存前の検証・仮行から確定行への置換などのテスト
lib/accounts.ts                    ← getNextSubAccountCode（補助科目の自動採番）
lib/tax-codes.ts                   ← 税区分・事業者タイプ
lib/csv-import.ts                  ← 独自形式パーサー
lib/csv-import-yayoi.ts            ← 弥生形式パーサー
lib/yayoi-tax.ts                   ← 弥生の税区分表記 → tax_codes.id の変換（resolveYayoiTaxCode）
supabase/schema.sql                ← DBスキーマのスナップショット
supabase/manual-migrations/        ← 手動適用した変更SQL（CLIの履歴には未登録）
  20261115120000_period_close.sql               ← 年度の確定・ロック（本番適用済み）
  20261115120000_period_close.test.sql          ← 165項目のSQLテスト
  20261115120000_period_close.test_local.sql    ← ローカル専用4項目（本番で実行しない）
  20261115120000_period_close_apply.md          ← 適用・ロールバック手順
  20261115120000_period_close_concurrency.md    ← C1〜C10の同時実行手順
  20261101180000_atomic_journal_save(.test).sql   ← Migration A: 保存 RPC・CHECK・会計期間 Trigger（テスト 88件）
  20261101180100_enforce_journal_balance(.test).sql ← Migration B: 借貸一致の遅延制約・明細ガード（テスト 18件）
  20261101180100_concurrency_test.md              ← COMMIT 経路・同時更新の確認手順
  20261104180000_add_entry_supplement(.test).sql  ← 補足列・保存RPCの末尾引数（2026-11-04 適用済み・テスト 20/20 通過）
  20261110170000_auto_reference_number(.test).sql ← 伝票番号の自動採番（2026-11-11 までに適用済み・本番でテスト 45項目通過）
  20261110170000_auto_reference_number_apply.md   ← 適用の順序・同時実行テスト T1〜T6・後片付け（本番の T1〜T5 は未実施）
  20261112120000_company_support(.test).sql       ← 会社単位（法人／個人）・初期科目セット・複合外部キー（2026-11-12 本番適用済み・テスト 135項目通過）
  20261112120000_company_support_apply.md         ← 適用の順序・事前事後の確認・1b までの運用制限
lib/company.ts ← 会社型・候補の解決
lib/company-cookie.ts ← sa_company_id の仕様・読取
lib/company-guard.ts ← ブラウザーの会社照合
lib/company-server.ts ← Server Actionのcookie照合
lib/company-scope.ts ← 期/仕訳の所属会社を解決
lib/company-operations.ts ← 会社作成・アーカイブのDB処理
lib/company-period.ts ← 個人の会計期間の検証
lib/company-dirty.ts ← 会社切替と未保存の確認
contexts/CompanyContext.tsx ← useCompany・候補・会社切替
actions/company-actions.ts ← 会社作成・選択・アーカイブ/復元
components/layout/CompanySwitcher.tsx ← 会社切替UI
components/settings/CompanyCreateForm.tsx ← 会社作成/設定/アーカイブUI
components/settings/CompanySettings.tsx ← 会社作成/設定/アーカイブUI
components/settings/CompanyArchiveList.tsx ← 会社作成/設定/アーカイブUI
lib/account-master.ts ← 会社別科目・別名の保存
lib/account-master-options.ts ← 会社区分別の区分・税区分の選択肢
lib/financial-statement-calculations.ts ← 共通の純粋なPL/BS計算
lib/account-balance.ts ← normalizeOpeningBalance
lib/individual-financial-statements.ts ← 個人PL/BSの型と計算
lib/individual-statement-rows.ts ← 画面/PDFの個人用行構成
lib/report-pagination.ts ← ID分割・全ページ取得
lib/reports/scope.ts ← 帳票の会社整合・期名・HTTP状態
components/financial-statements/IndividualPLTable.tsx ← 個人用の表
components/financial-statements/IndividualBSTable.tsx ← 個人用の表
components/financial-statements/IndividualStatementTable.tsx ← 個人用の表
components/pdf/documents/IndividualPLDocument.tsx ← 個人用PDF文書
components/pdf/documents/IndividualBSDocument.tsx ← 個人用PDF文書
components/pdf/documents/IndividualStatementDocument.tsx ← 個人用PDF文書
supabase/manual-migrations/20261112150000_company_archive.sql ← is_archived列（5c1d2c4、本番ダンプに存在確認）
supabase/manual-migrations/20261112150000_company_archive.test.sql ← アーカイブ列の手動テスト
supabase/manual-migrations/20261112150000_company_archive_apply.md ← アーカイブ列の適用手順
supabase/manual-migrations/20261114180000_opening_balances(.test).sql ← 期首残高（手動設定・導出・繰越。2026-11-14 本番適用済み・テスト 52項目通過）
supabase/manual-migrations/20261114180000_opening_balances_apply.md ← 適用順序・ロールバックSQL・既知の制限
supabase/manual-migrations/20261114180000_opening_balances_concurrency.md ← 2接続の同時実行確認（本番は未実施）
lib/opening-balances.ts ← 期首残高の取得・保存・解除と純粋関数（銭単位の検証・合計・差）
lib/opening-balance-impact.ts ← 翌期への影響の通知条件
app/opening-balances/page.tsx ← 期首残高画面（期の選択）
components/opening-balances/OpeningBalanceEditor.tsx ← 期首残高の表示・手動設定・解除
components/OpeningBalanceImpactNotice.tsx ← 仕訳・CSV取込画面の翌期影響の通知
```

> `supabase/.temp/`・`*.tsbuildinfo` は `.gitignore` 済み。`handover/` の `SA_v12〜v14.txt` / `old_claude.md.txt` は過去の引継ぎ資料（参照のみ・更新しない）。

---

## 設定画面の設計メモ

### 表示設定（DisplaySettings.tsx）
- `localStorage` キー: `'stoic-display-settings'`（JSON: `{showSubAccount, showTaxClass, textSize}`）。旧設定に `textSize` がなければ `'normal'` を補う
- SSRガード: `typeof window === 'undefined'` で初期値 `DEFAULT_SETTINGS` を返す
- Context: `DisplaySettingsProvider` → `useDisplaySettings()` で `[settings, setSettings]` を取得
- Switch の変更は即座に localStorage へ保存し Toast 通知
- 仕訳日記帳の文字サイズは標準13px／大16px（`textSize: 'normal' | 'large'`）。一覧のコンテナだけに適用する。全画面型への切り替えは `journal-grid.module.css` の72em、表の下限は38em（列幅の下限は全画面型67.9em／半画面型35.2em）。最大化時の一覧幅約1215pxは16pxでも約75.9emのため全画面型になる。補足がある仕訳だけ半画面型の開閉ボタンに丸印を付け、開閉状態は保存しない
- ナビは `sticky top-0 z-40` で常時表示し、科目候補（z-index: 9999）・確認ダイアログ（z-50）を前面に出す。`html` の `scroll-padding-top: 3.5rem` はナビの高さ（h-14）に合わせ、キーボードでフォーカスしたセルが隠れるのを防ぐ。印刷時は親 `header` ごと `no-print` で非表示にする

### 会計期間管理（FiscalPeriodSettings.tsx / FiscalPeriodModal.tsx）
- 開始日は **常に自動設定・readonly**（既存期間があれば前期 `end_date + 1`、なければ手入力）
- 削除できるのは **最新の期間（end_date が最大）のみ**、かつ当期・仕訳あり期間は不可
- 編集時: `end_date` 変更は次の期の `start_date - 1` のみ許容（空白・重複防止）
- バリデーションエラーは Toast ではなく各フィールドの下に赤テキストで表示
- `is_current` 切替: false→true の順で実行（partial unique index 制約のため）

### FiscalPeriodContext
- `useCurrentPeriod()` → `{ period: FiscalPeriod | null, refresh: () => void }`
- `layout.tsx` の `DisplaySettingsProvider` 内にネスト

### テンプレート管理（TemplateManager.tsx）

第12弾で画面から削除。DB の `journal_templates`／`journal_template_lines` と `lib/journal-templates.ts` は残している（作り直しの予定）。以下は過去の実装の記録。

- 設定画面末尾の Card として配置（`settings/page.tsx` から `<TemplateManager />` を置くだけ）
- accounts は TemplateManager 内で supabase から直接 fetch（props で受け取らない）
- 登録フォームはインライン（モーダル不要）。`JournalLineRow` を再利用して明細を入力
- バリデーション：テンプレ名必須 / 全明細行に side と account_id が必要 / 金額は空欄可
- 削除は CASCADE により `journal_template_lines` も自動削除される
- `showSubAccount` / `showTaxClass` は `useDisplaySettings()` から取得

### TemplateSelector（TemplateSelector.tsx）

第12弾で画面から削除。DB の `journal_templates`／`journal_template_lines` と `lib/journal-templates.ts` は残している（作り直しの予定）。以下は過去の実装の記録。

- Props: `templates: JournalTemplate[]`, `onApply: (lines: LineState[], description: string | null) => void`
- テンプレ未選択時は「適用」ボタンを disabled
- `templateToLines()` で変換後 `onApply` を呼ぶ
- `hasOrphanedAccounts` が true なら適用後に alert を表示（削除済み科目の警告）

### JournalForm のテンプレート対応

第12弾で画面から削除。DB の `journal_templates`／`journal_template_lines` と `lib/journal-templates.ts` は残している（作り直しの予定）。以下は過去の実装の記録。

- マウント時に `fetchTemplates()` を呼び `templates` state で保持
- 新規モードかつ templates が1件以上のとき、タイトル直下に `<TemplateSelector>` を表示
- 編集モード（`editTarget` あり）では `TemplateSelector` を非表示
- 適用前に入力済み判定（摘要・伝票番号・明細のいずれかに値あり）→ confirm ダイアログ
- 適用時は明細・摘要を上書き。**日付・伝票番号は上書きしない**

---

## 仕訳日記帳の一括編集・一括削除（実装済み・コミット 555c0db）

- 状態は `app/journals/page.tsx` の `selectedIds: Set<string>` で管理。`JournalList` へ `selectedIds` / `onToggleSelect` / `onToggleAll` を渡す。
- 一覧・入力・編集は `components/journals/journal-grid.ts` の列定義を共有する。全画面型は8列、半画面型は6列＋摘要行。見出しも2段で、9セルの移動順は `NAV_COLS` に定義する（補足は対象外）。窓の処理は `lib/journal-paging.ts`。先頭仕訳IDを保持し、仕訳全体が12表示行に収まる範囲を表示する（13行以上の仕訳は単独で全行表示）。末尾は最終仕訳を含む最長の窓に丸めるため、継続行だけの断片は生じない。先頭IDが削除・絞り込みで消えたときは直前のindexを丸めて使う。↑↓／Tab／Shift+Tab／編集確定後のEnterで窓外へ移動すると、対象仕訳が全て入るまで仕訳単位でスライドし、仕訳ID＋列でフォーカスを復帰する。« ‹ › » は最初・前・次・最後の窓へジャンプし、範囲を「n〜m 行目 / 全 N 行」で表示する。`JournalListHandle` の既存メソッド名 `goToFirstPage` / `goToLastPage` / `focusFirstDebitCell` は維持し、検索後の `focusFirstDebitCell` は先頭へ戻す
- `showTaxClass` は一覧の表示だけを切り替え、インライン入力・編集の税区分欄は残す。一覧では `showSubAccount` を使わない。CSVは `buildJournalsCsv` が摘要の右に補足を出力し、複合仕訳の各表示行に繰り返す（CSVインポートは変更なし）
- 一覧セルの非編集時は Ctrl+↑（Mac は Command も可）で全仕訳の先頭の同じ列へ移動し、必要な場合だけ最初の窓へジャンプする。Ctrl+←／→（Mac は Command も可）は同じ仕訳の日付／摘要へ移動する。これらはセル側で処理し、画面全体のショートカットへ伝えない。選択中の仕訳もフォーカス先に更新する。Ctrl+↓（Windows）はセル側でイベントを消費せず、通常の ↓ による次の仕訳への移動も行わず、画面全体のショートカット（`app/journals/page.tsx`）へ渡す。画面全体で `goToLastPage()` により最後の窓へ移してから、入力フォームの日付欄へフォーカスする。Shift・Alt との併用は対象外。一覧セルのCtrl+↓を最後の仕訳の同じ列へ移動する操作にはしない。これらの画面全体のショートカットの判定は維持する。
- Space キーで選択切替。全選択は**表示中の窓の仕訳単位**。期首残高仕訳・インライン編集中は選択不可（UI のみ。DB 側の防御は無い）。
- 一覧の Alt+↓ は借方科目・貸方科目セルではその科目のインライン編集と候補表示を開始し、フォーカスは入力欄に残す。Enter/F2 と同じ条件で、継続行・期首残高仕訳・フォーム表示中は編集せず、複合仕訳は既存フォームを開く。それ以外のセルの Alt+↓ は補足を開閉する。
- 一覧セルの非編集時に文字を打つと、そのセルのインライン編集を開始して既存値を最初の1文字で置き換える（v5コミットA）。日付・借方金額・貸方金額は半角数字0〜9、借方科目・貸方科目・摘要は印字可能な1文字を受け付ける。伝票・補助は対象外。最初の表示行で、期首残高仕訳ではなく、入力フォーム非表示・未編集中の場合のみ開始する。IME中（`isComposing` / `keyCode === 229`）、リピート、Ctrl／Alt／Meta付き、Space、Tab、Enter、Escape、Fキー、矢印、Delete、Backspaceではこの経路を開始しない。Shiftで生成した印字文字は受け付ける。Spaceの選択・Deleteの確認・Ctrl+矢印は従来の処理を使う。複合仕訳は既存フォームを開き、文字を引き継がない。
- 開始キーは `preventDefault()` し、`initialField` とともに `initialInput: { field, text }` を `InlineEditRow` に渡して最初のレンダーから初期文字を入れる。金額は初期値を最初の数字で置き換える。第4弾コミット4以降はreadonlyの `type="text"` とし、初回フォーカスでは全選択せず、次の数字を追記する。摘要は初期文字の末尾にキャレットを置く。Enter／F2からの編集開始・既存値の扱いは変更しない。
- `AccountCombobox` は閉じた欄の ↓／Alt+↓ と `openOnMount` で閲覧モードを開く。コード順の全科目を表示し、現在の科目（未選択なら先頭）を強調して初回は中央へスクロールする。入力欄の現在の表示を全選択し、文字入力でコード・名前・別名の絞り込み検索へ切り替える。入力フォーム・インライン編集・テンプレートで共通。
- 文字入力から科目編集を開始するときは `AccountCombobox.initialQuery` に初期文字を渡し、`query` をその文字、`browsing=false`、候補を開いた状態、強調位置を先頭で初期化する。最初のフォーカスだけ全選択を避けて末尾にキャレットを置き、続けた文字を追記する。`openOnMount` の閲覧モードとは別指定で、Enter／F2からのフォーカス時の全選択は維持する。
- `a61a6de` の `replaceOnType` はimeFree未指定時の動作として維持する。`InlineEditRow` の親科目・補助科目欄で指定し、編集中の候補が閉じた欄への最初の文字で既存表示を置き換える。候補が開いていれば既存の検索語へ追記する。入力フォーム・テンプレートにはこの指定を追加しない。第4弾でインライン編集の欄は `imeFree` を優先し、replaceOnTypeによるselectは行わない。
- `DateInput.initialInputText` は初期文字を最初のフォーカスで消さないための任意指定。インライン編集では `commitRef` で `DateInputHandle.commit()` を呼び、Tab／Enterおよび行外へのblurによる保存の前に入力途中の日付を同期確定する。親stateの反映を待たず戻り値を検証・保存に使い、不正・未完の入力や実在しない月日はエラーにして保存せず編集を続ける。`commitRef` を指定しない入力フォームなどは、フォーカス時クリア・blur確定・不正入力時の空文字通知を維持する。
- v5コミットB：`InlineJournalForm.onNavigateUp` を `app/journals/page.tsx` で `JournalListHandle.focusLastEntryCell(col)` に接続する。入力フォームの先頭行の日付・借方科目・借方金額・貸方科目・貸方金額で、修飾キーなしの↑を押すと最後の仕訳の同じ列へ移る。最後の仕訳が表示中なら直接フォーカスし、窓外なら最後の窓へ移して既存の `pendingFocusCell` で仕訳ID＋列を指定する。仕訳0件では何もしない。既存メソッド名・一覧から↓でフォームへ戻る操作・画面全体のCtrl系ショートカットの判定は維持する。
- フォームの↑移動は `getInlineFormNavigateUpColumn` で対象列・先頭行・修飾キー・IME（`isComposing` / `keyCode === 229`）を判定する。税区分・補助・補足・2行目以降の明細行は対象外。科目候補が開いていれば既存の `stopPropagation()` により候補操作を優先する。閉じた科目欄が `preventDefault()` 済みでも移動を受け付ける。移動時は親でも `preventDefault()` し、金額の標準の↑による増加を抑止する。フォームのstateはリセットせず、入力内容を保持する。
- 日付の移動判定には、保存用の `commitRef` とは別の読み取り専用の `DateInput.statusRef`（`DateInputStatusHandle.hasPendingInput()`）を使う。フォーカス中に空白以外の未確定文字があれば、`1207` のように解釈可能でもblurする前は移動しない。文字のない状態なら既存の確定済み日付の有無によらず移動できる。会計期間未取得時のネイティブ日付欄も `validity.badInput` なら移動しない。移動の判定で日付の確定や `onChange` は呼ばず、フォーカス時のクリア・blur時の確定・コミットAの `commit()` の処理は変更しない。
- 摘要は↑移動の対象外。`list="desc-suggestions"` のネイティブdatalistはブラウザ側で↑を候補の表示・操作に使い、候補の開閉状態をアプリから確実に判定できないため、既存の候補操作を残す。datalistを自作するなどの回避策は入れない。
- コミットBの確認：`npm test` は469件、`npm run build` は成功。日付の変更前ハンドラーでは「12」の入力後にblurすると `onChange('')` が呼ばれることを、ブラウザを使わない一時的なハンドラー検証で再現した。変更後の状態取得は文字を変更せず未確定を返すこと、既存のblurと `commit()` が12/07を返すこと、一覧が0件・1件・窓外の末尾・13行の複合仕訳末尾を処理することも同じ方法で確認した。実機でのフォーカス移動・科目候補との競合・datalistとの競合・日付入力途中の保持・金額が増減しないこと・入力保持・↓でフォームへ戻ることは未確認。調査内容・制限・確認手順は [`ui-v5-commit-b-verification.md`](./handover/ui-v5-commit-b-verification.md)。コミットBはその後、利用者の実機確認で全項目OKの報告あり（2026-11-07）。
- v5コミットAの確認：純粋関数のテストは429件成功、`npm run build`成功。変更前は日付入力後のTab／Enterで変更前の日付が保存処理へ渡る問題を、ブラウザを使わない一時的なハンドラー検証で再現し、修正後は `1207` が12/07、不正な入力では保存なしとなる処理を確認した。科目の `s→h→o` で検索語が `sho` になる処理も同じ方法で確認した。実機のフォーカス・1文字目の欠け・2文字目以降・二重入力・候補表示・Escape・保存後の仕訳やDBの日付・他画面の操作は未確認。IME ONで非入力セルに最初の文字がどう届くかも未確認で、英字として届く可能性が残る。日本語はEnter／F2で編集に入ってから入力する運用を想定する。詳細は [`ui-v5-commit-a-verification.md`](./handover/ui-v5-commit-a-verification.md)。コミットAはその後、利用者よりmain反映済み・実機確認OKの報告あり（v5-B依頼時）。IME ONで一覧のセル（div）に最初の文字がどう届くかは、第4弾の実機検証（2026-11-07）で、IME ONのままでも `1`・`k` などそのまま届くことを確認した。
- 科目候補が開いているときの Escape は候補だけを閉じて検索語を空にし、行へイベントを伝えない。候補が閉じているときは行へ伝わるため、インライン編集中は次の Escape で編集を取り消す。`AccountCombobox.openOnMount` は指定時だけマウント時の候補を開き、`InlineEditRow.openInitialAccount` は `initialField` が借方科目・貸方科目のときだけ対応欄に渡す。
- 一括変更は日付・摘要のみ（日付は当期の範囲内か確認）。一括削除は確認 Dialog を表示。いずれも `journal_entries` を `.in('id', ids)` で更新・削除する（1文で完結するため RPC にしていない）。
- 動作確認済み（2026-11-01）: 一括変更2件→UPDATE ログ2件、一括削除2件→DELETE ログ2件。一括変更のエラーは `translateSupabaseError` で変換する（会計期間外は DB の Trigger `trg_journal_entries_check_period` も拒否する）。
- `JournalListHandle.clearSelection` は廃止。新規・編集・複製を開くときは `selectedIds` のみ解除する（「選択→編集」の強調行 `selectedEntryId` は解除されない点が以前と異なる）。

### 仕訳一覧の並び順とF5（第8弾）

- 新規仕訳は検索条件に関係なく入力順に末尾へ追加する。`lastPageRequest` を `JournalList` に渡し、entries反映後のeffectで最後の窓へ移す。入力フォームのフォーカスには触れない。
- インライン編集後の再取得は `keepCurrentOrder` で内容だけ更新し、日付を変更しても位置を保つ。検索条件から外れた仕訳は除き、他の画面で増えた仕訳は末尾へ追加する。F5・検索・ブラウザ再読み込みは日付順へ戻す。画面と仕訳日記帳PDFは `date → reference_number（NULLは最後）→ created_at → id` の昇順で取得する。同じ日付では伝票番号を優先し、同番号・ともにNULLの場合だけ作成日時・IDで固定する。手入力のNULL伝票番号同士は作成日時順だが、CSV等で作成日時が同じ場合の厳密な入力順は保証しない。
- 取得は `lib/journal-fetch.ts` の `readJournalEntries`（結果または失敗）とpageの反映関数に分離する。明細検索のエラーも失敗とし、失敗時は一覧・順序・表示位置を維持する。通し番号 `latestFetchSeq` で最後に開始した取得だけを反映する。
- 保存経路は変更せず、pageの `pendingIdsRef` で保存中の仮UUIDを明示的に管理する。`commitEntry` は仮IDの位置で正式IDへ差し替え、先に取得された同じ正式IDは除く。ロールバック時は仮IDを除く。
- `committedAtRef` に保存完了時の取得番号を記録し、`getFetchKeepIds` で保存中の仮IDと取得開始後に保存完了した正式IDを保持する。検索条件外でもその取得では残すが、完了後に開始した次の取得からは検索条件に従う。取得に正式IDが含まれれば重複追加しない。取得が保存完了通知より先に届くと仮IDと正式IDが一時的に並ぶことはあるが、commit後の重複は残さない。DBに入力順の属性は作らない。
- F5はページを再読み込みせず、実行時の検索条件・会計期間・科目マスタを使って再取得する。F5だけcapture段階で既定動作を先に抑止する（子のIME処理が伝播を止めても有効）。インライン編集中・複合仕訳フォーム表示中・取得中・リピート・IME変換中は並べ直さない。Ctrl+F5・Shift+F5を含む修飾キー付きF5はブラウザに任せる。取得失敗時は一覧・順序・表示位置・フォーカスを維持し、toast.errorで通知する。
- F5の結果反映直前に、編集中・フォーム表示中・未処理のフォーカス要求があれば結果を破棄する。反映可能な場合だけ `captureViewport()` で先頭index・窓内表示行・列を記録するので、取得中のセル移動も尊重する。結果と復元要求は同じstateに保持し、entries反映後のeffectで窓を戻し、次のeffectで同じ表示行・列へフォーカスする。`pickFocusRow` は継続行なら最も近い1行目（同距離は前）、件数減少時は最後の仕訳を選ぶ。選択状態もその仕訳に合わせる。入力フォームのフォーカスと入力内容には触れない。通常の矢印・Tabは従来どおり仕訳ID基準。新規追加の最終ページ要求とF5復元要求は別に扱う。
- 伝票番号は第14弾（2026-11-11）から会計期ごとに自動採番する（上記「伝票番号の自動採番」）。入力フォームは番号を送らず、保存後に DB が確定した番号が一覧へ出る。番号のない既存の仕訳は `-` のまま。列が整数になったため、DB昇順は数値順（`1 → 2 → 10`）になり、第8弾時点の文字列順の問題（`1 → 10 → 2`）は解消した。第8弾の時点では自動採番せず、NULL を保存していた。
- ショートカット一覧（第8弾追加）: **F5**＝最新条件で日付順に並べ直し、画面上のセル位置を保持。既存のCtrl+Shift+E／L／R／S、Ctrl+↑／↓、一覧セルの矢印・Tabの仕様は上記のまま。
- コミット1は `npm test` 641件成功・`npm run build` 成功。コミット2は668件成功・ビルド成功。第8弾は利用者の実機確認済み（問題なし）。自動テストの範囲・実機確認手順・範囲外の問題は [ui-entry-order-verification.md](./handover/ui-entry-order-verification.md) を参照。

### IMEの影響を受けない入力（第4弾）

- コミット1：`lib/ime-free-input.ts` の純粋関数でreadonly欄のキーを判定する。`applyImeFreeDateKey` は半角数字・1つの区切り・Backspace・Deleteを扱い、追加は5文字まで。`applyImeFreeQueryKey` は空白を除く印字可能ASCII・検索中のBackspaceを扱い、閉じた欄・閲覧モードでは最初の文字で検索語を置き換える。Ctrl／Alt／Meta付きとIME中（`isComposing` / `keyCode === 229`）は処理しない。Tab／Enter／矢印などは呼び出し側へ残す。
- 第4弾の入力は物理キーボードが前提。日付・科目の `imeFree` 欄とインライン金額欄のreadonly入力では貼り付け（Ctrl+V）・カーソル位置への挿入（全選択時の置き換えを除き末尾追加）・日本語名／かなでの科目検索・スマートフォンのソフトウェアキーボード入力ができない。モバイル対応は対象外。伝票番号は対象外。
- コミット2：`DateInput.imeFree`（既定false）を追加。指定時は常時readonlyとし、`pendingText.current` を元にキー入力を反映する。`InlineJournalForm`・`InlineEditRow` の日付だけで有効。フォーカス時クリア・初期文字・blur／commitによる確定・statusRefは従来どおり。`JournalForm` と期間未取得時のネイティブ日付欄は変更しない。Backspaceは末尾1文字、Deleteは入力途中の文字列を全部消す。
- コミット2の確認：`npm test` は555件成功、`npm run build` は成功。ブラウザを使わない一時的なハンドラー検証で、再レンダー前の連続キー入力→commit、初期文字の保持、statusRef、Backspace／Delete、不正日付の拒否（commitRefあり）、Tab／Enter／↑の非消費、imeFree未指定相当の編集可能状態とonChangeを確認。
- 範囲外の既存仕様：`commitRef` を使わない入力フォームの日付は `0230` などの実在しない日付を欄では拒否せず、保存時にRPCで拒否する。インライン編集では `commit()` の厳密な日付判定で拒否する。この差は今回変更しない。
- コミット2の実機確認：その後の利用者報告で、Windows／Chrome 156・日本語入力ONで日付→科目→金額→税区分→摘要まで移動し、摘要が日本語入力になることを確認済み。上段数字とテンキーの個別比較・一覧セルからの文字入力開始は、この報告では未確認。
- コミット3：`AccountCombobox.imeFree`（既定false）を追加。指定時はreadonlyとし、純粋関数の結果をquery・open・browsing・強調位置（先頭）へ反映する。`replaceOnType` によるselectは行わない。`InlineJournalForm` の借貸親科目・補助・2行目以降の科目、`InlineEditRow` の親科目・補助で有効。初期検索文字・閲覧モードと、候補確定時のTab／EnterのpreventDefault／stopPropagationは維持し、次の移動・保存は次の打鍵に分ける。検索ロジック・別名データは変更しない。`JournalLineRow`（複合仕訳・テンプレート）・検索フォームには指定せず、日本語検索を維持する。
- コミット3の確認：`npm test` は555件成功、`npm run build` は成功。ブラウザを使わない一時的なハンドラー検証で、readonly指定、コード／ローマ字別名での絞り込み、追記／Backspace、候補確定時のTab／EnterのpreventDefault／stopPropagationと次の打鍵の伝播、↓／Alt+↓の閲覧モード、初期検索文字／openOnMount、IME判定、imeFree未指定相当の日本語検索とreplaceOnTypeを確認。実際のDOMフォーカス・ブラウザIME・DB保存の検証ではない。
- 第4弾の利用者実機確認：Windows／Chrome 156・日本語入力ONで、日付→科目→金額→税区分→摘要まで進むと摘要が日本語入力になり、保存後の2周目・インライン編集でも同じ。借方2行目の金額を通っても維持されることを確認済み。こちらでの再検証はしていない。摘要／補足のEnterの区別は、第10弾の修正と実機確認で解消（次項）。Edge・Google日本語入力での同等動作は未確認。
- 第10弾で修正済み：`InlineJournalForm.handleDescriptionKeyDown` の摘要・補足のEnter／Escapeを、ともに `isImeInput`（`isComposing || keyCode === 229`）へ統一した。変換確定Enterで保存せず、変換中Escapeでフォームをクリアしないための判定。変更後のアプリ上のEnter／Escapeは、Windows／Chrome・日本語入力ONで実機確認済み（利用者報告・2026-11-07）：摘要・補足とも、変換を確定するEnterでは保存されず、確定後のEnterで保存される／変換中のEscapeは変換の取り消しだけでフォームは消えない／変換中でないEscapeは従来どおりフォームをクリアする。Edge・Google日本語入力での確認は未実施。readonly金額欄のEscape判定は変更していない。
- コミット4の背景（2026-11-07・利用者の実機記録。こちらでは再検証していない）：Windows／Chrome 156／日本語入力ON（あ）で、Tab移動後の普通のinputへの最初のキーを確認した。

| Tabで進む順序 | 日本語入力ONの維持（利用者報告） |
|---|---|
| readonly → 普通のinput | 維持される |
| readonly → ボタン → 普通のinput | 維持される |
| readonly → type="number" → 普通のinput | 維持されず、英字になる |

- コミット4：`applyImeFreeAmountKey(text, event, replaceAll)` を追加。半角数字の末尾追加／全選択時の置き換え、`/`・`.` による000追加、Backspace・Deleteを処理し、整数13桁・既存の小数2桁までに制限する。空欄・全選択時の000追加と桁数超過は文字列を変えずキーを消費する。小数点の新規入力機能は追加しない（`.` は000追加）。IME中・Ctrl／Alt／Meta付きは処理しない。
- 金額欄は `InlineJournalForm` の4か所（借貸先頭行・2行目以降）と `InlineEditRow` の2か所だけをreadonlyの `type="text"` へ変更し、keydownでstateを更新する。値のある欄はフォーカス時にselectし、最初に処理したキーの後とblurで全選択扱いを解除する。一覧の数字から開始した編集だけは初回フォーカスでselectせず初期文字へ追記する。先頭行のEscapeによるクリア・↑移動・保存時の検証は維持する。`JournalLineRow`（複合仕訳フォーム・テンプレート）の金額は `type="number"` のまま。税区分・摘要・補足・伝票番号は変更しない。
- コミット4の確認：金額キーのテスト62件を追加し、`npm test` は617件成功、`npm run build` は成功。ブラウザを使わない一時的なハンドラー検証で、6か所のreadonly指定・全選択／置き換え／blur・借貸の初期文字追記・000の単回追加・削除・Tab／Enterの非消費・先頭行の↑移動とEscape・モック保存へ渡る金額・借貸不一致とゼロの拒否を確認した。DB・ブラウザIME・実際のDOMフォーカスは検証していない。
- コミット4の利用者実機確認済み（Windows／Chrome 156・日本語入力ON）：日付→科目→金額→税区分→摘要で日本語入力が保たれる。保存後の2周目・インライン編集・借方2行目の金額を通った場合も同じ。金額欄へTabで入ると全選択され、`/`で`000`が入る。クリック時の全選択・上段数字とテンキーの個別比較は、この報告では未確認。
- コミット1の確認：純粋関数のテスト86件を追加。`npm test` は555件成功、`npm run build` は成功。その後のWindows／Chrome 156・日本語入力ONでの実機確認結果は上記の利用者報告を参照。

### 仕訳入力の導線整理（第12弾）

- 「＋ 新規入力」ボタンと一覧の「編集」ボタンを削除。日常の入力は一番下の `InlineJournalForm` と `InlineEditRow` が中心。`JournalForm` は複合仕訳の編集（Enter・F2・ダブルクリック・文字入力）と複製だけに使う。新規モードの見出し・ボタン・保存処理はコードに残っているが、画面からは入れない。複製ボタン・補足の開閉・既存のショートカットは残す。
- **意図して廃止した操作**：単純仕訳を複合仕訳に直接変える操作。`InlineEditRow` に行の追加がないため。代わりに「複製 → 入力フォームで借方＋／貸方＋ → 保存 → 元の仕訳を削除」を使う。将来は直接変えられるようにする予定。
- 単純仕訳（借方1行・貸方1行）の複製は、一番下の入力フォームに元の仕訳の日付・科目・金額・税区分・摘要・補足を入れる。補助科目は親科目と補助科目に分け、明細の元の順序によらず借方→貸方で入れる。伝票番号は入れず、保存時に自動採番される（第14弾から。それまではNULL）。入力途中の内容は確認せず上書きし、フォーカスは日付欄へ移す。`DateInput` は再マウントせず、focusで入力途中の文字とエラーをクリアする。空入力でTabを押すと複製元の日付を維持する。
- 科目マスタにない科目は、科目・補助科目とも空にする。補助科目が存在してもその親科目がマスタにない場合も同じ。他の科目へ置き換えず、未選択のまま保存すると既存の必須チェックで止まる。税区分・補足のnullは空文字、金額は小数も文字列として保持する。
- `lib/journal-duplicate.ts` はSupabase・Reactに依存しない純関数と型を持つ。`isSimpleEntry` を一覧から移し、`InlineLine` を入力フォームから移した。`entryToInlineDraft` は複合仕訳を渡すと `単純仕訳以外はインライン入力に複製できません` の例外にする。変換は親の `handleDuplicate` のイベント処理内で行い、失敗時は `toast.error` だけでフォーム状態を変えない（effect内の例外で画面を落とさないため）。
- 親が `duplicateRequest: { seq, draft }` を発行し、子が反映して `onDuplicateApplied(seq)` を呼び、親は現在のseqと一致したときだけ要求を消す。seqはrefで毎回増やし、子もrefで同一マウント中の同じseqの二重反映を防ぐ。`showForm` 中は入力フォームがアンマウントされるため、親が要求を消して再マウント時の再反映を防ぐ。複合編集・複合複製を開くときも未処理の要求を破棄する。単純複製は開いている `JournalForm` を確認せず閉じる。
- 複製反映のeffectは、既定の日付を入れるeffectより後に宣言する。マウント時に両方が動いても複製元の日付を今日の日付で上書きさせないため。金額のスナップショット・全選択扱いのref、行追加後のフォーカス要求、フォームエラーをリセットしてからdraftを反映し、日付欄へのfocus後に親へ消費を通知する。
- 複合仕訳の複製も元の仕訳の日付を使い、伝票番号は空にする（保存時に新しい番号が自動採番される）。`onNewAdd` で楽観的に一覧へ追加した直後に `onDuplicateSubmitted` で `JournalForm` を閉じる。複製時はフォームの初期化・日付欄へのフォーカスを行わない。保存用の値はローカル変数に確保し、閉じた後もDB保存→成功時の `onNewCommit`／失敗時の `onNewRollback`・`toast.error` を続ける。保存完了後に新規モードへ切り替わる不具合と、完了までの再入力が消える問題を解消する。編集と、画面から入れない新規モードの処理は維持する。
- 自動コピーとの関係：複製で両方の金額が入った状態から片方を変えると、第9弾の条件どおり反対側も連動する。借方＋／貸方＋で複合仕訳にした場合など、自動コピーの条件を外れると連動しない。`lib/amount-sync.ts` は変更していない。
- テンプレートの画面部品4ファイルを削除。DBの `journal_templates`／`journal_template_lines` と `lib/journal-templates.ts` は既存データとともに残し、作り直しに備える。DB・SQL・RPC・`lib/journal-save.ts`・CIは変更しておらず、SQLは実行していない。
- **自動検証（2026-11-08実測）**：純関数テスト14件を追加し、`npm test` は771件／21ファイルすべて成功（従来757件／20ファイル）。`npm run typecheck` はエラー0件、`npm run build` 成功。buildで変わった `next-env.d.ts` だけを `git restore next-env.d.ts` で戻した。削除対象の識別子は `CLAUDE.md` 以外のコードに残っていない（過去の引継ぎ資料・`.claudeignore` の記録は維持）。着手前の指定内容と実装に相違なし。
- lintは作業前・作業後とも全体28エラー・12警告。新しいlint抑止は追加していない。ファイル別の実測は下表（エラー／警告）。`CLAUDE.md` はlint対象外。

| ファイル | 作業前 | 作業後 |
|---|---:|---:|
| `app/journals/page.tsx` | 5／1 | 5／1 |
| `app/settings/page.tsx` | 0／0 | 0／0 |
| `components/journals/JournalList.tsx` | 0／2 | 0／2 |
| `components/journals/JournalForm.tsx` | 1／2 | 1／2 |
| `components/journals/InlineJournalForm.tsx` | 12／5 | 12／5 |
| `TemplateSelector.tsx`・`TemplateManager.tsx`・`TemplateEditModal.tsx`・`TemplateFormFields.tsx`（各ファイル） | 0／0 | 削除 |
| `lib/journal-duplicate.ts`・`__tests__/journal-duplicate.test.ts`（各ファイル） | 未作成 | 0／0 |

- **実機確認済み（利用者・Windows／Chrome・日本語入力ON・2026-11-08・12項目すべて問題なし）**。利用者の報告に基づき、次の内容を確認済み。
  - 「＋ 新規入力」ボタン・一覧の「編集」ボタン・設定画面のテンプレート欄が削除されている。
  - 単純仕訳の複製：内容（日付・科目・補助科目・金額・税区分・摘要・補足）が入力フォームに入り、日付欄にフォーカスがある。日付欄を何も打たずにTabすると元の日付が残り、別の日付を打つと変わる。借方の金額を変えると貸方も連動して保存できる（自動コピー）。入力途中の内容は上書きされ、続けて別の仕訳を複製すると置き換わり、日付欄の途中入力が次の複製で残らない。
  - **複製要求の消費**：単純仕訳を複製 → 複合仕訳を開いてキャンセル → 複製の内容が入力フォームに入り直さない。
  - 複合フォームを開いたまま単純仕訳を複製すると、フォームが閉じ、日付は元の仕訳の日付のまま。
  - 複合仕訳の複製：日付が元の仕訳の日付になり、保存後に一覧へ戻り、新規モードに切り替わらない。
  - 既存の複合仕訳の編集（Enter・F2・ダブルクリック）と、単純仕訳のインライン編集は、従来どおり動く。
  - 自動テストの範囲は `lib/journal-duplicate.ts` の純関数の14件。複製要求の消費・effect の順序・フォーカスには自動テストがなく、上記の実機確認で確かめた。
  - Edge・Google日本語入力での動作、保存失敗時の複合仕訳の複製（フォームが閉じた後のtoastによる通知）は未確認。

### 借方・貸方金額の自動コピー（第9弾）

- 単純仕訳で片方の金額を入れたあと、反対側を手で入れ直す手間を減らす入力補助。貸借一致の強制補正ではなく、不一致の仕訳を保存時に無条件で帳尻合わせしない。DB・RPC・`enforce_journal_balance`・`lib/journal-save.ts` は変更していない。
- 金額欄からフォーカスが抜けるときやTab／Enter／クリックで保存するときに1回だけコピーし、キー入力ごとの追従はしない。借方→貸方・貸方→借方で同じルールを使う。
- コピー条件はすべて満たす必要がある：借方1行・貸方1行、自分側の新しい値が有効な正の金額、反対側が空または編集前の自分側と同額。反対側がユーザーの意図で別金額、複合仕訳（明細が2行以外）、自分側が空・0・不正値ならコピーせず、反対側も消さない。
- 判定はSupabaseに依存しない純関数 `syncAmounts(lines, snapshot)`（`lib/amount-sync.ts`）。`lib/journal-save.ts` と同じ形式の `AMOUNT_PATTERN` で検証し、最小単位（銭）の `BigInt` で比較する。`10000`・`10000.00`・`010000`、`05` と `5` はそれぞれ同額扱いで、`05` の保存値は5になる。
- 金額欄のfocus時に値をrefのスナップショット（`{ side, value }`）へ保持し、blur・保存完了・行の追加／削除・クリア・Escapeで破棄する。`InlineEditRow` の `initialInput`（一覧の金額セルへの直接入力）では、focus時点で1文字目が入力済みなので、初回focusだけ元の仕訳金額を基準にする。
- 保存前はReactのstate更新を待たず、同期後のローカル変数を入力チェック・借貸一致・楽観更新・RPC送信に使う。新規は `handleSubmit` の先頭、編集は `triggerSave` の先頭と `handleBlur` で同期する。編集のTab／Enter保存はblurを起こさないため、保存経路でも同期する。
- 新規の `handleAmountKeyDown` はIME変換中を除くEnterで `handleSubmit` を呼ぶ。Ctrl+Shift+Sは `app/journals/page.tsx` から呼ぶ既存経路を使う。
- 編集の `validate()` は同期後の金額を受け取り、金額の空→不正→不一致の順に判定する。空は「借方金額を入力してください。」「貸方金額を入力してください。」、不正は「借方金額は小数第2位までの正の数で入力してください。」「貸方金額は小数第2位までの正の数で入力してください。」、不一致は「借方金額と貸方金額が一致していません。」。
- 対象は `InlineJournalForm.tsx`（インライン新規入力・第12弾から単純仕訳の複製も含む）・`InlineEditRow.tsx`（インライン編集）。別画面の `JournalForm.tsx` は画面からは複合仕訳の編集・複製だけに使い、自動コピーの条件（借方1行・貸方1行の2行）に当てはまらないため対象外。金額欄は `JournalLineRow.tsx` の `type="number"` のまま。
- `__tests__/amount-sync.test.ts` に純関数テスト87件。Reactのイベント順序（blurと保存の連続、`initialInput`）の自動テストはない。コミットは `1070aea`（自動コピー・Enter保存・保存前の同期）、`832341f`（編集行の空金額エラー文言を元に戻す）。
- 利用者の実機確認（Windows／Chrome 156・日本語入力ON）：新規の借方→Tabで貸方にコピー、貸方変更で借方も連動、不一致なら上書きしない、`借方+`で複合にするとコピーしない、空にしても反対側は消えない、金額欄からEnter保存・Ctrl+Shift+S保存を確認済み（問題なし）。既存仕訳の借方変更→欄外クリック保存、一覧の金額セルへの直接入力による編集開始・保存、借方変更→Tab／Enter保存、空・0のエラー文言も確認済み（問題なし）。
- 第10弾の実機確認（2026-11-07・Windows／Chrome・日本語入力ON）で、「借方10000・貸方が空でTab→自動コピー→保存」はエラーなく保存でき、摘要・補足の変換確定Enter（アプリ上）も問題なし。CI（`test`）は緑（利用者の報告）。未確認：Edge・Google日本語入力。自動テスト成功は実機確認を意味しない。

### 仕訳日記帳の出力

- 正式な出力経路は `/api/pdf/journal` の PDF。表題・期名（共通 `PDFHeader`）・検索条件・列見出しを1つの `fixed` ブロックとして全ページに繰り返す。固定幅の6列は縮小せず、科目・摘要の左余白で金額との間隔を確保する。行が改ページで分割されると空になった日付・伝票No列が次ページで落ちて科目が左にずれるため、表示行の `wrap={false}` で行をまとめて送る（架空データ100表示行のPDFで再現を確認）。共通ヘッダーや他帳票のPDFは変更しない。
- PDF の税区分は `getAllTaxCodes()` で取得し、`lib/reports/journal.ts` の純粋関数 `resolveTaxCodeLabel` で `short_name ?? name ?? ID` に解決する（null は null）。マスタ取得の失敗は例外にし、未登録 ID の表示と区別する。`getJournalReport` の呼び出し元は仕訳日記帳PDFのAPIのみ。
- 既知の制限: ブラウザ印刷（「印刷」ボタン）は表示中の窓だけが対象（通常12表示行以内、13行以上の複合仕訳は全行）。全件を出力するときは PDF を使う。
- 第10弾で修正済み: `lib/reports/journal.ts` の `linesQuery`（金額・科目による絞り込み）は `error` を確認し、失敗時はそのmessageで例外にする。既存のAPIが500を返し、`PDFButton` が「PDF生成に失敗しました」をalertで表示する。明細取得失敗のrejectと、正常時の `in('id', …)` による絞り込み・該当行の出力をテスト2件で確認した。APIとボタンは変更していない。
- 範囲外の既存の制限（未修正）: 金額の下限・上限は検索に適用するが、PDFの検索条件欄には表示しない（レポートの `filters` に金額条件がない）。
- 検証（2026-11-04）: 架空データ100表示行（空の伝票No・複合仕訳の継続行・長い科目名と摘要・未登録税区分IDを含む）で9ページを生成し、全ページを画像と座標で確認。見出しの繰り返し・全列の位置・金額と次列の6ptの余白・文字の保持・本文とフッターの非重複を確認済み。利用者の実データや画面操作・ブラウザ印刷は未確認。

## エラーハンドリング基盤（実装済み）

- `lib/errors.ts`（`AppError` / `AccountingError` / `ValidationError` / `NotFoundError` / `ConflictError` / `DatabaseError`・`ERROR_CODES`）、`lib/supabase-error-handler.ts`（`translateSupabaseError` / `wrapSupabase`）、`lib/toast.tsx`（`useToast()` が `{ info, success, error }` を返す）。
- 通知ルール: フィールド単位 → フィールド下に赤字 / フォーム全体 → フォーム上部の赤背景 / ページ全体 → `toast.error` / 成功 → `toast.success`。
- 保護機能: 期首残高仕訳の編集・削除禁止、削除確認 Dialog、二重送信防止（`isSubmitting` 等）、孤立科目の表示（`（削除済み科目）`）。

## CSVインポート（実装済み）

- 形式: 独自形式（10列）/ 弥生形式（実サンプルは25列・識別フラグ `2000`・`2111` の単一仕訳のみ取り込み、複合仕訳（2110・2100・2101）と未知フラグは警告してスキップ。和暦・Shift-JIS・見出し行なしの実ファイルに対応。下記「解決済み」「要改善」参照）。
- 流れ: アップロード → パース・科目名/補助/税区分を ID へ変換 → エラーなら一覧表示（staging 未登録・「置換ルールを登録」で `mapping_rules` に追加）→ `import_staging` → `StagingTable` で確認・修正 → 本登録。
- **本登録は `import_staging_entries` RPC で全件を1トランザクションに登録する**（2026-11-01〜）。1件でも失敗すれば全件取り消し、エラーは「n行目（摘要）: …」。画面は `registerReason` に理由を表示し、失敗後は staging を読み直す。
- 既知の制約: パーサーで整数円以外を弾く（CSV 限定の仕様。仕訳日記帳の手入力は `lib/journal-save.ts` で小数第2位まで許可し、DB 全体の制約ではない）。`import_staging.raw_*_amount` の `numeric(15,2)` による丸めは CSV 経由では起きなくなるが、CSV を経由しない直接書き込みでは残る。補助科目（`debit_sub_account_id` / `credit_sub_account_id`）は本登録で未対応。
- 実装: `lib/csv-amount.ts`（共通金額パーサー）/ `lib/csv-import.ts` / `lib/csv-import-yayoi.ts` / `lib/yayoi-tax.ts`（弥生の税区分変換）/ `components/csv-import/*` / `app/csv-import/page.tsx`。
- **テスト**: パーサーのテストは `__tests__/csv-import*.test.ts`。Supabase は `__tests__/helpers/fake-supabase.ts`（架空の科目・税区分。各テスト前に `resetFakeDb()`）で差し替える。`[現行挙動・要改善]` と付いたテストは「今の動作の記録」であり、正しい業務仕様の保証ではない。修正したら期待値を正しい動作に書き換えること。
- **解決済み（2026-11-02）弥生形式の実ファイル対応**（実サンプル: Shift-JIS・見出し行なし・25列・和暦 `R.08/04/01`）:
  - 和暦: `normalizeDate` が `M/T/S/H/R.YY/MM/DD` を西暦に変換する（独自形式にも効く。元号の境界・暦としての存在は検証しない）。
  - 先頭行: 弥生形式は見出し行を捨てない。先頭行の識別フラグが4桁の数字でなければ見出し行付きとみなし、エラーにする（`lib/csv-upload.ts` の `prepareCsvRows`）。独自形式は従来どおり先頭行を捨てる。弥生パーサーの行番号は先頭のデータ行が1行目（`parseYayoiCsvFile(data, firstRowNumber = 1)`）。
  - 文字コード: ファイルをバイト列で読み、UTF-8 として厳密に読めなければ Shift-JIS で読み直す（`decodeCsvText`。両形式に適用）。
  - **実機確認済み（2026-11-02・利用者報告）**: 実サンプルを画面から取り込めた。コミット `9812636`、CI（`test`）も成功。取込件数（9件）・複合仕訳の警告（2件）も期待どおり。置換ルールボタンの列名不一致は 2026-11-02 夜に解消済み（下記）。
- **解決済み（2026-11-02 夜）弥生形式の識別フラグ・税区分・置換ルールボタン**（実サンプル2本＝標準・簡易課税で確認。実機確認済み・`npm test` 247件・`npm run build` 成功）:
  - 識別フラグ: `2000`（伝票以外の仕訳）と `2111`（1行の伝票データ）を同じ列構成で取り込む（`SINGLE_FLAGS`。弥生公式サポートの記載＋実サンプルで列位置が同じことを確認）。複合仕訳以外の未知フラグ（空欄・見出し文字列を含む）は「未対応の識別フラグのためスキップしました」の警告を行番号つきで出す。制御行と仕訳行を区別する設計は未実施（既知以外はすべて警告）。
  - 置換ルールボタン: `MAPPABLE_COLUMNS` に「借方勘定科目」「貸方勘定科目」を追加。値が空のエラー（「科目が空です」）ではボタンを出さない（独自形式にも効く）。
  - 税区分の変換（`lib/yayoi-tax.ts`）: 弥生の表記（例 `課対仕入込10%適格`・`課税売上込五10%`・`課税売上込一軽減8%`）を「区分・内/込/外/別・事業区分（一〜六）・税率」に分解して `tax_codes.id` に対応づける。旧マップ（`課税仕入` など）の表記も同じ区分に変換する。末尾の「適格」は無視する。
    - 簡易課税の売上は事業区分を読み取り `SIMPLE_S{1-6}_{10|8K}`、区分のない表記は `SIMPLE_SALES_*`、返還は区分別のコードが無いため `SIMPLE_SALES_RETURN_*`。簡易課税の仕入（非課税対応・共通対応を含む）は `tax_codes` に区分が無いため、警告なしで税区分を空にする（旧実装は本則の `PROP_PURCHASE_10` に変換していた）。
    - 非課税対応・共通対応の仕入は個別対応方式のみ。それ以外の事業者タイプでは対応する区分が無い。
    - **対応づけられない税区分は「対象外」（`OUT_OF_SCOPE`）で取り込み、警告（warnings と `parse_warnings`）を残す**。対象: 未知の表記、`tax_codes` に無い税率・区分（5%・非軽減8%・貸倒・回収・輸入・有価証券譲渡・不明など）、事業者タイプに対応する区分が無い場合（免税事業者の課税区分など）。事業者タイプの初期値は `EXEMPT` のため、設定を変えていないと課税区分の行がすべて「対象外」＋警告になる。
    - 外税・別記（`外`・`別`）は対応する区分で登録し、警告を出す。消費税集計表（`getTaxSummaryReport`）は金額を税区分ごとに合計するだけで、税込・税抜の区別を持たない。
- **要改善（2026-11-02 時点・未修正。優先順）**
  1. **外税・別記の金額の扱い**: 現在は警告のみ。集計が税込前提かどうかの仕様を決めてから、変換か取込拒否かを選ぶ。
  2. **「適格」以外の接尾辞**（経過措置の控除割合など）は一覧に無く、対応づけられず「対象外」＋警告になる。実ファイルが出てきたら対応する。
  3. 日付は形式しか検証しない（`2026/2/30`・和暦の元号境界も通り、本登録の RPC が `INVALID_DATE` で拒否する）。
  4. 複合仕訳（2110・2100・2101）は取り込まず、警告でスキップする（実サンプルにも含まれる）。
  5. 軽微: `lookupSubAccount` は補助科目のエイリアスを見ない（`lookupAccount` は見る）。摘要の空白の正規化が独自形式のみ（弥生は `trim` のみ）。
  6. 警告が行ごとに出るため、「対象外」への置き換えが多いファイルでは警告が長くなる。件数でまとめる表示は未実装。

---

## 次にやること

<details>
<summary>ステップ1b（A〜D完了）</summary>

会社別取得・作成・切替・アーカイブ、書込先照合、科目マスタ、共通集計修正、個人PL/BS・PDFを実装済み。各コミット・検証結果は冒頭、詳細は `handover/step1b-*-report.md`。A〜Dの実機確認は利用者が完了済み。

</details>

### ステップ2・未決事項の整理

- ステップ2: 期首残高・繰越（A案＋任意期の手動期首残高）は 2026-11-14 に実装・本番DB適用・`main` マージ済み（「ステップ2: 期首残高・繰越」節）。ステップ3（年度の確定・ロック）はDB本番適用・アプリ実装済み（86dfd08）。2026-11-15に利用者がWindows／Chrome・日本語入力ON・テスト用会社で7項目を実機確認済み。次は同節の未確認項目の確認。
- 未決1-5（会社切替の位置・保持）、1-6（法人成りを別会社として扱うか）、1-8（個人PL/BSの表示）を残す。1-5/1-8に対応する実装は1bで追加済みだが、Project側の決定記録との最終整理は未確認。
- 旧SQLテスト4本の会社別準備・現行RPCへの追随は完了（2026-11-13・ローカルPG17.12）。A88/B18/補足20/伝票番号45、1aの135、アーカイブ7項目がすべて通過。更新版の本番SQL Editorでの実行は未実施。詳細は `handover/step1b-sqltests-report.md`。

### 土台（機能追加より先）
- 完了（2026-11-01）: 訂正履歴のノイズ除去、一括編集・一括削除の動作確認、TRUNCATE 等の権限剥奪、**保存処理の原子化（Migration A + アプリ切替）と借貸一致の DB 側保証（Migration B）**、CSV の小数第3位以下を含む整数円以外をパーサーで弾く対応（保存まわりの残課題①）。
1. **残課題（保存まわり）**: ② 期首残高仕訳の作成経路の確認（本番 0 件）③ `journal_lines (entry_id, line_number)` の UNIQUE ④ `insert_journal_lines` / `validate_journal_lines` を非公開スキーマへ ⑤ MAINTAIN 権限・`rls_auto_enable` の EXECUTE 整理 ⑥ 伝票番号の同時実行テスト T1〜T5 の本番実施（未実施。手順は `20261110170000_auto_reference_number_apply.md`）。
2. **自動テストの拡充**: Vitest 導入済み（計1,153件／41ファイル: 1b-D完了時。会社分離・会社管理・科目マスタ・法人/個人PL/BS・ページ分割・PDF整合/描画も対象。第14弾は852件／24ファイル。757件は第10弾コードコミット後、771件は第12弾。金額 `parseCsvAmount` / `amountToRpcString`、借貸金額の自動コピー（`amount-sync`）、CSV パーサー `lib/csv-import.ts` / `lib/csv-import-yayoi.ts`、弥生の税区分変換 `lib/yayoi-tax.ts`、照合関数、仕訳保存RPC引数、仕訳単位の窓処理、CSVエクスポート、表示設定、仕訳日記帳レポートの税区分表示・マスタ取得失敗・明細検索の失敗と正常時の絞り込み、一覧セルのキー判定・日付入力の確定・入力フォームからの↑移動判定、IME非依存の日付・科目・金額キー入力）。SQL テストは手動実行のみ。次は集計ロジック（`lib/reports/*`）の拡充。CSV の既知課題（下記「CSVインポート」の「要改善」）の修正も、テストの書き換えとセットで進める。
3. **監査ログの完全性**: ログ偽造余地（INSERT 権限）・`changed_by` 固定・`journal_lines` 直接変更が履歴に残らない点。Trigger 関数を SECURITY DEFINER にして INSERT 権限と policy を外す案などを要設計（RPC の SECURITY DEFINER 化・非公開スキーマ化と同時に検討）。
4. 公開・共同利用の前提作業: 認証、policy 再設計、`ledger_view` の `security_invoker`、残りの grant の最小化、バックアップと**復元試験**。
5. 資料の整合: `handover/implementation-details.md` などが現状と合っているか順次確認。

### 機能
- ⑫ 期首残高・繰越: ステップ2で実装済み（自動繰越＋任意期の手動期首残高。「期首残高」画面）。`is_opening_balance` 仕訳の自動生成は行わない（導出で足りるため）。年度ロックはステップ3でDB本番適用・アプリ実装済み。テスト用会社での7項目の実機確認は完了（利用者報告・2026-11-15）。残る実機確認はステップ3節を参照。
- ⑬ 表示設定の反映: 仕訳日記帳の税区分・文字サイズは適用済み。`LedgerTable.tsx` に `showSubAccount` が未適用。CSVインポート確認UI は未確認。
- ⑨ CSVインポートの AI 推論（任意）。方針は Project 資料の D 章（AI は外部・読み取り専用が前提）に従う。

### 改善候補（任意・優先度低）
- 損益計算書・貸借対照表の CSV エクスポート
- 仕訳日記帳の画面分離（`/journals` と `/journals/new`）、期名の和暦・第○期表示、PL/BS の税抜表示切替、複数期間比較、ダッシュボード強化
