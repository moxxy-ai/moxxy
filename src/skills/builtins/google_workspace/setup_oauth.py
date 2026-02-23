#!/usr/bin/env python3
"""
OAuth Setup Helper for Google Workspace Skill

This script helps you obtain a refresh token for Google Workspace API access.
Run this script once to authorize the application and get your refresh token.

Usage:
    python3 setup_oauth.py --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET

Prerequisites:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create an OAuth 2.0 Client ID (Desktop application)
3. Add yourself as a test user if the app is in testing mode
4. Note your Client ID and Client Secret
"""

import argparse
import sys
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Error: google-auth-oauthlib not installed.")
    print("Run: pip install google-auth-oauthlib")
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

def main():
    parser = argparse.ArgumentParser(
        description='Obtain a Google OAuth2 refresh token for the Google Workspace skill'
    )
    parser.add_argument('--client-id', required=True, help='Google OAuth Client ID')
    parser.add_argument('--client-secret', required=True, help='Google OAuth Client Secret')
    parser.add_argument('--port', type=int, default=8080, help='Local callback port (default: 8080)')
    
    args = parser.parse_args()

    client_config = {
        "installed": {
            "client_id": args.client_id,
            "client_secret": args.client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [f"http://localhost:{args.port}"]
        }
    }

    print("=" * 60)
    print("Google Workspace OAuth Setup")
    print("=" * 60)
    print()
    print("This script will:")
    print("  1. Open your browser to authenticate with Google")
    print("  2. Ask you to grant permissions to the application")
    print("  3. Display your refresh token")
    print()
    print("Required permissions:")
    for scope in SCOPES:
        print(f"  - {scope.split('/')[-1]}")
    print()
    input("Press Enter to continue...")
    print()

    try:
        flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
        credentials = flow.run_local_server(port=args.port)
        
        print()
        print("=" * 60)
        print("SUCCESS! Here are your credentials:")
        print("=" * 60)
        print()
        print(f"Client ID:     {args.client_id}")
        print(f"Client Secret: {args.client_secret}")
        print(f"Refresh Token: {credentials.refresh_token}")
        print()
        print("=" * 60)
        print("Store these in your moxxy vault using these commands:")
        print("=" * 60)
        print()
        print(f'<invoke name="manage_vault">["set", "GOOGLE_CLIENT_ID", "{args.client_id}"]</invoke>')
        print()
        print(f'<invoke name="manage_vault">["set", "GOOGLE_CLIENT_SECRET", "{args.client_secret}"]</invoke>')
        print()
        print(f'<invoke name="manage_vault">["set", "GOOGLE_REFRESH_TOKEN", "{credentials.refresh_token}"]</invoke>')
        print()
        print("Alternatively, use the web dashboard Vault tab to add these secrets.")
        print()

    except Exception as e:
        print(f"Error during OAuth flow: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
