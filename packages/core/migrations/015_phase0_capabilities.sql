-- Phase 0 — Capability Substrate.
-- Seeds real ModelCapabilities for the models actually used by kingdom.config.json
-- (gpt-4.1-mini, gpt-4o-mini, the llama.cpp local coder), plus frontier examples
-- (claude-opus, gpt-4o) so capability-based routing has real rows to score.
-- Also migrates the local coder off LM Studio onto the new llama.cpp default and
-- registers the llamacpp provider for health tracking.

INSERT OR IGNORE INTO schema_version (version) VALUES (15);

-- ── gpt-4.1-mini (king / nobility / judge / healer workhorse) ──────────────
INSERT OR IGNORE INTO model_configs
  (model_id, provider, display_name, context_window, safe_input_budget, output_reservation, safety_margin_percent, tokenizer_type, tokenizer_config, tier_assignment)
VALUES
  ('gpt-4.1-mini', 'openai', 'GPT-4.1 Mini', 1000000, 900000, 32768, 0.12, 'tiktoken', '{"encoding":"o200k_base"}', 'king');

UPDATE model_configs
SET capabilities_json = json_object(
      'strengths',         json_array('decomposition', 'review', 'healing', 'orchestration', 'summarization'),
      'tool_use',          json('true'),
      'structured_output', json('true'),
      'multimodal',        json('true'),
      'streaming',         json('true'),
      'tier_class',        'balanced',
      'latency_class',     'fast'
    ),
    aliases_json = json_array('balanced-reasoning')
WHERE model_id = 'gpt-4.1-mini';

-- ── claude-opus (frontier example) ─────────────────────────────────────────
INSERT OR IGNORE INTO model_configs
  (model_id, provider, display_name, context_window, safe_input_budget, output_reservation, safety_margin_percent, tokenizer_type, tokenizer_config, tier_assignment)
VALUES
  ('claude-opus-4', 'anthropic', 'Claude Opus 4', 200000, 180000, 16384, 0.12, 'character-estimate', NULL, NULL);

UPDATE model_configs
SET capabilities_json = json_object(
      'strengths',         json_array('decomposition', 'implementation', 'review', 'healing', 'orchestration', 'summarization'),
      'tool_use',          json('true'),
      'structured_output', json('true'),
      'multimodal',        json('true'),
      'streaming',         json('true'),
      'tier_class',        'premium',
      'latency_class',     'thorough'
    ),
    aliases_json = json_array('frontier', 'best-coder')
WHERE model_id = 'claude-opus-4';

-- ── gpt-4o capabilities (model seeded in 002; caps set in 009, reaffirm) ────
-- (no-op if 009 already populated; left for completeness / documentation.)

-- ── Local llama.cpp coder: migrate qwen2.5-coder-7b off LM Studio ───────────
UPDATE model_configs
SET provider = 'llamacpp'
WHERE model_id = 'qwen2.5-coder-7b';

-- Refresh its capabilities: llama.cpp supports json_schema structured output
-- (response_format), so mark structured_output true; tool_use remains false for
-- small local coders (keeps the prose-and-parse fallback path for the squire).
UPDATE model_configs
SET capabilities_json = json_object(
      'strengths',         json_array('implementation', 'summarization'),
      'tool_use',          json('false'),
      'structured_output', json('true'),
      'multimodal',        json('false'),
      'streaming',         json('true'),
      'tier_class',        'cheap',
      'latency_class',     'fast'
    ),
    aliases_json = json_array('cheap-coder', 'local-coder')
WHERE model_id = 'qwen2.5-coder-7b';

-- ── Register the llamacpp provider for health tracking ──────────────────────
INSERT OR IGNORE INTO provider_health (provider_id, display_name, endpoint, status, priority_order)
VALUES
  ('llamacpp', 'llama.cpp (Local)', 'http://localhost:8080', 'unavailable', 3);
