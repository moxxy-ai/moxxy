#!/bin/bash
if [ -z "$1" ]; then
    echo "Usage: web_crawler <URL>"
    exit 1
fi

URL="$1"
DIR=$(dirname "$0")

# Strategy 1: Use existing local venv with Playwright
if [ -d "$DIR/venv" ] && [ -f "$DIR/venv/bin/python3" ]; then
    OUTPUT=$("$DIR/venv/bin/python3" "$DIR/crawler.py" "$URL" 2>&1)
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ] && [ -n "$OUTPUT" ]; then
        echo "$OUTPUT"
        exit 0
    fi
    echo "Playwright venv execution failed (exit=$EXIT_CODE), trying fallback..." >&2
fi

# Strategy 2: Set up venv if setup script exists and venv is missing
if [ ! -d "$DIR/venv" ] && [ -f "$DIR/setup_venv.sh" ]; then
    echo "Setting up Playwright venv..." >&2
    bash "$DIR/setup_venv.sh" >&2
    if [ -d "$DIR/venv" ] && [ -f "$DIR/venv/bin/python3" ]; then
        OUTPUT=$("$DIR/venv/bin/python3" "$DIR/crawler.py" "$URL" 2>&1)
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 0 ] && [ -n "$OUTPUT" ]; then
            echo "$OUTPUT"
            exit 0
        fi
        echo "Playwright execution after setup failed (exit=$EXIT_CODE), trying fallback..." >&2
    else
        echo "Venv setup failed, trying fallback..." >&2
    fi
fi

# Strategy 3: Lightweight fallback using Python stdlib (no external deps)
# This handles non-JS pages reliably
BROWSE_SKILL_DIR="$DIR/../browse_network"
if [ -f "$BROWSE_SKILL_DIR/fetch.py" ]; then
    python3 "$BROWSE_SKILL_DIR/fetch.py" "$URL"
    exit $?
fi

# Strategy 4: Inline curl fallback (absolute last resort)
echo "--- CONTENT FOR $URL (curl fallback) ---"
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" \
    --max-time 30 "$URL" | \
    python3 -c "
import sys, re
from html.parser import HTMLParser

class Strip(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.skip = 0
    def handle_starttag(self, tag, a):
        if tag in ('script','style','noscript','head','svg'): self.skip += 1
        elif tag in ('p','div','br','h1','h2','h3','h4','h5','h6','li','tr'): self.text.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','noscript','head','svg'): self.skip -= 1
        elif tag in ('p','div','h1','h2','h3','h4','h5','h6'): self.text.append('\n')
    def handle_data(self, d):
        if not self.skip: self.text.append(d)
    def result(self):
        t = ''.join(self.text)
        t = re.sub(r'\n{3,}', '\n\n', t)
        return t.strip()[:15000]

s = Strip()
s.feed(sys.stdin.read())
print(s.result())
" 2>/dev/null

exit $?
