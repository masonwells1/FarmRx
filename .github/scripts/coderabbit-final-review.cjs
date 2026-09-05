'use strict';

const READY_LABEL = 'ready-for-coderabbit';
const REQUESTED_LABEL = 'coderabbit-review-requested';
const REVIEW_COMMAND = '@coderabbitai review';
const ACTIONS_BOT_LOGIN = 'github-actions[bot]';
const RESET_ACTIONS = new Set(['synchronize', 'reopened', 'converted_to_draft']);
const ALLOWED_PERMISSIONS = new Set(['admin', 'maintain', 'write']);
const ACCEPTABLE_CHECK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const CODERABBIT_LEGACY_STATUS_CREATOR_ID = '136622811';
const CODERABBIT_CHECK_APP_ID = '347564';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error);
}

function pullRequestLabelNames(pullRequest) {
  return new Set((pullRequest.labels || []).map((label) => normalize(label.name)));
}

function nestedValue(item, path) {
  return path.reduce((value, key) => value && value[key], item);
}

function newestBySource(items, nameKey, identityPaths, dateKeys) {
  const sourcesByName = new Map();
  let malformed = !Array.isArray(items);

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') {
      malformed = true;
      continue;
    }
    const name = normalize(item[nameKey]);
    if (!name) {
      malformed = true;
      continue;
    }

    const identity = identityPaths.map((path) => nestedValue(item, path));
    const timestamp = dateKeys.map((key) => item[key]).find(Boolean);
    const epoch = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
    if (identity.some((value) => value === undefined || value === null || value === '')
      || Number.isNaN(epoch)) {
      malformed = true;
      continue;
    }

    const source = identity.map(String).join('\u0000');
    if (!sourcesByName.has(name)) sourcesByName.set(name, new Map());
    const sources = sourcesByName.get(name);
    const existing = sources.get(source);
    if (!existing || epoch > existing.epoch) {
      sources.set(source, { items: [item], epoch });
    } else if (epoch === existing.epoch) {
      // GitHub can return conflicting payloads for one source at the same
      // instant. Keep every tied result so a non-success cannot be hidden.
      existing.items.push(item);
    }
  }

  return {
    itemsByName: new Map([...sourcesByName].map(([name, sources]) => [
      name,
      [...sources.values()].flatMap((entry) => entry.items),
    ])),
    malformed,
  };
}

function evaluateChecks({ checkRuns, statuses, requiredChecks, ignoredChecks = [] }) {
  const ignored = new Set(ignoredChecks.map(normalize));
  const { itemsByName: checksByName, malformed: malformedCheckRuns } = newestBySource(checkRuns, 'name', [
    ['app', 'id'],
    ['check_suite', 'id'],
  ], [
    'completed_at',
    'started_at',
    'created_at',
  ]);
  const { itemsByName: statusesByName, malformed: malformedStatuses } = newestBySource(statuses, 'context', [
    ['creator', 'id'],
  ], [
    'updated_at',
    'created_at',
  ]);
  const blockers = [];

  if (malformedCheckRuns) blockers.push('check runs response is malformed');
  if (malformedStatuses) blockers.push('commit statuses response is malformed');

  for (const checks of checksByName.values()) {
    for (const check of checks) {
      const name = normalize(check.name);
      const ignoredConfiguredCheck = ignored.has(name) && name !== 'coderabbit';
      const ignoredCodeRabbitCheck = ignored.has(name)
        && name === 'coderabbit'
        && String(check.app.id) === CODERABBIT_CHECK_APP_ID;
      if (!ignoredConfiguredCheck
        && !ignoredCodeRabbitCheck
        && (check.status !== 'completed' || !ACCEPTABLE_CHECK_CONCLUSIONS.has(check.conclusion))) {
        blockers.push(`${check.name}: ${check.status}/${check.conclusion || 'no conclusion'}`);
      }
    }
  }

  for (const [name, statusesForName] of statusesByName) {
    for (const status of statusesForName) {
      const ignoredConfiguredStatus = ignored.has(name) && name !== 'coderabbit';
      const ignoredLegacyCodeRabbit = ignored.has(name)
        && name === 'coderabbit'
        && String(status.creator.id) === CODERABBIT_LEGACY_STATUS_CREATOR_ID;
      if (!ignoredConfiguredStatus && !ignoredLegacyCodeRabbit && status.state !== 'success') {
        blockers.push(`${status.context}: ${status.state}`);
      }
    }
  }

  for (const requiredName of requiredChecks) {
    const name = normalize(requiredName);
    const checks = checksByName.get(name) || [];
    const matchingStatuses = statusesByName.get(name) || [];
    // Required GitHub check runs are stricter than optional runs: neutral and
    // skipped cannot clear a Foundation or deployment gate. If a check run
    // exists, its result is authoritative over a same-name legacy status.
    const checksPassed = checks.length > 0 && checks.every((check) => (
      check.status === 'completed' && check.conclusion === 'success'
    ));
    const statusesPassed = matchingStatuses.length > 0 && matchingStatuses.every((status) => (
      status.state === 'success'
    ));

    if (checks.length > 0 ? !checksPassed : !statusesPassed) {
      blockers.push(`${requiredName}: required check is missing or not successful`);
    }
  }

  return [...new Set(blockers)];
}

async function removeLabelIfPresent(github, owner, repo, issueNumber, label) {
  try {
    await github.rest.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: label,
    });
  } catch (error) {
    if (error && error.status === 404) return;
    throw error;
  }
}

async function removeLabelsIndependently({ github, owner, repo, pullNumber, labels }) {
  const cleanupFailures = [];
  for (const label of labels) {
    try {
      await removeLabelIfPresent(github, owner, repo, pullNumber, label);
    } catch (cleanupError) {
      const detail = errorDetail(cleanupError);
      cleanupFailures.push(`could not remove ${label}: ${detail}`);
    }
  }
  return cleanupFailures;
}

async function resetLabels({ github, owner, repo, pullNumber, core, reason }) {
  const cleanupFailures = await removeLabelsIndependently({
    github,
    owner,
    repo,
    pullNumber,
    labels: [REQUESTED_LABEL, READY_LABEL],
  });
  if (cleanupFailures.length > 0) {
    const failureReason = `${reason}; ${cleanupFailures.join('; ')}`;
    core.setFailed(`CodeRabbit final-review state reset failed: ${failureReason}`);
    return { status: 'blocked', reason: failureReason };
  }
  core.notice(`CodeRabbit final-review state reset: ${reason}`);
  return { status: 'reset', reason };
}

async function blockCandidate({
  github,
  owner,
  repo,
  pullNumber,
  core,
  reason,
  labelsToRemove = [READY_LABEL],
}) {
  const cleanupFailures = await removeLabelsIndependently({
    github,
    owner,
    repo,
    pullNumber,
    labels: labelsToRemove,
  });
  const finalReason = cleanupFailures.length > 0
    ? `${reason}; ${cleanupFailures.join('; ')}`
    : reason;
  core.setFailed(`CodeRabbit final review was not requested: ${finalReason}`);
  return { status: 'blocked', reason: finalReason };
}

function validatePullRequest(pullRequest, defaultBranch, expectedHeadSha, { requireReady = true } = {}) {
  const reasons = [];

  if (pullRequest.state !== 'open') reasons.push('pull request is not open');
  if (pullRequest.draft) reasons.push('pull request is still a draft');
  if (pullRequest.base.ref !== defaultBranch) {
    reasons.push(`base branch is ${pullRequest.base.ref}, not ${defaultBranch}`);
  }
  if (pullRequest.auto_merge) reasons.push('auto-merge is enabled');
  if (pullRequest.mergeable !== true || pullRequest.mergeable_state === 'unknown') {
    reasons.push('GitHub has not confirmed that the pull request is mergeable');
  }
  if (pullRequest.mergeable_state === 'dirty') {
    reasons.push('pull request has merge conflicts');
  }
  if (pullRequest.mergeable_state === 'behind') {
    reasons.push('pull request branch is behind the base branch');
  }
  if (pullRequest.head.sha !== expectedHeadSha) {
    reasons.push('pull request head changed after the ready label was applied');
  }
  if (requireReady && !pullRequestLabelNames(pullRequest).has(READY_LABEL)) {
    reasons.push(`${READY_LABEL} was removed; correct the candidate and relabel it to retry`);
  }

  return reasons;
}

function reviewCommandBody(headSha) {
  return `${REVIEW_COMMAND}\n<!-- coderabbit-final-review-head:${headSha} -->`;
}

function isActionsReviewComment(comment, headSha) {
  return normalize(comment.user?.login) === normalize(ACTIONS_BOT_LOGIN)
    && String(comment.body || '').trim() === reviewCommandBody(headSha);
}

async function requestedMarkerHasCommand({ github, owner, repo, pullNumber, headSha }) {
  const comments = await github.paginate(
    github.rest.issues.listComments,
    { owner, repo, issue_number: pullNumber, per_page: 100 },
  );
  return comments.some((comment) => isActionsReviewComment(comment, headSha));
}

async function collectCheckBlockers({ github, owner, repo, headSha, config }) {
  try {
    const [checkRuns, statuses] = await Promise.all([
      github.paginate(
        github.rest.checks.listForRef,
        { owner, repo, ref: headSha, filter: 'latest', per_page: 100 },
      ),
      github.paginate(
        github.rest.repos.listCommitStatusesForRef,
        { owner, repo, ref: headSha, per_page: 100 },
      ),
    ]);
    return evaluateChecks({
      checkRuns,
      statuses,
      requiredChecks: config.requiredChecks,
      ignoredChecks: config.ignoredChecks,
    });
  } catch (error) {
    const detail = errorDetail(error);
    return [`could not collect required checks and statuses: ${detail}`];
  }
}

async function run({ github, context, core, config }) {
  const { owner, repo } = context.repo;
  const action = context.payload.action;
  const pullNumber = context.payload.pull_request.number;

  if (RESET_ACTIONS.has(action)) {
    return resetLabels({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: `pull_request_target.${action}`,
    });
  }

  if (action !== 'labeled' || normalize(context.payload.label?.name) !== READY_LABEL) {
    return { status: 'ignored', reason: `pull_request_target.${action}` };
  }

  let permissionResponse;
  try {
    permissionResponse = await github.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: context.actor,
    });
  } catch (permissionError) {
    const detail = errorDetail(permissionError);
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: `could not determine ${context.actor} repository permission: ${detail}`,
      labelsToRemove: [REQUESTED_LABEL, READY_LABEL],
    });
  }
  const permission = normalize(permissionResponse.data.permission);
  if (!ALLOWED_PERMISSIONS.has(permission)) {
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: `${context.actor} has ${permission || 'no'} repository permission`,
    });
  }

  const expectedHeadSha = context.payload.pull_request.head.sha;
  let initialResponse;
  try {
    initialResponse = await github.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  } catch (initialError) {
    return blockCandidate({
      github, owner, repo, pullNumber, core,
      reason: `could not read the initial pull request state: ${errorDetail(initialError)}`,
    });
  }
  const initialPullRequest = initialResponse.data;
  const initialReasons = validatePullRequest(
    initialPullRequest,
    context.payload.repository.default_branch,
    expectedHeadSha,
  );
  if (initialReasons.length > 0) {
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: initialReasons.join('; '),
    });
  }

  const labels = pullRequestLabelNames(initialPullRequest);
  if (labels.has(REQUESTED_LABEL)) {
    try {
      if (await requestedMarkerHasCommand({
        github,
        owner,
        repo,
        pullNumber,
        headSha: expectedHeadSha,
      })) {
        await removeLabelIfPresent(github, owner, repo, pullNumber, READY_LABEL);
        core.notice(`CodeRabbit was already requested for ${expectedHeadSha}; duplicate event ignored.`);
        return { status: 'duplicate', headSha: expectedHeadSha };
      }
      await removeLabelIfPresent(github, owner, repo, pullNumber, REQUESTED_LABEL);
      core.warning('Cleared a requested marker that had no matching GitHub Actions review command; retrying the gate.');
    } catch (verificationError) {
      return blockCandidate({
        github,
        owner,
        repo,
        pullNumber,
        core,
        reason: `could not verify the requested marker (${verificationError.message}); preserving the requested marker to prevent a duplicate review command`,
      });
    }
  }

  const blockers = await collectCheckBlockers({
    github,
    owner,
    repo,
    headSha: expectedHeadSha,
    config,
  });
  if (blockers.length > 0) {
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: blockers.join('; '),
    });
  }

  if (config.quietPeriodMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, config.quietPeriodMs));
  }
  let confirmationResponse;
  let confirmationCheckBlockers;
  try {
    [confirmationResponse, confirmationCheckBlockers] = await Promise.all([
      github.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
      collectCheckBlockers({ github, owner, repo, headSha: expectedHeadSha, config }),
    ]);
  } catch (confirmationError) {
    return blockCandidate({
      github, owner, repo, pullNumber, core,
      reason: `could not confirm the pull request after the quiet period: ${errorDetail(confirmationError)}`,
    });
  }
  const confirmationReasons = validatePullRequest(
    confirmationResponse.data,
    context.payload.repository.default_branch,
    expectedHeadSha,
  );
  confirmationReasons.push(...confirmationCheckBlockers);
  if (confirmationReasons.length > 0) {
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: confirmationReasons.join('; '),
    });
  }

  let commentsBeforeAttempt;
  try {
    commentsBeforeAttempt = await github.paginate(
      github.rest.issues.listComments,
      { owner, repo, issue_number: pullNumber, per_page: 100 },
    );
  } catch (snapshotError) {
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: `could not snapshot existing review comments (${snapshotError.message})`,
    });
  }
  const preexistingCommentIds = new Set(commentsBeforeAttempt.map((comment) => comment.id));
  try {
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pullNumber,
      labels: [REQUESTED_LABEL],
    });
  } catch (markerError) {
    return blockCandidate({
      github, owner, repo, pullNumber, core,
      reason: `could not mark the review request before posting a command: ${errorDetail(markerError)}`,
      labelsToRemove: [REQUESTED_LABEL, READY_LABEL],
    });
  }

  let finalResponse;
  let finalCheckBlockers;
  try {
    [finalResponse, finalCheckBlockers] = await Promise.all([
      github.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
      collectCheckBlockers({
        github,
        owner,
        repo,
        headSha: expectedHeadSha,
        config,
      }),
    ]);
  } catch (revalidationError) {
    const detail = errorDetail(revalidationError);
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: `could not revalidate the pull request after marking the review request: ${detail}`,
      labelsToRemove: [REQUESTED_LABEL, READY_LABEL],
    });
  }
  const finalReasons = validatePullRequest(
    finalResponse.data,
    context.payload.repository.default_branch,
    expectedHeadSha,
  );
  finalReasons.push(...finalCheckBlockers);
  if (finalReasons.length > 0) {
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: finalReasons.join('; '),
      labelsToRemove: [REQUESTED_LABEL, READY_LABEL],
    });
  }

  let createdComment;
  try {
    const commentResponse = await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: reviewCommandBody(expectedHeadSha),
    });
    createdComment = commentResponse.data;
  } catch (commentError) {
    let commandCommentExists = false;
    let verificationFailure = null;
    try {
      const comments = await github.paginate(
        github.rest.issues.listComments,
        { owner, repo, issue_number: pullNumber, per_page: 100 },
      );
      commandCommentExists = comments.some((comment) => (
        !preexistingCommentIds.has(comment.id)
        && isActionsReviewComment(comment, expectedHeadSha)
      ));
    } catch (verificationError) {
      verificationFailure = errorDetail(verificationError);
    }

    if (commandCommentExists) {
      const cleanupFailures = await removeLabelsIndependently({
        github, owner, repo, pullNumber, labels: [READY_LABEL],
      });
      if (cleanupFailures.length > 0) {
        return blockCandidate({
          github, owner, repo, pullNumber, core,
          reason: `GitHub reported a comment error but the exact command exists; ${cleanupFailures.join('; ')}`,
          labelsToRemove: [],
        });
      }
      core.warning('GitHub reported a comment error, but the exact command comment exists; preserving the requested marker.');
      return { status: 'requested', headSha: expectedHeadSha, recovered: true };
    }

    if (verificationFailure) {
      return blockCandidate({
        github, owner, repo, pullNumber, core,
        reason: `GitHub did not confirm the review comment (${errorDetail(commentError)}); could not verify whether it landed (${verificationFailure}); preserving the requested marker to prevent a duplicate review command`,
      });
    }

    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: `GitHub did not confirm the review comment (${commentError.message}); the requested marker was cleared for a deliberate retry`,
      labelsToRemove: [REQUESTED_LABEL, READY_LABEL],
    });
  }

  let postCommentResponse;
  let postCommentCheckBlockers;
  try {
    [postCommentResponse, postCommentCheckBlockers] = await Promise.all([
      github.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
      collectCheckBlockers({ github, owner, repo, headSha: expectedHeadSha, config }),
    ]);
  } catch (postCommentError) {
    return blockCandidate({
      github, owner, repo, pullNumber, core,
      reason: `could not revalidate the pull request after posting the review command: ${errorDetail(postCommentError)}`,
    });
  }
  const postCommentReasons = validatePullRequest(
    postCommentResponse.data,
    context.payload.repository.default_branch,
    expectedHeadSha,
    { requireReady: false },
  );
  postCommentReasons.push(...postCommentCheckBlockers);
  if (postCommentReasons.length > 0) {
    if (postCommentResponse.data.head.sha === expectedHeadSha) {
      return blockCandidate({
        github,
        owner,
        repo,
        pullNumber,
        core,
        reason: `post-command revalidation failed on the frozen head; preserving the requested marker and review command: ${postCommentReasons.join('; ')}`,
      });
    }
    const cleanupFailures = [];
    let deletedComment = false;
    try {
      await github.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: createdComment.id,
      });
      deletedComment = true;
    } catch (cleanupError) {
      cleanupFailures.push(`could not remove the raced review command: ${errorDetail(cleanupError)}`);
    }
    if (deletedComment) {
      try {
      await removeLabelIfPresent(github, owner, repo, pullNumber, REQUESTED_LABEL);
      } catch (cleanupError) {
        cleanupFailures.push(`could not remove ${REQUESTED_LABEL}: ${errorDetail(cleanupError)}`);
      }
    }
    return blockCandidate({
      github,
      owner,
      repo,
      pullNumber,
      core,
      reason: `pull request changed while the review command was being posted; ${postCommentReasons.join('; ')}${cleanupFailures.length ? `; ${cleanupFailures.join('; ')}` : ''}`,
    });
  }
  try {
    await removeLabelIfPresent(github, owner, repo, pullNumber, READY_LABEL);
  } catch (readyCleanupError) {
    return blockCandidate({
      github, owner, repo, pullNumber, core,
      reason: `review command was posted but could not clear ${READY_LABEL}: ${errorDetail(readyCleanupError)}`,
    });
  }
  core.notice(`Requested one CodeRabbit review for frozen head ${expectedHeadSha}.`);
  return { status: 'requested', headSha: expectedHeadSha };
}

module.exports = {
  ACCEPTABLE_CHECK_CONCLUSIONS,
  READY_LABEL,
  REQUESTED_LABEL,
  REVIEW_COMMAND,
  evaluateChecks,
  reviewCommandBody,
  run,
  validatePullRequest,
};
