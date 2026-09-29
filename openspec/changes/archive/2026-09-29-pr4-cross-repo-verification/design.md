# Design

- The canonical event is `litellm-discovery-core-updated`.
- Payload fields are `core_repository`, `core_branch`, and `core_sha`; the SHA must be a complete 40-character commit ID.
- Consumer workflows are independently runnable with `workflow_dispatch` and `repository_dispatch`.
- Consumers keep their existing CI jobs unchanged and add a compatibility job that builds/tests against the supplied SHA. The selected SHA is written to the job summary and artifact metadata.
- Core push CI dispatches consumers only when `CROSS_REPO_DISPATCH_TOKEN` is configured. The token is intentionally a repository secret; forks and pull requests never receive it.
- A missing token is reported as a skipped dispatch, not a failed Core build.
