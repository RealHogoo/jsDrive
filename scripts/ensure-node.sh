#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-v22.13.1}"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
NODE_HOME="${RUNTIME_DIR}/node-${NODE_VERSION}"

detect_platform() {
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in
    linux) os="linux" ;;
    darwin) os="darwin" ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
  esac
  echo "${os}-${arch}"
}

download() {
  url="$1"
  target="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$target"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$target"
    return
  fi
  echo "curl or wget is required to download Node.js" >&2
  exit 1
}

if [ ! -x "${NODE_HOME}/bin/node" ]; then
  platform="$(detect_platform)"
  archive="node-${NODE_VERSION}-${platform}.tar.xz"
  url="https://nodejs.org/dist/${NODE_VERSION}/${archive}"
  mkdir -p "$RUNTIME_DIR"
  tmp="${RUNTIME_DIR}/${archive}"
  echo "Downloading Node.js ${NODE_VERSION} (${platform})..." >&2
  download "$url" "$tmp"
  rm -rf "$NODE_HOME"
  tar -xJf "$tmp" -C "$RUNTIME_DIR"
  mv "${RUNTIME_DIR}/node-${NODE_VERSION}-${platform}" "$NODE_HOME"
  rm -f "$tmp"
fi

echo "$NODE_HOME"
