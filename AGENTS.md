# Agent rules

- Large sources (LiveSpot) are processed in chunks of slugs, one chunk per `scrape-concerts` invocation, chained with `cursor` + `state`. Why: doing ~1500+ pages in one invocation silently killed the edge worker and left jobs stuck "running".
- The scrape runner heartbeats on drafts processed, not only on upserts. Why: the watchdog must tell a slow-but-alive ingest apart from a dead worker.
