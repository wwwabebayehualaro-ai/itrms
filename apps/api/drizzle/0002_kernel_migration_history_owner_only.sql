-- The migration history belongs to the owner alone. The default privileges give the system role every table the owner
-- creates, the migrator's own table included: a row written there (a far-future created_at, or one deleted) would make
-- `migrate` skip or rerun migrations. And the backup role reads no business table (it backs up physically).
REVOKE ALL ON ALL TABLES IN SCHEMA "drizzle" FROM itrms_system, itrms_backup, itrms_app;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "drizzle" FROM itrms_system, itrms_backup, itrms_app;
--> statement-breakpoint
REVOKE ALL ON SCHEMA "drizzle" FROM itrms_system, itrms_backup, itrms_app;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "kernel" FROM itrms_backup;
--> statement-breakpoint
REVOKE ALL ON SCHEMA "kernel" FROM itrms_backup;
