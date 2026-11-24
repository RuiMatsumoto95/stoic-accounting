# 変更履歴

## 0.1.0（初回公開準備中）

### 記帳と帳票

- 仕訳日記帳で、単純・複合仕訳の入力・訂正・複製、検索、一括変更・削除に対応。日本語入力を有効にしたまま日付・科目・金額をキー操作で入力できる。 [仕訳日記帳](docs/30-features/journals.md)
- 総勘定元帳、補助元帳、残高試算表、補助残高一覧、消費税集計表を追加。法人・個人向けの損益計算書と貸借対照表には前期比較があり、帳票は印刷・PDF出力に対応。 [画面別の機能](docs/30-features/README.md)
- 独自形式と弥生形式の単純仕訳を、CSVの確認一覧から本登録できる。仕訳日記帳の一覧をCSVに出力できる。 [CSVインポート](docs/30-features/csv-import.md)・[仕訳日記帳の出力](docs/30-features/journals.md#出力)

### 仕訳の整合性と年度管理

- 2026-11-01に仕訳の保存をRPCへまとめ、DBで貸借一致・会計期間などを検査するようにした。訂正・削除に伴う変更前の明細も記録する。 [DB関数とRPC](docs/20-database/functions-rpc.md)・[訂正削除履歴の設計判断](docs/40-decisions/ADR-0012-journal-change-history.md)
- 11月に会計期ごとの伝票番号の自動採番、法人・個人の新規作成と複数会社の切り替えを追加。所属会社は複合外部キーでも照合する。 [DB変更の履歴](docs/20-database/migrations.md)・[会社スコープ](docs/10-architecture/company-scope.md)
- 2026-11-14に期首残高の自動導出と手動設定、11-15に年度の確定・解除と確定後の書き込み制限を追加した。 [期首残高](docs/30-features/opening-balances.md)・[年度の確定と解除](docs/30-features/settings.md#年度の確定と解除)

### 開発と公開準備

- ルートから仕訳日記帳へ移動する構成にした。CIは型生成を含む型チェックとVitestを実行する。UI構成用のshadcnを開発依存に移した。 [技術スタック](docs/10-architecture/tech-stack.md)・[VitestとCI](docs/60-testing/vitest-and-ci.md)
- 仕様・設計判断・運用手順・検証範囲を `docs/` に整理し、確認したコードと参照先を記録するようにした。 [ドキュメント索引](docs/README.md)
- Apache License 2.0を採用し、ソース公開を公開デモに先行させる方針を決めた。現段階のアプリは架空データでの試用が対象。 [ライセンス](docs/40-decisions/ADR-0013-apache-license.md)・[公開の順序](docs/40-decisions/ADR-0015-source-before-hosted-demo.md)・[公開ロードマップ](docs/roadmap.md)
