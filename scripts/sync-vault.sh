#!/usr/bin/env bash
# Copies the Obsidian vault into ./vault (read-only copy). Usage: npm run sync-vault -- "/path/to/Negotiator Chatbot RAG Vault"
set -euo pipefail
SRC="${1:?Give the path to the vault folder}"
rm -rf vault && mkdir vault
rsync -a --exclude '.obsidian' --exclude '_attachments' "$SRC"/ vault/
echo "Synced $(find vault -name '*.md' | wc -l) notes"
