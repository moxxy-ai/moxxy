#!/usr/bin/env python3
"""
Google Workspace Skill - Comprehensive integration with Google services.
Supports Gmail, Drive, Calendar, Chat, Docs, and Sheets.
"""

import json
import os
import sys
import base64
import mimetypes
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Any

try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
except ImportError:
    print("Error: Google API libraries not installed.")
    print("Run: pip install google-auth google-auth-oauthlib google-api-python-client")
    sys.exit(1)

SCOPES = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/chat.messages',
    'https://www.googleapis.com/auth/chat.spaces',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
]

TOKEN_CACHE_DIR = Path.home() / '.moxxy' / 'google_tokens'


def get_credentials() -> Credentials:
    """Get valid Google OAuth2 credentials from vault env vars."""
    client_id = os.environ.get('GOOGLE_CLIENT_ID')
    client_secret = os.environ.get('GOOGLE_CLIENT_SECRET')
    refresh_token = os.environ.get('GOOGLE_REFRESH_TOKEN')

    if not all([client_id, client_secret, refresh_token]):
        print("Error: Missing Google OAuth credentials in vault.")
        print("Required vault keys:")
        print("  - GOOGLE_CLIENT_ID")
        print("  - GOOGLE_CLIENT_SECRET")
        print("  - GOOGLE_REFRESH_TOKEN")
        print("\nTo obtain these:")
        print("  1. Go to https://console.cloud.google.com/apis/credentials")
        print("  2. Create OAuth 2.0 Client ID (Desktop app)")
        print("  3. Run the setup_oauth.py script to get a refresh token")
        sys.exit(1)

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri='https://oauth2.googleapis.com/token',
        client_id=client_id,
        client_secret=client_secret,
        scopes=SCOPES,
    )

    creds.refresh(Request())
    return creds


def get_service(name: str, version: str, creds: Credentials):
    """Build and return a Google API service client."""
    return build(name, version, credentials=creds)


# ============================================================================
# GMAIL ACTIONS
# ============================================================================

def gmail_list(service, max_results: int = 20, label: str = None, query: str = None) -> dict:
    """List emails in inbox or specified label."""
    try:
        params = {'userId': 'me', 'maxResults': max_results}
        if label:
            params['labelIds'] = [label]
        if query:
            params['q'] = query

        results = service.users().messages().list(**params).execute()
        messages = results.get('messages', [])

        email_list = []
        for msg in messages:
            detail = service.users().messages().get(userId='me', id=msg['id'], format='metadata').execute()
            headers = {h['name']: h['value'] for h in detail.get('payload', {}).get('headers', [])}
            email_list.append({
                'id': msg['id'],
                'threadId': detail.get('threadId'),
                'subject': headers.get('Subject', '(No subject)'),
                'from': headers.get('From', ''),
                'to': headers.get('To', ''),
                'date': headers.get('Date', ''),
                'snippet': detail.get('snippet', '')[:200],
                'labelIds': detail.get('labelIds', []),
                'unread': 'UNREAD' in detail.get('labelIds', []),
            })

        return {'success': True, 'count': len(email_list), 'emails': email_list}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def gmail_read(service, message_id: str) -> dict:
    """Read a specific email by ID."""
    try:
        msg = service.users().messages().get(userId='me', id=message_id, format='full').execute()
        headers = {h['name']: h['value'] for h in msg.get('payload', {}).get('headers', [])}

        body = ''
        payload = msg.get('payload', {})
        if 'body' in payload and 'data' in payload['body']:
            body = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='ignore')
        elif 'parts' in payload:
            for part in payload['parts']:
                if part.get('mimeType') == 'text/plain' and 'data' in part.get('body', {}):
                    body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                    break

        return {
            'success': True,
            'email': {
                'id': msg['id'],
                'threadId': msg.get('threadId'),
                'subject': headers.get('Subject', '(No subject)'),
                'from': headers.get('From', ''),
                'to': headers.get('To', ''),
                'cc': headers.get('Cc', ''),
                'date': headers.get('Date', ''),
                'body': body,
                'snippet': msg.get('snippet', ''),
                'labelIds': msg.get('labelIds', []),
            }
        }
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def gmail_send(service, to: str, subject: str, body: str, cc: str = None, bcc: str = None, html: bool = False) -> dict:
    """Send an email."""
    try:
        message_lines = [f"To: {to}"]
        if cc:
            message_lines.append(f"Cc: {cc}")
        if bcc:
            message_lines.append(f"Bcc: {bcc}")
        message_lines.append(f"Subject: {subject}")

        content_type = 'text/html' if html else 'text/plain'
        message_lines.append(f"Content-Type: {content_type}; charset=utf-8")
        message_lines.append("")
        message_lines.append(body)

        raw_message = '\r\n'.join(message_lines)
        encoded_message = base64.urlsafe_b64encode(raw_message.encode('utf-8')).decode('utf-8')

        result = service.users().messages().send(userId='me', body={'raw': encoded_message}).execute()
        return {'success': True, 'messageId': result['id'], 'threadId': result.get('threadId')}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def gmail_search(service, query: str, max_results: int = 20) -> dict:
    """Search emails with a query."""
    return gmail_list(service, max_results=max_results, query=query)


def gmail_label(service, message_id: str, add_labels: list = None, remove_labels: list = None) -> dict:
    """Add or remove labels from an email."""
    try:
        body = {}
        if add_labels:
            body['addLabelIds'] = add_labels
        if remove_labels:
            body['removeLabelIds'] = remove_labels

        result = service.users().messages().modify(userId='me', id=message_id, body=body).execute()
        return {'success': True, 'messageId': message_id, 'labelIds': result.get('labelIds', [])}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def gmail_trash(service, message_id: str) -> dict:
    """Move an email to trash."""
    try:
        service.users().messages().trash(userId='me', id=message_id).execute()
        return {'success': True, 'messageId': message_id}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def gmail_labels(service) -> dict:
    """List all labels."""
    try:
        results = service.users().labels().list(userId='me').execute()
        labels = results.get('labels', [])
        return {'success': True, 'labels': [{'id': l['id'], 'name': l['name'], 'type': l['type']} for l in labels]}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def gmail_reply(service, message_id: str, body: str, reply_all: bool = False) -> dict:
    """Reply to an email."""
    try:
        original = service.users().messages().get(userId='me', id=message_id, format='metadata').execute()
        headers = {h['name']: h['value'] for h in original.get('payload', {}).get('headers', [])}

        to = headers.get('From', '')
        subject = headers.get('Subject', '')
        if not subject.startswith('Re:'):
            subject = f"Re: {subject}"
        cc = headers.get('Cc') if reply_all else None

        return gmail_send(service, to=to, subject=subject, body=body, cc=cc)
    except HttpError as e:
        return {'success': False, 'error': str(e)}


# ============================================================================
# DRIVE ACTIONS
# ============================================================================

def drive_list(service, folder_id: str = 'root', query: str = None, page_size: int = 50) -> dict:
    """List files in Google Drive."""
    try:
        q = f"'{folder_id}' in parents and trashed = false"
        if query:
            q = f"{q} and {query}"

        results = service.files().list(
            pageSize=page_size,
            q=q,
            fields="nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, parents)"
        ).execute()

        files = results.get('files', [])
        return {
            'success': True,
            'count': len(files),
            'files': files
        }
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def drive_search(service, query: str, page_size: int = 50) -> dict:
    """Search files in Drive."""
    try:
        q = f"name contains '{query}' and trashed = false"
        results = service.files().list(
            pageSize=page_size,
            q=q,
            fields="nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)"
        ).execute()

        files = results.get('files', [])
        return {'success': True, 'count': len(files), 'files': files}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def drive_get(service, file_id: str) -> dict:
    """Get file metadata."""
    try:
        file = service.files().get(fileId=file_id, fields='id, name, mimeType, size, modifiedTime, createdTime, webViewLink, parents, owners').execute()
        return {'success': True, 'file': file}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def drive_download(service, file_id: str, output_path: str = None) -> dict:
    """Download a file from Drive."""
    try:
        file_metadata = service.files().get(fileId=file_id).execute()
        file_name = file_metadata['name']
        mime_type = file_metadata['mimeType']

        if output_path is None:
            output_path = file_name

        if 'google-apps' in mime_type:
            export_map = {
                'application/vnd.google-apps.document': 'application/pdf',
                'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.google-apps.presentation': 'application/pdf',
            }
            export_mime = export_map.get(mime_type, 'application/pdf')
            request = service.files().export_media(fileId=file_id, mimeType=export_mime)
        else:
            request = service.files().get_media(fileId=file_id)

        import io
        fh = io.FileIO(output_path, 'wb')
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        return {'success': True, 'file': file_name, 'saved_to': output_path}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def drive_upload(service, file_path: str, folder_id: str = 'root', name: str = None) -> dict:
    """Upload a file to Drive."""
    try:
        if not os.path.exists(file_path):
            return {'success': False, 'error': f'File not found: {file_path}'}

        file_name = name or os.path.basename(file_path)
        mime_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'

        file_metadata = {'name': file_name, 'parents': [folder_id]}
        media = MediaFileUpload(file_path, mimetype=mime_type)

        file = service.files().create(body=file_metadata, media_body=media, fields='id, name, webViewLink').execute()
        return {'success': True, 'file': file}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def drive_create_folder(service, name: str, parent_id: str = 'root') -> dict:
    """Create a new folder."""
    try:
        file_metadata = {
            'name': name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }
        file = service.files().create(body=file_metadata, fields='id, name, webViewLink').execute()
        return {'success': True, 'folder': file}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def drive_share(service, file_id: str, email: str, role: str = 'reader', send_notification: bool = True) -> dict:
    """Share a file with someone."""
    try:
        permission = {
            'type': 'user',
            'role': role,
            'emailAddress': email,
        }
        result = service.permissions().create(
            fileId=file_id,
            body=permission,
            sendNotificationEmail=send_notification,
            fields='id, role, emailAddress'
        ).execute()
        return {'success': True, 'permission': result}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def drive_delete(service, file_id: str) -> dict:
    """Delete/trash a file."""
    try:
        service.files().delete(fileId=file_id).execute()
        return {'success': True, 'fileId': file_id}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def drive_move(service, file_id: str, new_folder_id: str) -> dict:
    """Move a file to a different folder."""
    try:
        file = service.files().get(fileId=file_id, fields='parents').execute()
        previous_parents = ','.join(file.get('parents', []))
        file = service.files().update(
            fileId=file_id,
            addParents=new_folder_id,
            removeParents=previous_parents,
            fields='id, parents'
        ).execute()
        return {'success': True, 'fileId': file_id}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


# ============================================================================
# CALENDAR ACTIONS
# ============================================================================

def calendar_list(service, max_results: int = 20, time_min: str = None, time_max: str = None, calendar_id: str = 'primary') -> dict:
    """List upcoming events."""
    try:
        now = datetime.utcnow()
        if time_min is None:
            time_min = now.isoformat() + 'Z'
        if time_max is None:
            time_max = (now + timedelta(days=30)).isoformat() + 'Z'

        events_result = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            maxResults=max_results,
            singleEvents=True,
            orderBy='startTime'
        ).execute()

        events = events_result.get('items', [])
        event_list = []
        for event in events:
            event_list.append({
                'id': event['id'],
                'summary': event.get('summary', '(No title)'),
                'start': event.get('start', {}),
                'end': event.get('end', {}),
                'location': event.get('location', ''),
                'description': event.get('description', ''),
                'attendees': [a.get('email') for a in event.get('attendees', [])],
                'hangoutLink': event.get('hangoutLink'),
                'htmlLink': event.get('htmlLink'),
            })

        return {'success': True, 'count': len(event_list), 'events': event_list}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def calendar_create(service, summary: str, start_time: str, end_time: str = None,
                    description: str = None, location: str = None, attendees: list = None,
                    calendar_id: str = 'primary') -> dict:
    """Create a new event."""
    try:
        event = {
            'summary': summary,
            'start': {'dateTime': start_time, 'timeZone': 'UTC'},
            'end': {'dateTime': end_time or start_time, 'timeZone': 'UTC'},
        }

        if description:
            event['description'] = description
        if location:
            event['location'] = location
        if attendees:
            event['attendees'] = [{'email': email} for email in attendees]

        result = service.events().insert(calendarId=calendar_id, body=event).execute()
        return {
            'success': True,
            'event': {
                'id': result['id'],
                'htmlLink': result.get('htmlLink'),
                'summary': result.get('summary'),
            }
        }
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def calendar_update(service, event_id: str, summary: str = None, start_time: str = None,
                    end_time: str = None, description: str = None, location: str = None,
                    calendar_id: str = 'primary') -> dict:
    """Update an existing event."""
    try:
        event = service.events().get(calendarId=calendar_id, eventId=event_id).execute()

        if summary:
            event['summary'] = summary
        if start_time:
            event['start'] = {'dateTime': start_time, 'timeZone': 'UTC'}
        if end_time:
            event['end'] = {'dateTime': end_time, 'timeZone': 'UTC'}
        if description:
            event['description'] = description
        if location:
            event['location'] = location

        result = service.events().update(calendarId=calendar_id, eventId=event_id, body=event).execute()
        return {'success': True, 'event': {'id': result['id'], 'htmlLink': result.get('htmlLink')}}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def calendar_delete(service, event_id: str, calendar_id: str = 'primary') -> dict:
    """Delete an event."""
    try:
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
        return {'success': True, 'eventId': event_id}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def calendar_freebusy(service, time_min: str, time_max: str, calendar_ids: list = None) -> dict:
    """Check free/busy status."""
    try:
        body = {
            'timeMin': time_min,
            'timeMax': time_max,
            'items': [{'id': cid} for cid in (calendar_ids or ['primary'])]
        }
        result = service.freebusy().query(body=body).execute()
        return {'success': True, 'calendars': result.get('calendars', {})}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


# ============================================================================
# CHAT (HANGOUTS) ACTIONS
# ============================================================================

def chat_list_spaces(service, page_size: int = 50) -> dict:
    """List all chat spaces."""
    try:
        results = service.spaces().list(pageSize=page_size).execute()
        spaces = results.get('spaces', [])
        return {
            'success': True,
            'count': len(spaces),
            'spaces': [{'name': s['name'], 'displayName': s.get('displayName', ''), 'type': s.get('type', '')} for s in spaces]
        }
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def chat_send(service, space_name: str, message: str, thread_key: str = None) -> dict:
    """Send a message to a space."""
    try:
        body = {'text': message}
        params = {'parent': space_name, 'body': body}
        if thread_key:
            params['threadKey'] = thread_key

        result = service.spaces().messages().create(**params).execute()
        return {'success': True, 'message': {'name': result['name'], 'text': result.get('text', '')}}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def chat_list_messages(service, space_name: str, page_size: int = 50) -> dict:
    """List messages in a space."""
    try:
        results = service.spaces().messages().list(parent=space_name, pageSize=page_size).execute()
        messages = results.get('messages', [])
        return {
            'success': True,
            'count': len(messages),
            'messages': [{'name': m['name'], 'text': m.get('text', ''), 'createTime': m.get('createTime')} for m in messages]
        }
    except HttpError as e:
        return {'success': False, 'error': str(e)}


# ============================================================================
# DOCS ACTIONS
# ============================================================================

def docs_create(service, title: str, content: str = None) -> dict:
    """Create a new Google Doc."""
    try:
        body = {'title': title}
        doc = service.documents().create(body=body).execute()
        doc_id = doc['documentId']

        if content:
            requests = [{
                'insertText': {
                    'location': {'index': 1},
                    'text': content
                }
            }]
            service.documents().batchUpdate(documentId=doc_id, body={'requests': requests}).execute()

        return {
            'success': True,
            'document': {
                'documentId': doc_id,
                'title': doc.get('title'),
                'url': f"https://docs.google.com/document/d/{doc_id}/edit"
            }
        }
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def docs_read(service, document_id: str) -> dict:
    """Read the content of a Google Doc."""
    try:
        doc = service.documents().get(documentId=document_id).execute()

        content = ''
        for element in doc.get('body', {}).get('content', []):
            if 'paragraph' in element:
                for para_element in element['paragraph'].get('elements', []):
                    if 'textRun' in para_element:
                        content += para_element['textRun'].get('content', '')
                content += '\n'

        return {
            'success': True,
            'document': {
                'documentId': doc['documentId'],
                'title': doc.get('title', ''),
                'content': content.strip(),
            }
        }
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def docs_append(service, document_id: str, content: str) -> dict:
    """Append content to a Google Doc."""
    try:
        doc = service.documents().get(documentId=document_id).execute()
        end_index = doc['body']['content'][-1]['endIndex'] - 1

        requests = [{
            'insertText': {
                'location': {'index': end_index},
                'text': '\n' + content
            }
        }]
        service.documents().batchUpdate(documentId=document_id, body={'requests': requests}).execute()
        return {'success': True, 'documentId': document_id}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


# ============================================================================
# SHEETS ACTIONS
# ============================================================================

def sheets_create(service, title: str) -> dict:
    """Create a new spreadsheet."""
    try:
        spreadsheet = service.spreadsheets().create(body={'properties': {'title': title}}).execute()
        return {
            'success': True,
            'spreadsheet': {
                'spreadsheetId': spreadsheet['spreadsheetId'],
                'title': spreadsheet['properties']['title'],
                'url': f"https://docs.google.com/spreadsheets/d/{spreadsheet['spreadsheetId']}/edit"
            }
        }
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def sheets_read(service, spreadsheet_id: str, range_name: str = 'Sheet1') -> dict:
    """Read data from a spreadsheet."""
    try:
        result = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=range_name).execute()
        values = result.get('values', [])
        return {'success': True, 'range': range_name, 'values': values, 'rowCount': len(values)}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def sheets_write(service, spreadsheet_id: str, range_name: str, values: list) -> dict:
    """Write data to a spreadsheet."""
    try:
        body = {'values': values}
        result = service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption='RAW',
            body=body
        ).execute()
        return {'success': True, 'updatedCells': result.get('updatedCells')}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def sheets_append(service, spreadsheet_id: str, range_name: str, values: list) -> dict:
    """Append data to a spreadsheet."""
    try:
        body = {'values': values}
        result = service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption='RAW',
            insertDataOption='INSERT_ROWS',
            body=body
        ).execute()
        return {'success': True, 'updatedCells': result.get('updates', {}).get('updatedCells')}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


def sheets_clear(service, spreadsheet_id: str, range_name: str) -> dict:
    """Clear data from a spreadsheet."""
    try:
        service.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=range_name).execute()
        return {'success': True, 'range': range_name}
    except HttpError as e:
        return {'success': False, 'error': str(e)}


# ============================================================================
# MAIN DISPATCHER
# ============================================================================

def main():
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)

    service_name = sys.argv[1]
    action = sys.argv[2] if len(sys.argv) > 2 else None

    creds = get_credentials()

    if service_name == 'gmail':
        service = get_service('gmail', 'v1', creds)
        dispatch_gmail(service, action, sys.argv[3:])
    elif service_name == 'drive':
        service = get_service('drive', 'v3', creds)
        dispatch_drive(service, action, sys.argv[3:])
    elif service_name == 'calendar':
        service = get_service('calendar', 'v3', creds)
        dispatch_calendar(service, action, sys.argv[3:])
    elif service_name == 'chat':
        service = get_service('chat', 'v1', creds)
        dispatch_chat(service, action, sys.argv[3:])
    elif service_name == 'docs':
        service = get_service('docs', 'v1', creds)
        dispatch_docs(service, action, sys.argv[3:])
    elif service_name == 'sheets':
        service = get_service('sheets', 'v4', creds)
        dispatch_sheets(service, action, sys.argv[3:])
    else:
        print(f"Unknown service: {service_name}")
        print("Available services: gmail, drive, calendar, chat, docs, sheets")
        sys.exit(1)


def dispatch_gmail(service, action, args):
    if action == 'list':
        max_results = int(args[0]) if args else 20
        label = args[1] if len(args) > 1 else None
        print_json(gmail_list(service, max_results, label))
    elif action == 'search':
        query = args[0] if args else ''
        print_json(gmail_search(service, query))
    elif action == 'read':
        message_id = args[0] if args else None
        if not message_id:
            print("Error: message_id required")
            sys.exit(1)
        print_json(gmail_read(service, message_id))
    elif action == 'send':
        if len(args) < 3:
            print("Usage: gmail send <to> <subject> <body> [cc]")
            sys.exit(1)
        print_json(gmail_send(service, to=args[0], subject=args[1], body=args[2], cc=args[3] if len(args) > 3 else None))
    elif action == 'reply':
        if len(args) < 2:
            print("Usage: gmail reply <message_id> <body>")
            sys.exit(1)
        print_json(gmail_reply(service, message_id=args[0], body=args[1]))
    elif action == 'label':
        if len(args) < 2:
            print("Usage: gmail label <message_id> <add_labels> [remove_labels]")
            sys.exit(1)
        add_labels = args[1].split(',') if len(args) > 1 else []
        remove_labels = args[2].split(',') if len(args) > 2 else []
        print_json(gmail_label(service, args[0], add_labels, remove_labels))
    elif action == 'trash':
        message_id = args[0] if args else None
        if not message_id:
            print("Error: message_id required")
            sys.exit(1)
        print_json(gmail_trash(service, message_id))
    elif action == 'labels':
        print_json(gmail_labels(service))
    else:
        print("Gmail actions: list, search, read, send, reply, label, trash, labels")


def dispatch_drive(service, action, args):
    if action == 'list':
        folder_id = args[0] if args else 'root'
        print_json(drive_list(service, folder_id))
    elif action == 'search':
        query = args[0] if args else ''
        print_json(drive_search(service, query))
    elif action == 'get':
        file_id = args[0] if args else None
        if not file_id:
            print("Error: file_id required")
            sys.exit(1)
        print_json(drive_get(service, file_id))
    elif action == 'download':
        if not args:
            print("Usage: drive download <file_id> [output_path]")
            sys.exit(1)
        print_json(drive_download(service, args[0], args[1] if len(args) > 1 else None))
    elif action == 'upload':
        if not args:
            print("Usage: drive upload <file_path> [folder_id]")
            sys.exit(1)
        print_json(drive_upload(service, args[0], args[1] if len(args) > 1 else 'root'))
    elif action == 'mkdir':
        if len(args) < 1:
            print("Usage: drive mkdir <name> [parent_id]")
            sys.exit(1)
        print_json(drive_create_folder(service, args[0], args[1] if len(args) > 1 else 'root'))
    elif action == 'share':
        if len(args) < 3:
            print("Usage: drive share <file_id> <email> <role>")
            sys.exit(1)
        print_json(drive_share(service, args[0], args[1], args[2]))
    elif action == 'delete':
        file_id = args[0] if args else None
        if not file_id:
            print("Error: file_id required")
            sys.exit(1)
        print_json(drive_delete(service, file_id))
    elif action == 'move':
        if len(args) < 2:
            print("Usage: drive move <file_id> <new_folder_id>")
            sys.exit(1)
        print_json(drive_move(service, args[0], args[1]))
    else:
        print("Drive actions: list, search, get, download, upload, mkdir, share, delete, move")


def dispatch_calendar(service, action, args):
    if action == 'list':
        max_results = int(args[0]) if args else 20
        print_json(calendar_list(service, max_results))
    elif action == 'create':
        if len(args) < 3:
            print("Usage: calendar create <summary> <start_time> <end_time> [location] [description]")
            sys.exit(1)
        print_json(calendar_create(
            service,
            summary=args[0],
            start_time=args[1],
            end_time=args[2],
            location=args[3] if len(args) > 3 else None,
            description=args[4] if len(args) > 4 else None,
        ))
    elif action == 'update':
        if len(args) < 2:
            print("Usage: calendar update <event_id> [summary] [start] [end] [location]")
            sys.exit(1)
        print_json(calendar_update(
            service,
            event_id=args[0],
            summary=args[1] if len(args) > 1 else None,
            start_time=args[2] if len(args) > 2 else None,
            end_time=args[3] if len(args) > 3 else None,
            location=args[4] if len(args) > 4 else None,
        ))
    elif action == 'delete':
        event_id = args[0] if args else None
        if not event_id:
            print("Error: event_id required")
            sys.exit(1)
        print_json(calendar_delete(service, event_id))
    elif action == 'freebusy':
        if len(args) < 2:
            print("Usage: calendar freebusy <time_min> <time_max>")
            sys.exit(1)
        print_json(calendar_freebusy(service, args[0], args[1]))
    else:
        print("Calendar actions: list, create, update, delete, freebusy")


def dispatch_chat(service, action, args):
    if action == 'spaces':
        print_json(chat_list_spaces(service))
    elif action == 'send':
        if len(args) < 2:
            print("Usage: chat send <space_name> <message>")
            sys.exit(1)
        print_json(chat_send(service, args[0], args[1]))
    elif action == 'messages':
        if not args:
            print("Usage: chat messages <space_name>")
            sys.exit(1)
        print_json(chat_list_messages(service, args[0]))
    else:
        print("Chat actions: spaces, send, messages")


def dispatch_docs(service, action, args):
    if action == 'create':
        title = args[0] if args else 'Untitled'
        content = args[1] if len(args) > 1 else None
        print_json(docs_create(service, title, content))
    elif action == 'read':
        doc_id = args[0] if args else None
        if not doc_id:
            print("Error: document_id required")
            sys.exit(1)
        print_json(docs_read(service, doc_id))
    elif action == 'append':
        if len(args) < 2:
            print("Usage: docs append <document_id> <content>")
            sys.exit(1)
        print_json(docs_append(service, args[0], args[1]))
    else:
        print("Docs actions: create, read, append")


def dispatch_sheets(service, action, args):
    if action == 'create':
        title = args[0] if args else 'Untitled Spreadsheet'
        print_json(sheets_create(service, title))
    elif action == 'read':
        if not args:
            print("Usage: sheets read <spreadsheet_id> [range]")
            sys.exit(1)
        print_json(sheets_read(service, args[0], args[1] if len(args) > 1 else 'Sheet1'))
    elif action == 'write':
        if len(args) < 3:
            print("Usage: sheets write <spreadsheet_id> <range> <json_values>")
            sys.exit(1)
        values = json.loads(args[2])
        print_json(sheets_write(service, args[0], args[1], values))
    elif action == 'append':
        if len(args) < 3:
            print("Usage: sheets append <spreadsheet_id> <range> <json_values>")
            sys.exit(1)
        values = json.loads(args[2])
        print_json(sheets_append(service, args[0], args[1], values))
    elif action == 'clear':
        if len(args) < 2:
            print("Usage: sheets clear <spreadsheet_id> <range>")
            sys.exit(1)
        print_json(sheets_clear(service, args[0], args[1]))
    else:
        print("Sheets actions: create, read, write, append, clear")


def print_json(data: dict):
    print(json.dumps(data, indent=2))


def print_usage():
    print("Google Workspace Skill")
    print()
    print("Usage: google_workspace <service> <action> [args...]")
    print()
    print("Services:")
    print("  gmail     - Email operations (list, read, send, search, reply, label, trash)")
    print("  drive     - File storage (list, search, get, download, upload, mkdir, share, delete, move)")
    print("  calendar  - Calendar events (list, create, update, delete, freebusy)")
    print("  chat      - Google Chat (spaces, send, messages)")
    print("  docs      - Google Docs (create, read, append)")
    print("  sheets    - Google Sheets (create, read, write, append, clear)")
    print()
    print("Required vault secrets:")
    print("  GOOGLE_CLIENT_ID")
    print("  GOOGLE_CLIENT_SECRET")
    print("  GOOGLE_REFRESH_TOKEN")


if __name__ == '__main__':
    main()
