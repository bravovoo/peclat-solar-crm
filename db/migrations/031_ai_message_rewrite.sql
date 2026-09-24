-- A reformulação pode ser usada sem uma conversa selecionada.
ALTER TABLE ai_usage_events ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_action_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_action_check
 CHECK (action IN ('summarize','suggest_reply','next_action','missing_information','follow_up','closing_support','rewrite_message'));
