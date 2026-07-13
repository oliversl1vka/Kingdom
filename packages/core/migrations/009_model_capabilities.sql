-- Extend model_configs with capability metadata and aliases.
-- Migration 009: capability-based model selection (Phase A chunk 1).
--
-- Both columns are JSON text and nullable — unknown capabilities are expected
-- for brand-new models. `resolveModel()` treats null as "unverified".

INSERT OR IGNORE INTO schema_version (version) VALUES (9);

ALTER TABLE model_configs ADD COLUMN capabilities_json TEXT;
ALTER TABLE model_configs ADD COLUMN aliases_json TEXT;

-- Backfill capability metadata for the three seeded models.
-- Values reflect what these models shipped with as of early 2026.
UPDATE model_configs
SET capabilities_json = json_object(
      'strengths',         json_array('decomposition', 'review', 'orchestration'),
      'tool_use',          json('true'),
      'structured_output', json('true'),
      'multimodal',        json('true'),
      'streaming',         json('true'),
      'tier_class',        'premium',
      'latency_class',     'balanced'
    ),
    aliases_json = json_array('best-reasoning', 'flagship')
WHERE model_id = 'gpt-4o';

UPDATE model_configs
SET capabilities_json = json_object(
      'strengths',         json_array('implementation', 'review', 'healing', 'summarization'),
      'tool_use',          json('true'),
      'structured_output', json('true'),
      'multimodal',        json('true'),
      'streaming',         json('true'),
      'tier_class',        'cheap',
      'latency_class',     'fast'
    ),
    aliases_json = json_array('cheap-fast', 'default')
WHERE model_id = 'gpt-4o-mini';

UPDATE model_configs
SET capabilities_json = json_object(
      'strengths',         json_array('implementation'),
      'tool_use',          json('false'),
      'structured_output', json('true'),
      'multimodal',        json('false'),
      'streaming',         json('true'),
      'tier_class',        'cheap',
      'latency_class',     'fast'
    ),
    aliases_json = json_array('cheap-coder', 'local-coder')
WHERE model_id = 'qwen2.5-coder-7b';
