---
"@agentskit/code-review": patch
---

Campaign workers now use a short recoverable pull-request lease with a parent heartbeat, preventing interrupted reviews from blocking the next campaign for hours.
