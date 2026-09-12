---
"@agentskit/code-review": patch
---

SARIF output now includes `partialFingerprints.primaryLocationLineHash` per finding (derived from file, rule, and title — deliberately excluding the line number, so GitHub Code Scanning still recognizes the same finding across runs when an unrelated edit shifts it a few lines), plus `tool.driver.version` and `informationUri`.
