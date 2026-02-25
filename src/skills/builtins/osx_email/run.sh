#!/bin/bash
set -eu

ACTION="${1:-}"
if [ -z "$ACTION" ]; then
    echo '{"success":false,"error":"Usage: osx_email <fetch|list|permissive_read|send> [args...]"}'
    exit 1
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
EMAILS_DIR="${AGENT_WORKSPACE}/emails"
mkdir -p "$EMAILS_DIR"

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }
_jv() { v=$(printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1); printf '%s' "${v:-$3}"; }

# Helper: execute AppleScript via host proxy
run_applescript() {
    local script="$1"
    local payload
    payload=$(printf '{"script":"%s"}' "$(_esc "$script")")
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
        -d "$payload" \
        "${API_BASE}/host/execute_applescript"
}

# Helper: sanitize a string for use in filenames
sanitize_filename() {
    printf '%s' "$1" | tr -cs 'a-zA-Z0-9_-' '_' | head -c 50
}

# --- THREAT SCANNER ---
THREAT_COUNT=0
THREAT_DETAILS=""

scan_threats() {
    local file="$1"
    THREAT_COUNT=0
    THREAT_DETAILS=""

    local pi_patterns="<invoke|<system>|<system-reminder|ignore previous|ignore all previous|you are now|new instructions|disregard|forget your|override your|act as if|pretend you|from now on you|IMPORTANT:|URGENT:|CRITICAL:|do not follow"
    local html_patterns="<script|<iframe|<object|<embed|<applet|<form|<input|javascript:|vbscript:|on[a-z]+="
    local obfus_patterns="&#[0-9]+;|&#x[0-9a-fA-F]+;|%[0-9a-fA-F]{2}.*%[0-9a-fA-F]{2}|data:text/html|data:application"
    local attach_patterns="\.(exe|scr|bat|cmd|ps1|vbs|wsf|msi|dll|com|pif|hta|cpl|reg)[\"' \t,;)>]"

    local line_num=0
    local in_body=0
    while IFS= read -r line; do
        line_num=$((line_num + 1))
        if [ "$in_body" -eq 0 ]; then
            if [ "$line" = "---" ]; then
                in_body=1
            fi
            continue
        fi

        if printf '%s' "$line" | grep -iqE "$pi_patterns"; then
            THREAT_COUNT=$((THREAT_COUNT + 1))
            THREAT_DETAILS="${THREAT_DETAILS}Line ${line_num}: prompt_injection\n"
        fi
        if printf '%s' "$line" | grep -iqE "$html_patterns"; then
            THREAT_COUNT=$((THREAT_COUNT + 1))
            THREAT_DETAILS="${THREAT_DETAILS}Line ${line_num}: malicious_html_script\n"
        fi
        if printf '%s' "$line" | grep -iE "$obfus_patterns" >/dev/null 2>&1; then
            THREAT_COUNT=$((THREAT_COUNT + 1))
            THREAT_DETAILS="${THREAT_DETAILS}Line ${line_num}: obfuscated_content\n"
        fi
        if printf '%s' "$line" | grep -iE "$attach_patterns" >/dev/null 2>&1; then
            THREAT_COUNT=$((THREAT_COUNT + 1))
            THREAT_DETAILS="${THREAT_DETAILS}Line ${line_num}: dangerous_attachment_ref\n"
        fi
    done < "$file"
}

# --- ACTION: fetch ---
do_fetch() {
    local inbox="${2:-INBOX}"
    local limit="${3:-10}"

    local script
    script=$(cat <<'APPLESCRIPT_TEMPLATE'
tell application "Mail"
    set inboxName to "INBOX_PLACEHOLDER"
    set msgLimit to LIMIT_PLACEHOLDER
    set targetMailbox to missing value

    -- Find the mailbox
    repeat with acct in accounts
        repeat with mb in mailboxes of acct
            if name of mb is inboxName then
                set targetMailbox to mb
                exit repeat
            end if
        end repeat
        if targetMailbox is not missing value then exit repeat
    end repeat

    if targetMailbox is missing value then
        -- Fallback: use inbox
        set targetMailbox to inbox
    end if

    set msgList to messages 1 thru (minimum of {msgLimit, count of messages of targetMailbox}) of targetMailbox
    set output to ""

    repeat with msg in msgList
        set msgSender to sender of msg
        set msgSubject to subject of msg
        set msgDate to date received of msg as string
        set msgContent to content of msg
        set output to output & "===EMAIL_START===" & linefeed
        set output to output & "FROM:" & msgSender & linefeed
        set output to output & "SUBJECT:" & msgSubject & linefeed
        set output to output & "DATE:" & msgDate & linefeed
        set output to output & "BODY:" & linefeed & msgContent & linefeed
        set output to output & "===EMAIL_END===" & linefeed
    end repeat

    return output
end tell
APPLESCRIPT_TEMPLATE
)

    script=$(printf '%s' "$script" | sed "s/INBOX_PLACEHOLDER/$inbox/g" | sed "s/LIMIT_PLACEHOLDER/$limit/g")

    local result
    result=$(run_applescript "$script")

    local success
    success=$(printf '%s' "$result" | sed -n 's/.*"success"[[:space:]]*:[[:space:]]*\([a-z]*\).*/\1/p' | head -1)
    if [ "$success" != "true" ]; then
        echo "$result"
        exit 1
    fi

    local raw_output
    raw_output=$(_jv "$result" "stdout" "")

    if [ -z "$raw_output" ]; then
        echo '{"success":true,"message":"No emails found or Mail.app returned empty response.","emails":[]}'
        exit 0
    fi

    local today
    today=$(date +%Y-%m-%d)
    local idx=0
    local metadata_json="["

    local current_from="" current_subject="" current_date="" current_body="" in_email=0 in_body=0

    while IFS= read -r line; do
        if [ "$line" = "===EMAIL_START===" ]; then
            in_email=1
            in_body=0
            current_from=""
            current_subject=""
            current_date=""
            current_body=""
            continue
        fi

        if [ "$line" = "===EMAIL_END===" ]; then
            if [ "$in_email" -eq 1 ] && [ -n "$current_from" ]; then
                idx=$((idx + 1))
                local safe_from
                safe_from=$(sanitize_filename "$current_from")
                local safe_subject
                safe_subject=$(sanitize_filename "$current_subject")
                local filename="${today}_$(printf '%03d' "$idx")_from_${safe_from}_subject_${safe_subject}.txt"

                {
                    printf 'From: %s\n' "$current_from"
                    printf 'Subject: %s\n' "$current_subject"
                    printf 'Date: %s\n' "$current_date"
                    printf -- '---\n'
                    printf '%s\n' "$current_body"
                } > "${EMAILS_DIR}/${filename}"

                if [ "$idx" -gt 1 ]; then
                    metadata_json="${metadata_json},"
                fi
                metadata_json="${metadata_json}{\"index\":${idx},\"from\":\"$(_esc "$current_from")\",\"subject\":\"$(_esc "$current_subject")\",\"date\":\"$(_esc "$current_date")\",\"filename\":\"$(_esc "$filename")\"}"
            fi
            in_email=0
            in_body=0
            continue
        fi

        if [ "$in_email" -eq 1 ]; then
            case "$line" in
                FROM:*)
                    if [ "$in_body" -eq 0 ]; then
                        current_from="${line#FROM:}"
                        continue
                    fi
                    ;;
                SUBJECT:*)
                    if [ "$in_body" -eq 0 ]; then
                        current_subject="${line#SUBJECT:}"
                        continue
                    fi
                    ;;
                DATE:*)
                    if [ "$in_body" -eq 0 ]; then
                        current_date="${line#DATE:}"
                        continue
                    fi
                    ;;
                BODY:)
                    in_body=1
                    continue
                    ;;
            esac
            if [ "$in_body" -eq 1 ]; then
                if [ -n "$current_body" ]; then
                    current_body="${current_body}
${line}"
                else
                    current_body="$line"
                fi
            fi
        fi
    done <<< "$raw_output"

    metadata_json="${metadata_json}]"

    printf '{"success":true,"message":"Fetched %d emails. Content saved to agent workspace. Use permissive_read to safely read content.","emails":%s}\n' "$idx" "$metadata_json"
}

# --- ACTION: list ---
do_list() {
    if [ ! -d "$EMAILS_DIR" ] || [ -z "$(ls -A "$EMAILS_DIR" 2>/dev/null)" ]; then
        echo '{"success":true,"message":"No email files found. Run osx_email fetch first.","files":[]}'
        exit 0
    fi

    local files_json="["
    local first=1
    for f in "$EMAILS_DIR"/*.txt; do
        [ -f "$f" ] || continue
        local basename
        basename=$(basename "$f")
        local from subject date
        from=$(head -1 "$f" | sed 's/^From: //')
        subject=$(sed -n '2p' "$f" | sed 's/^Subject: //')
        date=$(sed -n '3p' "$f" | sed 's/^Date: //')

        if [ "$first" -eq 1 ]; then
            first=0
        else
            files_json="${files_json},"
        fi
        files_json="${files_json}{\"filename\":\"$(_esc "$basename")\",\"from\":\"$(_esc "$from")\",\"subject\":\"$(_esc "$subject")\",\"date\":\"$(_esc "$date")\"}"
    done
    files_json="${files_json}]"

    printf '{"success":true,"files":%s}\n' "$files_json"
}

# --- ACTION: permissive_read ---
do_permissive_read() {
    local filename="${2:-}"
    local dry_run="${3:-}"

    if [ -z "$filename" ]; then
        echo '{"success":false,"error":"Usage: osx_email permissive_read <filename> [--dry-run]"}'
        exit 1
    fi

    local filepath="${EMAILS_DIR}/${filename}"
    if [ ! -f "$filepath" ]; then
        echo '{"success":false,"error":"File not found: '"$filename"'. Use osx_email list to see available files."}'
        exit 1
    fi

    scan_threats "$filepath"

    if [ "$dry_run" = "--dry-run" ]; then
        local verdict="SAFE"
        if [ "$THREAT_COUNT" -gt 0 ]; then
            verdict="UNSAFE"
        fi
        local details_escaped
        details_escaped=$(printf '%b' "$THREAT_DETAILS" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}')
        printf '{"success":true,"mode":"dry-run","verdict":"%s","threat_count":%d,"threats":"%s","message":"Dry-run scan complete. No content returned."}\n' \
            "$verdict" "$THREAT_COUNT" "$details_escaped"
        exit 0
    fi

    if [ "$THREAT_COUNT" -eq 0 ]; then
        local content
        content=$(sed 's/<[^>]*>//g' "$filepath")
        local content_escaped
        content_escaped=$(_esc "$content")
        printf '{"success":true,"verdict":"SAFE","threat_count":0,"content":"%s"}\n' "$content_escaped"
    else
        local redacted=""
        local line_num=0
        local in_body=0
        while IFS= read -r line; do
            line_num=$((line_num + 1))
            if [ "$in_body" -eq 0 ]; then
                redacted="${redacted}${line}
"
                if [ "$line" = "---" ]; then
                    in_body=1
                fi
                continue
            fi

            local is_threat=0
            if printf '%s' "$line" | grep -iqE "<invoke|<system>|<system-reminder|ignore previous|ignore all previous|you are now|new instructions|disregard|forget your|override your|act as if|pretend you|from now on you|IMPORTANT:|URGENT:|CRITICAL:|do not follow"; then
                is_threat=1
            fi
            if printf '%s' "$line" | grep -iqE "<script|<iframe|<object|<embed|<applet|<form|<input|javascript:|vbscript:|on[a-z]+="; then
                is_threat=1
            fi
            if printf '%s' "$line" | grep -iE '&#[0-9]+;|&#x[0-9a-fA-F]+;|%[0-9a-fA-F]{2}.*%[0-9a-fA-F]{2}|data:text/html|data:application' >/dev/null 2>&1; then
                is_threat=1
            fi
            if printf '%s' "$line" | grep -iE '\.(exe|scr|bat|cmd|ps1|vbs|wsf|msi|dll|com|pif|hta|cpl|reg)["'"'"' \t,;)>]' >/dev/null 2>&1; then
                is_threat=1
            fi

            if [ "$is_threat" -eq 1 ]; then
                redacted="${redacted}[REDACTED line ${line_num}: potentially malicious content removed]
"
            else
                local clean_line
                clean_line=$(printf '%s' "$line" | sed 's/<[^>]*>//g')
                redacted="${redacted}${clean_line}
"
            fi
        done < "$filepath"

        local details_escaped
        details_escaped=$(printf '%b' "$THREAT_DETAILS" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}')
        local content_escaped
        content_escaped=$(_esc "$redacted")
        printf '{"success":true,"verdict":"UNSAFE","threat_count":%d,"threats":"%s","message":"Content returned with %d dangerous lines redacted.","content":"%s"}\n' \
            "$THREAT_COUNT" "$details_escaped" "$THREAT_COUNT" "$content_escaped"
    fi
}

# --- ACTION: send ---
do_send() {
    local to="${2:-}"
    local subject="${3:-}"
    local body="${4:-}"

    if [ -z "$to" ] || [ -z "$subject" ] || [ -z "$body" ]; then
        echo '{"success":false,"error":"Usage: osx_email send <to> <subject> <body>"}'
        exit 1
    fi

    local escaped_subject escaped_body escaped_to
    escaped_to=$(printf '%s' "$to" | sed 's/\\/\\\\/g; s/"/\\"/g')
    escaped_subject=$(printf '%s' "$subject" | sed 's/\\/\\\\/g; s/"/\\"/g')
    escaped_body=$(printf '%s' "$body" | sed 's/\\/\\\\/g; s/"/\\"/g')

    local script
    script=$(cat <<APPLESCRIPT_EOF
tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:"${escaped_subject}", content:"${escaped_body}", visible:true}
    tell newMessage
        make new to recipient at end of to recipients with properties {address:"${escaped_to}"}
    end tell
    send newMessage
end tell
APPLESCRIPT_EOF
)

    local result
    result=$(run_applescript "$script")

    local success
    success=$(printf '%s' "$result" | sed -n 's/.*"success"[[:space:]]*:[[:space:]]*\([a-z]*\).*/\1/p' | head -1)
    if [ "$success" = "true" ]; then
        printf '{"success":true,"message":"Email sent to %s with subject: %s"}\n' "$to" "$subject"
    else
        echo "$result"
        exit 1
    fi
}

# --- DISPATCH ---
case "$ACTION" in
    "fetch")
        do_fetch "$@"
        ;;
    "list")
        do_list
        ;;
    "permissive_read")
        do_permissive_read "$@"
        ;;
    "send")
        do_send "$@"
        ;;
    *)
        echo '{"success":false,"error":"Unknown action: '"$ACTION"'. Use fetch, list, permissive_read, or send."}'
        exit 1
        ;;
esac
