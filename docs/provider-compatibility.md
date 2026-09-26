---
title: Provider compatibility
description: Provider routing and capability boundaries for AgentsKit Code Review.
---

# Provider compatibility

Code Review runs against supported local coding-agent CLIs or configured model providers. Provider capabilities and safe execution defaults are maintained in the [compatibility source](provider-compatibility.json) and validated before review work starts.

The package uses the provider already configured for the selected adapter. Provider execution is bounded by the review's call, token, and time budgets. Authentication failures and unsupported capabilities stop the affected work before a review can be approved.

See [provider adapters in the repository](../docs/for-agents/code-review.md) for implementation ownership, and run `npm run check` before publishing changes to provider routing.
