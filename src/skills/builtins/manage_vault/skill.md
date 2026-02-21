# manage_vault

Use this skill to manage secrets in the agent's secure vault. This is useful for storing API keys, passwords, or other sensitive configuration.

### Usage
- `manage_vault list` - Lists all keys currently in the vault.
- `manage_vault get <key>` - Retrieves the value of the specified secret.
- `manage_vault set <key> <value>` - Saves or updates a secret in the vault.
- `manage_vault remove <key>` - Deletes a secret from the vault.

### Rules
- **CRITICAL: NEVER output the raw, unmasked secret value in your final response to the user.** 
- When you retrieve a secret using `manage_vault get <key>`, you will receive the raw value. 
- You MUST mask it (e.g., `sk-****123` or `********`) before sending it to the user in the chat.
- Only show the full secret if the user explicitly confirms they are in a secure environment and need the raw value for some reason (rare). Even then, prefer masking.
- `list` only returns keys, which is safe to show.
