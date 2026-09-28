# PR4 cross repository verification

Add an explicit compatibility contract between discovery core and its Pi/OpenCode consumers. Consumer workflows accept a complete Core SHA through `repository_dispatch` or manual dispatch, run their existing immutable verification suites, and publish the selected SHA in the workflow summary. Core CI validates the consumer workflow contract and, on `main`, dispatches both consumers when the optional cross-repository token is configured.
