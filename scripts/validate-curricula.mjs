import fs from 'node:fs';
import vm from 'node:vm';

const cataloguePath = new URL('../curricula/catalog.json', import.meta.url);
const htmlPath = new URL('../index.html', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(cataloguePath, 'utf8'));
const html = fs.readFileSync(htmlPath, 'utf8');
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };

assert(catalog && catalog.version === 1, 'curricula/catalog.json must declare version: 1.');
assert(Array.isArray(catalog.packs) && catalog.packs.length > 0, 'The catalogue must contain at least one pack.');
const packIds = new Set();
let totalTopics = 0;
for (const [packIndex, pack] of (catalog.packs || []).entries()) {
  const prefix = 'Pack '+(packIndex + 1)+' ('+(pack?.id || 'unnamed')+')';
  assert(pack && /^[a-z0-9][a-z0-9-]{1,79}$/.test(pack.id || ''), prefix+': id must be a unique lowercase slug.');
  assert(!packIds.has(pack?.id), prefix+': duplicate pack id.');
  if (pack?.id) packIds.add(pack.id);
  for (const field of ['title','country','exam','language','streamName']) assert(typeof pack?.[field] === 'string' && pack[field].trim(), prefix+': missing '+field+'.');
  assert(Array.isArray(pack?.subjects) && pack.subjects.length > 0, prefix+': subjects must be a non-empty array.');
  const subjectIds = new Set();
  for (const [subjectIndex, subject] of (pack?.subjects || []).entries()) {
    const sp = prefix+', subject '+(subjectIndex + 1)+' ('+(subject?.id || 'unnamed')+')';
    assert(subject && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(subject.id || ''), sp+': invalid subject id.');
    assert(!subjectIds.has(subject?.id), sp+': duplicate subject id in the same pack.');
    if (subject?.id) subjectIds.add(subject.id);
    assert(typeof subject?.name === 'string' && subject.name.trim(), sp+': missing subject name.');
    assert(Array.isArray(subject?.topics) && subject.topics.length > 0, sp+': topics must be a non-empty array.');
    const topicNames = new Set();
    for (const topic of subject?.topics || []) {
      assert(typeof topic === 'string' && topic.trim().length > 0 && topic.trim().length <= 240, sp+': each topic must be a non-empty string of at most 240 characters.');
      if (typeof topic === 'string') {
        const key = topic.trim().toLocaleLowerCase();
        assert(!topicNames.has(key), sp+': duplicate topic name '+JSON.stringify(topic)+'.');
        topicNames.add(key);
        totalTopics++;
      }
    }
  }
}
assert(packIds.has('sl-al-commerce-si'), 'The existing Commerce starter pack must remain available.');
assert(!(catalog.packs || []).some(pack => /^temporary(?:-|$)/i.test(pack?.id || '')), 'Temporary test curricula must not remain in the catalogue.');
assert(!html.includes('temporary-biology-test'), 'The temporary Biology test pack must be removed from the app version.');
assert(html.includes('id="hubRatingGrouping"'), 'Analytics must expose topic, subject, and syllabus grouping.');
assert(html.includes('id="hubRatingPeriod"') && html.includes("['week','This week']") && html.includes("['month','This month']") && html.includes("['year','This year']"), 'Analytics must expose this-week, this-month, and this-year periods.');
assert(html.includes('id="hubRatingCustomStart"') && html.includes('id="hubRatingCustomEnd"'), 'Analytics must support a custom calendar date range.');
assert(html.includes('function ratingAnalyticsSvgMarkup') && html.includes('Number of rating presses'), 'Analytics must render an X/Y graph with an explicit review-count axis.');
assert(html.includes('id="hubRatingEntity"'), 'Analytics must let users select the topic, subject, or syllabus being analysed.');
assert(html.includes('id="homeOpenAnalytics"') && html.includes('id="analyticsStandalone"'), 'Analytics must have a dedicated full-screen screen launched from Home.');
assert(!html.includes('data-hub-tab="analytics"'), 'Analytics must not remain a Study Hub tab.');
assert(!html.includes('data-view="history"') && html.includes('id="dangerZoneStandalone"'), 'Review history must be moved out of the main navigation and into Danger Zone.');
assert(html.includes('DANGER ZONE — Clear every saved review-history entry?'), 'History deletion must warn users that analytics records will be lost.');
assert(html.includes('function exportAnalyticsPdf()') && html.includes('data-hub-action="analytics-export-pdf"'), 'Analytics must include the detailed printable PDF report action.');

// Parse each inline JavaScript block without executing browser-dependent app code.
let checkedScripts = 0;
for (const [index, match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].entries()) {
  const attrs = match[1] || '';
  if (/\btype\s*=\s*["'](?:application\/(?:json|ld\+json)|importmap)["']/i.test(attrs)) continue;
  const source = match[2] || '';
  if (!source.trim()) continue;
  try { new vm.Script(source, {filename:'index.html:inline-script-'+(index + 1)}); checkedScripts++; }
  catch (error) { errors.push('Inline script '+(index + 1)+' has a syntax error: '+error.message); }
}
assert(checkedScripts > 0, 'No inline JavaScript blocks were checked.');

if (errors.length) {
  console.error('Curriculum validation failed:');
  for (const error of errors) console.error(' - '+error);
  process.exitCode = 1;
} else {
  console.log('Curriculum validation passed: '+catalog.packs.length+' pack(s), '+totalTopics+' topic(s), '+checkedScripts+' inline JavaScript block(s) syntax-checked.');
}
