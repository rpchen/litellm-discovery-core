# PR6 endpoint snapshot and drift detection

Add a host-independent persisted discovery snapshot contract. Core defines an endpoint-bound, schema-versioned snapshot, validates compatibility on restore, and compares snapshots for endpoint/model drift. Host adapters remain responsible for where and when snapshots are persisted.
