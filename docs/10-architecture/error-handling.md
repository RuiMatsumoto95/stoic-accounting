---
status: 現行
verified: 2026-11-24 @ cc4d9d2
code: [lib/errors.ts, lib/supabase-error-handler.ts, lib/toast.tsx, app/layout.tsx, lib/company-guard.ts, lib/company-scope.ts, lib/journal-save.ts, lib/reports/scope.ts, actions/company-actions.ts, actions/fiscal-period-actions.ts, app/journals/page.tsx, app/csv-import/page.tsx, components/journals/InlineEditRow.tsx, components/opening-balances/OpeningBalanceEditor.tsx, components/pdf/PDFButton.tsx, app/api/pdf, supabase/schema.sql]
related: [README.md, company-scope.md, pdf.md, ../20-database/functions-rpc.md, ../30-features/journals.md, ../30-features/csv-import.md]
---

# エラー処理

DBが返す業務エラーは、処理によってアプリのエラー型へ変換し、画面やAPIの応答に使う。エラー型とコードは [lib/errors.ts](../../lib/errors.ts) にある。

## エラー型

`AppError` は `code`、`message`、任意の `details`、`httpStatus` を持つ。`isAppError` はアプリのエラー型かを判定する。

| 型 | HTTPステータス | 例 |
| --- | --- | --- |
| `ValidationError` | 400 | 不正な入力、帳票の比較期が別会社 |
| `NotFoundError` | 404 | 存在しない期や、対象期の会社にない帳票の科目 |
| `ConflictError` | 409 | 別タブでの会社切り替えを検出、会社名・科目コードの重複 |
| `AccountingError` | 422 | 借貸不一致、会計期間外、確定済みの期への変更 |
| `DatabaseError` | 500 | 変換規則にないDBエラー |

ここでのステータスはアプリのエラー型が持つ値。ブラウザー内で処理するエラーやServer Actionの戻り値にも同じ型・コードを使う。

## Supabaseからの変換

- `translateSupabaseError` は、SQLSTATE `P0001` の `message` にある業務コードを表引きする。`showDetail` が真の項目では、`details` の説明を表示文に追加する。例えばCSV本登録のエラーには行番号などが入る。
- `23505`・`23514` は伝票番号の一意・範囲制約を判別する。その他の `23505` は会社名または科目コードの重複として扱う。`23503` は制約名から、参照先の期・仕訳・テンプレートの不一致、手動期首残高の有無、使用中の科目などを判別する。
- `42501` は `AppError` の `PERMISSION_DENIED`（403）へ変換する。規則に該当しないDBエラーは `DB_QUERY_FAILED`（500）。
- `wrapSupabase` は応答にエラーがあれば変換して投げる。エラーなしでデータが `null` なら `ACCOUNT_NOT_FOUND` を投げる。期・仕訳の単件取得では `lib/company-scope.ts` が `PGRST116` をそれぞれの未検出エラーへ変換する。

DBの業務コードと制約名の一覧は [DB関数とRPC](../20-database/functions-rpc.md#エラーコード) を参照。

## 呼び出し元での扱い

| 呼び出し元 | エラーと通知の扱い |
| --- | --- |
| 画面 | 入力エラーは欄やフォームに表示する。日記帳の再取得・削除や設定の保存などは `useToast` の `error`／`success` を使う。`ToastProvider` は共通レイアウトにあり、通知を3秒で消す。 |
| 仕訳・CSV | 新規仕訳の保存失敗時は仮の行を除き、インライン編集の失敗時は入力を残す。CSV本登録の失敗は画面に理由を表示し、未処理一覧を再取得する。 |
| Server Actions | 会社・会計期間の対象操作は例外を捕捉し、画面向けの `error` と、判明する場合は `code` を返す。 |
| PDF | ルートで捕捉した検証・データ取得エラーにはJSONの `error` を返す。`reportErrorStatus` は `AppError.httpStatus` を使い、その他は500を返す。ボタンは失敗時に応答のメッセージを読み、読めない場合は既定文言を表示する。 |

一部の画面のデータ取得では `console.error` だけで終了する。画面表示やログ出力の扱いは呼び出し元ごとに決まる。
