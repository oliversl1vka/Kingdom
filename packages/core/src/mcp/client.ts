export interface MCPClientConfig {
  serverUrl: string;
  reconnectIntervalMs?: number;
}

export interface MCPCallResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export class MCPClient {
  private connected = false;
  private config: MCPClientConfig;

  constructor(config: MCPClientConfig) {
    this.config = {
      reconnectIntervalMs: 5000,
      ...config,
    };
  }

  async connect(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.serverUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      this.connected = response.ok;
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<MCPCallResult<T>> {
    if (!this.connected) {
      const reconnected = await this.connect();
      if (!reconnected) {
        return { success: false, error: 'MCP server unavailable' };
      }
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      });

      if (!response.ok) {
        return { success: false, error: `MCP call failed: HTTP ${response.status}` };
      }

      const data = (await response.json()) as T;
      return { success: true, data };
    } catch (error) {
      this.connected = false;
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    this.connected = false;
  }
}
