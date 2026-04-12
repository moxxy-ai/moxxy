const GATEWAY_DOWN_MSG = 'Gateway is not running. Start it with: moxxy gateway start';

function isConnectionError(err) {
  const cause = err.cause;
  if (cause && (cause.code === 'ECONNREFUSED' || cause.code === 'ECONNRESET')) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('econnrefused') || msg.includes('fetch failed')
    || msg.includes('unable to connect') || msg.includes('connection refused');
}

function gatewayDownError() {
  const error = new Error(GATEWAY_DOWN_MSG);
  error.isGatewayDown = true;
  return error;
}

function normalizeBaseUrl(baseUrl) {
  const raw = (baseUrl || '').trim();
  if (!raw) return 'http://localhost:3000';
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  const withoutV1Suffix = withoutTrailingSlash.replace(/\/v1$/i, '');
  return withoutV1Suffix || withoutTrailingSlash;
}

function normalizeMcpServersResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.servers)) return payload.servers;
  return [];
}

/**
 * Moxxy API client.
 * Uses native fetch with bearer token injection.
 */
export class ApiClient {
  constructor(baseUrl, token, authMode = 'token') {
    this.baseUrl = normalizeBaseUrl(baseUrl);
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
      } else if (resp.status === 404) {
        msg += `\nEndpoint not found (${path}). Verify MOXXY_API_URL points to a Moxxy gateway with /v1 routes.`;
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

  /**
   * Upload a recorded voice clip to the gateway. The server transcribes it
   * via the configured STT provider and immediately starts a run with the
   * transcript as the task. Returns `{ transcript, run_id, status, ... }`.
   */
  async startRunWithAudio(agentId, { data, mime = 'audio/wav', filename = 'voice.wav' }) {
    const form = new FormData();
    const blob = new Blob([data], { type: mime });
    form.append('audio', blob, filename);

    const headers = {};
    if (this.token) {
      headers['authorization'] = `Bearer ${this.token}`;
    }
    // NOTE: do NOT set content-type — fetch will compute the multipart
    // boundary for us.

    const url = this.buildUrl(`/v1/agents/${encodeURIComponent(agentId)}/runs/audio`);
    let resp;
    try {
      resp = await fetch(url, { method: 'POST', headers, body: form });
    } catch (err) {
      if (isConnectionError(err)) throw gatewayDownError();
      throw err;
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({
        error: 'unknown',
        message: resp.statusText,
      }));
      const error = new Error(err.message || `API error ${resp.status}`);
      error.status = resp.status;
      error.code = err.error;
      throw error;
    }
    const text = await resp.text();
    if (!text) return {};
    return JSON.parse(text);
  }

  async stopAgent(agentId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/stop`, 'POST');
  }

  async resetSession(agentId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/reset`, 'POST');
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

  async getHistory(agentId, limit = 50) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/history?limit=${limit}`, 'GET');
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

  async respondToAsk(agentId, questionId, answer) {
    return this.request(
      `/v1/agents/${encodeURIComponent(agentId)}/ask-responses/${encodeURIComponent(questionId)}`,
      'POST',
      { answer },
    );
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

  async listMcpServers(agentName) {
    const payload = await this.request(`/v1/agents/${encodeURIComponent(agentName)}/mcp`, 'GET');
    return normalizeMcpServersResponse(payload);
  }

  async addMcpServer(agentName, config) {
    return this.request(`/v1/agents/${encodeURIComponent(agentName)}/mcp`, 'POST', config);
  }

  async removeMcpServer(agentName, serverId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentName)}/mcp/${encodeURIComponent(serverId)}`, 'DELETE');
  }

  async testMcpServer(agentName, serverId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentName)}/mcp/${encodeURIComponent(serverId)}/test`, 'POST');
  }

  async listWebhooks(agentName) {
    const payload = await this.request(`/v1/agents/${encodeURIComponent(agentName)}/webhooks`, 'GET');
    return Array.isArray(payload) ? payload : [];
  }

  async createWebhook(agentName, config) {
    return this.request(`/v1/agents/${encodeURIComponent(agentName)}/webhooks`, 'POST', config);
  }

  async updateWebhook(agentName, slug, patch) {
    return this.request(`/v1/agents/${encodeURIComponent(agentName)}/webhooks/${encodeURIComponent(slug)}`, 'PATCH', patch);
  }

  async deleteWebhook(agentName, slug) {
    return this.request(`/v1/agents/${encodeURIComponent(agentName)}/webhooks/${encodeURIComponent(slug)}`, 'DELETE');
  }

  async listTemplates() {
    return this.request('/v1/templates', 'GET');
  }

  async getTemplate(slug) {
    return this.request(`/v1/templates/${encodeURIComponent(slug)}`, 'GET');
  }

  async createTemplate(content) {
    return this.request('/v1/templates', 'POST', { content });
  }

  async updateTemplate(slug, content) {
    return this.request(`/v1/templates/${encodeURIComponent(slug)}`, 'PUT', { content });
  }

  async deleteTemplate(slug) {
    return this.request(`/v1/templates/${encodeURIComponent(slug)}`, 'DELETE');
  }

  async setAgentTemplate(name, template) {
    return this.request(`/v1/agents/${encodeURIComponent(name)}/template`, 'PATCH', { template });
  }

  // --- Settings: Speech-to-text ---------------------------------------

  /**
   * Fetch the currently-active STT configuration from the gateway.
   * Returns `{ enabled: false }` when voice messages are off, or
   * `{ enabled: true, provider, model, secret_ref, ... }` otherwise.
   * The API never returns the raw API key.
   */
  async getSttSettings() {
    return this.request('/v1/settings/stt', 'GET');
  }

  /**
   * Configure (or reconfigure) speech-to-text.
   *
   * Pass `api_key` to provision a fresh vault secret; omit it to reuse an
   * existing `secret_ref`. The running gateway swaps providers in-place —
   * no restart needed.
   */
  async updateSttSettings(body) {
    return this.request('/v1/settings/stt', 'PUT', body);
  }

  /**
   * Disable voice messages. Removes the `stt` block from settings.yaml
   * and clears the in-memory provider. Does NOT delete the vault secret.
   */
  async deleteSttSettings() {
    return this.request('/v1/settings/stt', 'DELETE');
  }
}

export function createApiClient(baseUrl, token, authMode = 'token') {
  return new ApiClient(baseUrl, token, authMode);
}
