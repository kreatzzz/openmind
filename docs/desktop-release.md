# Desktop release engineering

Openmind has two native packaging paths. Neither publishes a release automatically.

## Development bundle smoke

[`desktop-bundles.yml`](../.github/workflows/desktop-bundles.yml) builds native artifacts on Windows x64 and Apple Silicon whenever packaging-relevant pull-request files change, and it can also be run manually. It produces:

- a Windows x64 per-user NSIS installer, followed by a silent install/uninstall smoke test;
- an Apple Silicon `.app` archive and DMG, followed by bundle-signature and disk-image verification; and
- `SHA256SUMS.txt` beside each platform's files.

These workflow artifacts are for engineering checks. The Windows installer is unsigned. The macOS app uses Tauri's ad-hoc identity, which is not Developer ID signing or notarization. Artifact names include `development` to keep that boundary visible outside the app. They expire after 14 days.

The Windows installer uses WebView2's download bootstrapper. It therefore requires network access when WebView2 is absent and is not an offline installer. The app still requires a separately installed local model runtime for local inference.

## Signed draft release

[`desktop-release.yml`](../.github/workflows/desktop-release.yml) is manual and fail closed. It accepts an existing `v<application-version>` tag, requires the workflow itself to be dispatched from that same tag, and requires the tag's commit to be on `main`. Versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` must match.

Configure a protected GitHub environment named `desktop-release`. Restrict its deployment branches to release tags and require owner review. Put these values in environment secrets:

| Secret                           | Purpose                                                     |
| -------------------------------- | ----------------------------------------------------------- |
| `APPLE_CERTIFICATE`              | Base64 Developer ID Application `.p12` export               |
| `APPLE_CERTIFICATE_PASSWORD`     | Password for that export                                    |
| `APPLE_SIGNING_IDENTITY`         | Exact Developer ID Application identity                     |
| `APPLE_ID`                       | Apple developer account email used for notarization         |
| `APPLE_PASSWORD`                 | Apple app-specific password                                 |
| `APPLE_TEAM_ID`                  | Apple developer team ID                                     |
| `WINDOWS_CERTIFICATE`            | Base64 code-signing `.pfx` export                           |
| `WINDOWS_CERTIFICATE_PASSWORD`   | Password for that export                                    |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | Expected certificate thumbprint                             |
| `WINDOWS_TIMESTAMP_URL`          | RFC 3161 timestamp service URL for the certificate provider |

The preflight fails before source checkout if any credential is absent. The macOS job imports the certificate into an ephemeral keychain, signs with Developer ID, notarizes and staples the app, then creates a DMG containing that stapled app. It signs, notarizes, and staples the DMG and verifies the embedded app again from a read-only mount. The Windows job imports the PFX into the runner's current-user certificate store, refuses a thumbprint mismatch or expired certificate, signs the executable and NSIS installer with SHA-256 and timestamping, and verifies Authenticode on the installer, installed app, and uninstaller.

After both native jobs pass, the workflow creates a new **draft** GitHub release with the signed assets and a deterministic `SHA256SUMS.txt`. It refuses to overwrite an existing release. Publishing remains a separate owner action after clean-device review.

The repository currently has no `desktop-release` environment or signing secrets. Obtain the Developer ID identity, Apple notarization account, and Windows signing arrangement before expecting this workflow to pass. Hardware-backed Windows certificates need a provider-specific `signCommand` integration instead of the PFX import step; do not export a hardware key to imitate this setup.

## Release checklist

1. Update all three application versions and run `bun run release:verify`.
2. Merge the version change through the normal protected pull-request path.
3. Create and push the matching annotated tag, such as `v0.1.0`, on the merged `main` commit.
4. In GitHub Actions, choose that tag as the workflow ref, start **Draft signed desktop release**, and enter the same tag.
5. Download the draft assets and compare each file with `SHA256SUMS.txt`.
6. On clean physical devices, test first install, launch, lock/unlock with synthetic data, upgrade from the preceding supported version, downgrade refusal, uninstall, and preservation of the encrypted vault.
7. Record the tested OS versions, device architectures, installer results, schema compatibility, and known limitations in the draft notes before publication.

The workflows do not enable Tauri updater artifacts or add an updater endpoint. Native code signing and an app-update signature are separate trust systems. Add the updater only after a real HTTPS endpoint and a protected updater public/private key plan exist, then test that an active conversation is never interrupted.

## Local checks

The helpers are safe to run without signing credentials:

```sh
bun run release:verify
bun run release:checksums path/to/staged-assets
```

`release:checksums` writes `SHA256SUMS.txt` using sorted relative paths. A local unsigned bundle can still be built for engineering use with `bun run tauri build --no-bundle` or the platform-specific bundle command, but it is not a release candidate.
