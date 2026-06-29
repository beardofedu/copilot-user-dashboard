const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.static('public'));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;

// Get list of organization members
async function getOrgMembers() {
  try {
    const response = await axios.get(
      `https://api.github.com/orgs/${GITHUB_ORG}/members`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10'
        },
        params: {
          per_page: 100
        }
      }
    );
    return response.data.map(member => member.login);
  } catch (error) {
    console.error('Error fetching org members:', error.message);
    return [];
  }
}

// Fetch AI credit usage for a specific user
async function getUserUsage(username, year, month) {
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
          user: username,
          ...(year && { year }),
          ...(month && { month })
        }
      }
    );

    const userData = {
      user: username,
      totalCost: 0,
      items: [],
      models: {}
    };

    if (response.data.usageItems) {
      response.data.usageItems.forEach(item => {
        userData.totalCost += item.netAmount;
        userData.items.push(item);

        if (!userData.models[item.model]) {
          userData.models[item.model] = {
            model: item.model,
            quantity: 0,
            cost: 0
          };
        }
        userData.models[item.model].quantity += item.netQuantity;
        userData.models[item.model].cost += item.netAmount;
      });
    }

    return userData;
  } catch (error) {
    console.error(`Error fetching usage for ${username}:`, error.message);
    return null;
  }
}

// Fetch AI credit usage grouped by user
async function getAICreditUsageByUser(year, month) {
  try {
    const members = await getOrgMembers();
    if (members.length === 0) {
      throw new Error('No organization members found');
    }

    // Fetch usage for each member in parallel
    const usagePromises = members.map(username => getUserUsage(username, year, month));
    const usageResults = await Promise.all(usagePromises);

    // Filter out null/empty results and sort by cost
    return usageResults
      .filter(user => user && user.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost);
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
