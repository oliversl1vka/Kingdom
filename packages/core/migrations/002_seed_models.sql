-- Seed default model configurations
-- Migration 002: Default model and provider entries

INSERT OR IGNORE INTO schema_version (version) VALUES (2);

-- Model Configurations
INSERT OR IGNORE INTO model_configs (model_id, provider, display_name, context_window, safe_input_budget, output_reservation, safety_margin_percent, tokenizer_type, tokenizer_config, tier_assignment)
VALUES
  ('gpt-4o', 'openai', 'GPT-4o', 128000, 100352, 16384, 0.12, 'tiktoken', '{"encoding":"o200k_base"}', 'king'),
  ('gpt-4o-mini', 'openai', 'GPT-4o Mini', 128000, 100352, 16384, 0.12, 'tiktoken', '{"encoding":"o200k_base"}', 'nobility'),
  ('qwen2.5-coder-7b', 'lmstudio', 'Qwen 2.5 Coder 7B', 32768, 22118, 4096, 0.12, 'huggingface', '{"tokenizer_path":"qwen2.5-coder-tokenizer.json"}', 'knight');

-- Provider Health defaults (OpenAI first for test mode)
INSERT OR IGNORE INTO provider_health (provider_id, display_name, endpoint, status, priority_order)
VALUES
  ('openai', 'OpenAI', 'https://api.openai.com/v1', 'unavailable', 1),
  ('lmstudio', 'LM Studio (Local)', 'http://localhost:1234', 'unavailable', 2),
  ('anthropic', 'Anthropic', 'https://api.anthropic.com/v1', 'unavailable', 3),
  ('google', 'Google AI', 'https://generativelanguage.googleapis.com/v1', 'unavailable', 4);
