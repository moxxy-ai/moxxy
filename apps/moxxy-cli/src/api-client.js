/**
 * Moxxy API client.
 * Uses native fetch with bearer token injection.
 */
export class ApiClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  buildUrl(path) {
    return `${this.baseUrl}${path}`;
  }

  buildRequest(path, method, body) {
    const headers = {
      'content-type': 'application/json',
    };
    if (this.token) {
      headers['authorization'] = `Bearer ${this.token}`;
    }
    return new Request(this.buildUrl(path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async request(path, method, body) {
    const req = this.buildRequest(path, method, body);
    const resp = await fetch(req);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({
        error: 'unknown',
        message: resp.statusText,
      }));
      const error = new Error(err.message || `API error ${resp.status}`);
      error.status = resp.status;
      throw error;
    }
    const text = await resp.text();
    if (!text) return {};
    return JSON.parse(text);
  }

  async createToken(scopes, ttlSeconds, description) {
    const body = { scopes };
    if (ttlSeconds !== undefined && ttlSeconds !== null) body.ttl_seconds = ttlSeconds;
    if (description) body.description = description;
    return this.request('/v1/auth/tokens', 'POST', body);
  }

  async listTokens() {
    return this.request('/v1/auth/tokens', 'GET');
  }

  async revokeToken(id) {
    return this.request(`/v1/auth/tokens/${encodeURIComponent(id)}`, 'DELETE');
  }

  async createAgent(providerId, modelId, workspaceRoot, opts = {}) {
    const body = {
      provider_id: providerId,
      model_id: modelId,
      workspace_root: workspaceRoot,
      ...opts,
    };
    return this.request('/v1/agents', 'POST', body);
  }

  async getAgent(id) {
    return this.request(`/v1/agents/${encodeURIComponent(id)}`, 'GET');
  }

  async startRun(agentId, task) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/runs`, 'POST', { task });
  }

  async stopAgent(agentId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/stop`, 'POST');
  }

  eventStreamUrl(filters = {}) {
    const url = new URL('/v1/events/stream', this.baseUrl);
    for (const [k, v] of Object.entries(filters)) {
      if (v) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  async listAgents() {
    return this.request('/v1/agents', 'GET');
  }

  async listProviders() {
    return this.request('/v1/providers', 'GET');
  }

  async listModels(providerId) {
    return this.request(`/v1/providers/${encodeURIComponent(providerId)}/models`, 'GET');
  }

  async listSecrets() {
    return this.request('/v1/vault/secrets', 'GET');
  }

  async listSkills(agentId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/skills`, 'GET');
  }

  async disableHeartbeat(agentId, heartbeatId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/heartbeats/${encodeURIComponent(heartbeatId)}`, 'DELETE');
  }

  async listGrants() {
    return this.request('/v1/vault/grants', 'GET');
  }

  async revokeGrant(grantId) {
    return this.request(`/v1/vault/grants/${encodeURIComponent(grantId)}`, 'DELETE');
  }

  async installProvider(id, displayName, models) {
    return this.request('/v1/providers', 'POST', {
      id,
      display_name: displayName,
      models,
    });
  }

  async listChannels() {
    return this.request('/v1/channels', 'GET');
  }

  async createChannel(channelType, displayName, botToken, config) {
    return this.request('/v1/channels', 'POST', {
      channel_type: channelType,
      display_name: displayName,
      bot_token: botToken,
      config,
    });
  }

  async pairChannel(channelId, code, agentId) {
    return this.request(`/v1/channels/${encodeURIComponent(channelId)}/pair`, 'POST', {
      code,
      agent_id: agentId,
    });
  }

  async deleteChannel(channelId) {
    return this.request(`/v1/channels/${encodeURIComponent(channelId)}`, 'DELETE');
  }

  async listChannelBindings(channelId) {
    return this.request(`/v1/channels/${encodeURIComponent(channelId)}/bindings`, 'GET');
  }
}

export function createApiClient(baseUrl, token) {
  return new ApiClient(baseUrl, token);
}
