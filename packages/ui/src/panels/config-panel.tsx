import React, { useState, useEffect } from 'react';
import { COLORS } from '../assets/sprites.js';
import {
  fetchConfig, saveConfig, setApiKey, fetchModels,
  type KingdomConfig, type ModelInfo, type TierConfig, type MCPServerConfig,
} from '../api/client.js';

const TIERS = ['king', 'nobility', 'knight', 'squire'] as const;
const PROVIDERS = ['openai', 'anthropic', 'google', 'lmstudio'] as const;

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: '#0f3460',
  color: COLORS.text,
  border: `1px solid #4a4a5a`,
  fontFamily: 'inherit',
  fontSize: '13px',
  width: '100%',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 16px',
  background: COLORS.accent,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '13px',
};

const sectionStyle: React.CSSProperties = {
  background: COLORS.panel,
  padding: '16px',
  marginBottom: '16px',
  borderLeft: `3px solid ${COLORS.gold}`,
};

const DEFAULT_CONFIG: KingdomConfig = {
  project_name: 'my-kingdom',
  providers: {
    openai: { endpoint: 'https://api.openai.com', api_key_name: 'openai', priority_order: 1, enabled: true },
  },
  tiers: {
    king:     { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 120 },
    nobility: { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 90 },
    knight:   { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 120 },
    squire:   { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 60 },
  },
  retention: { log_retention_days: 7, heartbeat_retention_days: 3 },
  token_engine: { default_safety_margin_percent: 0.12, max_concurrent_checks: 10 },
};

export function ConfigPanel() {
  const [config, setConfig] = useState<KingdomConfig | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [modelsProvider, setModelsProvider] = useState('openai');

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        if (cfg) {
          setConfig(cfg);
        } else {
          setConfig(DEFAULT_CONFIG);
          setMessage('No kingdom initialized yet. You can configure settings and save them after initializing.');
        }
      })
      .catch(() => {
        setConfig(DEFAULT_CONFIG);
        setMessage('Could not reach the server. Showing default configuration.');
      });
  }, []);

  const handleFetchModels = async (provider: string) => {
    setLoadingModels(true);
    setMessage('');
    try {
      const m = await fetchModels(provider);
      setModels(m);
      setModelsProvider(provider);
    } catch {
      setMessage(`Could not fetch models from ${provider}. Ensure API key is set and saved.`);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setMessage('');
    try {
      await saveConfig(config);
      setMessage('Configuration saved successfully.');
    } catch {
      setMessage('Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleSetApiKey = async (provider: string) => {
    const key = apiKeys[provider];
    if (!key) return;
    setMessage('');
    try {
      await setApiKey(provider, key);
      setMessage(`API key for ${provider} saved.`);
      setApiKeys((prev) => ({ ...prev, [provider]: '' }));
    } catch {
      setMessage(`Failed to save API key for ${provider}.`);
    }
  };

  const updateTier = (tier: string, field: keyof TierConfig, value: string | number) => {
    if (!config) return;
    setConfig({
      ...config,
      tiers: {
        ...config.tiers,
        [tier]: {
          ...config.tiers[tier],
          [field]: value,
        },
      },
    });
  };

  const mcpServers = config?.mcp_servers ?? {};

  const addMcpServer = () => {
    if (!config) return;
    const name = `mcp-server-${Object.keys(mcpServers).length + 1}`;
    setConfig({
      ...config,
      mcp_servers: {
        ...mcpServers,
        [name]: { transport: 'stdio', command: '', args: [], env: {}, enabled: true },
      },
    });
  };

  const updateMcp = (name: string, update: Partial<MCPServerConfig>) => {
    if (!config) return;
    setConfig({
      ...config,
      mcp_servers: {
        ...mcpServers,
        [name]: { ...mcpServers[name], ...update },
      },
    });
  };

  const removeMcp = (name: string) => {
    if (!config) return;
    const next = { ...mcpServers };
    delete next[name];
    setConfig({ ...config, mcp_servers: next });
  };

  const renameMcp = (oldName: string, newName: string) => {
    if (!config || !newName || newName === oldName || mcpServers[newName]) return;
    const next = { ...mcpServers };
    next[newName] = next[oldName];
    delete next[oldName];
    setConfig({ ...config, mcp_servers: next });
  };

  if (!config) {
    return (
      <div style={{ color: COLORS.text, padding: '8px' }}>
        <p>{message || 'Loading configuration...'}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      {message && (
        <div style={{
          padding: '8px 12px',
          marginBottom: '12px',
          background: message.includes('Failed') || message.includes('Could not') ? '#5a1a1a' : '#1a3a1a',
          color: message.includes('Failed') || message.includes('Could not') ? COLORS.healthRed : COLORS.healthGreen,
          borderLeft: `3px solid ${message.includes('Failed') || message.includes('Could not') ? COLORS.healthRed : COLORS.healthGreen}`,
        }}>
          {message}
        </div>
      )}

      {/* API Keys Section */}
      <div style={sectionStyle}>
        <h3 style={{ color: COLORS.gold, marginBottom: '12px' }}>🔑 Provider API Keys</h3>
        {PROVIDERS.map((provider) => (
          <div key={provider} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ color: COLORS.text, width: '100px', textTransform: 'capitalize' }}>{provider}</span>
            <input
              type="password"
              placeholder={`Enter ${provider} API key...`}
              value={apiKeys[provider] ?? ''}
              onChange={(e) => setApiKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => handleSetApiKey(provider)}
              disabled={!apiKeys[provider]}
              style={{ ...btnStyle, opacity: apiKeys[provider] ? 1 : 0.5 }}
            >
              Save Key
            </button>
          </div>
        ))}
      </div>

      {/* Tier Model Configuration */}
      <div style={sectionStyle}>
        <h3 style={{ color: COLORS.gold, marginBottom: '12px' }}>⚔️ Agent Tier Models</h3>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => handleFetchModels(p)}
              disabled={loadingModels}
              style={{ ...btnStyle, background: modelsProvider === p ? COLORS.accent : '#0f3460', fontSize: '11px' }}
            >
              {loadingModels && modelsProvider === p ? '...' : `Load ${p} models`}
            </button>
          ))}
        </div>
        {models.length > 0 && (
          <div style={{ marginBottom: '12px', fontSize: '11px', color: '#888' }}>
            {models.length} models available from {modelsProvider}
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid #4a4a5a` }}>
              <th style={{ textAlign: 'left', color: COLORS.gold, padding: '6px', width: '120px' }}>Tier</th>
              <th style={{ textAlign: 'left', color: COLORS.gold, padding: '6px' }}>Model</th>
              <th style={{ textAlign: 'left', color: COLORS.gold, padding: '6px', width: '100px' }}>Retries</th>
              <th style={{ textAlign: 'left', color: COLORS.gold, padding: '6px', width: '120px' }}>Timeout (s)</th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => {
              const t = config.tiers[tier] ?? { model: '', max_retries: 3, timeout_seconds: 60 };
              return (
                <tr key={tier} style={{ borderBottom: `1px solid #2a2a3a` }}>
                  <td style={{ padding: '6px', color: COLORS.text, textTransform: 'capitalize' }}>{tier}</td>
                  <td style={{ padding: '6px' }}>
                    {models.length > 0 ? (
                      <select
                        value={t.model}
                        onChange={(e) => updateTier(tier, 'model', e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer' }}
                      >
                        <option value={t.model}>{t.model}</option>
                        {models
                          .filter((m) => m.id !== t.model)
                          .map((m) => (
                            <option key={m.id} value={m.id}>{m.id}</option>
                          ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={t.model}
                        onChange={(e) => updateTier(tier, 'model', e.target.value)}
                        style={inputStyle}
                      />
                    )}
                  </td>
                  <td style={{ padding: '6px' }}>
                    <input
                      type="number"
                      value={t.max_retries}
                      min={0}
                      max={10}
                      onChange={(e) => updateTier(tier, 'max_retries', parseInt(e.target.value, 10) || 0)}
                      style={{ ...inputStyle, width: '60px' }}
                    />
                  </td>
                  <td style={{ padding: '6px' }}>
                    <input
                      type="number"
                      value={t.timeout_seconds}
                      min={10}
                      max={600}
                      onChange={(e) => updateTier(tier, 'timeout_seconds', parseInt(e.target.value, 10) || 60)}
                      style={{ ...inputStyle, width: '80px' }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MCP Servers Section */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ color: COLORS.gold, margin: 0 }}>🔌 MCP Servers</h3>
          <button onClick={addMcpServer} style={{ ...btnStyle, fontSize: '11px', padding: '4px 12px' }}>
            + Add Server
          </button>
        </div>

        {Object.keys(mcpServers).length === 0 && (
          <p style={{ color: '#666', fontSize: '12px', margin: 0 }}>
            No MCP servers configured. Add one to enable tool access for agents.
          </p>
        )}

        {Object.entries(mcpServers).map(([name, srv]) => (
          <div key={name} style={{ background: '#0a0a14', padding: '12px', marginBottom: '10px', borderLeft: `2px solid ${srv.enabled ? COLORS.healthGreen : '#555'}` }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                defaultValue={name}
                onBlur={(e) => renameMcp(name, e.target.value.trim())}
                style={{ ...inputStyle, width: '200px', fontWeight: 'bold' }}
              />
              <select
                value={srv.transport}
                onChange={(e) => updateMcp(name, { transport: e.target.value as 'stdio' | 'sse' })}
                style={{ ...inputStyle, width: '90px', cursor: 'pointer' }}
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
              </select>
              <label style={{ color: COLORS.text, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={srv.enabled}
                  onChange={(e) => updateMcp(name, { enabled: e.target.checked })}
                />
                Enabled
              </label>
              <button
                onClick={() => removeMcp(name)}
                style={{ ...btnStyle, background: '#5a1a1a', padding: '3px 10px', fontSize: '11px', marginLeft: 'auto' }}
              >
                Remove
              </button>
            </div>

            {/* Transport-specific fields */}
            {srv.transport === 'stdio' ? (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                <div style={{ flex: '0 0 180px' }}>
                  <div style={{ color: '#888', fontSize: '10px', marginBottom: '2px' }}>Command</div>
                  <input
                    type="text"
                    placeholder="npx, node, python..."
                    value={srv.command ?? ''}
                    onChange={(e) => updateMcp(name, { command: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#888', fontSize: '10px', marginBottom: '2px' }}>Arguments (one per line)</div>
                  <textarea
                    placeholder={"-y\n@modelcontextprotocol/server-github"}
                    value={(srv.args ?? []).join('\n')}
                    onChange={(e) => updateMcp(name, { args: e.target.value.split('\n') })}
                    style={{ ...inputStyle, minHeight: '48px', resize: 'vertical' }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '6px' }}>
                <div style={{ color: '#888', fontSize: '10px', marginBottom: '2px' }}>Server URL</div>
                <input
                  type="text"
                  placeholder="http://localhost:3001/sse"
                  value={srv.url ?? ''}
                  onChange={(e) => updateMcp(name, { url: e.target.value })}
                  style={inputStyle}
                />
              </div>
            )}

            {/* Environment variables */}
            <div>
              <div style={{ color: '#888', fontSize: '10px', marginBottom: '2px' }}>
                Environment Variables (KEY=VALUE, one per line)
              </div>
              <textarea
                placeholder={"GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...\nNODE_ENV=production"}
                value={Object.entries(srv.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                onChange={(e) => {
                  const env: Record<string, string> = {};
                  for (const line of e.target.value.split('\n')) {
                    const eqIdx = line.indexOf('=');
                    if (eqIdx > 0) {
                      env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1);
                    }
                  }
                  updateMcp(name, { env });
                }}
                style={{ ...inputStyle, minHeight: '40px', resize: 'vertical' }}
              />
            </div>
          </div>
        ))}
      </div>

      <button onClick={handleSaveConfig} disabled={saving} style={{ ...btnStyle, fontSize: '14px', padding: '10px 24px' }}>
        {saving ? 'Saving...' : '💾 Save Configuration'}
      </button>
    </div>
  );
}
