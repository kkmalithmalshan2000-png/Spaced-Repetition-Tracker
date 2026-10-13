// Vercel Serverless Function: shared syllabus requests with authenticated voting and owner-only deletion.
// Configure SUPABASE_URL and SUPABASE_ANON_KEY in Vercel. The browser sends the signed-in user's access token;
// Supabase Row Level Security is the final enforcement layer for ownership and vote uniqueness.
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://txugbdavblpettcnhcxl.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_sQkKOf-CfHlG7mvA2sFjIg_qcezI2Fa';
const MAX_BODY = 12000;
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
      const requestsResponse = await fetch(SUPABASE_URL + '/rest/v1/nexus_syllabus_requests?select=id,name,category,topics,created_at,owner_id,syllabus_request_votes(count)&order=created_at.desc&limit=200', {
        headers: { apikey: SUPABASE_ANON_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), Accept: 'application/json' }
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
        createdAt: x.created_at, votes: Array.isArray(x.syllabus_request_votes) && x.syllabus_request_votes[0] ? Number(x.syllabus_request_votes[0].count || 0) : 0,
        isOwner: !!user && user.id === x.owner_id, hasUpvoted: myVotes.has(x.id), status: 'community'
      })), signedIn: !!user });
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
    if (req.method === 'DELETE') {
      const id = clean(String(input.id || ''), 80);
      if (!id) return json(res, 400, { error: 'Request ID is required.' });
      // RLS permits deleting only rows whose owner_id matches the authenticated JWT user.
      const deleted = await db('nexus_syllabus_requests?id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(user.id), token, { method: 'DELETE', prefer: 'return=representation' });
      if (!deleted.ok) return json(res, 502, { error: 'Could not delete this request. Please try again.' });
      const rows = await deleted.json();
      if (!rows.length) return json(res, 403, { error: 'You can delete only requests you created.' });
      return json(res, 200, { deleted: true, id });
    }
    const action = clean(input.action, 30);
    if (action === 'upvote' || action === 'remove-upvote') {
      const id = clean(String(input.id || ''), 80);
      if (!id) return json(res, 400, { error: 'Request ID is required.' });
      if (action === 'upvote') {
        const vote = await db('nexus_syllabus_votes', token, { method: 'POST', prefer: 'return=representation,resolution=ignore-duplicates', body: { request_id: id, user_id: user.id } });
        if (!vote.ok) return json(res, 502, { error: 'Could not save your upvote. Please try again.' });
        return json(res, 200, { upvoted: true, id });
      }
      const removed = await db('nexus_syllabus_votes?request_id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(user.id), token, { method: 'DELETE', prefer: 'return=representation' });
      if (!removed.ok) return json(res, 502, { error: 'Could not remove your upvote. Please try again.' });
      return json(res, 200, { upvoted: false, id });
    }
    const name = clean(input.name, 120), category = clean(input.category, 100), topics = clean(input.topics, 3000);
    if (!name || !category) return json(res, 400, { error: 'Subject/course name and category are required.' });
    const inserted = await db('nexus_syllabus_requests', token, { method: 'POST', body: { name, category, topics, owner_id: user.id } });
    if (!inserted.ok) return json(res, 502, { error: 'Could not save the request. Ensure the Supabase syllabus tables and policies are installed.' });
    const rows = await inserted.json();
    const row = rows[0];
    return json(res, 201, { request: { id: row.id, name: row.name, category: row.category, topics: row.topics || '', createdAt: row.created_at, votes: 0, isOwner: true, hasUpvoted: false, status: 'community' } });
  } catch (error) {
    console.error('Syllabus request API failed:', error && error.message);
    return json(res, 500, { error: 'Unable to process this request right now.' });
  }
};
