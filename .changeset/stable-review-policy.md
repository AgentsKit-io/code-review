---
"@agentskit/code-review": patch
---

Exclude worker concurrency from the semantic review-policy fingerprint. Campaign preflight and publication now recognize the same completed SHA/policy even when their scheduling limits differ, preventing repeated reviews, comments and model costs. Meaningful policy changes still invalidate the identity.
