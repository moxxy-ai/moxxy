#!/usr/bin/env bash

# Built-in Skill: file_ops
# Structured file manipulation for development workflows.
# Operations: read, write, patch, append, ls, mkdir, tree

ACTION="${1:-}"

case "$ACTION" in
    read)
        FILE="${2:-}"
        if [ -z "$FILE" ]; then
            echo "Usage: file_ops read <path> [start_line] [end_line]"
            exit 1
        fi
        if [ ! -f "$FILE" ]; then
            echo "Error: file not found: $FILE"
            exit 1
        fi
        START="${3:-}"
        END="${4:-}"
        if [ -n "$START" ] && [ -n "$END" ]; then
            sed -n "${START},${END}p" "$FILE"
        elif [ -n "$START" ]; then
            sed -n "${START},\$p" "$FILE"
        else
            cat "$FILE"
        fi
        ;;

    write)
        FILE="${2:-}"
        CONTENT="${3:-}"
        if [ -z "$FILE" ] || [ -z "$CONTENT" ]; then
            echo "Usage: file_ops write <path> <content>"
            exit 1
        fi
        # Create parent directories if needed
        mkdir -p "$(dirname "$FILE")"
        printf '%s' "$CONTENT" > "$FILE"
        echo "Written $(wc -c < "$FILE" | tr -d ' ') bytes to $FILE"
        ;;

    patch)
        FILE="${2:-}"
        SEARCH="${3:-}"
        REPLACE="${4:-}"
        if [ -z "$FILE" ] || [ -z "$SEARCH" ]; then
            echo "Usage: file_ops patch <path> <search_string> <replace_string>"
            exit 1
        fi
        if [ ! -f "$FILE" ]; then
            echo "Error: file not found: $FILE"
            exit 1
        fi
        # Use python3 for reliable find-and-replace (handles special chars safely)
        python3 -c "
import sys
with open(sys.argv[1], 'r') as f:
    content = f.read()
search = sys.argv[2]
replace = sys.argv[3] if len(sys.argv) > 3 else ''
if search not in content:
    print('Error: search string not found in file')
    sys.exit(1)
new_content = content.replace(search, replace, 1)
with open(sys.argv[1], 'w') as f:
    f.write(new_content)
print('Patched successfully')
" "$FILE" "$SEARCH" "${REPLACE:-}"
        ;;

    append)
        FILE="${2:-}"
        CONTENT="${3:-}"
        if [ -z "$FILE" ] || [ -z "$CONTENT" ]; then
            echo "Usage: file_ops append <path> <content>"
            exit 1
        fi
        mkdir -p "$(dirname "$FILE")"
        printf '%s' "$CONTENT" >> "$FILE"
        echo "Appended to $FILE"
        ;;

    ls)
        DIR="${2:-.}"
        if [ ! -d "$DIR" ]; then
            echo "Error: directory not found: $DIR"
            exit 1
        fi
        ls -la "$DIR"
        ;;

    mkdir)
        DIR="${2:-}"
        if [ -z "$DIR" ]; then
            echo "Usage: file_ops mkdir <path>"
            exit 1
        fi
        mkdir -p "$DIR"
        echo "Created directory: $DIR"
        ;;

    tree)
        DIR="${2:-.}"
        DEPTH="${3:-3}"
        if [ ! -d "$DIR" ]; then
            echo "Error: directory not found: $DIR"
            exit 1
        fi
        if command -v tree &>/dev/null; then
            tree -L "$DEPTH" "$DIR"
        else
            # Fallback if tree is not installed
            find "$DIR" -maxdepth "$DEPTH" -print | head -200
        fi
        ;;

    *)
        echo "Unknown action: $ACTION"
        echo ""
        echo "Available actions: read, write, patch, append, ls, mkdir, tree"
        echo ""
        echo "Usage:"
        echo "  file_ops read <path> [start_line] [end_line]"
        echo "  file_ops write <path> <content>"
        echo "  file_ops patch <path> <search> <replace>"
        echo "  file_ops append <path> <content>"
        echo "  file_ops ls [path]"
        echo "  file_ops mkdir <path>"
        echo "  file_ops tree [path] [depth]"
        exit 1
        ;;
esac
