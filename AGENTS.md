# Repository instructions

## Keep the portfolio PDF in sync

Whenever website content is updated, the agent making the update is responsible for updating the downloadable portfolio PDF as part of the same work. Reflect the relevant changes accurately; preserve the portfolio's design, image quality, accessible text, and working links. Use the latest approved PDF and its editable source when available. Do not invent project details or change unrelated portfolio content.

## Publish the matching PDF on GitHub Pages

The canonical repository path is `portfolio.pdf`, and the public address is `https://christingilbert.com/portfolio.pdf`. Store and version the actual PDF bytes directly in Git as a normal file so GitHub Pages can serve the document. Do not use Git LFS for this path, and do not add an LFS filter for it in `.gitattributes`.

Publish the PDF through the website's existing GitHub Pages deployment. Separate object storage, a CDN, and the `files.christingilbert.com` subdomain are not required.

Before reporting completion, check that the PDF opens, confirm the repository file matches the approved source by checksum, and fetch the public URL to verify it serves the actual PDF with the expected content. Account for GitHub Pages deployment and cache propagation. If publishing cannot be completed, report which step is blocked and whether the website and PDF are out of sync.
