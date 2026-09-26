---
"@agentskit/code-review": patch
---

Publish the Windows local-CLI spawn fix from 0.32.1, which never reached npm: the publish workflow ran the release checks without installing the documentation app's dependencies (`fumadocs-mdx: not found`). The workflow now installs `apps/docs` dependencies before `npm run check`, matching CI.
