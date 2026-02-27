#!/usr/bin/env bash

# Built-in Skill: git (local only)
# Adds managed worktree helpers for isolated multi-repo / multi-task workflows.
# For GitHub API actions (issues, PRs, forks), use the "github" skill instead.

set -euo pipefail

# Git identity from vault secrets (GIT_USER_NAME, GIT_USER_EMAIL)
export GIT_AUTHOR_NAME="${GIT_USER_NAME:-${AGENT_NAME:-MoxxyAgent}}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_AUTHOR_EMAIL="${GIT_USER_EMAIL:-${AGENT_NAME:-agent}@moxxy.local}"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

# Git HTTPS auth via GITHUB_TOKEN (for clone, fetch, push)
if [ -n "${GITHUB_TOKEN:-}" ]; then
    # Use askpass-style helper so token is injected into all HTTPS git operations
    _MOXXY_GIT_ASKPASS=$(mktemp)
    cat > "$_MOXXY_GIT_ASKPASS" <<'ASKPASS'
#!/bin/sh
echo "${GITHUB_TOKEN}"
ASKPASS
    chmod +x "$_MOXXY_GIT_ASKPASS"
    export GIT_ASKPASS="$_MOXXY_GIT_ASKPASS"
    export GIT_TERMINAL_PROMPT=0

    # Also configure credential helper for explicit push/fetch
    git config --global credential.https://github.com.username "x-access-token" 2>/dev/null || true
fi

if ! command -v git >/dev/null 2>&1; then
    echo "Error: 'git' is not installed on this system." >&2
    exit 1
fi

WORKSPACE_ROOT="${AGENT_WORKSPACE:-$(pwd)}"
STATE_DIR="${WORKSPACE_ROOT}/.moxxy-git"
REPOS_DIR="${STATE_DIR}/repos"
WORKTREES_DIR="${STATE_DIR}/worktrees"
ACTIVE_FILE="${STATE_DIR}/active-worktree"

ensure_state_dirs() {
    mkdir -p "$REPOS_DIR" "$WORKTREES_DIR"
}

slugify() {
    local raw="${1:-}"
    printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | \
        sed -E 's#[^a-z0-9._/-]+#-#g; s#/{2,}#/#g; s#(^[-/]+|[-/]+$)##g; s#/#__#g'
}

to_repo_url() {
    local input="$1"
    if [[ "$input" =~ ^https?:// ]] || [[ "$input" =~ ^git@ ]]; then
        printf '%s\n' "$input"
    elif [[ "$input" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
        printf 'https://github.com/%s.git\n' "$input"
    elif [ -d "$input" ]; then
        (
            cd "$input" && pwd -P
        )
    else
        printf '%s\n' "$input"
    fi
}

repo_id_from_input() {
    local input="$1"
    local normalized
    normalized=$(printf '%s' "$input" | sed -E 's#^[^:]+://##; s#^git@##; s#\.git$##; s#[:/]#/#g')
    slugify "$normalized"
}

is_git_repo() {
    local dir="$1"
    git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

set_active_worktree() {
    local target="$1"
    local resolved
    resolved=$(
        cd "$target" 2>/dev/null && pwd -P
    ) || return 1
    ensure_state_dirs
    printf '%s\n' "$resolved" > "$ACTIVE_FILE"
}

get_active_worktree() {
    [ -f "$ACTIVE_FILE" ] || return 1
    local target
    target=$(cat "$ACTIVE_FILE")
    [ -n "$target" ] || return 1
    is_git_repo "$target" || return 1
    printf '%s\n' "$target"
}

discover_single_worktree() {
    [ -d "$WORKTREES_DIR" ] || return 1
    local first=""
    local count=0
    local path=""
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        count=$((count + 1))
        if [ "$count" -eq 1 ]; then
            first="$path"
        fi
    done < <(find "$WORKTREES_DIR" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | sort)

    [ "$count" -eq 1 ] || return 1
    is_git_repo "$first" || return 1
    printf '%s\n' "$first"
}

sync_repo_mirror() {
    local repo_url="$1"
    local repo_id="$2"
    local bare_repo="${REPOS_DIR}/${repo_id}.git"

    if [ -d "$bare_repo" ]; then
        if ! git -C "$bare_repo" fetch --all --prune >/dev/null 2>&1; then
            if ! git -C "$bare_repo" fetch --all --prune; then
                echo "Error: could not fetch from '$repo_url'. Verify the repository exists and GITHUB_TOKEN is set in vault." >&2
                return 1
            fi
        fi
    else
        if ! git clone --bare "$repo_url" "$bare_repo" >/dev/null 2>&1; then
            if ! git clone --bare "$repo_url" "$bare_repo"; then
                echo "Error: could not clone '$repo_url'. Verify the repository exists and GITHUB_TOKEN is set in vault." >&2
                return 1
            fi
        fi
    fi
    printf '%s\n' "$bare_repo"
}

is_empty_repo() {
    local bare_repo="$1"
    # git show-ref exits 1 when no refs exist, which would crash under pipefail
    git -C "$bare_repo" show-ref >/dev/null 2>&1 && return 1 || return 0
}

resolve_base_ref() {
    local bare_repo="$1"
    local requested="${2:-}"

    # Empty repo: no refs exist at all
    if is_empty_repo "$bare_repo"; then
        printf '__EMPTY_REPO__\n'
        return 0
    fi

    if [ -n "$requested" ]; then
        if git -C "$bare_repo" show-ref --verify --quiet "refs/remotes/origin/${requested}"; then
            printf 'origin/%s\n' "$requested"
            return 0
        fi
        if git -C "$bare_repo" show-ref --verify --quiet "refs/heads/${requested}"; then
            printf '%s\n' "$requested"
            return 0
        fi
        echo "Error: base branch '$requested' not found in mirror." >&2
        return 1
    fi

    local head_ref
    head_ref=$(git -C "$bare_repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
    if [ -n "$head_ref" ]; then
        printf '%s\n' "$head_ref"
        return 0
    fi

    for candidate in origin/main origin/master; do
        if git -C "$bare_repo" show-ref --verify --quiet "refs/remotes/${candidate}"; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    local first_remote
    first_remote=$(git -C "$bare_repo" for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v '^origin/HEAD$' | head -n1 || true)
    if [ -n "$first_remote" ]; then
        printf '%s\n' "$first_remote"
        return 0
    fi

    echo "Error: could not determine a base reference for new worktree." >&2
    return 1
}

find_worktree_target() {
    local target="$1"
    local resolved=""

    if [ -d "$target" ] && is_git_repo "$target"; then
        resolved=$(
            cd "$target" && pwd -P
        )
        printf '%s\n' "$resolved"
        return 0
    fi

    if [ -n "${AGENT_WORKSPACE:-}" ] && [ -d "${AGENT_WORKSPACE}/${target}" ] && is_git_repo "${AGENT_WORKSPACE}/${target}"; then
        resolved=$(
            cd "${AGENT_WORKSPACE}/${target}" && pwd -P
        )
        printf '%s\n' "$resolved"
        return 0
    fi

    [ -d "$WORKTREES_DIR" ] || return 1
    local first=""
    local count=0
    local path=""
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        count=$((count + 1))
        if [ "$count" -eq 1 ]; then
            first="$path"
        fi
    done < <(find "$WORKTREES_DIR" -mindepth 2 -maxdepth 2 -type d -name "$target" 2>/dev/null | sort)

    if [ "$count" -eq 1 ]; then
        printf '%s\n' "$first"
        return 0
    fi
    if [ "$count" -gt 1 ]; then
        echo "Error: multiple worktrees match '$target'. Use an explicit path." >&2
        return 1
    fi

    # Prefix match: e.g. "companion" matches "companion-20260227-004030"
    first=""
    count=0
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        count=$((count + 1))
        if [ "$count" -eq 1 ]; then
            first="$path"
        fi
    done < <(find "$WORKTREES_DIR" -mindepth 2 -maxdepth 2 -type d -name "${target}*" 2>/dev/null | sort)
    if [ "$count" -eq 1 ] && [ -n "$first" ] && is_git_repo "$first"; then
        printf '%s\n' "$first"
        return 0
    fi
    if [ "$count" -gt 1 ]; then
        echo "Error: multiple worktrees match prefix '$target'. Use an explicit path or more specific name." >&2
    fi
    return 1
}

print_ws_help() {
    cat <<'EOF'
Usage:
  git ws init <repo> [base_branch] [task_name]
  git init <owner/repo> [base_branch] [task_name]   # shorthand for ws init
  git ws list
  git ws use <worktree_path_or_name>
  git ws active

Examples:
  git ws init moxxy-ai/moxxy main fix-telemetry
  git init moxxy-ai/moxxy main fix-telemetry
  git ws list
  git ws use fix-telemetry-20260225-103000
  git status
EOF
}

handle_ws_command() {
    local sub="${1:-help}"
    [ "$#" -gt 0 ] && shift

    ensure_state_dirs

    case "$sub" in
        init)
            local repo_input="${1:-}"
            local base_branch="${2:-}"
            local task_name="${3:-task}"

            if [ -z "$repo_input" ]; then
                echo "Usage: git ws init <repo> [base_branch] [task_name]" >&2
                exit 1
            fi

            local repo_url
            repo_url=$(to_repo_url "$repo_input")
            local repo_id
            repo_id=$(repo_id_from_input "$repo_input")
            if [ -z "$repo_id" ]; then
                echo "Error: could not derive repository identifier from '$repo_input'." >&2
                exit 1
            fi

            local bare_repo
            bare_repo=$(sync_repo_mirror "$repo_url" "$repo_id")
            local base_ref
            base_ref=$(resolve_base_ref "$bare_repo" "$base_branch")

            local task_slug
            task_slug=$(slugify "$task_name")
            [ -n "$task_slug" ] || task_slug="task"

            local ts
            ts=$(date +%Y%m%d-%H%M%S)
            local worktree_name="${task_slug}-${ts}"
            local worktree_dir="${WORKTREES_DIR}/${repo_id}/${worktree_name}"
            mkdir -p "${WORKTREES_DIR}/${repo_id}"

            local branch_name="moxxy/${task_slug}-${ts}"

            if [ "$base_ref" = "__EMPTY_REPO__" ]; then
                # Empty repo: clone normally and create orphan branch
                git clone "$repo_url" "$worktree_dir" 2>/dev/null || git clone "$repo_url" "$worktree_dir"
                git -C "$worktree_dir" checkout --orphan "$branch_name" 2>/dev/null || \
                    git -C "$worktree_dir" checkout --orphan "$branch_name"
                base_ref="(empty repo - orphan branch)"
            else
                git -C "$bare_repo" worktree add "$worktree_dir" "$base_ref" >/dev/null 2>&1 || \
                    git -C "$bare_repo" worktree add "$worktree_dir" "$base_ref"

                if ! git -C "$worktree_dir" checkout -b "$branch_name" >/dev/null 2>&1; then
                    branch_name="moxxy/${task_slug}-${ts}-${RANDOM}"
                    git -C "$worktree_dir" checkout -b "$branch_name" >/dev/null 2>&1 || \
                        git -C "$worktree_dir" checkout -b "$branch_name"
                fi
            fi

            set_active_worktree "$worktree_dir"
            local active_worktree
            active_worktree=$(get_active_worktree)

            echo "Initialized isolated worktree."
            echo "repo: $repo_input"
            echo "base: $base_ref"
            echo "branch: $branch_name"
            echo "path: $active_worktree"
            ;;

        list)
            local active=""
            active=$(get_active_worktree 2>/dev/null || true)
            local found_any=0
            local path=""
            while IFS= read -r path; do
                [ -n "$path" ] || continue
                found_any=1
                local resolved_path="$path"
                resolved_path=$(
                    cd "$path" 2>/dev/null && pwd -P
                ) || resolved_path="$path"
                local marker=" "
                if [ -n "$active" ] && [ "$resolved_path" = "$active" ]; then
                    marker="*"
                fi
                echo "${marker} ${resolved_path}"
            done < <(find "$WORKTREES_DIR" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | sort)

            if [ "$found_any" -eq 0 ]; then
                echo "No managed worktrees found."
            fi
            ;;

        use)
            local target="${1:-}"
            if [ -z "$target" ]; then
                echo "Usage: git ws use <worktree_path_or_name>" >&2
                exit 1
            fi

            local resolved
            resolved=$(find_worktree_target "$target") || {
                echo "Error: worktree not found: $target" >&2
                exit 1
            }

            set_active_worktree "$resolved"
            echo "Active worktree: $resolved"
            ;;

        active)
            local active
            active=$(get_active_worktree) || {
                echo "No active worktree. Use 'git ws init ...' or 'git ws use ...' first." >&2
                exit 1
            }
            echo "$active"
            ;;

        help|--help|-h|"")
            print_ws_help
            ;;

        *)
            echo "Unknown ws command: $sub" >&2
            print_ws_help
            exit 1
            ;;
    esac
}

run_git_with_active_context() {
    local active=""
    local cmd="${1:-}"

    # Repo-independent git commands can run directly from workspace root.
    case "$cmd" in
        ""|help|--help|version|--version|clone|init|ls-remote)
            cd "$WORKSPACE_ROOT"
            exec git "$@"
            ;;
    esac

    if [ "$cmd" = "config" ]; then
        case "${2:-}" in
            --global|--system)
                cd "$WORKSPACE_ROOT"
                exec git "$@"
                ;;
        esac
    fi

    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        exec git "$@"
    fi

    active=$(get_active_worktree 2>/dev/null || true)
    if [ -n "$active" ]; then
        exec git -C "$active" "$@"
    fi

    active=$(discover_single_worktree 2>/dev/null || true)
    if [ -n "$active" ]; then
        set_active_worktree "$active" || true
        exec git -C "$active" "$@"
    fi

    if [ -n "${AGENT_WORKSPACE:-}" ] && is_git_repo "$AGENT_WORKSPACE"; then
        exec git -C "$AGENT_WORKSPACE" "$@"
    fi

    echo "Error: no active repository context." >&2
    echo "Initialize a worktree first: git ws init <owner/repo> [base_branch] [task_name]" >&2
    echo "Or run git with an explicit path: git -C <repo_path> <command>" >&2
    exit 1
}

if [ "${1:-}" = "ws" ]; then
    shift
    handle_ws_command "$@"
    exit $?
fi

# Alias: git init owner/repo [base] [task] -> git ws init owner/repo [base] [task]
if [ "${1:-}" = "init" ] && [ -n "${2:-}" ] && [[ "${2}" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
    shift
    handle_ws_command init "$@"
    exit $?
fi

if [ "${1:-}" = "-C" ] && [ "$#" -ge 2 ]; then
    target_dir="$2"
    if git "$@"; then
        if is_git_repo "$target_dir"; then
            set_active_worktree "$target_dir" || true
        fi
        exit 0
    fi
    exit $?
fi

run_git_with_active_context "$@"
