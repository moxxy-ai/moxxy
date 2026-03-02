# Git Primitives

Git primitives give agents full version control capabilities: initializing repos, cloning, branching, committing, pushing, creating pull requests, and managing worktrees. Several operations integrate with the vault for credential management.

## git.init

Initialize a new git repository.

**Parameters**:

```json
{
  "path": "my-project",
  "default_branch": "main"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | No | workspace root | Directory to initialize (relative to workspace) |
| `default_branch` | string | No | git default | Initial branch name |

## git.clone

Clone a repository into the workspace.

**Parameters**:

```json
{
  "url": "https://github.com/user/repo.git",
  "path": "repo",
  "branch": "main",
  "depth": 1
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | -- | Repository URL |
| `path` | string | No | derived from URL | Target directory (relative to workspace) |
| `branch` | string | No | default | Branch to checkout |
| `depth` | integer | No | full | Shallow clone depth |

**Vault integration**: For private repositories, the agent needs a `github-token` vault grant. The clone primitive injects the token into the URL for HTTPS authentication.

## git.status

Show the working tree status.

**Parameters**:

```json
{
  "path": "/workspace/my-project"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Path to the git repository |

**Result**:

```json
{
  "branch": "feature/auth-refactor",
  "modified": ["src/auth.rs", "src/lib.rs"],
  "untracked": ["src/new_file.rs"],
  "staged": ["src/auth.rs"]
}
```

Note: A file can appear in both `staged` and `modified` if it has staged changes and additional unstaged modifications.

## git.checkout

Switch or create branches.

**Parameters**:

```json
{
  "path": "/workspace/my-project",
  "branch": "feature/new-feature",
  "create": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Path to the git repository |
| `branch` | string | Yes | -- | Branch name |
| `create` | boolean | No | false | Create branch if it does not exist |

## git.commit

Stage files and create a commit. Stages all files (`git add -A`) when `files` is omitted.

**Parameters**:

```json
{
  "path": "/workspace/my-project",
  "message": "refactor: extract auth middleware",
  "files": ["src/auth.rs", "src/middleware.rs"]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Path to the git repository |
| `message` | string | Yes | -- | Commit message |
| `files` | string[] | No | all files | Specific files to stage (stages all if omitted) |

**Vault integration**: The commit primitive reads `github-user` and `github-email` from the vault to configure `user.name` and `user.email` for the commit.

## git.push

Push commits to a remote.

**Parameters**:

```json
{
  "path": "/workspace/my-project",
  "remote": "origin",
  "branch": "feature/auth-refactor",
  "force": false
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Path to the git repository |
| `remote` | string | No | `origin` | Remote name |
| `branch` | string | No | current | Branch to push |
| `force` | boolean | No | false | Force push |

**Vault integration**: For HTTPS remotes, the push primitive resolves `github-token` from the vault and injects it into the push URL for authentication. The token is never persisted in `.git/config`.

## git.fork

Fork a GitHub repository via the GitHub API.

**Parameters**:

```json
{
  "owner": "original-owner",
  "repo": "original-repo"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | Yes | Repository owner/organization |
| `repo` | string | Yes | Repository name |

**Vault integration**: Requires a `github-token` vault grant with repo scope.

## git.pr_create

Create a GitHub pull request. Infers owner/repo from the `origin` remote URL.

**Parameters**:

```json
{
  "path": "/workspace/my-project",
  "title": "refactor: extract auth middleware",
  "body": "This PR extracts the auth middleware into its own module.",
  "head": "feature/auth-refactor",
  "base": "main"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Path to the git repository |
| `title` | string | Yes | -- | PR title |
| `body` | string | No | empty | PR description |
| `base` | string | No | `main` | Target branch |
| `head` | string | No | current branch | Source branch |

**Vault integration**: Requires a `github-token` vault grant. Returns `AccessDenied` if the token is missing.

## git.worktree_add

Create a git worktree for parallel feature work.

**Parameters**:

```json
{
  "path": "/workspace/my-project",
  "branch": "feature/auth-refactor",
  "worktree_path": "custom/worktree/path",
  "create_branch": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Path to the main git repository |
| `branch` | string | Yes | -- | Branch name for the worktree |
| `worktree_path` | string | No | `{workspace}/.worktrees/{branch}` | Custom path for the worktree |
| `create_branch` | boolean | No | true | Create the branch if it doesn't exist |

## git.worktree_list

List all worktrees for a repository.

**Parameters**:

```json
{
  "path": "/workspace/my-project"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Path to the git repository |

**Result**:

```json
{
  "worktrees": [
    {"path": "/home/user/project", "branch": "refs/heads/main", "head": "abc123"},
    {"path": "/home/user/.worktrees/feature-auth", "branch": "refs/heads/feature-auth", "head": "def456"}
  ]
}
```

## git.worktree_remove

Remove a git worktree.

**Parameters**:

```json
{
  "path": "/workspace/my-project",
  "worktree_path": "/workspace/.worktrees/feature-auth",
  "force": false
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Path to the main git repository |
| `worktree_path` | string | Yes | -- | Path of the worktree to remove |
| `force` | boolean | No | false | Force removal even with uncommitted changes |

## Example Skill Declaration

A full git workflow skill:

```yaml
allowed_primitives:
  - git.init
  - git.clone
  - git.status
  - git.checkout
  - git.commit
  - git.push
  - git.pr_create
  - git.worktree_add
  - git.worktree_list
  - git.worktree_remove
  - fs.read
  - fs.write
safety_notes: "Full git workflow with push access. Requires github-token vault grant."
```
