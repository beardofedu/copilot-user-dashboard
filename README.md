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
GITHUB_ENTERPRISE=your_enterprise_slug_if_org_is_enterprise_owned
USER_MONTHLY_LIMIT=250
NEAR_LIMIT_PERCENT=0.8
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

This dashboard uses one of these GitHub REST API endpoints:
```
GET /organizations/{org}/settings/billing/ai_credit/usage
GET /enterprises/{enterprise}/settings/billing/ai_credit/usage
```

See [GitHub Billing API Docs](https://docs.github.com/en/rest/billing/usage) for more details.

## Data Interpretation

- **Gross Amount**: Total charged before discounts
- **Net Amount**: Amount after discounts applied
- **Unit Types**: Typically "tokens" for AI usage (input/output tokens)
- **Models**: Claude, GPT-4, CodeX, etc.

## Fine-Grained Token Permissions

When creating a fine-grained personal access token for this dashboard, grant it **Organization Administration** read permissions:

**Required Permissions:**
- **Organization Administration** (Read)
  - Provides access to: `GET /organizations/{org}/settings/billing/ai_credit/usage`
- **Enterprise Administration/Billing access** (for enterprise-owned orgs)
  - Provides access to: `GET /enterprises/{enterprise}/settings/billing/ai_credit/usage`

**Optional Permissions (if you want additional billing insights):**
- Read access to billing budgets: `GET /organizations/{org}/settings/billing/budgets`
- Read access to premium requests: `GET /organizations/{org}/settings/billing/premium_request/usage`
- Read access to general billing: `GET /organizations/{org}/settings/billing/usage`

**Steps to create the token:**
1. Go to [GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click "Generate new token"
3. Name it: `copilot-dashboard`
4. Set expiration as needed
5. Under "Resource owner", select your organization
6. Under "Repository access", select "All repositories" or specific ones
7. Under "Organization permissions", expand "Administration" and select **Read** access
8. Click "Generate token" and copy it to your `.env` file

## Troubleshooting

### 403 Forbidden Error

If you see "403 Forbidden" errors when loading the dashboard:

**Check your token permissions:**
1. Visit `http://localhost:3000/api/test-token` to verify your token can access the required endpoints
2. Ensure your fine-grained token has:
   - **Organization Administration** (Read) - Required for `/settings/billing/ai_credit/usage`
   - **Members** (Read) - Required for listing org members
3. For enterprise-owned orgs, set `GITHUB_ENTERPRISE` and ensure enterprise billing access
4. Verify you are an **organization owner** or have **org admin** access

**Note:** For enterprise-owned orgs, org admins cannot use `?user=` on the organization endpoint. You must use the enterprise endpoint with `GITHUB_ENTERPRISE`.

**Quick test:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.github.com/organizations/YOUR_ORG/settings/billing/ai_credit/usage
```

If this returns 403, your token doesn't have the necessary permissions.

### No Users Displayed

Ensure:
- Your organization has members
- At least one member has used Copilot credits in the selected time period
- Your token has both Administration and Members read permissions

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
