/**
 * Moxxy API client wrapping native fetch with auth header injection.
 */
export class ApiClient {
  #baseUrl;
  #token;

  constructor(baseUrl = 'http://localhost:3000', token = null) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#token = token;
  }

  get baseUrl() {
    return this.#baseUrl;
  }

  get token() {
    return this.#token;
  }

  setToken(token) {
    this.#token = token;
  }

  #headers(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (this.#token) {
      headers['Authorization'] = `Bearer ${this.#token}`;
    }
    return headers;
  }

  async #request(method, path, body = null) {
    const url = `${this.#baseUrl}${path}`;
    const opts = {
      method,
      headers: this.#headers(),
    };
    if (body !== null && body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    const contentType = resp.headers.get('content-type') || '';

    let data = null;
    if (contentType.includes('application/json')) {
      data = await resp.json();
    } else {
      data = await resp.text();
    }

    if (!resp.ok) {
      const errMsg = data?.message || data?.error || `HTTP ${resp.status}`;
      const err = new Error(errMsg);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  get(path) {
    return this.#request('GET', path);
  }

  post(path, body) {
    return this.#request('POST', path, body);
  }

  delete(path) {
    return this.#request('DELETE', path);
  }

  // --- Auth ---
  createToken(scopes, ttlSeconds = null, description = '') {
    const body = { scopes };
    if (ttlSeconds) body.ttl_seconds = ttlSeconds;
    if (description) body.description = description;
    return this.post('/v1/auth/tokens', body);
  }

  listTokens() {
    return this.get('/v1/auth/tokens');
  }

  revokeToken(id) {
    return this.delete(`/v1/auth/tokens/${encodeURIComponent(id)}`);
  }

  // --- Agents ---
  createAgent(providerId, modelId, workspaceRoot, opts = {}) {
    return this.post('/v1/agents', {
      provider_id: providerId,
      model_id: modelId,
      workspace_root: workspaceRoot,
      ...opts,
    });
  }

  getAgent(id) {
    return this.get(`/v1/agents/${encodeURIComponent(id)}`);
  }

  startRun(agentId, task) {
    return this.post(`/v1/agents/${encodeURIComponent(agentId)}/runs`, { task });
  }

  stopAgent(agentId) {
    return this.post(`/v1/agents/${encodeURIComponent(agentId)}/stop`, {});
  }

  // --- Events ---
  eventStreamUrl(filters = {}) {
    const params = new URLSearchParams();
    if (filters.agent_id) params.set('agent_id', filters.agent_id);
    if (filters.run_id) params.set('run_id', filters.run_id);
    const qs = params.toString();
    return `${this.#baseUrl}/v1/events/stream${qs ? '?' + qs : ''}`;
  }
}

/**
 * Load API client from environment/config.
 */
export function createClient() {
  const baseUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  const token = process.env.MOXXY_TOKEN || null;
  return new ApiClient(baseUrl, token);
}
