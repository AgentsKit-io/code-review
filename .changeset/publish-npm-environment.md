---
'@agentskit/code-review': patch
---

Run the publish job in the `npm` GitHub environment that the package's npm Trusted Publisher requires. The 0.32.3 publish was refused by npm because the job ran without it; this release ships those changes.
