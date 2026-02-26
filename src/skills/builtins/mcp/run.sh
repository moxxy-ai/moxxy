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
# When no positional args but stdin has JSON array (MOXXY_ARGS_MODE=stdin), parse action from stdin
if [ -z "$action" ] && [ "$MOXXY_ARGS_MODE" = "stdin" ]; then
    _stdin=$(cat)
    if [ -n "$_stdin" ]; then
        action=$(printf '%s' "$_stdin" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0] if a else '')" 2>/dev/null || echo '')
        export _MOXXY_STDIN_ARGS="$_stdin"
    fi
fi

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
        # Fallback: when $2 is empty, get JSON from stdin (already consumed above) or read stdin now
        if [ -z "$json_config" ] && [ "$MOXXY_ARGS_MODE" = "stdin" ]; then
            _input="${_MOXXY_STDIN_ARGS:-}"
            if [ -z "$_input" ]; then
                _input=$(cat)
            fi
            json_config=$(printf '%s' "$_input" | python3 -c "
import sys, json
try:
    a = json.load(sys.stdin)
    print(a[1] if isinstance(a, list) and len(a) > 1 else '')
except Exception:
    print('')
" 2>/dev/null || echo '')
        fi

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

        # Pass JSON via stdin to avoid argv escaping/size issues when invoked by agent
        printf '%s' "$json_config" | python3 -c "
import json, re, sys, urllib.request

GENERIC_NAMES = frozenset({'default', 'mcp', 'server', 'default_server', 'unknown'})

def derive_name_from_spec(spec):
    \"\"\"Derive a descriptive name from command/args when config uses a generic name.\"\"\"
    args = spec.get('args', [])
    if isinstance(args, str):
        args = args.split()
    for a in reversed(args):
        a = str(a).strip()
        if not a or a.startswith('-') or a.startswith('/'):
            continue
        # exa-mcp-server -> exa, @modelcontextprotocol/server-github -> github
        part = a.split('/')[-1].split('@')[-1]
        # Try first segment (exa-mcp-server -> exa)
        match = re.match(r'^([a-zA-Z0-9]+)(?:[-_]?(?:mcp|server))?', part)
        if match:
            derived = match.group(1).lower()
            if derived and derived not in GENERIC_NAMES:
                return derived
        # If part is generic-word-specific (server-github), use the specific part
        if '-' in part or '_' in part:
            for seg in part.replace('_', '-').split('-'):
                if seg and seg.lower() not in GENERIC_NAMES and re.match(r'^[a-zA-Z][a-zA-Z0-9]*$', seg):
                    return seg.lower()
        if re.match(r'^[a-zA-Z][a-zA-Z0-9_-]+$', part):
            return part.split('-')[0].split('_')[0].lower()
    return 'mcp_tool'

config = json.load(sys.stdin)
servers = config.get('mcpServers', config)
api_url = sys.argv[1]
agent = sys.argv[2]
auth = sys.argv[3] if len(sys.argv) > 3 else ''
added = 0

for name, spec in servers.items():
    cmd = spec.get('command', '')
    if not cmd:
        print(f'Skipping \"{name}\": no command specified.')
        continue
    final_name = name if name.lower() not in GENERIC_NAMES else derive_name_from_spec(spec)
    if final_name != name:
        print(f'Renaming generic \"{name}\" to \"{final_name}\" (derived from spec)')
    args = spec.get('args', [])
    args_str = ' '.join(args) if isinstance(args, list) else str(args)
    env = json.dumps(spec.get('env', {}))
    payload = json.dumps({'name': final_name, 'command': cmd, 'args': args_str, 'env': env}).encode()
    headers = {'Content-Type': 'application/json'}
    if auth:
        headers['X-Moxxy-Internal-Token'] = auth
    print(f'Adding MCP server: {final_name}')
    req = urllib.request.Request(f'{api_url}/agents/{agent}/mcp', data=payload, headers=headers, method='POST')
    try:
        resp = urllib.request.urlopen(req)
        print(resp.read().decode())
    except Exception as e:
        print(f'Error adding {name}: {e}')
    added += 1

print(f'Added {added} MCP server(s). Please restart the gateway (moxxy gateway restart) to initialize them.')
" "$API_URL" "$AGENT_NAME" "${MOXXY_INTERNAL_TOKEN:-}"
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
