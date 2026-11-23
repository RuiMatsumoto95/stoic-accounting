---
status: 現行
verified: 2026-11-24 @ b69542c
code: [app/settings/page.tsx, components/settings/DisplaySettings.tsx, components/settings/CompanySettings.tsx, components/settings/CompanyCreateForm.tsx, components/settings/CompanyArchiveList.tsx, components/settings/FiscalPeriodSettings.tsx, components/settings/FiscalPeriodModal.tsx, components/layout/CompanySwitcher.tsx, contexts/CompanyContext.tsx, contexts/FiscalPeriodContext.tsx, lib/company-dirty.ts, lib/display-settings.ts, lib/tax-codes.ts, lib/period-close-state.ts, lib/fiscal-period-operations.ts, actions/company-actions.ts, actions/fiscal-period-actions.ts]
related: [README.md, journals.md, csv-import.md, opening-balances.md, ../20-database/functions-rpc.md, ../20-database/security-rls.md]
---

# 設定

`/settings` は、作業中の会社の表示設定、事業者タイプ、会社管理、会計期間管理を扱う。

## 表示と事業者タイプ

| 設定 | 保存先と動作 |
| --- | --- |
| 補助科目列と税区分列 | ブラウザーのローカルストレージに保存する。初期値は補助科目列を非表示、税区分列を表示。 |
| 仕訳日記帳の文字サイズ | 標準13pxと大16pxから選ぶ。初期値は標準。ブラウザーのローカルストレージに保存する。 |
| 事業者タイプ | この会社の `companies.tax_method` を更新する。免税、簡易課税、本則課税（個別対応方式）、本則課税（一括比例配分方式）の4択。仕訳入力の税区分候補と弥生CSVの税区分変換に使う。 |

## 会社管理と切り替え

- 会社作成時は会社名、法人・個人の区分、課税方式と最初の会計期を指定する。法人は開始日・終了日を入力し、個人は年を指定すると1月1日〜12月31日になる。DBが会社・初期科目・繰越先・初期の当期をまとめて作成する。画面は作成した会社への切り替えを試みる。
- ヘッダーの「作業中の会社」を切り替えると、会社の選択を保存して仕訳日記帳を読み直す。未保存入力が登録されている場合は破棄を確認する。別タブで会社が変わったことを検出した画面は再読み込みを求める。
- アーカイブすると通常の選択候補から消え、アーカイブ済みの一覧から「戻す」で復帰できる。作業中の会社はアーカイブできない。会社名は引き続き予約され、データやPDFへのアクセス権は変わらない。

## 会計期間の作成と変更

- 一覧の「現在期」で、各画面が使う当期を設定する。
- 「期間を追加」では、既存の期があれば最新の終了日の翌日を開始日にする。終了日から期名を初期入力し、期名は手入力で変更できる。個人の期は同じ年の1月1日〜12月31日が必要。
- 編集時の開始日は固定。次期がある場合は終了日を次期開始日の前日に合わせる。既存仕訳が期間外になる日付変更はDBが拒否する。
- 削除の対象は当期ではない最新の未確定期。仕訳や期首残高の手動設定が残っている期は削除できない。

## 年度の確定と解除

- 一覧では確定済みの期に「確定済み」と表示する。確定は古い期から、解除は新しい期から行う。前後の期の状態で実行できない場合は理由を表示する。
- 「確定」ダイアログはDBで確認したエラーと警告を表示する。エラーがない場合に確定でき、警告だけなら確定できる。確定・解除のメモは任意で、DBの履歴に記録する。
- 確定後は仕訳と期首残高が読み取り専用になり、期の日付変更と削除はDBで拒否される。確定・解除後は一覧と当期の状態を更新する。確定前チェックや変更ガードの詳細は [DB関数とRPC](../20-database/functions-rpc.md#年度確定解除) と [トリガーと制約](../20-database/triggers-constraints.md#年度確定後の書き込み) を参照。
