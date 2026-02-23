# Google Workspace

Comprehensive integration with Google Workspace services including Gmail, Google Drive, Google Calendar, Google Chat, Google Docs, and Google Sheets.

## Setup (Required)

Before using this skill, you must configure OAuth2 credentials:

1. **Create Google Cloud Project**: Go to https://console.cloud.google.com
2. **Enable APIs**: Enable Gmail API, Drive API, Calendar API, Chat API, Docs API, and Sheets API
3. **Create OAuth Client**: Go to APIs & Services → Credentials → Create Credentials → OAuth client ID → Desktop application
4. **Get Refresh Token**: Run the setup script:
   ```bash
   python3 ~/.moxxy/agents/<agent>/skills/google_workspace/setup_oauth.py --client-id YOUR_ID --client-secret YOUR_SECRET
   ```
5. **Store Credentials in Vault**:
   ```
   <invoke name="manage_vault">["set", "GOOGLE_CLIENT_ID", "your_client_id"]</invoke>
   <invoke name="manage_vault">["set", "GOOGLE_CLIENT_SECRET", "your_client_secret"]</invoke>
   <invoke name="manage_vault">["set", "GOOGLE_REFRESH_TOKEN", "your_refresh_token"]</invoke>
   ```

## Usage

```
google_workspace <service> <action> [arguments...]
```

## Gmail

### List emails
```
google_workspace gmail list [max_results] [label]
```
- `max_results`: Number of emails to return (default: 20)
- `label`: Filter by label (e.g., "INBOX", "UNREAD", "STARRED")

### Search emails
```
google_workspace gmail search "<query>"
```
- Supports Gmail search operators: `from:`, `to:`, `subject:`, `has:attachment`, etc.

### Read an email
```
google_workspace gmail read <message_id>
```

### Send an email
```
google_workspace gmail send "<to>" "<subject>" "<body>" [cc]
```

### Reply to an email
```
google_workspace gmail reply <message_id> "<body>"
```

### Manage labels
```
google_workspace gmail label <message_id> <add_labels> [remove_labels]
```
- Labels are comma-separated (e.g., "STARRED,IMPORTANT")

### Trash an email
```
google_workspace gmail trash <message_id>
```

### List all labels
```
google_workspace gmail labels
```

## Google Drive

### List files
```
google_workspace drive list [folder_id]
```
- `folder_id`: "root" for My Drive, or a specific folder ID

### Search files
```
google_workspace drive search "<query>"
```

### Get file metadata
```
google_workspace drive get <file_id>
```

### Download a file
```
google_workspace drive download <file_id> [output_path]
```
- Google Docs/Sheets/Slides are exported to PDF or Office formats

### Upload a file
```
google_workspace drive upload <file_path> [folder_id]
```

### Create a folder
```
google_workspace drive mkdir "<name>" [parent_id]
```

### Share a file
```
google_workspace drive share <file_id> <email> <role>
```
- `role`: "reader", "writer", "commenter", "owner"

### Move a file
```
google_workspace drive move <file_id> <new_folder_id>
```

### Delete a file
```
google_workspace drive delete <file_id>
```

## Google Calendar

### List events
```
google_workspace calendar list [max_results]
```

### Create an event
```
google_workspace calendar create "<summary>" "<start_time>" "<end_time>" [location] [description]
```
- Times in ISO 8601 format: `2024-01-15T10:00:00`

### Update an event
```
google_workspace calendar update <event_id> [summary] [start] [end] [location]
```

### Delete an event
```
google_workspace calendar delete <event_id>
```

### Check free/busy
```
google_workspace calendar freebusy <time_min> <time_max>
```

## Google Chat

### List spaces
```
google_workspace chat spaces
```

### Send a message
```
google_workspace chat send <space_name> "<message>"
```
- `space_name`: Format like "spaces/AAAAxxxxx"

### List messages in a space
```
google_workspace chat messages <space_name>
```

## Google Docs

### Create a document
```
google_workspace docs create "<title>" [content]
```

### Read a document
```
google_workspace docs read <document_id>
```

### Append to a document
```
google_workspace docs append <document_id> "<content>"
```

## Google Sheets

### Create a spreadsheet
```
google_workspace sheets create "<title>"
```

### Read data
```
google_workspace sheets read <spreadsheet_id> [range]
```
- `range`: e.g., "Sheet1!A1:D10" (default: "Sheet1")

### Write data
```
google_workspace sheets write <spreadsheet_id> <range> '<json_values>'
```
- `json_values`: JSON array of arrays, e.g., `[["Name","Age"],["Alice",30]]`

### Append data
```
google_workspace sheets append <spreadsheet_id> <range> '<json_values>'
```

### Clear data
```
google_workspace sheets clear <spreadsheet_id> <range>
```

## Examples

### Send an email
```
google_workspace gmail send "colleague@example.com" "Meeting Tomorrow" "Hi, let's meet at 2pm tomorrow."
```

### Search for emails from a sender
```
google_workspace gmail search "from:boss@company.com has:attachment"
```

### Upload a file to Drive
```
google_workspace drive upload "/path/to/report.pdf" "root"
```

### Share a document
```
google_workspace drive share "1BxiMVs0XRA5nFMdKvBdBZjGMUUqpt" "colleague@example.com" "writer"
```

### Create a calendar event
```
google_workspace calendar create "Team Standup" "2024-01-15T09:00:00" "2024-01-15T09:30:00" "Conference Room A"
```

### Append data to a sheet
```
google_workspace sheets append "1BxiMVs0XRA5nFMdKvBdBZjGMUUqpt" "Sheet1" '[["John", "Doe", "john@example.com"]]'
```

## Notes

- All actions return JSON responses with a `success` field
- IDs for files, messages, events, etc. can be found using list/search operations
- The skill automatically refreshes OAuth tokens as needed
- Google Docs/Sheets IDs are the alphanumeric string in the URL
