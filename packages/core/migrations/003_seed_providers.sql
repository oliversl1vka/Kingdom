-- Seed provider configurations per data-model.md ProviderHealth
INSERT OR IGNORE INTO provider_health (provider_id, display_name, status, endpoint, priority_order, requests_today)
VALUES
  ('openai', 'OpenAI', 'unavailable', 'https://api.openai.com/v1', 1, 0),
  ('anthropic', 'Anthropic', 'unavailable', 'https://api.anthropic.com/v1', 2, 0),
  ('google', 'Google', 'unavailable', 'https://generativelanguage.googleapis.com/v1beta', 3, 0),
  ('lmstudio', 'LM Studio', 'unavailable', 'http://localhost:1234/v1', 4, 0);
