'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  READY_LABEL,
  REQUESTED_LABEL,
  REVIEW_COMMAND,
  evaluateChecks,
  reviewCommandBody,
  run,
} = require('./coderabbit-final-review.cjs');

const HEAD = '1111111111111111111111111111111111111111';
const NEXT_HEAD = '2222222222222222222222222222222222222222';
const REQUIRED_CHECKS = ['foundation', 'Vercel'];

function completedCheck(name, conclusion = 'success', { appId = 1, suiteId = 1, completedAt = '2026-08-30T12:00:00Z' } = {}) {
  return {
    name,
    status: 'completed',
    conclusion,
    completed_at: completedAt,
    app: { id: appId },
    check_suite: { id: suiteId },
  };
}

function commitStatus(context, state = 'success', { creatorId = context === 'CodeRabbit' ? 136622811 : 1 } = {}) {
  return {
    context,
    state,
    updated_at: '2026-08-30T12:00:00Z',
    creator: { id: creatorId },
  };
}

function pullRequest({ head = HEAD, labels = [READY_LABEL], draft = false, autoMerge = null } = {}) {
  return {
    number: 42,
    state: 'open',
    draft,
    base: { ref: 'main' },
    head: { sha: head },
    labels: labels.map((name) => ({ name })),
    auto_merge: autoMerge,
    mergeable: true,
    mergeable_state: 'blocked',
  };
}

function makeHarness({
  action = 'labeled',
  eventLabel = READY_LABEL,
  permission = 'write',
  permissionFailure = null,
  labelRemovalFailure = null,
  pullGetFailures = null,
  commentLookupFailures = null,
  pulls = [pullRequest(), pullRequest(), pullRequest()],
  checkRuns = [completedCheck('foundation')],
  statuses = [commitStatus('Vercel'), commitStatus('CodeRabbit', 'pending')],
  commentFailure = null,
  existingComments = [],
  checkRunsSequence = null,
  statusesSequence = null,
  checkRunsFailure = null,
  statusesFailure = null,
} = {}) {
  const liveLabels = new Set(pulls[0].labels.map((label) => label.name));
  const comments = existingComments.map((comment) => ({ ...comment }));
  const timeline = [];
  const failures = [];
  const notices = [];
  const labelRemovalAttempts = [];
  let pullIndex = 0;
  let checkRunsIndex = 0;
  let statusesIndex = 0;
  let pullGetIndex = 0;
  let commentLookupIndex = 0;

  function currentPull() {
    const source = pulls[Math.min(pullIndex++, pulls.length - 1)];
    return {
      ...source,
      labels: [...liveLabels].map((name) => ({ name })),
    };
  }

  const github = {
    rest: {
      checks: {
        listForRef: async () => {
          if (checkRunsFailure) throw new Error(checkRunsFailure);
          const sequence = checkRunsSequence || [checkRuns];
          const current = sequence[Math.min(checkRunsIndex++, sequence.length - 1)];
          return { data: { check_runs: current } };
        },
      },
      issues: {
        addLabels: async ({ labels }) => labels.forEach((label) => {
          liveLabels.add(label);
          timeline.push({
            event: 'labeled',
            label: { name: label },
            actor: { login: 'github-actions[bot]' },
            created_at: new Date().toISOString(),
          });
        }),
        createComment: async ({ body }) => {
          if (commentFailure === 'ambiguous') {
            comments.push({
              id: comments.length + 1,
              body,
              created_at: new Date().toISOString(),
              user: { login: 'github-actions[bot]' },
            });
            throw new Error('connection closed after write');
          }
          if (commentFailure === 'ambiguous-untrusted') {
            comments.push({
              id: comments.length + 1,
              body,
              created_at: new Date().toISOString(),
              user: { login: 'outside-commenter' },
            });
            throw new Error('connection closed before write');
          }
          if (commentFailure === 'definite') throw new Error('comment rejected');
          const comment = {
            id: comments.length + 1,
            body,
            created_at: new Date().toISOString(),
            user: { login: 'github-actions[bot]' },
          };
          comments.push(comment);
          return { data: comment };
        },
        deleteComment: async ({ comment_id: commentId }) => {
          const index = comments.findIndex((comment) => comment.id === commentId);
          if (index >= 0) comments.splice(index, 1);
        },
        listComments: async () => {
          const failure = commentLookupFailures && commentLookupFailures[commentLookupIndex++];
          if (failure) throw new Error(failure);
          return { data: comments };
        },
        listEventsForTimeline: async () => ({ data: timeline }),
        removeLabel: async ({ name }) => {
          labelRemovalAttempts.push(name);
          if ((Array.isArray(labelRemovalFailure) && labelRemovalFailure.includes(name))
            || labelRemovalFailure === name) throw new Error(`could not remove ${name}`);
          if (!liveLabels.delete(name)) {
            const error = new Error('label missing');
            error.status = 404;
            throw error;
          }
        },
      },
      pulls: {
        get: async () => {
          const failure = pullGetFailures
            && pullGetFailures[Math.min(pullGetIndex++, pullGetFailures.length - 1)];
          if (failure) throw new Error(failure);
          return { data: currentPull() };
        },
      },
      repos: {
        getCollaboratorPermissionLevel: async () => {
          if (permissionFailure) throw new Error(permissionFailure);
          return { data: { permission } };
        },
        listCommitStatusesForRef: async () => {
          if (statusesFailure) throw new Error(statusesFailure);
          const sequence = statusesSequence || [statuses];
          const current = sequence[Math.min(statusesIndex++, sequence.length - 1)];
          return { data: current };
        },
      },
    },
    paginate: async (method, params, map) => {
      const response = await method(params);
      const normalizedResponse = method === github.rest.checks.listForRef
        ? { data: response.data.check_runs }
        : response;
      return map ? map(normalizedResponse) : normalizedResponse.data;
    },
  };
  const context = {
    actor: 'masonwells1',
    repo: { owner: 'masonwells1', repo: 'FarmRx' },
    payload: {
      action,
      label: eventLabel ? { name: eventLabel } : undefined,
      pull_request: pullRequest(),
      repository: { default_branch: 'main' },
    },
  };
  const core = {
    notice: (message) => notices.push(message),
    setFailed: (message) => failures.push(message),
    warning: (message) => notices.push(message),
  };

  return {
    comments,
    context,
    core,
    failures,
    github,
    liveLabels,
    labelRemovalAttempts,
    notices,
  };
}

async function execute(harness) {
  return run({
    github: harness.github,
    context: harness.context,
    core: harness.core,
    config: { requiredChecks: REQUIRED_CHECKS, ignoredChecks: ['CodeRabbit'] },
  });
}

test('green frozen candidate with normalized paginated check runs posts exactly one review command', async () => {
  const harness = makeHarness();
  const result = await execute(harness);

  assert.equal(result.status, 'requested');
  assert.deepEqual(harness.comments.map((comment) => comment.body), [reviewCommandBody(HEAD)]);
  assert.equal(harness.comments[0].body.split('\n')[0], REVIEW_COMMAND);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
  assert.deepEqual(harness.failures, []);
});

test('duplicate ready events never post a second review command', async () => {
  const harness = makeHarness();
  await execute(harness);
  harness.liveLabels.add(READY_LABEL);
  const duplicate = await execute(harness);

  assert.equal(duplicate.status, 'duplicate');
  assert.deepEqual(harness.comments.map((comment) => comment.body), [reviewCommandBody(HEAD)]);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
});

test('a stranded requested marker without a matching Actions comment self-heals and retries', async () => {
  const harness = makeHarness({
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'requested');
  assert.deepEqual(harness.comments.map((comment) => comment.body), [reviewCommandBody(HEAD)]);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
  assert.match(harness.notices.join('\n'), /no matching GitHub Actions review command/);
});

test('an inconclusive requested-marker lookup preserves dedupe state until a retry proves the command exists', async () => {
  const harness = makeHarness({
    commentLookupFailures: ['comment lookup unavailable'],
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
    existingComments: [{
      id: 99,
      body: reviewCommandBody(HEAD),
      created_at: new Date().toISOString(),
      user: { login: 'github-actions[bot]' },
    }],
  });

  const first = await execute(harness);
  assert.equal(first.status, 'blocked');
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
  assert.deepEqual(harness.comments.map((comment) => comment.body), [reviewCommandBody(HEAD)]);
  assert.match(harness.failures[0], /preserving the requested marker/);

  harness.liveLabels.add(READY_LABEL);
  const retry = await execute(harness);
  assert.equal(retry.status, 'duplicate');
  assert.deepEqual(harness.comments.map((comment) => comment.body), [reviewCommandBody(HEAD)]);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
});

test('an inconclusive requested-marker lookup retries exactly once after a later no-command result', async () => {
  const harness = makeHarness({
    commentLookupFailures: ['comment lookup unavailable'],
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
  });

  const first = await execute(harness);
  assert.equal(first.status, 'blocked');
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
  assert.deepEqual(harness.comments, []);

  harness.liveLabels.add(READY_LABEL);
  const retry = await execute(harness);
  assert.equal(retry.status, 'requested');
  assert.deepEqual(harness.comments.map((comment) => comment.body), [reviewCommandBody(HEAD)]);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
});

test('requested-marker lookup failure records ready-label cleanup failure without posting', async () => {
  const harness = makeHarness({
    commentLookupFailures: ['comment lookup unavailable'],
    labelRemovalFailure: READY_LABEL,
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.deepEqual(harness.labelRemovalAttempts, [READY_LABEL]);
  assert.equal(harness.liveLabels.has(READY_LABEL), true);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
  assert.match(harness.failures[0], /comment lookup unavailable/);
  assert.match(harness.failures[0], /could not remove ready-for-coderabbit/);
});

test('a new commit resets both workflow labels', async () => {
  const harness = makeHarness({
    action: 'synchronize',
    eventLabel: null,
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'reset');
  assert.equal(harness.liveLabels.size, 0);
  assert.deepEqual(harness.comments, []);
});

test('reset cleanup attempts both labels and reports each failure', async (t) => {
  await t.test('requested-label cleanup failure still removes ready', async () => {
    const harness = makeHarness({
      action: 'synchronize',
      eventLabel: null,
      labelRemovalFailure: REQUESTED_LABEL,
      pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
    });
    const result = await execute(harness);

    assert.equal(result.status, 'blocked');
    assert.deepEqual(harness.comments, []);
    assert.deepEqual(harness.labelRemovalAttempts, [REQUESTED_LABEL, READY_LABEL]);
    assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
    assert.equal(harness.liveLabels.has(READY_LABEL), false);
    assert.match(harness.failures[0], /reset failed/);
    assert.match(harness.failures[0], /could not remove coderabbit-review-requested/);
  });

  await t.test('both cleanup failures are aggregated', async () => {
    const harness = makeHarness({
      action: 'synchronize',
      eventLabel: null,
      labelRemovalFailure: [REQUESTED_LABEL, READY_LABEL],
      pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
    });
    const result = await execute(harness);

    assert.equal(result.status, 'blocked');
    assert.deepEqual(harness.comments, []);
    assert.deepEqual(harness.labelRemovalAttempts, [REQUESTED_LABEL, READY_LABEL]);
    assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
    assert.equal(harness.liveLabels.has(READY_LABEL), true);
    assert.match(harness.failures[0], /could not remove coderabbit-review-requested/);
    assert.match(harness.failures[0], /could not remove ready-for-coderabbit/);
  });
});

test('missing, pending, or failed checks block the paid review request', async () => {
  const harness = makeHarness({
    checkRuns: [
      { name: 'foundation', status: 'in_progress', conclusion: null, started_at: '2026-08-30T12:00:00Z' },
      completedCheck('security-scan', 'failure'),
    ],
    statuses: [commitStatus('CodeRabbit', 'pending')],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.match(harness.failures[0], /foundation/);
  assert.match(harness.failures[0], /security-scan/);
  assert.match(harness.failures[0], /Vercel/);
  assert.doesNotMatch(harness.failures[0], /CodeRabbit: pending/);
});

test('check or status collection failures clear labels and post no review command', async (t) => {
  const cases = [
    ['check runs', { checkRunsFailure: 'checks endpoint unavailable' }],
    ['commit statuses', { statusesFailure: 'statuses endpoint unavailable' }],
  ];

  for (const [name, failure] of cases) {
    await t.test(name, async () => {
      const harness = makeHarness({
        ...failure,
        pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
      });
      const result = await execute(harness);

      assert.equal(result.status, 'blocked');
      assert.deepEqual(harness.comments, []);
      assert.equal(harness.liveLabels.has(READY_LABEL), false);
      assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
      assert.match(harness.failures[0], /could not collect required checks and statuses/);
      assert.match(harness.failures[0], /endpoint unavailable/);
    });
  }
});

test('a permission lookup failure clears workflow labels and posts no review command', async () => {
  const harness = makeHarness({
    permissionFailure: 'collaborator permission endpoint unavailable',
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
  assert.match(harness.failures[0], /could not determine masonwells1 repository permission/);
  assert.match(harness.failures[0], /collaborator permission endpoint unavailable/);
});

test('a permission lookup failure still removes ready when requested-label cleanup fails', async () => {
  const harness = makeHarness({
    permissionFailure: 'collaborator permission endpoint unavailable',
    labelRemovalFailure: REQUESTED_LABEL,
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.deepEqual(harness.labelRemovalAttempts, [REQUESTED_LABEL, READY_LABEL]);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
  assert.match(harness.failures[0], /could not determine masonwells1 repository permission/);
  assert.match(harness.failures[0], /collaborator permission endpoint unavailable/);
  assert.match(harness.failures[0], /could not remove coderabbit-review-requested/);
});

test('a check rerun that starts during the quiet confirmation blocks the request', async () => {
  const harness = makeHarness({
    checkRunsSequence: [
      [completedCheck('foundation')],
      [{ name: 'foundation', status: 'in_progress', conclusion: null }],
    ],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
  assert.match(harness.failures[0], /foundation/);
});

test('drafts, auto-merge, branch state, stale heads, and low-permission actors fail closed', async (t) => {
  const behind = pullRequest();
  behind.mergeable_state = 'behind';
  const unknown = pullRequest();
  unknown.mergeable = null;
  unknown.mergeable_state = 'unknown';
  const cases = [
    ['draft', { pulls: [pullRequest({ draft: true })] }],
    ['auto-merge', { pulls: [pullRequest({ autoMerge: {} })] }],
    ['behind base', { pulls: [behind] }],
    ['unknown mergeability', { pulls: [unknown] }],
    ['stale head', { pulls: [pullRequest({ head: NEXT_HEAD })] }],
    ['low permission', { permission: 'triage' }],
  ];

  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const harness = makeHarness(options);
      const result = await execute(harness);
      assert.equal(result.status, 'blocked');
      assert.deepEqual(harness.comments, []);
      assert.equal(harness.liveLabels.has(READY_LABEL), false);
    });
  }

  await t.test('merge conflict', async () => {
    const conflicted = pullRequest();
    conflicted.mergeable = false;
    conflicted.mergeable_state = 'dirty';
    const harness = makeHarness({ pulls: [conflicted] });
    const result = await execute(harness);
    assert.equal(result.status, 'blocked');
    assert.deepEqual(harness.comments, []);
  });
});

test('a head change during the gate removes the request marker and posts no comment', async () => {
  const harness = makeHarness({
    pulls: [pullRequest(), pullRequest(), pullRequest({ head: NEXT_HEAD })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
});

test('post-marker pull request revalidation failures clear both labels without posting', async () => {
  const harness = makeHarness({
    pullGetFailures: [null, null, 'final pull request lookup unavailable'],
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
  assert.match(harness.failures[0], /could not revalidate the pull request after marking the review request/);
  assert.match(harness.failures[0], /final pull request lookup unavailable/);
});

test('post-marker revalidation cleanup still removes ready when requested cleanup fails', async () => {
  const harness = makeHarness({
    labelRemovalFailure: REQUESTED_LABEL,
    pulls: [pullRequest(), pullRequest(), pullRequest({ head: NEXT_HEAD })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.deepEqual(harness.labelRemovalAttempts, [REQUESTED_LABEL, READY_LABEL]);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
  assert.match(harness.failures[0], /head changed after the ready label was applied/);
  assert.match(harness.failures[0], /could not remove coderabbit-review-requested/);
});

test('a head change while the command is posted deletes the raced comment and clears the marker', async () => {
  const harness = makeHarness({
    pulls: [pullRequest(), pullRequest(), pullRequest(), pullRequest({ head: NEXT_HEAD })],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(harness.comments, []);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
  assert.match(harness.failures[0], /changed while the review command was being posted/);
});

test('a definite comment failure clears both labels so the pull request cannot be stranded', async () => {
  const harness = makeHarness({ commentFailure: 'definite' });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
  assert.deepEqual(harness.comments, []);
  assert.match(harness.failures[0], /marker was cleared/);
});

test('an ambiguous comment failure preserves dedupe state when the command actually landed', async () => {
  const harness = makeHarness({ commentFailure: 'ambiguous' });
  const result = await execute(harness);

  assert.equal(result.status, 'requested');
  assert.equal(result.recovered, true);
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
  assert.deepEqual(harness.comments.map((comment) => comment.body), [reviewCommandBody(HEAD)]);
  assert.deepEqual(harness.failures, []);
});

test('an ambiguous failure never trusts the same command from another commenter', async () => {
  const harness = makeHarness({ commentFailure: 'ambiguous-untrusted' });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.equal(harness.liveLabels.has(READY_LABEL), false);
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
  assert.match(harness.failures[0], /marker was cleared/);
});

test('ambiguous recovery never mistakes an old-head Actions command for a new write', async () => {
  const harness = makeHarness({
    commentFailure: 'definite',
    existingComments: [{
      id: 99,
      body: reviewCommandBody(NEXT_HEAD),
      created_at: new Date().toISOString(),
      user: { login: 'github-actions[bot]' },
    }],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'blocked');
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), false);
  assert.equal(harness.comments.length, 1);
  assert.match(harness.failures[0], /marker was cleared/);
});

test('an old-head marker and command cannot suppress the current-head request', async () => {
  const harness = makeHarness({
    pulls: [pullRequest({ labels: [READY_LABEL, REQUESTED_LABEL] })],
    existingComments: [{
      id: 99,
      body: reviewCommandBody(NEXT_HEAD),
      created_at: new Date().toISOString(),
      user: { login: 'github-actions[bot]' },
    }],
  });
  const result = await execute(harness);

  assert.equal(result.status, 'requested');
  assert.deepEqual(
    harness.comments.map((comment) => comment.body),
    [reviewCommandBody(NEXT_HEAD), reviewCommandBody(HEAD)],
  );
  assert.equal(harness.liveLabels.has(REQUESTED_LABEL), true);
});

test('check evaluation accepts neutral/skipped results and ignores CodeRabbit pending state', () => {
  const blockers = evaluateChecks({
    checkRuns: [
      completedCheck('foundation'),
      completedCheck('optional-neutral', 'neutral'),
      completedCheck('optional-skipped', 'skipped'),
    ],
    statuses: [commitStatus('Vercel'), commitStatus('CodeRabbit', 'pending')],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });

  assert.deepEqual(blockers, []);
});

test('source-distinct required checks and statuses cannot mask one another', () => {
  const checkBlockers = evaluateChecks({
    checkRuns: [
      completedCheck('foundation', 'failure', { appId: 1, suiteId: 1 }),
      completedCheck('foundation', 'success', { appId: 2, suiteId: 2 }),
      completedCheck('Vercel'),
    ],
    statuses: [],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });
  assert.match(checkBlockers.join('\n'), /foundation: completed\/failure/);
  assert.match(checkBlockers.join('\n'), /foundation: required check is missing or not successful/);

  const statusBlockers = evaluateChecks({
    checkRuns: [completedCheck('foundation')],
    statuses: [
      commitStatus('Vercel', 'failure', { creatorId: 1 }),
      commitStatus('Vercel', 'success', { creatorId: 2 }),
    ],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });
  assert.match(statusBlockers.join('\n'), /Vercel: failure/);
  assert.match(statusBlockers.join('\n'), /Vercel: required check is missing or not successful/);
});

test('newest rerun from the same check or status source supersedes only that source', () => {
  const blockers = evaluateChecks({
    checkRuns: [
      completedCheck('foundation', 'failure', {
        appId: 1,
        suiteId: 1,
        completedAt: '2026-08-30T11:00:00Z',
      }),
      completedCheck('foundation', 'success', {
        appId: 1,
        suiteId: 1,
        completedAt: '2026-08-30T12:00:00Z',
      }),
    ],
    statuses: [
      { ...commitStatus('Vercel', 'failure', { creatorId: 1 }), updated_at: '2026-08-30T11:00:00Z' },
      { ...commitStatus('Vercel', 'success', { creatorId: 1 }), updated_at: '2026-08-30T12:00:00Z' },
    ],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });

  assert.deepEqual(blockers, []);
});

test('source freshness uses parsed instants rather than timestamp text', () => {
  const checkBlockers = evaluateChecks({
    checkRuns: [
      completedCheck('foundation', 'success', {
        appId: 1,
        suiteId: 1,
        completedAt: '2026-08-30T16:30:00Z',
      }),
      completedCheck('foundation', 'failure', {
        appId: 1,
        suiteId: 1,
        completedAt: '2026-08-30T12:00:00-05:00',
      }),
      completedCheck('Vercel'),
    ],
    statuses: [],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });
  assert.match(checkBlockers.join('\n'), /foundation: completed\/failure/);

  const statusBlockers = evaluateChecks({
    checkRuns: [completedCheck('foundation')],
    statuses: [
      { ...commitStatus('Vercel', 'success'), updated_at: '2026-08-30T16:30:00Z' },
      { ...commitStatus('Vercel', 'failure'), updated_at: '2026-08-30T12:00:00-05:00' },
    ],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });
  assert.match(statusBlockers.join('\n'), /Vercel: failure/);
});

test('equal-time conflicting results fail closed regardless of list order', () => {
  for (const [first, second] of [['success', 'failure'], ['failure', 'success']]) {
    const checkBlockers = evaluateChecks({
      checkRuns: [
        completedCheck('foundation', first, { appId: 1, suiteId: 1 }),
        completedCheck('foundation', second, { appId: 1, suiteId: 1 }),
        completedCheck('Vercel'),
      ],
      statuses: [],
      requiredChecks: REQUIRED_CHECKS,
      ignoredChecks: ['CodeRabbit'],
    });
    assert.match(checkBlockers.join('\n'), /foundation: completed\/failure/);

    const statusBlockers = evaluateChecks({
      checkRuns: [completedCheck('foundation')],
      statuses: [
        commitStatus('Vercel', first),
        commitStatus('Vercel', second),
      ],
      requiredChecks: REQUIRED_CHECKS,
      ignoredChecks: ['CodeRabbit'],
    });
    assert.match(statusBlockers.join('\n'), /Vercel: failure/);
  }
});

test('only the explicit legacy CodeRabbit status creator is ignored', () => {
  const accepted = evaluateChecks({
    checkRuns: [completedCheck('foundation'), completedCheck('Vercel')],
    statuses: [commitStatus('CodeRabbit', 'pending', { creatorId: 136622811 })],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });
  assert.deepEqual(accepted, []);

  const collision = evaluateChecks({
    checkRuns: [completedCheck('foundation'), completedCheck('Vercel')],
    statuses: [
      commitStatus('CodeRabbit', 'pending', { creatorId: 136622811 }),
      commitStatus('CodeRabbit', 'failure', { creatorId: 999 }),
    ],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });
  assert.match(collision.join('\n'), /CodeRabbit: failure/);
});

test('malformed required source identity or timestamp fails closed', () => {
  const missingIdentity = evaluateChecks({
    checkRuns: [
      { name: 'foundation', status: 'completed', conclusion: 'success', completed_at: '2026-08-30T12:00:00Z' },
      completedCheck('Vercel'),
    ],
    statuses: [commitStatus('foundation'), commitStatus('Vercel')],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });
  assert.match(missingIdentity.join('\n'), /check runs response is malformed/);

  const invalidTimestamp = evaluateChecks({
    checkRuns: [completedCheck('foundation'), completedCheck('Vercel')],
    statuses: [
      { ...commitStatus('foundation'), updated_at: 'not-a-date' },
      commitStatus('Vercel'),
    ],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });
  assert.match(invalidTimestamp.join('\n'), /commit statuses response is malformed/);
});

test('malformed check and status entries fail closed without dereferencing', () => {
  const blockers = evaluateChecks({
    checkRuns: [completedCheck('foundation'), undefined],
    statuses: [commitStatus('Vercel'), undefined],
    requiredChecks: REQUIRED_CHECKS,
    ignoredChecks: ['CodeRabbit'],
  });

  assert.match(blockers.join('\n'), /check runs response is malformed/);
  assert.match(blockers.join('\n'), /commit statuses response is malformed/);
});

test('neutral or skipped required Foundation and Vercel checks block despite a same-name success status', async (t) => {
  for (const requiredCheck of REQUIRED_CHECKS) {
    for (const conclusion of ['neutral', 'skipped']) {
      await t.test(`${requiredCheck} ${conclusion}`, () => {
        const otherRequiredCheck = REQUIRED_CHECKS.find((name) => name !== requiredCheck);
        const blockers = evaluateChecks({
          checkRuns: [
            completedCheck(otherRequiredCheck),
            completedCheck(requiredCheck, conclusion),
          ],
          statuses: REQUIRED_CHECKS.map((name) => commitStatus(name)),
          requiredChecks: REQUIRED_CHECKS,
          ignoredChecks: ['CodeRabbit'],
        });

        assert.match(
          blockers.join('\n'),
          new RegExp(`${requiredCheck}: required check is missing or not successful`),
        );
      });
    }
  }
});
