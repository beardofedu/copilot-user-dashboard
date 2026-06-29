const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.static('public'));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;

// Fetch AI credit usage from org-level report
async function getAICreditUsageByUser(year, month) {
  try {
    const response = await axios.get(
      `https://api.github.com/organizations/${GITHUB_ORG}/settings/billing/ai_credit/usage`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10'
        },
        params: {
          ...(year && { year }),
          ...(month && { month })
        }
      }
    );

    const orgTotal = {
      user: 'Organization Total',
      totalCost: 0,
      items: [],
      models: {}
    };

    if (Array.isArray(response.data.usageItems)) {
      response.data.usageItems.forEach(item => {
        const amount = item.netAmount > 0 ? item.netAmount : item.grossAmount;
        orgTotal.totalCost += amount;
        orgTotal.items.push(item);

        if (!orgTotal.models[item.model]) {
          orgTotal.models[item.model] = {
            model: item.model,
            quantity: 0,
            cost: 0
          };
        }
        orgTotal.models[item.model].quantity += item.grossQuantity;
        orgTotal.models[item.model].cost += amount;
      });
    }

    return [orgTotal];
  } catch (error) {
    console.error('Error fetching AI credit usage:', error.message);
    throw error;
  }
}

// API endpoint to get usage data
app.get('/api/usage', async (req, res) => {
  try {
    const { year, month } = req.query;
    const usageData = await getAICreditUsageByUser(year, month);
    res.json(usageData);
  } catch (error) {
    console.error('Full error:', error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.message || error.message;
    
    if (statusCode === 403) {
      res.status(403).json({ 
        error: 'Permission denied (403). Ensure your token has Organization Administration read permissions and you are an org owner or have proper admin access.' 
      });
    } else {
      res.status(statusCode).json({ error: errorMessage });
    }
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Test token permissions
app.get('/api/test-token', async (req, res) => {
  try {
    // Test 1: Can we access org members?
    const membersResponse = await axios.get(
      `https://api.github.com/orgs/${GITHUB_ORG}/members`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10'
        },
        params: { per_page: 1 }
      }
    );

    // Test 2: Can we access billing usage (without user filter)?
    const billingResponse = await axios.get(
      `https://api.github.com/organizations/${GITHUB_ORG}/settings/billing/ai_credit/usage`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10'
        }
      }
    );

    res.json({
      status: 'ok',
      checks: {
        members_access: 'OK',
        billing_access: 'OK',
        members_count: membersResponse.data.length,
        has_usage_data: !!billingResponse.data.usageItems
      }
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || error.message,
      status: error.response?.status
    });
  }
});

// Debug endpoint to see raw API response
app.get('/api/debug-raw', async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.github.com/organizations/${GITHUB_ORG}/settings/billing/ai_credit/usage`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10'
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: error.message,
      status: error.response?.status
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
  console.log(`Organization: ${GITHUB_ORG}`);
});
