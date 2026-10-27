# Repository instructions

## Keep the portfolio PDF in sync

Whenever website content is updated, the agent making the update is responsible for updating the downloadable portfolio PDF as part of the same work. Reflect the relevant changes accurately; preserve the portfolio's design, image quality, accessible text, and working links. Use the latest approved PDF and its editable source when available. Do not invent project details or change unrelated portfolio content.

The canonical repository path is `portfolio.pdf`. Store and version the actual PDF with Git LFS, using a path-specific entry in `.gitattributes` (for example, `/portfolio.pdf filter=lfs diff=lfs merge=lfs -text`). Install and configure Git LFS as needed; commit the LFS pointer and push the corresponding LFS object. Verify that the object is available to collaborators and that the checked-out PDF is valid.

## Publish the matching PDF

The agent updating the website must upload the same PDF bytes to the configured external hosting or CDN as part of that update. The intended public address is `https://files.christingilbert.com/portfolio.pdf`. Host large static documents on the `files.christingilbert.com` subdomain using configured external object storage and CDN, independently of GitHub Pages. Configure or use the existing subdomain routing so that this address serves the actual PDF, not a Git LFS pointer. GitHub Pages does not directly serve Git LFS objects; do not assume committing an LFS pointer publishes the PDF.

Use the project's documented hosting configuration and authorized credentials. Never put credentials, access tokens, or signed upload URLs in the repository. Do not invent a provider, bucket, destination, credentials, or a publishing procedure: if the hosting and routing are not yet configured, or access is unavailable, report what is missing and do not claim the mirror is current.

Before reporting completion, check the PDF opens, confirm the repository version and uploaded file match by checksum, and fetch the public URL to verify it returns a PDF with the expected content. Account for CDN cache invalidation or propagation. If updating or publishing the PDF cannot be completed, tell the user which step is blocked and whether the website and PDF are out of sync.
