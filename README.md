# Pedit

Pedit is a local Codex plugin for visual image-editing workflows. It opens a canvas inside Codex, lets users manage image projects and versions, and hands image-editing tasks back to Codex through the Pedit MCP bridge.

中文说明：See [README.zh-CN.md](./README.zh-CN.md).

## What This Plugin Includes

- A Codex plugin manifest in `.codex-plugin/plugin.json`
- A local MCP server in `packages/server`
- A canvas UI in `apps/canvas`
- Shared task and version data types in `packages/core`
- Pedit skills in `skills/`

## Requirements

- Codex desktop with plugin support
- Node.js 20 or newer
- pnpm

## Install From Source

Clone the repository, install dependencies, and build the plugin:

```bash
pnpm install
pnpm build
pnpm validate:plugin
```

Then install or enable this folder as a local Codex plugin. After enabling the plugin, open a new Codex thread and run:

```text
@pedit 打开
```

Opening a new Codex thread after installation is recommended because MCP tools are exposed when the thread starts.

## Development

Start the local development server:

```bash
pnpm dev
```

Run tests:

```bash
pnpm test
```

Build all packages:

```bash
pnpm build
```

Validate the Codex plugin structure:

```bash
pnpm validate:plugin
```

## Product Docs

- [PRD](./docs/PRD.zh-CN.md)
- [Product architecture](./docs/product/03_product_architecture_pedit.md)
- [AI Coding retrospective](./docs/product/04_ai_coding_retrospective_pedit.md)
- [User guide](./docs/product/05_user_guide_pedit.md)
- [Case study](./docs/product/07_case_study_article_pedit.md)

## Release Package

Create a clean zip package for sharing:

```bash
pnpm pack:release
```

The generated package excludes local runtime data, node_modules, generated projects, and private image assets.

## Local Data And Privacy

Pedit stores project state, uploaded images, generated images, and task runtime data locally. Do not commit or publish these folders:

```text
.pedit-runtime/
packages/server/.pedit-runtime/
```

These paths are intentionally ignored by git.
