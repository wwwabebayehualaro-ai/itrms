# ADR 0007: Object storage through the S3 API (MinIO), licence flag

> **Server choice superseded by [ADR-0020](0020-object-storage-seaweedfs.md) (SeaweedFS).** The S3-API-only rule below stays
> in force.

* Status: accepted (2026-10-17, fixed), **with a licence flag that needs the product owner's decision**

## Context
Uploads (medical certificates, photos, scanned libres, contracts) and generated PDFs need durable storage on the regional
server. The fixed decision names MinIO.

**Licence flag (ADR-0010).** MinIO's server is **AGPL-3.0**, which the licence policy does not allow. The community edition
has also been wound down:
* no official binaries or Docker images since October 2025;
* maintenance mode from December 2025;
* the repository archived in 2026.

The official guidance points to the commercial AIStor product. Using MinIO therefore means building it from unmaintained
AGPL source. ([summary](https://glukhov.org/data-infrastructure/object-storage/minio-dead/), [repository](https://github.com/minio/MinIO))

## Decision
* The application uses object storage **only through the S3 API** (`@aws-sdk/client-s3`, Apache-2.0) and presigned URLs, and
  calls no MinIO-specific API. The storage server can therefore be swapped by configuration.
* The server stays **MinIO, as decided**, until the product owner answers the licence flag. The recommended alternative is
  **SeaweedFS** (Apache-2.0, S3 gateway), to be chosen in task 0.3 after an S3 compatibility test (presigned PUT/GET,
  multipart, versioning). Other candidates:
  * Ceph RGW: LGPL, and heavy for one server.
  * Garage: AGPL.
  * RustFS: Apache-2.0, but young (verify).
* Dev and tests use the same S3 container as production.

## Consequences
* Changing the storage server never touches application code. An S3 contract test suite guards this.
* Backups use restic over the S3 API (ADR-0012), so they do not depend on the server either.

## Licences
MinIO: AGPL-3.0 (flagged). SeaweedFS: Apache-2.0. AWS SDK v3: Apache-2.0.
