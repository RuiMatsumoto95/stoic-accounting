---
status: 現行
verified: 2026-11-24 @ 1e6a903
code: [contexts/CompanyContext.tsx, contexts/FiscalPeriodContext.tsx, lib/journal-save.ts, lib/balance-calculator.ts, lib/opening-balances.ts, lib/csv-import.ts, supabase/schema.sql]
related: [README.md, ../30-features/README.md, ../20-database/tables.md]
---

# 用語集

| 用語 | このプロジェクトでの意味 |
| --- | --- |
| 会社・作業中の会社 | 帳簿を分けるデータの単位。法人と個人事業の両方を「会社」と呼ぶ。作業中の会社の選択は画面が扱う範囲を決める。 [会社スコープ](../10-architecture/company-scope.md) |
| 会計期・当期・前期 | 会計期は会社ごとに設定する開始日から終了日までの期間。当期はその会社で選択中の期。決算書の前期比較では、対象期の開始日より前に終了した同じ会社の期のうち、終了日が最も新しいものを使う。 [設定](../30-features/settings.md)・[貸借対照表](../30-features/balance-sheet.md) |
| 単純仕訳・複合仕訳 | 単純仕訳は借方・貸方が各1明細の仕訳。複合仕訳は片側または両側に複数明細を持つ仕訳。どちらも仕訳の借方合計と貸方合計が一致する。 [仕訳日記帳](../30-features/journals.md) |
| 親科目・補助科目 | 補助科目は親科目に属する内訳。仕訳で補助科目を選ぶと明細には補助科目のIDを保存する。残高試算表などでは親科目にも合算する。 [勘定科目マスタ](../30-features/accounts.md)・[残高試算表](../30-features/trial-balance.md) |
| 期首残高・手動期首残高 | 期の開始時点の残高。通常は過去の仕訳などから導出する。手動設定があると、その期は設定値を使う。 [期首残高](../30-features/opening-balances.md) |
| 繰越先科目 | 期首残高を導出するときに過年度の損益を受ける会社別の科目。個人事業では事業主貸・事業主借の残高の振替にも使う。 [DB関数とRPC](../20-database/functions-rpc.md#期首残高の取得手動設定) |
| 年度の確定・解除 | 会計期の状態を切り替える操作。確定するとその期の仕訳・期首残高などに変更制限がかかり、解除すると変更できる状態に戻る。 [設定](../30-features/settings.md#年度の確定と解除) |
| 中間表・本登録 | CSVで読み込んだ確認中の行は中間表（`import_staging`）に置く。本登録するとDBが検証し、対象期の正式な仕訳を作る。 [CSVインポート](../30-features/csv-import.md) |
| 税区分・事業者タイプ | 税区分は仕訳明細の課税上の分類。設定画面の事業者タイプは会社の課税方式で、仕訳の税区分候補や弥生CSVの変換に使う。 [設定](../30-features/settings.md)・[消費税集計表](../30-features/tax-summary.md) |
| P/L・B/S | 損益計算書と貸借対照表。会社の区分に合わせて法人用・個人用の様式を使う。 [損益計算書](../30-features/income-statement.md)・[貸借対照表](../30-features/balance-sheet.md) |
