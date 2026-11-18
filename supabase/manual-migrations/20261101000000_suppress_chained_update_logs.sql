-- 2026-11-01  訂正履歴（journal_entry_logs）のノイズ除去と不要権限の剥奪
--
-- 適用方法: Supabase の SQL Editor で手動実行（Supabase CLI の migration 履歴には登録されていない）。
-- 置き場所: supabase/manual-migrations/（CLI が履歴の元として扱う supabase/migrations/ とは意図的に分けている。
--           baseline の migration を切る際に移す）。
-- 元に戻す: 変更前の log_journal_entry_changes() は git 履歴の supabase/schema.sql（コミット eb8cb12）にある。
--           剥奪した権限は GRANT で付け直せる。
-- 別実行（このファイルには含めない・元に戻せない）: 開発用テストデータ時点での履歴リセット
--           truncate journal_entry_logs;

-- 1) 明細Trigger経由の updated_at 連鎖更新を訂正履歴に記録しない（直接のヘッダーUPDATE・DELETEは従来どおり記録）
CREATE OR REPLACE FUNCTION public.log_journal_entry_changes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  lines_snapshot JSONB;
BEGIN
  -- 直接のヘッダーUPDATE/DELETEはTrigger階層1。journal_linesのTrigger経由の連鎖更新は階層2以上
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- 変更前のjournal_linesを丸ごとJSONBに変換
  SELECT jsonb_agg(row_to_json(l))
  INTO lines_snapshot
  FROM journal_lines l
  WHERE l.entry_id = OLD.id;

  INSERT INTO journal_entry_logs (entry_id, action, before_data)
  VALUES (
    OLD.id,
    TG_OP,  -- 'UPDATE' または 'DELETE'
    jsonb_build_object(
      'entry', row_to_json(OLD),
      'lines', COALESCE(lines_snapshot, '[]')
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) REST APIから使わない権限の剥奪（TRUNCATEはRLSの対象外で、Triggerも発火しない）
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
