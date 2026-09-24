// Limits for one workspace on the standard plan.
//
// Each limit is checked where the thing it limits is created, and the numbers
// here are the only place they are written down.

// People who can belong to one workspace.
const MAX_USERS = 100;

// Projects a workspace can keep, archived ones included.
const MAX_PROJECTS = 200;

// The largest single file that can be uploaded, in megabytes.
const MAX_UPLOAD_MB = 25;

// How long a request may take before it is given up on, in seconds.
const TIMEOUT_SECONDS = 60;

// How many times a failed webhook is tried again.
const WEBHOOK_RETRIES = 5;

// Whether the numbers above allow one more of something.
function allows(limit, current) {
  return current < limit;
}

module.exports = {
  MAX_USERS,
  MAX_PROJECTS,
  MAX_UPLOAD_MB,
  TIMEOUT_SECONDS,
  WEBHOOK_RETRIES,
  allows,
};
