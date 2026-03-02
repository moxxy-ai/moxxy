const GATEWAY_DOWN_MSG = 'Gateway is not running. Start it with: moxxy gateway start';

function isConnectionError(err) {
  const cause = err.cause;
  if (cause && (cause.code === 'ECONNREFUSED' || cause.code === 'ECONNRESET')) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('econnrefused') || msg.includes('fetch failed');
}

function gatewayDownError() {
  const error = new Error(GATEWAY_DOWN_MSG);
  error.isGatewayDown = true;
  return error;
}

/**
 * Moxxy API client.
 * Uses native fetch with bearer token injection.
 */
export class ApiClient {
  constructor(baseUrl, token, authMode = 'token') {
    this.baseUrl = baseUrl;
    this.token = token;
    this.authMode = authMode;
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
    let resp;
    try {
      resp = await fetch(req);
    } catch (err) {
      if (isConnectionError(err)) throw gatewayDownError();
      throw err;
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({
        error: 'unknown',
        message: resp.statusText,
      }));
      let msg = err.message || `API error ${resp.status}`;
      if (resp.status === 401 && this.authMode === 'loopback') {
        msg += '\nLoopback mode is enabled but the gateway rejected the request. Ensure the gateway is running with auth_mode: loopback.';
      } else if (resp.status === 401 && !this.token) {
        msg += '\nMOXXY_TOKEN is not set. Run `moxxy init` to create a token, or set it with:\n  export MOXXY_TOKEN="<your-token>"';
      } else if (resp.status === 401) {
        msg += '\nYour token may be expired or revoked. Create a new one with: moxxy auth token create';
      }
      const error = new Error(msg);
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

  async createAgent(providerId, modelId, name, opts = {}) {
    const body = {
      provider_id: providerId,
      model_id: modelId,
      name,
      ...opts,
    };
    return this.request('/v1/agents', 'POST', body);
  }

  async getAgent(id) {
    return this.request(`/v1/agents/${encodeURIComponent(id)}`, 'GET');
  }

  async updateAgent(id, updates) {
    return this.request(`/v1/agents/${encodeURIComponent(id)}`, 'PATCH', updates);
  }

  async startRun(agentId, task) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/runs`, 'POST', { task });
  }

  async stopAgent(agentId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/stop`, 'POST');
  }

  async deleteAgent(agentId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}`, 'DELETE');
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

  async createSecret(body) {
    return this.request('/v1/vault/secrets', 'POST', body);
  }

  async deleteSecret(id) {
    return this.request(`/v1/vault/secrets/${encodeURIComponent(id)}`, 'DELETE');
  }

  async listSkills(agentId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/skills`, 'GET');
  }

  async deleteSkill(agentId, skillId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillId)}`, 'DELETE');
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

export function createApiClient(baseUrl, token, authMode = 'token') {
  return new ApiClient(baseUrl, token, authMode);
}
