---
status: 現行
verified: 2026-11-24 @ 95645b1
code: [app/layout.tsx, app/settings/page.tsx, contexts/CompanyContext.tsx, contexts/FiscalPeriodContext.tsx, components/layout/CompanySwitcher.tsx, actions/company-actions.ts, actions/fiscal-period-actions.ts, lib/company.ts, lib/company-cookie.ts, lib/company-guard.ts, lib/company-dirty.ts, lib/company-server.ts, lib/company-scope.ts, lib/company-operations.ts, lib/fiscal-period.ts, lib/fiscal-period-operations.ts, lib/journal-save.ts, lib/account-master.ts, lib/journal-templates.ts, lib/opening-balances.ts, lib/reports/scope.ts, app/api/pdf, supabase/schema.sql]
related: [README.md, security.md, pdf.md, error-handling.md, ../30-features/settings.md, ../20-database/tables.md]
---

# 会社スコープ

1つのDBに法人・個人の複数会社を保存する。画面で選んだ会社、操作対象の会計期や仕訳の会社、DBの参照先の会社を、それぞれ必要な箇所で照合する。利用者と会社を結び付ける認可は未実装。運用上の前提は [セキュリティの現状](security.md)。

## 作業中の会社と当期

1. `CompanyProvider` が会社一覧を取得し、アーカイブされていない会社から作業中の会社を決める。Cookieに有効な会社があれば使う。有効なCookieがなく候補が1社なら自動選択し、複数なら選択画面、0社なら作成・復帰の画面を表示する。
2. 会社選択のServer Actionは、存在する未アーカイブの会社IDを `sa_company_id` に保存する。Cookieは有効期間365日、`Path=/`、`SameSite=Lax`、`HttpOnly=false`。クライアント側も同じ値を読んで画面の状態を照合する。
3. 手動の会社切り替えでは、登録された未保存入力があれば破棄を確認する。選択に成功したら他タブへ通知し、`/journals` から読み直す。別タブでの変更は `BroadcastChannel`（利用可能な場合）、ブラウザーのフォーカス復帰、表示状態の変化でも照合する。不一致を検出した画面は再読み込みを求める。
4. `FiscalPeriodProvider` は選択した会社の `company_id` と `is_current = true` で当期を取得する。取得できなければ当期は `null`。DBの部分一意インデックスにより当期は会社ごとに最大1件。

## データ取得と書き込み

| 確認箇所 | 照合内容 |
| --- | --- |
| ブラウザーの書き込み | `assertActiveCompany` がタブに登録した会社ID、操作側が期待する会社ID、現在のCookieを照合する。不一致は `STALE_COMPANY`。 |
| Server Actions | 会計期間の作成・編集・削除・当期指定の共通処理は、引数の会社とリクエストのCookieを `assertServerCompany` で照合する。選択中の会社のアーカイブはServer Action側でも拒否する。 |
| 仕訳・CSV・期首残高 | 書き込む会社を引数に固定する。仕訳新規・CSV本登録は対象期、仕訳編集は対象仕訳の所属会社をRPCの前に照合する。期首残高の保存・解除も対象期の会社を照合する。照合先が異なる場合は `COMPANY_MISMATCH`。 |
| DBの参照整合性 | 仕訳と期、明細と仕訳・科目などを `(参照先ID, company_id)` の複合外部キーで照合する。対象表には所属会社の変更を拒否するトリガーもある。 |

照合済みの通信は、その後に別タブで会社が切り替わっても実行され得る。科目と別名の保存は複数リクエストを使い、別名を書き込む前にも会社を照合する。テンプレートのヘッダーと明細も複数リクエストで、開始時の会社を使い続ける。途中で失敗すると一部だけが保存される場合がある。

## 帳票の所属会社

帳票は `getCompanyIdByPeriod` で対象期の所属会社を求める。比較期は同じ会社に限定し、指定科目の所属も対象期の会社と照合する。PDFに出す期名は期のDB行から読み、損益計算書・貸借対照表の法人／個人の様式は対象期の会社の `kind` で決める。

会社のアーカイブは通常の選択候補から除く操作。既存の期や仕訳を保持し、帳票のための対象期の照会ではアーカイブ状態によるフィルターを適用しない。
