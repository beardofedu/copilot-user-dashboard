# Copilot AI Spend Dashboard

A dashboard for monitoring GitHub Copilot AI credit usage metrics by user/team member. Use this to track spending, identify power users, and make informed decisions about AI allotments.

## Features

- 📊 **Real-time usage tracking** - View total spend and token usage
- 👥 **User-level breakdown** - See which team members are using the most credits
- 📈 **Model analytics** - Track which AI models are consuming the most
- 📅 **Time period filtering** - Query by year and month
- 📱 **Responsive design** - Works on desktop and mobile

## Getting Started

### Prerequisites

- Node.js 16+
- GitHub Personal Access Token with `admin:org_read` scope
- Organization admin access

### Installation

1. Clone the repo:
```bash
git clone https://github.com/beardofedu/copilot-user-dashboard.git
cd copilot-user-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

4. Fill in your environment variables:
```
GITHUB_TOKEN=ghp_your_personal_access_token_here
GITHUB_ORG=your_organization_name
PORT=3000
```

### Running the Dashboard

Development mode (auto-restart on changes):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

Visit `http://localhost:3000` in your browser.

## API Endpoints

### Get AI Credit Usage
```
GET /api/usage?year=2026&month=6
```

Returns usage data grouped by user, including:
- Total cost per user
- Model breakdown
- Token quantities
- Price information

### Health Check
```
GET /api/health
```

## GitHub API Reference

This dashboard uses the GitHub REST API endpoint:
```
GET /organizations/{org}/settings/billing/ai_credit/usage
```

See [GitHub Billing API Docs](https://docs.github.com/en/rest/billing/usage) for more details.

## Data Interpretation

- **Gross Amount**: Total charged before discounts
- **Net Amount**: Amount after discounts applied
- **Unit Types**: Typically "tokens" for AI usage (input/output tokens)
- **Models**: Claude, GPT-4, CodeX, etc.

## Security Notes

- Never commit your `.env` file with real credentials
- Use GitHub organization PAT with minimal required scopes
- Keep your `GITHUB_TOKEN` secret

## Deployment

### Vercel
```bash
vercel
```

### Heroku
```bash
heroku create copilot-user-dashboard
git push heroku main
```

## License

MIT

## Contributing

Pull requests welcome! Feel free to add features like:
- Date range pickers
- CSV export
- Trend charts
- Budget alerts
- Team-level aggregation
