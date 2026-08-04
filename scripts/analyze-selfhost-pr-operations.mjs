#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CORE_FILES = [
  'selfhost/mvp/src/parser.virune',
  'selfhost/mvp/src/checker.virune',
  'selfhost/mvp/src/emitter.virune',
  'selfhost/mvp/src/model.virune',
];

const PREFIXES = ['feat', 'fix', 'test', 'chore', 'docs', 'refactor', 'build', 'ci', 'perf'];

export function classifyPullRequest(pr) {
  const title = pr.title ?? '';
  const body = pr.body ?? '';
  const text = `${title}\n${body}`.toLowerCase();
  const prefixMatch = title.match(/^([a-z]+)(?:\([^)]*\))?:/i);
  const prefix = prefixMatch?.[1]?.toLowerCase() ?? 'other';

  const diagnosticOnly =
    /diagnostic/.test(text) &&
    (/will not be merged/.test(text) || /does not modify .*source/.test(text) || /used only to run/.test(text));
  const historyRepair =
    !diagnosticOnly &&
    (/ancestry/.test(text) || /integrate rebuilt parent history/.test(text) || /connect .* history/.test(text)) &&
    (pr.commits === 0 || /exists only to resolve/.test(text));
  const sharedCiRepair =
    !diagnosticOnly &&
    !historyRepair &&
    (/^fix\(deps\):/i.test(title) || (/shared gate/.test(text) && /dependenc/.test(text)));

  let operationalClass = 'feature-correctness-evidence';
  if (diagnosticOnly) operationalClass = 'diagnostic-only-temporary';
  else if (historyRepair) operationalClass = 'history-ancestry-repair';
  else if (sharedCiRepair) operationalClass = 'shared-ci-dependency-repair';

  const temporaryExecution =
    diagnosticOnly || /temporary(?: self-removing)?(?: pr)? workflow/.test(text) || /self-removing workflow/.test(text);
  const stackExplicit = /depends on #\d+/.test(text) || /stacked(?: on| pr| parser| checker| emitter)/.test(text) || /based on #\d+/.test(text);
  const rebuildExplicit = /\brebuilt\b/.test(text) || /\brebuild\b/.test(text) || /normalized on current/.test(text);
  const files = Array.isArray(pr.files) ? pr.files : [];
  const coreFiles = CORE_FILES.filter((path) => files.includes(path));

  return {
    ...pr,
    prefix: PREFIXES.includes(prefix) ? prefix : 'other',
    operationalClass,
    temporaryExecution,
    stackExplicit,
    rebuildExplicit,
    coreFiles,
  };
}

export function summarizePullRequests(rawPullRequests, { coreSampleSize = 14 } = {}) {
  const pullRequests = rawPullRequests.map(classifyPullRequest);
  const prefixCounts = Object.fromEntries([...PREFIXES, 'other'].map((prefix) => [prefix, 0]));
  const operationalCounts = {
    'feature-correctness-evidence': 0,
    'history-ancestry-repair': 0,
    'shared-ci-dependency-repair': 0,
    'diagnostic-only-temporary': 0,
  };

  for (const pr of pullRequests) {
    prefixCounts[pr.prefix] += 1;
    operationalCounts[pr.operationalClass] += 1;
  }

  const coreSample = pullRequests
    .filter((pr) => /selfhost/i.test(pr.title) && pr.coreFiles.length > 0)
    .slice(0, coreSampleSize);
  const coreFileCounts = Object.fromEntries(CORE_FILES.map((path) => [path, 0]));
  for (const pr of coreSample) {
    for (const path of pr.coreFiles) coreFileCounts[path] += 1;
  }

  const createdTimes = pullRequests.map((pr) => Date.parse(pr.createdAt)).filter(Number.isFinite);
  const periodHours = createdTimes.length > 1
    ? (Math.max(...createdTimes) - Math.min(...createdTimes)) / 3_600_000
    : 0;

  return {
    pullRequests,
    totals: {
      count: pullRequests.length,
      merged: pullRequests.filter((pr) => pr.merged).length,
      open: pullRequests.filter((pr) => pr.state === 'OPEN').length,
      temporaryExecution: pullRequests.filter((pr) => pr.temporaryExecution).length,
      stackExplicit: pullRequests.filter((pr) => pr.stackExplicit).length,
      rebuildExplicit: pullRequests.filter((pr) => pr.rebuildExplicit).length,
      periodHours,
    },
    prefixCounts,
    operationalCounts,
    coreSample,
    coreFileCounts,
  };
}

function percent(count, total) {
  return total === 0 ? '0%' : `${Math.round((count / total) * 100)}%`;
}

function prList(pullRequests) {
  return pullRequests.length === 0 ? 'なし' : pullRequests.map((pr) => `#${pr.number}`).join(', ');
}

export function renderMarkdown(summary, { repository, author, generatedAt }) {
  const { pullRequests, totals, prefixCounts, operationalCounts, coreSample, coreFileCounts } = summary;
  const nonFeatureCount = totals.count - operationalCounts['feature-correctness-evidence'];
  const oldest = pullRequests.at(-1);
  const newest = pullRequests.at(0);
  const byOperationalClass = (name) => pullRequests.filter((pr) => pr.operationalClass === name);
  const temporary = pullRequests.filter((pr) => pr.temporaryExecution);
  const stacked = pullRequests.filter((pr) => pr.stackExplicit);
  const rebuilt = pullRequests.filter((pr) => pr.rebuildExplicit);

  const lines = [
    '# Self-hosting development operations baseline',
    '',
    `Generated at: ${generatedAt}`,
    '',
    `Repository: \`${repository}\`  `,
    `Author: \`${author}\`  `,
    `Range: latest ${totals.count} pull requests${oldest && newest ? ` (#${oldest.number}–#${newest.number})` : ''}`,
    '',
    '## Summary',
    '',
    '| Metric | Baseline |',
    '|---|---:|',
    `| Pull requests | ${totals.count} |`,
    `| Merged | ${totals.merged} |`,
    `| Open | ${totals.open} |`,
    `| Non-feature transport/recovery PRs | ${nonFeatureCount} (${percent(nonFeatureCount, totals.count)}) |`,
    `| Temporary execution paths | ${totals.temporaryExecution} (${percent(totals.temporaryExecution, totals.count)}) |`,
    `| Explicit stack/dependency-chain usage | ${totals.stackExplicit} |`,
    `| Explicit rebuild/normalize evidence | ${totals.rebuildExplicit} |`,
    `| Creation window | ${totals.periodHours.toFixed(1)} hours |`,
    '',
    '## Title prefixes',
    '',
    '| Prefix | Count |',
    '|---|---:|',
    ...Object.entries(prefixCounts).filter(([, count]) => count > 0).map(([prefix, count]) => `| \`${prefix}\` | ${count} |`),
    '',
    '## Operational classification',
    '',
    '| Class | Count | Pull requests |',
    '|---|---:|---|',
    `| Feature / correctness / evidence | ${operationalCounts['feature-correctness-evidence']} | — |`,
    `| History / ancestry repair | ${operationalCounts['history-ancestry-repair']} | ${prList(byOperationalClass('history-ancestry-repair'))} |`,
    `| Shared CI / dependency repair | ${operationalCounts['shared-ci-dependency-repair']} | ${prList(byOperationalClass('shared-ci-dependency-repair'))} |`,
    `| Diagnostic-only temporary | ${operationalCounts['diagnostic-only-temporary']} | ${prList(byOperationalClass('diagnostic-only-temporary'))} |`,
    '',
    '## Temporary and stacked execution evidence',
    '',
    `Temporary execution: ${prList(temporary)}`,
    '',
    `Stack/dependency chain: ${prList(stacked)}`,
    '',
    `Rebuild/normalize: ${prList(rebuilt)}`,
    '',
    '## Core file concentration',
    '',
    `Representative sample: ${prList(coreSample)}`,
    '',
    '| Core file | Changed PRs | Ratio |',
    '|---|---:|---:|',
    ...CORE_FILES.map((path) => `| \`${path}\` | ${coreFileCounts[path]}/${coreSample.length} | ${percent(coreFileCounts[path], coreSample.length)} |`),
    '',
    '## Interpretation',
    '',
    '1. Replace diagnostic-only PRs and temporary workflows with repository-owned commands.',
    '2. Define when stacked PRs are allowed and cap their recommended depth.',
    '3. Make inventory, focused self-host tests, and reconstruction diagnostics reproducible from a clean clone.',
    '4. Defer parser/checker/emitter internal refactoring until the self-hosting critical path is stable.',
    '5. Re-run the same rolling-window analysis and compare changes without excluding unfavorable cases.',
    '',
    '## Limitations',
    '',
    '- The report uses the final GitHub pull-request snapshot. It cannot reconstruct every historical rebase or branch rebuild.',
    '- File concentration uses the latest self-host PRs that changed at least one declared core file.',
    '- Classification rules are deterministic heuristics and must be changed together with their tests and documentation.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY ?? 'yaona807/virune',
    author: null,
    limit: 50,
    output: null,
    jsonOutput: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--repo') options.repository = value, index += 1;
    else if (argument === '--author') options.author = value, index += 1;
    else if (argument === '--limit') options.limit = Number(value), index += 1;
    else if (argument === '--output') options.output = value, index += 1;
    else if (argument === '--json-output') options.jsonOutput = value, index += 1;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^[^/]+\/[^/]+$/.test(options.repository)) throw new Error(`Invalid repository: ${options.repository}`);
  options.author ??= options.repository.split('/')[0];
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error('--limit must be an integer between 1 and 100');
  return options;
}

async function fetchPullRequests({ repository, author, limit, token }) {
  const [owner, name] = repository.split('/');
  const query = `
    query($query: String!, $count: Int!) {
      search(query: $query, type: ISSUE, first: $count) {
        nodes {
          ... on PullRequest {
            number
            title
            body
            state
            isDraft
            merged
            createdAt
            updatedAt
            baseRefName
            headRefName
            commits { totalCount }
            files(first: 100) {
              nodes { path }
              pageInfo { hasNextPage }
            }
          }
        }
      }
    }
  `;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'virune-selfhost-operations-baseline',
    },
    body: JSON.stringify({
      query,
      variables: {
        query: `repo:${owner}/${name} is:pr author:${author} sort:created-desc`,
        count: limit,
      },
    }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(`GitHub GraphQL error: ${payload.errors.map((error) => error.message).join('; ')}`);
  return payload.data.search.nodes.map((pr) => {
    if (pr.files.pageInfo.hasNextPage) throw new Error(`PR #${pr.number} changes more than 100 files; file pagination is required`);
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      draft: pr.isDraft,
      merged: pr.merged,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      base: pr.baseRefName,
      head: pr.headRefName,
      commits: pr.commits.totalCount,
      files: pr.files.nodes.map((file) => file.path),
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN or GH_TOKEN is required');
  const pullRequests = await fetchPullRequests({ ...options, token });
  const summary = summarizePullRequests(pullRequests);
  const generatedAt = new Date().toISOString();
  const markdown = renderMarkdown(summary, { ...options, generatedAt });
  if (options.output) await writeFile(options.output, markdown, 'utf8');
  else process.stdout.write(markdown);
  if (options.jsonOutput) {
    await writeFile(options.jsonOutput, `${JSON.stringify({ generatedAt, repository: options.repository, author: options.author, ...summary }, null, 2)}\n`, 'utf8');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
