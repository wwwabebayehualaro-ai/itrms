# ADR 0020: SeaweedFS as the S3 server

* Status: accepted (2026-10-18). It **supersedes the server choice in ADR-0007**. ADR-0007's rule that the app speaks only the
  S3 API stays in force.
* Decided by: the technical lead, under the product owner's delegation of technical choices.

## Context
ADR-0007 named MinIO. MinIO's community edition was put in maintenance mode (Dec 2025) and archived upstream (2026), and no
official binaries, images or security fixes have been published since October 2025. Running it would mean building and
patching an unmaintained server ourselves. (Its AGPL licence is not the reason; see ADR-0025.)

## Decision
* Object storage runs on **SeaweedFS** (Apache-2.0), **version 4.30 or later** (fixes CVE-2026-54917, a path traversal in the
  S3 gateway), pinned per the version rule.
* Single-server layout per installation: master + volume + filer + S3 gateway in one container (`weed server -s3`). Data is on
  its own disk volume; one bucket per installation; S3 credentials in Compose secrets.
* The application uses `@aws-sdk/client-s3` and presigned URLs only. An **S3 contract test suite** (presigned PUT/GET, size
  limits, multipart, delete, list) runs in CI against the pinned SeaweedFS image. It is the gate for every SeaweedFS upgrade.
* Backups: restic over S3 (ADR-0012), plus SeaweedFS's own volume replication off for single-server installs.

## Consequences
* There is no AGPL component in the default installation.
* If SeaweedFS ever fails the contract tests, the alternatives are RustFS (Apache-2.0) or Ceph RGW (LGPL, separate service),
  swapped by configuration.

## Licences
SeaweedFS: Apache-2.0. AWS SDK v3: Apache-2.0.
