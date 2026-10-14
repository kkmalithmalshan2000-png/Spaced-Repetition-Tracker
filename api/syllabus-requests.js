// Vercel Serverless Function: shared syllabus requests with authenticated voting and owner-only deletion.
// Configure SUPABASE_URL and SUPABASE_ANON_KEY in Vercel. The browser sends the signed-in user's access token;
// Supabase Row Level Security is the final enforcement layer for ownership and vote uniqueness.
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://txugbdavblpettcnhcxl.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_sQkKOf-CfHlG7mvA2sFjIg_qcezI2Fa';
const MAX_BODY = 12000;
const NEXUS_ADMIN_USER_ID = (process.env.NEXUS_ADMIN_USER_ID || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPOSITORY = (process.env.GITHUB_REPOSITORY || 'kkmalithmalshan2000-png/Spaced-Repetition-Tracker').trim();
const SYNC_BATCH_SIZE = 20;
const isAdmin = user => !!(user && NEXUS_ADMIN_USER_ID && user.id === NEXUS_ADMIN_USER_ID);
const json = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
async function currentUser(token) {
  if (!token) return null;
  const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && user.id ? user : null;
}
async function db(path, token, options = {}) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: options.method || 'GET',
    cache: 'no-store',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation'
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}
async function countVotes(requestId, token) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/nexus_syllabus_votes?select=request_id&request_id=eq.' + encodeURIComponent(requestId), {
    method: 'GET', cache: 'no-store',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, Accept: 'application/json', Prefer: 'count=exact', Range: '0-0' }
  });
  if (!response.ok) return null;
  const range = response.headers.get('content-range') || '';
  const match = range.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

const githubHeaders = () => ({
  Accept: 'application/vnd.github+json',
  Authorization: 'Bearer ' + GITHUB_TOKEN,
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json'
});
async function github(path, options = {}) {
  if (!GITHUB_TOKEN) throw new Error('GitHub request tracking is not configured. Add GITHUB_TOKEN in Vercel environment variables.');
  const response = await fetch('https://api.github.com/repos/' + GITHUB_REPOSITORY + path, {
    method: options.method || 'GET', cache: 'no-store', headers: githubHeaders(),
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload && payload.message ? payload.message : 'GitHub request failed (' + response.status + ').');
  return payload;
}
const requestMarker = id => 'Nexus Request ID: ' + id;
function issueBody(request) {
  return [
    'A curriculum request submitted through Nexus: Spaced Repetition Tracker.',
    '',
    '**Requested curriculum:** ' + clean(request.name, 120),
    '**Category / exam board:** ' + clean(request.category, 100),
    '',
    '**Topics / chapters requested:**',
    clean(request.topics, 3000) || 'No topic outline provided.',
    '',
    '---',
    requestMarker(request.id),
    'Submitted from the Nexus community request form.'
  ].join('\n');
}
async function listGithubIssues() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await github('/issues?state=all&per_page=100&page=' + page);
    const issues = Array.isArray(batch) ? batch.filter(x => !x.pull_request) : [];
    all.push(...issues);
    if (!Array.isArray(batch) || batch.length < 100) break;
  }
  return all;
}
async function createGithubIssue(request) {
  return github('/issues', { method: 'POST', body: {
    title: '[Nexus Curriculum Request] ' + clean(request.name, 120),
    body: issueBody(request)
  }});
}
function findGithubIssue(issues, id) {
  const marker = requestMarker(id);
  return issues.find(issue => String(issue.body || '').includes(marker)) || null;
}
async function closeGithubIssueForRequest(id, reason) {
  if (!GITHUB_TOKEN) return { closed: false, configured: false };
  try {
    const issue = findGithubIssue(await listGithubIssues(), id);
    if (!issue || issue.state === 'closed') return { closed: !!issue, configured: true };
    await github('/issues/' + issue.number, { method: 'PATCH', body: { state: 'closed', state_reason: reason || 'completed' } });
    return { closed: true, configured: true };
  } catch (error) {
    console.error('Could not close mirrored Nexus issue:', error && error.message);
    return { closed: false, configured: true };
  }
}
async function syncGithubBatch(requests) {
  if (!GITHUB_TOKEN) throw new Error('GitHub request tracking is not configured. Add GITHUB_TOKEN in Vercel environment variables.');
  const issues = await listGithubIssues();
  const missing = requests.filter(request => !findGithubIssue(issues, request.id));
  const batch = missing.slice(0, SYNC_BATCH_SIZE);
  let synced = 0;
  for (const request of batch) { await createGithubIssue(request); synced++; }
  return { synced, total: requests.length, remaining: Math.max(0, missing.length - synced) };
}
async function adminDeleteRequest(id) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Admin deletion is not configured yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables.');
  return fetch(SUPABASE_URL + '/rest/v1/nexus_syllabus_requests?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE', cache: 'no-store',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      Accept: 'application/json',
      Prefer: 'return=representation'
    }
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try {
    if (req.method === 'GET') {
      const user = await currentUser(token);
      const requestsResponse = await fetch(SUPABASE_URL + '/rest/v1/nexus_syllabus_requests?select=id,name,category,topics,created_at,owner_id,nexus_syllabus_votes(count)&order=created_at.desc&limit=200', {
        cache: 'no-store',
        headers: { apikey: SUPABASE_ANON_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), Accept: 'application/json', 'Cache-Control': 'no-cache, no-store, max-age=0' }
      });
      if (!requestsResponse.ok) return json(res, 503, { error: 'Community wishlist storage is not configured or is temporarily unavailable. Check the Supabase setup guide.' });
      const requests = await requestsResponse.json();
      let myVotes = new Set();
      if (user) {
        const votesResponse = await db('nexus_syllabus_votes?select=request_id&user_id=eq.' + encodeURIComponent(user.id), token);
        if (votesResponse.ok) (await votesResponse.json()).forEach(v => myVotes.add(v.request_id));
      }
      return json(res, 200, { requests: requests.map(x => ({
        id: x.id, name: x.name, category: x.category, topics: x.topics || '',
        createdAt: x.created_at, votes: Array.isArray(x.nexus_syllabus_votes) && x.nexus_syllabus_votes[0] ? Number(x.nexus_syllabus_votes[0].count || 0) : 0,
        isOwner: !!user && user.id === x.owner_id, hasUpvoted: myVotes.has(x.id), status: 'community'
      })), signedIn: !!user, isAdmin: isAdmin(user) });
    }
    if (req.method !== 'POST' && req.method !== 'DELETE') {
      res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
      return json(res, 405, { error: 'Method not allowed.' });
    }
    const user = await currentUser(token);
    if (!user) return json(res, 401, { error: 'Sign in to Nexus to submit, upvote, or delete community requests.' });
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return json(res, 413, { error: 'Request is too large.' });
    }
    let input;
    try { input = JSON.parse(raw || '{}'); } catch (_) { return json(res, 400, { error: 'Invalid request body.' }); }
    if (req.method === 'POST' && clean(input.action, 30) === 'sync-github') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only the Nexus administrator can synchronise requests to GitHub.' });
      const response = await db('nexus_syllabus_requests?select=id,name,category,topics,created_at&order=created_at.desc&limit=200', token);
      if (!response.ok) return json(res, 502, { error: 'Could not read the community request list for synchronisation.' });
      const result = await syncGithubBatch(await response.json());
      return json(res, 200, { ...result, issuesUrl: 'https://github.com/' + GITHUB_REPOSITORY + '/issues?q=is%3Aissue+is%3Aopen+%5BNexus+Curriculum+Request%5D' });
    }
    if (req.method === 'DELETE') {
      const id = clean(String(input.id || ''), 80);
      if (!id) return json(res, 400, { error: 'Request ID is required.' });
      const admin = isAdmin(user);
      let deleted;
      if (admin) deleted = await adminDeleteRequest(id);
      else deleted = await db('nexus_syllabus_requests?id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(user.id), token, { method: 'DELETE', prefer: 'return=representation' });
      if (!deleted.ok) return json(res, 502, { error: 'Could not delete this request. Please check the server configuration and try again.' });
      const rows = await deleted.json();
      if (!rows.length) return json(res, admin ? 404 : 403, { error: admin ? 'This request no longer exists.' : 'You can delete only requests you created.' });
      const githubResult = await closeGithubIssueForRequest(id, admin ? 'completed' : 'not_planned');
      return json(res, 200, { deleted: true, id, isAdmin: admin, githubIssueClosed: githubResult.closed, githubConfigured: githubResult.configured });
    }
    const action = clean(input.action, 30);
    if (action === 'upvote' || action === 'remove-upvote') {
      const id = clean(String(input.id || ''), 80);
      if (!id) return json(res, 400, { error: 'Request ID is required.' });
      if (action === 'upvote') {
        const vote = await db('nexus_syllabus_votes', token, { method: 'POST', prefer: 'return=representation,resolution=ignore-duplicates', body: { request_id: id, user_id: user.id } });
        if (!vote.ok) return json(res, 502, { error: 'Could not save your upvote. Please try again.' });
        const voteRows = await vote.json();
        const votes = await countVotes(id, token);
        return json(res, 200, { upvoted: true, id, votes, changed: Array.isArray(voteRows) && voteRows.length > 0 });
      }
      const removed = await db('nexus_syllabus_votes?request_id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(user.id), token, { method: 'DELETE', prefer: 'return=representation' });
      if (!removed.ok) return json(res, 502, { error: 'Could not remove your upvote. Please try again.' });
      const removedRows = await removed.json();
      const votes = await countVotes(id, token);
      return json(res, 200, { upvoted: false, id, votes, changed: Array.isArray(removedRows) && removedRows.length > 0 });
    }
    const name = clean(input.name, 120), category = clean(input.category, 100), topics = clean(input.topics, 3000);
    if (!name || !category) return json(res, 400, { error: 'Subject/course name and category are required.' });
    const inserted = await db('nexus_syllabus_requests', token, { method: 'POST', body: { name, category, topics, owner_id: user.id } });
    if (!inserted.ok) return json(res, 502, { error: 'Could not save the request. Ensure the Supabase syllabus tables and policies are installed.' });
    const rows = await inserted.json();
    const row = rows[0];
    let githubSynced = false, githubIssueUrl = '';
    try {
      const issue = await createGithubIssue(row);
      githubSynced = true;
      githubIssueUrl = issue && issue.html_url || '';
    } catch (error) {
      console.error('Nexus request saved but GitHub mirror failed:', error && error.message);
    }
    return json(res, 201, { request: { id: row.id, name: row.name, category: row.category, topics: row.topics || '', createdAt: row.created_at, votes: 0, isOwner: true, hasUpvoted: false, status: 'community' }, githubSynced, githubIssueUrl });
  } catch (error) {
    console.error('Syllabus request API failed:', error && error.message);
    return json(res, 500, { error: 'Unable to process this request right now.' });
  }
};
