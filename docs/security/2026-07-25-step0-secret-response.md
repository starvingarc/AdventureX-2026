# Recallo Step 0 Secret Response

Status: **live API tests and production deployment are blocked**.

A TikHub credential was committed in reachable Git history and a Qwen credential was shared outside the repository. Removing a value from the current `.env.example` does not revoke it or remove it from old commits. Do not paste either credential into source files, pull requests, issue comments, documents, terminal transcripts, or chat.

## Required operator actions

1. Revoke and rotate the exposed TikHub credential in the provider console.
2. Revoke and rotate the exposed Qwen/DashScope credential in Model Studio.
3. Store replacements only in the Railway or GitHub secret store used by the deployment environment.
4. Confirm dependent services use the replacements, then revoke any temporary overlap.
5. Obtain explicit authorization before rewriting Git history. The cleanup must cover every affected branch, pull-request head and cached GitHub view; rewriting only `main` is insufficient.
6. Review and expire Actions logs or artifacts that may contain sensitive material.

Until actions 1–4 are confirmed, do not run TikHub/Qwen network tests or production workflows. Until action 5 is complete, the history audit below is expected to fail.

## Repository gates

Run the daily current-tree gate:

```sh
npm run security:secrets
```

It scans current tracked worktree content and staged index content. It reports only path, secret type, source, masked preview, length and a truncated SHA-256 fingerprint.

Run focused fake-token tests:

```sh
npm run security:secrets:test
```

Run the explicit history audit only when investigating or verifying cleanup:

```sh
npm run security:secrets:history
```

History scanning is intentionally not part of commit or push hooks while the known incident remains in reachable history.

## Encrypted database export

The production DB export workflow requires the repository secret `PRODUCTION_DB_EXPORT_PASSPHRASE` with at least 24 characters. It encrypts the dump with OpenSSL AES-256-CBC, PBKDF2, 200000 iterations and SHA-256, deletes the plaintext dump, verifies that only a non-empty encrypted dump remains, and uploads only `*.dump.enc`.

Decrypt in an approved restricted environment without putting the passphrase in shell history:

```sh
export BACKUP_ENCRYPTION_PASSPHRASE='<retrieve from approved secret store>'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  -in backup.dump.enc -out backup.dump
unset BACKUP_ENCRYPTION_PASSPHRASE
```

The decrypted dump must remain outside the repository and be deleted after the authorized restore or verification task.
