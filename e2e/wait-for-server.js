'use strict';

// Right after a redeploy the container may still be starting — wait until the API answers.
module.exports = async config => {
  const baseURL  = config.projects[0].use.baseURL;
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/api/data`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Dashboard at ${baseURL} not ready after 60s: ${lastError}`);
};
