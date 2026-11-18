-- 2026-11-14: SECURITY INVOKER の明細トリガーが呼ぶ補助関数の EXECUTE 付与漏れを修正。
-- anon による期首残高保存が 42501（PostgREST は 401）で失敗したため、本番には同日手動適用済み。
-- 既存マイグレーションと同じトランザクション形式。GRANT は冪等。
begin;

GRANT EXECUTE ON FUNCTION public.opening_balance_account_ok(text, text, text) TO anon, authenticated;

commit;
