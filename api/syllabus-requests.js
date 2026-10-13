// Vercel Serverless Function: community syllabus requests.
// Configure GITHUB_TOKEN (repo Issues: read/write) to persist requests as GitHub issues.
// Optional SYLLABUS_REQUEST_WEBHOOK_URL can privately forward notification email data.
const REPO = process.env.GITHUB_REPOSITORY || 'kkmalithmalshan2000-png/Spaced-Repetition-Tracker';
const MAX_BODY = 12000;
const json = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const titlePrefix = '[Syllabus Request] ';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method === 'GET') {
    try {
      const response = await fetch('https://api.github.com/repos/' + REPO + '/issues?state=all&per_page=100&sort=created&direction=desc', {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Nexus-Syllabus-Requests' }
      });
      if (!response.ok) return json(res, 502, { error: 'Community wishlist is temporarily unavailable.' });
      const issues = await response.json();
      const requests = issues.filter(i => !i.pull_request && i.title && i.title.startsWith(titlePrefix)).map(i => ({
        id: i.number, name: i.title.slice(titlePrefix.length), category: clean((i.body || '').match(/\*\*Category:\*\* (.*)/)?.[1], 100),
        topics: clean((i.body || '').split('**Topics:**\n')[1]?.split('\n\n---')[0], 3000),
        createdAt: i.created_at, status: i.state === 'closed' ? 'completed' : 'community'
      }));
      return json(res, 200, { requests });
    } catch (_) { return json(res, 502, { error: 'Community wishlist is temporarily unavailable.' }); }
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return json(res, 405, { error: 'Method not allowed.' }); }
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return json(res, 413, { error: 'Request is too large.' });
    }
    let input;
    try { input = JSON.parse(raw || '{}'); } catch (_) { return json(res, 400, { error: 'Invalid request body.' }); }
    const name = clean(input.name, 120);
    const category = clean(input.category, 100);
    const topics = clean(input.topics, 3000);
    const email = clean(input.email, 254);
    if (!name || !category) return json(res, 400, { error: 'Subject/course name and category are required.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    const token = process.env.GITHUB_TOKEN;
    const webhook = process.env.SYLLABUS_REQUEST_WEBHOOK_URL;
    if (!token && !webhook) return json(res, 503, { error: 'Request service is not configured yet.' });
    let created = { name, category, topics, createdAt: new Date().toISOString(), status: 'community' };
    if (token) {
      const response = await fetch('https://api.github.com/repos/' + REPO + '/issues', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Nexus-Syllabus-Requests' },
        body: JSON.stringify({ title: titlePrefix + name, body: '**Category:** ' + category + '\n\n**Topics:**\n' + (topics || 'Not provided') + '\n\n---\nSubmitted through Nexus: Spaced Repetition Tracker.' })
      });
      if (!response.ok) return json(res, 502, { error: 'Could not save the request to the community wishlist.' });
      const issue = await response.json();
      created.id = issue.number;
      created.createdAt = issue.created_at;
    }
    if (webhook) {
      try {
        const forwarded = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, category, topics, email: email || null, createdAt: created.createdAt }) });
        if (!forwarded.ok) console.error('Syllabus notification webhook returned status', forwarded.status);
      } catch (error) { console.error('Syllabus notification webhook failed:', error && error.message); }
    }
    return json(res, 201, { request: created });
  } catch (_) { return json(res, 500, { error: 'Unable to process this request right now.' }); }
};
