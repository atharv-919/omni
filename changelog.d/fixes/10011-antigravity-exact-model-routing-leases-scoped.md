- **Antigravity routing:** keep exact-model routing leases scoped so a 404/429 on one model
  (e.g. `gemini-3-pro`) no longer hijacks cooldown for the whole model family (e.g.
  `gemini-3.1-pro`), and reserve the selected account for the lifetime of a stream so concurrent
  retries/handoffs cannot pick the same account prematurely
  ([#10011](https://github.com/diegosouzapw/OmniRoute/issues/10011)).
