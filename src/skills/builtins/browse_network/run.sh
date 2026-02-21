#!/bin/bash
if [ -z "$1" ]; then
    echo "Usage: browse_network <URL>"
    exit 1
fi

URL="$1"
DIR=$(dirname "$0")

python3 "$DIR/fetch.py" "$URL"
