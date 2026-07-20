# Security Policy

## Reporting a vulnerability

We take the security of STELLA seriously — especially because it processes voice
conversations with research participants and may handle sensitive data.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately using GitHub's
[private vulnerability reporting](https://github.com/c4dhi/stella/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). This notifies
the maintainers privately and lets us coordinate a fix and disclosure with you.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof of concept.
- Any relevant configuration (deployment type, version/commit).

We will acknowledge your report as soon as possible, keep you informed of
progress toward a fix, and credit you in the release notes unless you prefer to
remain anonymous.

## Supported versions

STELLA is under active development. Security fixes are applied to the `main`
branch and the most recent release. Please make sure you are running an
up-to-date version before reporting.

## Handling secrets

STELLA is designed to run on your own hardware. Deployment secrets (database
credentials, API keys, LiveKit keys) are supplied at deploy time and are **never**
committed to this repository — `k8s/03-secrets.yaml` contains development
placeholders only. If you deploy STELLA, replace every placeholder with a strong,
unique value and keep your secrets out of version control.
