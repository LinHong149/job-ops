# Job-Ops: Automated Job Application Tracking

A Chrome extension and MCP server that helps you track job applications, draft AI-powered responses, and automatically process Gmail notifications.

## Features

- **Chrome Extension**: AI-powered job application form filling
- **MCP Server**: Automated Gmail processing and Notion database updates
- **Gmail Integration**: Automatic detection of rejections, thank you emails, and interview requests
- **Notion Integration**: Automatic job application tracking with company-wide status updates
- **Discord Notifications**: Real-time notifications for job-related emails

## Setup

### 1. Environment Configuration

Copy the environment template and fill in your credentials:

```bash
cd job-sync
cp env.template .env
```

Edit `.env` with your actual values:

- **Notion API**: Get from [Notion Integrations](https://www.notion.so/my-integrations)
- **Discord Webhook**: Create in your Discord server settings
- **Gmail API**: Get from [Google Cloud Console](https://console.cloud.google.com/)

### 2. Gmail API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Gmail API
4. Create OAuth 2.0 credentials
5. Add `http://localhost:8080/oauth2callback` to authorized redirect URIs
6. Run the refresh token generator:

```bash
cd job-sync
node get-gmail-refresh.js
```

### 3. Notion Database Setup

Create a Notion database with these properties:

- **Name** (Title): Company name with job URL as hyperlink
- **Role** (Rich text): Job title/role
- **Date Applied** (Date): Application submission date
- **Status** (Select): Applied, Online Assessment, OA Complete, Nope, Interview Completed, Interview Scheduled, Offer Received

### 4. Chrome Extension Setup

1. Load the extension in Chrome:
   - Go to `chrome://extensions`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select the `chrome-extention` folder

2. Configure the extension:
   - Open extension options
   - Set your OpenAI API key
   - Configure your profile information

### 5. Start the MCP Server

Using Docker (recommended):

```bash
cd job-sync
docker compose up --build
```

Or using Node directly:

```bash
cd job-sync
npm install
node server.js
```

## Usage

### Chrome Extension

1. Visit job application pages
2. Use "Draft with AI" buttons to generate tailored responses
3. Submit applications - they'll automatically be logged to Notion

### Gmail Processing

The server automatically:

- **Rejections**: Marks as read, updates all company applications to "Nope" in Notion, sends Discord notification
- **Thank You Emails**: Marks as read, sends Discord notification
- **Interview/OA Emails**: Keeps unread, sends Discord notification
- **Other Emails**: Left unread, no action

### Manual Testing

Test Gmail polling:

```bash
cd job-sync
node test-gmail.js
```

## Configuration

### Gmail Polling Schedule

Default: Every 5 minutes (`*/5 * * * *`)

Change in `.env`:
```
CRON_GMAIL=*/10 * * * *  # Every 10 minutes
```

### Weekly Analytics

Default: Sundays at 6:00 PM (`0 18 * * SUN`)

Change in `.env`:
```
CRON_WEEKLY_ANALYTICS=0 20 * * SUN  # Sundays at 8:00 PM
```

## Security

- All secrets are stored in `.env` file (not committed to git)
- Test files with potential secrets are excluded from git
- Gmail uses OAuth 2.0 with refresh tokens
- Notion uses integration tokens with limited permissions

## Troubleshooting

### Gmail 403 Errors

1. Ensure Gmail API is enabled in Google Cloud Console
2. Regenerate refresh token if expired
3. Check OAuth consent screen configuration

### Notion Integration Issues

1. Verify integration has access to your database
2. Check property names match exactly
3. Ensure database ID is correct

### Chrome Extension Not Working

1. Reload the extension after making changes
2. Check service worker console for errors
3. Verify MCP server is running on port 8719

## Development

### Project Structure

```
job-ops/
├── chrome-extention/     # Chrome extension files
├── job-sync/            # MCP server
│   ├── server.js        # Main server file
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .env            # Environment variables (not in git)
└── README.md
```

### Adding New Email Patterns

Edit the `classifyEmail` function in `server.js` to add new detection patterns.

### Adding New Notion Properties

Update the `buildPropertiesFromApp` function in `server.js` to include new properties.
