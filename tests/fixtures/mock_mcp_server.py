#!/usr/bin/env python3
"""Minimal MCP server for integration tests. Reads JSON-RPC from stdin, writes to stdout."""
import json
import sys

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = req.get("method", "")
        rid = req.get("id")
        if rid is None:
            # Notification, e.g. notifications/initialized
            continue
        if method == "initialize":
            out = {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "serverInfo": {"name": "mock", "version": "1.0"},
                },
            }
        elif method == "tools/list":
            out = {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "tools": [
                        {
                            "name": "echo",
                            "description": "Echo the input text",
                            "inputSchema": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}},
                            },
                        }
                    ]
                },
            }
        elif method == "tools/call":
            params = req.get("params", {})
            name = params.get("name", "")
            args = params.get("arguments", {})
            text = args.get("text", str(args)) if isinstance(args, dict) else str(args)
            out = {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "content": [{"type": "text", "text": f"echo: {text}"}],
                    "isError": False,
                },
            }
        else:
            out = {
                "jsonrpc": "2.0",
                "id": rid,
                "error": {"code": -32601, "message": "Method not found"},
            }
        print(json.dumps(out), flush=True)

if __name__ == "__main__":
    main()
