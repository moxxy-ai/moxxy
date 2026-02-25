#!/bin/sh

# mcp builtin skill script

API_URL="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
AGENT_NAME="${MOXXY_AGENT_NAME:-default}"
AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }

action="$1"

case "$action" in
    "list")
        curl -s ${AUTH_HEADER:+-H "$AUTH_HEADER"} "${API_URL}/agents/${AGENT_NAME}/mcp"
        ;;
    "add")
        server_name="$2"
        command="$3"
        args="$4"
        env_json="${5:-{}}"

        if [ -z "$server_name" ] || [ -z "$command" ]; then
            echo "Error: server_name and command are required."
            exit 1
        fi

        payload=$(printf '{"name":"%s","command":"%s","args":"%s","env":"%s"}' \
          "$(_esc "$server_name")" "$(_esc "$command")" "$(_esc "$args")" "$(_esc "$env_json")")

        curl -s -X POST ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: application/json" -d "$payload" "${API_URL}/agents/${AGENT_NAME}/mcp"
        ;;
    "add-json")
        json_config="$2"

        if [ -z "$json_config" ]; then
            echo "Error: JSON config is required."
            echo "Expected format: {\"mcpServers\":{\"name\":{\"command\":\"...\",\"args\":[...],\"env\":{...}}}}"
            exit 1
        fi

        # Use Python3 for complex JSON parsing (broadly available)
        if ! command -v python3 >/dev/null 2>&1; then
            echo "Error: python3 is required for add-json. Use 'mcp add <name> <command> <args> [env_json]' instead."
            exit 1
        fi

        python3 -c "
import json, sys, urllib.request

config = json.loads(sys.argv[1])
servers = config.get('mcpServers', config)
api_url = sys.argv[2]
agent = sys.argv[3]
auth = sys.argv[4] if len(sys.argv) > 4 else ''
added = 0

for name, spec in servers.items():
    cmd = spec.get('command', '')
    if not cmd:
        print(f'Skipping \"{name}\": no command specified.')
        continue
    args = spec.get('args', [])
    args_str = ' '.join(args) if isinstance(args, list) else str(args)
    env = json.dumps(spec.get('env', {}))
    payload = json.dumps({'name': name, 'command': cmd, 'args': args_str, 'env': env}).encode()
    headers = {'Content-Type': 'application/json'}
    if auth:
        headers['X-Moxxy-Internal-Token'] = auth
    print(f'Adding MCP server: {name}')
    req = urllib.request.Request(f'{api_url}/agents/{agent}/mcp', data=payload, headers=headers, method='POST')
    try:
        resp = urllib.request.urlopen(req)
        print(resp.read().decode())
    except Exception as e:
        print(f'Error adding {name}: {e}')
    added += 1

print(f'Added {added} MCP server(s). Please reboot the agent to initialize them.')
" "$json_config" "$API_URL" "$AGENT_NAME" "${MOXXY_INTERNAL_TOKEN:-}"
        ;;
    "remove")
        server_name="$2"
        if [ -z "$server_name" ]; then
            echo "Error: server_name is required."
            exit 1
        fi

        curl -s -X DELETE ${AUTH_HEADER:+-H "$AUTH_HEADER"} "${API_URL}/agents/${AGENT_NAME}/mcp/${server_name}"
        ;;
    *)
        echo "Usage:"
        echo "  mcp list"
        echo "  mcp add <name> <command> <args> <env_json>"
        echo "  mcp add-json '<mcpServers JSON config>'"
        echo "  mcp remove <name>"
        exit 1
        ;;
esac
