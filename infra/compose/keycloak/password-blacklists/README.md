# Breached-password list (security.md SEC-ID-3)

`itrms-breached.txt` is Keycloak's `passwordBlacklist` file: a new password that matches a line (case-insensitive) is
refused, offline. It holds the entries of 12 to 128 characters (shorter ones are refused by the length rule anyway),
lower-cased, from the UK NCSC's list of the 100,000 most common passwords in breach data
(`Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` in [SecLists](https://github.com/danielmiessler/SecLists),
MIT). Compose mounts this folder at `/opt/keycloak/data/password-blacklists`.
