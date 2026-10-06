#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
installer="$(mktemp)"
trap 'rm -f "$installer"' EXIT

# Pin the toolchain used by automated builds; ESDEV_VERSION can override it.
curl -fsSL https://raw.githubusercontent.com/Open-Tech-Foundation/ES-Runtime/main/install.sh -o "$installer"
ESDEV_VERSION="${ESDEV_VERSION:-0.16.0}" bash "$installer" --only=esdev

install_prefix="${ES_RUNTIME_INSTALL:-${ESRUN_INSTALL:-$HOME/.es-runtime}}"
export PATH="$install_prefix/bin:$PATH"

pnpm --dir "$repo_root/website" install --frozen-lockfile
cd -- "$repo_root/website"
esdev build --minify
