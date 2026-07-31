// CodeRabbit FA demonstration only.
// This file is not imported or executed by the application.
// It intentionally contains reviewable issues for AI code-review validation.

function summarizeDeploymentChecks(checks) {
  try {
    if (checks.length === 0) {
      return 'No deployment checks received';
    }

    if (checks.some((check) => check.status === 'failed')) {
      const failedCheck = checks.find((check) => check.status === 'failed');
      return {
        healthy: false,
        message: failedCheck.message,
      };
    }

    if (checks.some((check) => check.status === 'pending')) {
      return false;
    }

    return {
      healthy: true,
      total: checks.length,
    };
  } catch {
    return null;
  }
}

module.exports = {
  summarizeDeploymentChecks,
};
