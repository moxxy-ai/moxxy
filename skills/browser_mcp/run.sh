#!/usr/bin/env bash

# browser_mcp skill shim
# Implements simple fetch, navigate and screenshot actions by proxying requests
# to an external MCP chrome-devtools server.

set -euo pipefail

usage() {
  cat <<EOF
Usage:
  $0 fetch <url>            # returns page HTML (via MCP evaluate)
  $0 navigate <url>         # open/navigate a page (returns raw MCP response)
  $0 screenshot <url> <out> # create page, take screenshot, save to <out>

Environment:
  MCP_BASE_URL   URL of the MCP server (required), e.g. https://mcp.example.com/api
  MCP_TOKEN      Optional bearer token for MCP
  TIMEOUT        Optional curl timeout seconds (default 30)
EOF
  exit 2
}

if [[ $# -lt 2 ]]; then
  usage
fi

MCP_BASE_URL="${MCP_BASE_URL:-}"
MCP_TOKEN="${MCP_TOKEN:-}"
TIMEOUT="${TIMEOUT:-30}"

if [[ -z "$MCP_BASE_URL" ]]; then
  echo "Error: MCP_BASE_URL must be set (see skill docs)." >&2
  exit 1
fi

_call_mcp() {
  method="$1"; shift
  body="$1"
  headers=("-H" "Content-Type: application/json")
  if [[ -n "$MCP_TOKEN" ]]; then
    headers+=("-H" "Authorization: Bearer $MCP_TOKEN")
  fi
  curl -sS "${headers[@]}" -X POST --max-time "$TIMEOUT" "$MCP_BASE_URL/$method" -d "$body"
}

# Helper to JSON-encode a single string using python3 (avoids jq dependency)
json_str() {
  python3 - <<PY
import json,sys
print(json.dumps(sys.argv[1]))
PY
}

cmd="$1"; shift
case "$cmd" in
fetch)
  url="$1"
  # 1) create a new page pointing to the URL
  body=$(python3 - <<PY
import json,sys
print(json.dumps({'url': sys.argv[1]}))
PY
  "$url")
  resp=$(_call_mcp "chrome-devtools_new_page" "$body")
  # try to extract a page identifier heuristically (pageId, id, or result.pageId)
  page_id=$(printf '%s' "$resp" | python3 -c "import sys,json
try:
  obj=json.load(sys.stdin)
  for k in ('pageId','id'):
    if k in obj:
      print(obj[k]); raise SystemExit
  if isinstance(obj.get('result'), dict) and 'pageId' in obj['result']:
    print(obj['result']['pageId']); raise SystemExit
except Exception:
  pass
")
  # 2) evaluate a script returning outerHTML
  func_stmt='() => { return document.documentElement.outerHTML; }'
  eval_body=$(python3 - <<PY
import json,sys
print(json.dumps({'function': func}, ensure_ascii=False))
PY
  -- <<PY2
{"func": "$func_stmt"}
PY2
  )
  # Some MCPs accept just the function; others accept pageId + function. Try both.
  if [[ -n "$page_id" ]]; then
    eval_body=$(python3 - <<PY
import json,sys
print(json.dumps({'pageId': sys.argv[1], 'function': sys.argv[2]}))
PY
    "$page_id" "$func_stmt")
  else
    eval_body=$(python3 - <<PY
import json,sys
print(json.dumps({'function': sys.argv[1]}))
PY
    "$func_stmt")
  fi
  out=$(_call_mcp "chrome-devtools_evaluate_script" "$eval_body")
  # If the MCP returns a structured result, try to print a likely field, otherwise raw
  printf "%s\n" "$out"
  ;;

navigate)
  url="$1"
  nav_body=$(python3 - <<PY
import json,sys
print(json.dumps({'type':'url','url': sys.argv[1]}))
PY
  "$url")
  _call_mcp "chrome-devtools_navigate_page" "$nav_body" | sed -n '1,200p'
  ;;

screenshot)
  if [[ $# -lt 2 ]]; then
    echo "screenshot requires: screenshot <url> <output_file>" >&2
    exit 2
  fi
  url="$1"; out_file="$2"
  # create page
  body=$(python3 - <<PY
import json,sys
print(json.dumps({'url': sys.argv[1]}))
PY
  "$url")
  resp=$(_call_mcp "chrome-devtools_new_page" "$body")
  page_id=$(printf '%s' "$resp" | python3 -c "import sys,json
try:
  obj=json.load(sys.stdin)
  for k in ('pageId','id'):
    if k in obj:
      print(obj[k]); raise SystemExit
  if isinstance(obj.get('result'), dict) and 'pageId' in obj['result']:
    print(obj['result']['pageId']); raise SystemExit
except Exception:
  pass
")
  # ask for screenshot
  if [[ -n "$page_id" ]]; then
    ss_body=$(python3 - <<PY
import json,sys
print(json.dumps({'pageId': sys.argv[1], 'fullPage': True}))
PY
  "$page_id")
  else
    ss_body=$(python3 - <<PY
import json
print(json.dumps({'fullPage': True}))
PY
    )
  fi
  ss_resp=$(_call_mcp "chrome-devtools_take_screenshot" "$ss_body")
  # Expecting base64 image under data or result.data; attempt to extract via python
  python3 - <<PY > "$out_file"
import sys, json, base64
try:
  obj=json.load(sys.stdin)
except Exception:
  print('ERROR: MCP returned non-json screenshot response', file=sys.stderr); sys.exit(1)
for key in ('data','result','resultData'):
  v = obj.get(key)
  if isinstance(v, str):
    b64=v; break
  if isinstance(v, dict) and 'data' in v:
    b64=v['data']; break
else:
  # try top-level nested
  b64 = obj.get('data') or (obj.get('result') and obj['result'].get('data'))
if not b64:
  print('ERROR: no image data found in MCP response', file=sys.stderr); sys.exit(2)
open(sys.argv[1],'wb').write(base64.b64decode(b64))
PY
  "$out_file" <<JSON
$ss_resp
JSON
  echo "Saved screenshot to $out_file"
  ;;
*)
  usage
  ;;
esac
