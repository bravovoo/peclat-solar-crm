ALTER TABLE ai_assistant_settings
 DROP CONSTRAINT ai_assistant_settings_provider_check,
 ADD CONSTRAINT ai_assistant_settings_provider_check CHECK(provider IN ('gemini','openai'));

ALTER TABLE ai_assistant_settings
 ALTER COLUMN provider SET DEFAULT 'gemini',
 ALTER COLUMN model SET DEFAULT 'gemini-2.5-flash';
