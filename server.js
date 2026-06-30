const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.static('public'));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;
const GITHUB_ENTERPRISE = process.env.GITHUB_ENTERPRISE;
const API_VERSION = '2026-03-10';
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_DELAY_MS = 350;
const API_TIMEOUT_MS = 8000;
const TOTAL_FETCH_TIMEOUT_MS = 60000;
const DEFAULT_USER_LIMIT = Number(process.env.USER_MONTHLY_LIMIT || 250);
const DEFAULT_NEAR_LIMIT_PERCENT = Number(process.env.NEAR_LIMIT_PERCENT || 0.8);
const ORG_USAGE_PATH = `/organizations/${GITHUB_ORG}/settings/billing/ai_credit/usage`;
const ENTERPRISE_USAGE_PATH = GITHUB_ENTERPRISE
  ? `/enterprises/${GITHUB_ENTERPRISE}/settings/billing/ai_credit/usage`
  : null;

const github = axios.create({
  baseURL: 'https://api.github.com',
  timeout: API_TIMEOUT_MS,
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION
  }
});
const usageCache = new Map();
const inflightRequests = new Map();
const usageDiagnostics = new Map();
let useEnterprisePath = Boolean(ENTERPRISE_USAGE_PATH);
let warnedEnterpriseFallback = false;

function usageAmount(item) {
  return item.netAmount > 0 ? item.netAmount : item.grossAmount;
}

function usageQuantity(item) {
  return item.netQuantity > 0 ? item.netQuantity : item.grossQuantity;
}

function usagePath() {
  if (useEnterprisePath && ENTERPRISE_USAGE_PATH) {
    return ENTERPRISE_USAGE_PATH;
  }
  return ORG_USAGE_PATH;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cacheKey(year, month) {
  return `${year || 'current'}-${month || 'current'}`;
}

function getCachedUsage(year, month) {
  const key = cacheKey(year, month);
  const entry = usageCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    usageCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedUsage(year, month, data) {
  usageCache.set(cacheKey(year, month), {
    timestamp: Date.now(),
    data
  });
}

function setUsageDiagnostics(year, month, diagnostics) {
  usageDiagnostics.set(cacheKey(year, month), diagnostics);
}

function isSecondaryRateLimit(error) {
  const status = error?.response?.status;
  const message = String(error?.response?.data?.message || error?.message || '').toLowerCase();
  return status === 403 && message.includes('secondary rate limit');
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNearLimitPercent(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : fallback;
}

function statusForUser(totalCost, userLimit, nearLimitPercent) {
  if (userLimit <= 0) {
    return 'ok';
  }
  const ratio = totalCost / userLimit;
  if (ratio >= 1) {
    return 'at_limit';
  }
  if (ratio >= nearLimitPercent) {
    return 'near_limit';
  }
  return 'ok';
}

function enrichUsers(rows, userLimit, nearLimitPercent) {
  const statusRank = { at_limit: 0, near_limit: 1, ok: 2 };

  return rows
    .map(row => {
      const ratio = userLimit > 0 ? row.totalCost / userLimit : 0;
      const topModels = Object.values(row.models)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 3)
        .map(model => ({
          model: model.model,
          cost: model.cost
        }));

      return {
        ...row,
        userLimit,
        percentOfLimit: ratio * 100,
        remainingToLimit: Math.max(userLimit - row.totalCost, 0),
        status: statusForUser(row.totalCost, userLimit, nearLimitPercent),
        topModels
      };
    })
    .sort((a, b) => {
      const statusDiff = statusRank[a.status] - statusRank[b.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }
      return b.percentOfLimit - a.percentOfLimit;
    });
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function usageBaseParams(year, month, enterpriseMode) {
  return {
    ...(year && { year }),
    ...(month && { month }),
    ...(enterpriseMode && GITHUB_ORG && { organization: GITHUB_ORG })
  };
}

async function listOrgMembers() {
  const members = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const response = await github.get(`/orgs/${GITHUB_ORG}/members`, {
      params: { per_page: perPage, page }
    });
    members.push(...response.data.map(member => member.login));
    if (response.data.length < perPage) {
      break;
    }
    page += 1;
  }

  return members;
}

function buildUserUsage(username, usageItems) {
  const data = {
    user: username,
    totalCost: 0,
    items: [],
    models: {}
  };

  usageItems.forEach(item => {
    const amount = usageAmount(item);
    data.totalCost += amount;
    data.items.push(item);

    if (!data.models[item.model]) {
      data.models[item.model] = {
        model: item.model,
        quantity: 0,
        cost: 0
      };
    }

    data.models[item.model].quantity += usageQuantity(item);
    data.models[item.model].cost += amount;
  });

  return data;
}

async function fetchUsage(username, year, month) {
  const enterpriseMode = useEnterprisePath && Boolean(ENTERPRISE_USAGE_PATH);
  const path = usagePath();

  try {
    const response = await github.get(path, {
      params: {
        ...usageBaseParams(year, month, enterpriseMode),
        ...(username && { user: username })
      }
    });
    return response.data;
  } catch (error) {
    if (enterpriseMode && error?.response?.status === 404) {
      useEnterprisePath = false;
      if (!warnedEnterpriseFallback) {
        warnedEnterpriseFallback = true;
        console.warn('Enterprise billing endpoint returned 404. Falling back to organization endpoint.');
      }
      const fallback = await github.get(ORG_USAGE_PATH, {
        params: {
          ...(year && { year }),
          ...(month && { month }),
          ...(username && { user: username })
        }
      });
      return fallback.data;
    }
    throw error;
  }
}

async function fetchOrganizationTotal(year, month) {
  const data = await fetchUsage(undefined, year, month);
  const usageItems = Array.isArray(data.usageItems) ? data.usageItems : [];
  return buildUserUsage('Organization Total', usageItems);
}

// Fetch AI credit usage grouped by user
async function getAICreditUsageByUser(year, month) {
  const cached = getCachedUsage(year, month);
  if (cached) {
    return cached;
  }

  const key = cacheKey(year, month);
  const inFlight = inflightRequests.get(key);
  if (inFlight) {
    return inFlight;
  }

  const fetchPromise = withTimeout((async () => {
  try {
    const members = await listOrgMembers();
    if (members.length === 0) {
      const total = [await fetchOrganizationTotal(year, month)];
      setCachedUsage(year, month, total);
      setUsageDiagnostics(year, month, {
        userLevelAvailable: false,
        reason: 'No organization members returned from /orgs/{org}/members.'
      });
      return total;
    }

    const userRows = [];
    let failedUserCalls = 0;
    let secondaryRateLimited = false;

    for (const username of members) {
      try {
        const data = await fetchUsage(username, year, month);
        const usageItems = Array.isArray(data.usageItems) ? data.usageItems : [];
        const row = buildUserUsage(username, usageItems);
        if (row.totalCost > 0) {
          userRows.push(row);
        }
      } catch (error) {
        failedUserCalls += 1;
        if (isSecondaryRateLimit(error)) {
          secondaryRateLimited = true;
          break;
        }
      }
      await sleep(REQUEST_DELAY_MS);
    }

    if (userRows.length === 0) {
      const total = [await fetchOrganizationTotal(year, month)];
      setCachedUsage(year, month, total);
      setUsageDiagnostics(year, month, {
        userLevelAvailable: false,
        reason: secondaryRateLimited
          ? 'GitHub secondary rate limit prevented per-user fetches.'
          : useEnterprisePath
            ? `No successful per-user responses. Failed calls: ${failedUserCalls}/${members.length}.`
            : 'Per-user filtering is unavailable in org mode for enterprise-owned orgs. Ensure GITHUB_ENTERPRISE is set and valid.'
      });
      return total;
    }

    const sorted = userRows.sort((a, b) => b.totalCost - a.totalCost);
    setCachedUsage(year, month, sorted);
    setUsageDiagnostics(year, month, {
      userLevelAvailable: true,
      reason: null
    });
    return sorted;
  } catch (error) {
    console.error('Error fetching AI credit usage:', error.message);
    throw error;
  } finally {
    inflightRequests.delete(key);
  }
  })(), TOTAL_FETCH_TIMEOUT_MS).catch(async () => {
    const total = [await fetchOrganizationTotal(year, month)];
    setCachedUsage(year, month, total);
    setUsageDiagnostics(year, month, {
      userLevelAvailable: false,
      reason: `Timed out while fetching per-user usage after ${TOTAL_FETCH_TIMEOUT_MS / 1000}s.`
    });
    inflightRequests.delete(key);
    return total;
  });

  inflightRequests.set(key, fetchPromise);
  return fetchPromise;
}

// API endpoint to get usage data
app.get('/api/usage', async (req, res) => {
  try {
    const { year, month, limit, near_limit_percent } = req.query;
    const userLimit = parsePositiveNumber(limit, DEFAULT_USER_LIMIT);
    const nearLimitPercent = parseNearLimitPercent(near_limit_percent, DEFAULT_NEAR_LIMIT_PERCENT);

    const usageRows = await getAICreditUsageByUser(year, month);
    const diagnostics = usageDiagnostics.get(cacheKey(year, month));
    const users = enrichUsers(usageRows, userLimit, nearLimitPercent);
    const userLevelAvailable = users.some(row => row.user !== 'Organization Total');
    const scopedUsers = users.filter(row => row.user !== 'Organization Total');

    const summaryUsers = userLevelAvailable ? scopedUsers : users;
    const nearLimitUsers = summaryUsers.filter(row => row.status === 'near_limit').length;
    const atLimitUsers = summaryUsers.filter(row => row.status === 'at_limit').length;
    const totalSpend = summaryUsers.reduce((sum, row) => sum + row.totalCost, 0);

    res.json({
      meta: {
        userLevelAvailable,
        mode: useEnterprisePath ? 'enterprise' : 'organization',
        reason: diagnostics?.reason || null,
        userLimit,
        nearLimitPercent
      },
      summary: {
        totalSpend,
        activeUsers: summaryUsers.length,
        nearLimitUsers,
        atLimitUsers
      },
      users
    });
  } catch (error) {
    console.error('Full error:', error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.message || error.message;

    if (isSecondaryRateLimit(error)) {
      res.status(429).json({
        error: 'GitHub secondary rate limit reached. Wait a few minutes and refresh.'
      });
    } else if (statusCode === 403) {
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
    const membersResponse = await github.get(`/orgs/${GITHUB_ORG}/members`, {
      params: { per_page: 1 }
    });
    const sampleUser = req.query.user || membersResponse.data[0]?.login;
    const billingResponse = await fetchUsage(undefined);

    let userFilterAccess = 'unknown';
    if (sampleUser) {
      try {
        await fetchUsage(sampleUser);
        userFilterAccess = 'OK';
      } catch (error) {
        userFilterAccess = `FAILED (${error.response?.status || 'error'})`;
      }
    }

    res.json({
      status: 'ok',
      checks: {
        mode: GITHUB_ENTERPRISE ? 'enterprise' : 'organization',
        members_access: 'OK',
        billing_access: 'OK',
        sample_user: sampleUser || null,
        user_filter_access: userFilterAccess,
        has_usage_data: !!billingResponse.usageItems
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
    const { year, month, user } = req.query;
    const data = await fetchUsage(user, year, month);
    res.json(data);
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
  console.log(`Billing mode: ${GITHUB_ENTERPRISE ? 'enterprise' : 'organization'}`);
  if (GITHUB_ENTERPRISE) {
    console.log(`Enterprise: ${GITHUB_ENTERPRISE}`);
  }
});
