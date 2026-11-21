# Build and distribution tools

| Script | Responsibility |
| --- | --- |
| `prepare-assets.mjs` | Bundle the classic tracking worker, prepare the pinned MediaPipe and ONNX assets, and write the SHA-256 asset manifest |
| `verify-assets.mjs` | Check local tracking, model, and geometry WASM assets in the production build |
| `serve.mjs` | Serve `dist/` on `127.0.0.1:4173`; `PALMIVO_PORT` selects another local port |
| `package.mjs` | Create `release/Palmivo` and `release/Palmivo-Source` |
| `archive.ps1` | Produce both ZIP archives and `release/checksums.json` |

Typical sequence:

~~~sh
pnpm build
pnpm package
~~~

Then run `scripts/archive.ps1` in PowerShell to create `Palmivo-Windows.zip` and `Palmivo-Source.zip`.

For the portable package with MIT TSM and the hosted source, run `pnpm run build:hosted`, `node scripts/package.mjs --candidate`, and `& .\scripts\archive.ps1 -Candidate` in PowerShell. This writes `Palmivo-Hybrid-Windows.zip`, `Palmivo-Hybrid-Source.zip`, and `hybrid-checksums.json` to `release/`. The portable launcher serves the included application on port 4181. [Model setup](../docs/MODELS.md)

The portable launcher `start-demo.cmd` uses the included Node executable and local server. The packager retains an unchanged runtime binary when an existing demo server is running. Source archives include the lockfile, package-manager configuration, QA sources, examples, documentation, and locally prepared tracking assets.

Existing launch configurations using `SIGNTOAST_PORT` remain supported. `PALMIVO_PORT` takes precedence when both variables are set. Presentation files are copied unchanged into each distribution.
