#!/usr/bin/env bash
# Republishes server.json to the official MCP Registry as com.siroagent/siro.
# Domain proof: https://siroagent.com/.well-known/mcp-registry-auth (served by the worker) holds the
# public half of key.pem. Bump "version" in server.json first, then: bash mcp-registry/publish.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# The Ed25519 seed is the last 32 bytes of the PKCS#8 DER key (works with OpenSSL and LibreSSL).
PRIV="$(openssl pkey -in "$DIR/key.pem" -outform DER | tail -c 32 | xxd -p -c 64)"
cd "$DIR"
./bin/mcp-publisher login http --domain siroagent.com --private-key "$PRIV"
./bin/mcp-publisher publish
