# Releasing STELLA

This document describes how to cut a STELLA release. It applies both to regular
releases and to **study cuts** — fixed, citeable versions used in a specific
study (e.g. a Prolific run) so the exact version is reproducible and referenceable
in publications.

## Versioning

STELLA follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- Regular releases: `v1.2.0`.
- Study cuts: suffix the tag with the study name, e.g. `v1.0.0-prolific`, so the
  artefact used in a paper is unambiguous.

Keep the version in sync across `package.json`, the SDK `pyproject.toml` files,
and `CITATION.cff`.

## Cutting a release

1. **Pick the branch and commit.** For a study cut, release from the study branch
   (e.g. `prolific_study`) at the exact commit used in the study.
2. **Update the changelog** (`docs-site/docs/changelog.md`) with the notable
   changes since the previous release.
3. **Bump versions** in `package.json`, the SDK `pyproject.toml` files, and
   `CITATION.cff` (`version:` and `date-released:`).
4. **Tag the commit:**
   ```bash
   git tag -a v1.0.0-prolific -m "STELLA v1.0.0 — Prolific study cut"
   git push origin v1.0.0-prolific
   ```
5. **Publish a GitHub Release** from that tag (Releases → Draft a new release):
   - Select the tag, title it, and paste the release notes / changelog.
   - Source archives are attached automatically; no build artefacts are required.

## Zenodo DOI (recommended for citability)

To mint a permanent, citeable DOI for each release:

1. Enable the repository in [Zenodo](https://zenodo.org/) (Zenodo → GitHub → flip
   the switch for `c4dhi/STELLA`). This requires the repository to be **public**.
2. Publishing a GitHub Release then automatically archives the tag and mints a
   DOI.
3. Add the DOI to `CITATION.cff` (`doi:`) and to the README citation section, and
   commit that update.

## Documentation versioning

The docs site (`docs-site/`) can snapshot a version alongside a release:

```bash
cd docs-site
npm run docusaurus docs:version X.Y.Z
```

Then update `lastVersion`/`versions` in `docusaurus.config.ts` as needed. The
docs deploy to https://c4dhi.github.io/STELLA/ automatically on push to `main`
via the `Deploy Documentation` GitHub Action.

## Checklist

- [ ] Changelog updated
- [ ] Versions bumped (`package.json`, SDK `pyproject.toml`, `CITATION.cff`)
- [ ] Tag pushed
- [ ] GitHub Release published with notes
- [ ] Zenodo DOI minted and recorded in `CITATION.cff` + README
- [ ] Docs version snapshotted (if applicable)
