import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const performanceStyles = html.match(/<style id="nexus-performance-optimizations">([\s\S]*?)<\/style>/)?.[1] ?? '';

test('performance overrides disable large-surface entrance animations', () => {
  assert.ok(performanceStyles, 'performance override stylesheet exists');
  assert.match(performanceStyles, /\.panel,\s*\.stat,\s*\.topic-card,\s*\.queue-item\s*\{[\s\S]*?animation:\s*none\s*!important/i);
  assert.match(performanceStyles, /\.app\s*\{\s*animation:\s*none\s*!important/i);
  assert.match(performanceStyles, /\.brandmark\s*\{\s*animation:\s*none\s*!important/i);
});

test('scroll and card hover do not trigger smooth-scroll or transform animation work', () => {
  assert.match(performanceStyles, /html\s*\{\s*scroll-behavior:\s*auto\s*!important/i);
  assert.match(performanceStyles, /\.panel:hover,\s*\.topic-card:hover,\s*\.stat:hover\s*\{[\s\S]*?transform:\s*none\s*!important/i);
  assert.match(performanceStyles, /\.tabs\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important/i);
});

test('community wishlist polling is throttled and does not run offline', () => {
  assert.match(html, /setInterval\(refreshVisibleWishlist,30000\)/);
  assert.doesNotMatch(html, /setInterval\(refreshVisibleWishlist,5000\)/);
  assert.match(html, /const loadRequests=async\(\)=>\{const loadId=\+\+requestLoadId;if\(!navigator\.onLine\)return;/);
  assert.match(html, /const refreshVisibleWishlist=\(\)=>\{if\(navigator\.onLine&&!document\.hidden&&activeTab==='requests'&&!pendingRequests\.size\)loadRequests\(\)\}/);
  assert.match(html, /window\.addEventListener\('online',refreshVisibleWishlist\)/);
});


test('review buttons are delegated centrally for all dynamically rendered queues', () => {
  assert.match(html, /document\.addEventListener\('click',e=>\{const b=e\.target\.closest\('button\[data-action="review"\]'\);if\(!b\)return;openReview\(b\.dataset\.id\);\}\);/);
  assert.doesNotMatch(html, /\$\('dueQueue'\)\.addEventListener\('click'/);
  assert.match(html, /\$\('topicGrid'\)\.addEventListener\('click',e=>\{const b=e\.target\.closest\('button\[data-action\]'\);if\(!b\)return;const \{action,id\}=b\.dataset;if\(action==='edit-topic'\)openTopic\(id\);if\(action==='delete-topic'\)deleteTopic\(id\);\}\);/);
});

test('reduced-motion preference remains supported', () => {
  assert.match(performanceStyles, /prefers-reduced-motion:\s*reduce/);
  assert.match(performanceStyles, /animation:\s*none\s*!important/);
  assert.match(performanceStyles, /transition:\s*none\s*!important/);
});
