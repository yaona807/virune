import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPullRequest,
  renderMarkdown,
  summarizePullRequests,
} from './analyze-selfhost-pr-operations.mjs';

const coreFiles = [
  'selfhost/mvp/src/parser.virune',
  'selfhost/mvp/src/checker.virune',
  'selfhost/mvp/src/emitter.virune',
];

function fixture(overrides) {
  return {
    number: 1,
    title: 'feat(selfhost): add feature',
    body: '',
    state: 'MERGED',
    merged: true,
    createdAt: '2026-08-01T00:00:00Z',
    commits: 1,
    files: coreFiles,
    ...overrides,
  };
}

test('classifies diagnostic-only temporary pull requests', () => {
  const result = classifyPullRequest(fixture({
    number: 268,
    title: 'chore(selfhost): isolate rebuild diagnostics',
    body: 'Temporary draft PR used only to run diagnostics. It does not modify Virune source files and will not be merged.',
  }));
  assert.equal(result.operationalClass, 'diagnostic-only-temporary');
  assert.equal(result.temporaryExecution, true);
});

test('classifies ancestry and shared gate repair pull requests', () => {
  const history = classifyPullRequest(fixture({
    number: 267,
    title: 'chore(selfhost): integrate rebuilt parent history',
    body: 'This PR exists only to resolve stacked branch ancestry.',
    commits: 0,
  }));
  const sharedGate = classifyPullRequest(fixture({
    number: 266,
    title: 'fix(deps): resolve dependency audit findings',
    body: 'Repair the shared gate before queued pull requests merge.',
  }));
  assert.equal(history.operationalClass, 'history-ancestry-repair');
  assert.equal(sharedGate.operationalClass, 'shared-ci-dependency-repair');
});

test('summarizes temporary paths and core file concentration', () => {
  const summary = summarizePullRequests([
    fixture({ number: 3, title: 'feat(selfhost): parser', body: 'A temporary self-removing workflow validates this change.' }),
    fixture({ number: 2, title: 'feat(selfhost): checker', files: ['selfhost/mvp/src/checker.virune'] }),
    fixture({ number: 1, title: 'test(selfhost): evidence', files: [] }),
  ]);
  assert.equal(summary.totals.count, 3);
  assert.equal(summary.totals.temporaryExecution, 1);
  assert.equal(summary.coreFileCounts['selfhost/mvp/src/parser.virune'], 1);
  assert.equal(summary.coreFileCounts['selfhost/mvp/src/checker.virune'], 2);
  assert.equal(summary.coreFileCounts['selfhost/mvp/src/emitter.virune'], 1);
});

test('renders a stable markdown report', () => {
  const summary = summarizePullRequests([
    fixture({ number: 2, createdAt: '2026-08-02T00:00:00Z' }),
    fixture({ number: 1, createdAt: '2026-08-01T00:00:00Z' }),
  ]);
  const markdown = renderMarkdown(summary, {
    repository: 'yaona807/virune',
    author: 'yaona807',
    generatedAt: '2026-08-05T00:00:00.000Z',
  });
  assert.match(markdown, /latest 2 pull requests \(#1–#2\)/);
  assert.match(markdown, /Creation window \| 24\.0 hours/);
  assert.match(markdown, /`selfhost\/mvp\/src\/parser\.virune` \| 2\/2 \| 100%/);
});
