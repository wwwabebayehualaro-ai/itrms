// Worker entry of @itrms/integrations: registers its jobs/ and handlers/ (code-structure.md §5.2). Only the worker
// processes load it, so the HTTP process never reaches the system pool (dependency-cruiser:
// http-entries-never-reach-system-pool).
export {};
