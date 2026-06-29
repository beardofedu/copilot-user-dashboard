const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.static('public'));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;

// Fetch AI credit usage grouped by user
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

    // Group usage by user
    const userUsage = {};
    
    if (response.data.usageItems) {
      response.data.usageItems.forEach(item => {
        const user = response.data.user || 'unknown';
        if (!userUsage[user]) {
          userUsage[user] = {
            user,
            totalCost: 0,
            items: [],
            models: {}
          };
        }
        
        userUsage[user].totalCost += item.netAmount;
        userUsage[user].items.push(item);
        
        if (!userUsage[user].models[item.model]) {
          userUsage[user].models[item.model] = {
            model: item.model,
            quantity: 0,
            cost: 0
          };
        }
        userUsage[user].models[item.model].quantity += item.netQuantity;
        userUsage[user].models[item.model].cost += item.netAmount;
      });
    }
    
    return Object.values(userUsage).sort((a, b) => b.totalCost - a.totalCost);
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
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
  console.log(`Organization: ${GITHUB_ORG}`);
});
