---
title: "Physical Backup and Point-in-Time Recovery (PITR) with WAL Archiving"
description: "Part-3 A hands-on walkthrough of WAL archiving, base backups, and Point-in-Time Recovery on PostgreSQL 16."
date: "2026-09-24"
tags:
  - PostgreSQL
  - Backup
  - PITR
  - WAL
---
# Overview

This is the final article in the series on logical and physical backups in PostgreSQL. In this article, we’ll put the concepts into practice by performing a **Point-in-Time Recovery (PITR)**.

To understand how PITR works in a real-world scenario, we’ll simulate a database disaster, restore the database from a physical base backup, replay the required WAL (Write-Ahead Log) files, and recover the database to a specific point in time.

Along the way, we’ll see how base backups, WAL archiving, recovery targets, and promotion work together to restore a PostgreSQL database to a desired recovery point.

# Database Backup and Point-in-Time Recovery (PITR) with WAL Archiving

A Database Backup is a copy of a PostgreSQL cluster's data files, taken at the storage level rather than as exported SQL statements. Because it captures the raw files and metadata that make up the cluster, it can be used to restore the database to the exact state it was in when the backup was taken. Combined with an archive of the Write-Ahead Log (WAL), it can also be replayed forward to any specific moment in time — a technique known as Point-in-Time Recovery (PITR).

This article walks through configuring WAL archiving, taking a base backup, simulating an accidental data-loss incident, and recovering the database to a chosen point in time on PostgreSQL 16 running on Ubuntu. It also covers how PostgreSQL's timeline mechanism keeps multiple recovery attempts from colliding.

## Write-Ahead Log (WAL)

PostgreSQL never modifies data files directly without first recording the change. Every change is written sequentially to the Write-Ahead Log before it is applied to the actual data files. This journal is what allows the server to recover cleanly after a crash: on restart, PostgreSQL replays the WAL records generated since the last checkpoint to bring the data files back to a consistent state.

WAL records are stored in the `pg_wal/` subdirectory of the cluster's data directory as a sequence of fixed-size segment files (16 MB by default). If these segments are continuously copied out to a separate, durable location — a process called WAL archiving — they form a running history of every change made to the database. That history, together with a base backup taken beforehand, is what makes PITR possible: restore the base backup, then replay archived WAL segments forward from that point.

## Point-in-Time Recovery (PITR)

PITR is the process of restoring a physical base backup and then replaying the required WAL records to bring the database to a specific moment in time, rather than simply to the moment the base backup was taken. This makes it possible to recover from mistakes such as an accidental `DELETE` or a dropped table by rolling the database forward to just before the mistake occurred, instead of losing everything since the last full backup.

## Scenario overview

The examples below use a sample fintech database with two tables `customers` and `transactions` to demonstrate the effect of an accidental deletion and a dropped table, followed by a recovery to a chosen point in time.

> **Environment:** PostgreSQL 16 on Ubuntu, with the cluster's default data directory at `/var/lib/postgresql/16/main` and configuration at `/etc/postgresql/16/main/postgresql.conf`. Adjust the version number in paths and commands if using a different release.

## Step 1 — Configure WAL archiving

WAL archiving must be enabled before a base backup is taken, since PITR depends on having an unbroken sequence of archived WAL segments from the start of the backup onward. Open `postgresql.conf` and set the following:

1. `wal_level` — set to `replica` or higher (`logical`), since PITR requires more than the minimal WAL information.
2. `archive_mode` — set to `on` to enable archiving.
3. `archive_command` — the shell command PostgreSQL runs to copy each completed WAL segment to the archive location.

```conf
archive_mode = on
wal_level = replica
archive_command = 'test ! -f /var/lib/postgresql/pg_basebackup/archive/%f && cp %p /var/lib/postgresql/pg_basebackup/archive/%f'
```

Here, `%p` is replaced with the path of the WAL file to archive and `%f` with just its filename. The `test ! -f ... &&` check guards against overwriting a segment that has already been archived: the copy only runs if the destination file does not yet exist. A filled-in example looks like:

```bash
test ! -f /var/lib/postgresql/pg_basebackup/archive/000000010000000A00000065 &&
  cp pg_wal/000000010000000A00000065 /var/lib/postgresql/pg_basebackup/archive/000000010000000A00000065
```

> **Security:** the archive directory should be writable only by the `postgres` system user and, ideally, located on separate storage (or a separate host) from the primary data directory. If the archive lives on the same disk as `pg_wal`, a single storage failure destroys both the live database and its recovery history. For this test exercise, we are storing it in the same machine.

Restart PostgreSQL for the changes to take effect, then verify the settings:

```bash
sudo systemctl restart postgresql
sudo -u postgres psql
```

```sql
SHOW wal_level;          -- expect: replica
SHOW archive_mode;       -- expect: on
SHOW archive_command;    -- expect: the copy command above
```

## Step 2 — Create a base backup

`pg_basebackup` can be used to create a base backup. The process creates a backup history file that is immediately stored in the WAL archive area, containing the backup's label string, its start and end times, and the WAL segments it spans.

`pg_basebackup` connects as a replication client, so the connecting role needs the `REPLICATION` privilege and `pg_hba.conf` must permit a replication connection for it. Switch to the `postgres` OS user first, since the data directory is owned by it:

```bash
sudo -u postgres -i
pg_basebackup -h localhost -U replicator -D /var/lib/postgresql/pg_basebackup/data \
  -Fp -Xs -P -v
```
Meaning of Flags here:

- `-Fp` — plain format, writing out a directory that mirrors the data directory (easier to inspect and restore than the tar format).
- `-Xs` — stream WAL as the backup is taken, so segments generated during the (potentially long) backup are captured too, not just those archived separately.
- `-P -v` — show progress and verbose output, useful for confirming the backup completed cleanly.

Once the command finishes, verify the backup is available by checking the data and archive directories for the expected files. The `backup_label` file inside the backup directory records the backup's start time — in this walkthrough, 2026-09-21 18:49:04 UTC — which is useful later for sanity-checking a recovery target.

## Step 3 — Simulate a disaster scenario

Before making the changes we'll want to recover from, let's take a snapshot of the current `customers` and `transactions` tables for comparison.

<figure>
  <img src="articles/Database Backup/images/starting_snapshot_2026_09_24_10_59_NST.png" alt="psql output showing 6 customers and 22 transactions">
  <figcaption>Fig. 1 — Initial snapshot: 6 customers and 22 transactions, 2026-09-24 05:14 UTC.</figcaption>
</figure>

Currently there are 22 rows in `transactions` and 6 rows in `customers`, with each customer having at least one associated transaction. First, an accidental deletion is simulated with the delete command for transactions of customers with ID greater than 4:

```sql
DELETE FROM transactions WHERE customer_id > 4;
```

<figure>
  <img src="articles/Database Backup/images/after_deletion_9_24_11_11.png" alt="psql output showing transactions after deleting customers 5 and 6">
  <figcaption>Fig. 2 — Transactions for customers 5 and 6 removed, 2026-09-24 05:26 UTC (14 rows remain).</figcaption>
</figure>

As shown above, transactions for customer IDs 5 and 6 are gone. Next, the `transactions` table is dropped entirely (another accidental action), followed by a manual WAL switch to close out the active WAL file in the archive directory:

```sql
DROP TABLE transactions;
SELECT pg_switch_wal();
```

<figure>
  <img src="articles/Database Backup/images/after_drop_9_24_13_17.png" alt="psql output confirming the transactions table has been dropped">
  <figcaption>Fig. 3 — After dropping the transactions table, 2026-09-24 07:36 UTC.</figcaption>
</figure>

## Step 4 — Prepare the cluster for recovery

Recovery replays WAL on top of the base backup, not on top of the live (now-damaged) data directory, so the current data directory must be cleared out and replaced with the base backup before recovery begins.

Stop PostgreSQL first, and before removing anything, keep a copy of the damaged data directory in case it's needed later:

```bash
sudo systemctl stop postgresql

cd /var/lib/postgresql/16/
zip -r main_damaged_backup.zip main/
```

Then clear the live data directory, copy in the base backup, and remove the stale WAL files that came with it — PostgreSQL will pull what it needs from the archive via `restore_command`:

```bash
rm -rf /var/lib/postgresql/16/main/*
cp -r /var/lib/postgresql/pg_basebackup/data/. /var/lib/postgresql/16/main/
rm -rf /var/lib/postgresql/16/main/pg_wal/*
```

> **Ownership:** after copying files as a different user (or with sudo), confirm the data directory and its contents are owned by `postgres` and permissioned `0700`, or PostgreSQL will refuse to start. See the Troubleshooting section below for the exact commands.

## Step 5 — Perform Point-in-Time Recovery

With the base backup in place, PostgreSQL needs to know where to find archived WAL segments and how far to replay them. Edit `postgresql.conf` and set:

```conf
restore_command = 'cp /var/lib/postgresql/pg_basebackup/archive/%f %p'
recovery_target_time = '2026-09-24 05:20:00'
```

As before, `%f` is the WAL filename to fetch and `%p` the path PostgreSQL expects it at. `recovery_target_time` is the point up to which WAL should be replayed — here, a moment between the initial snapshot (05:14) and the accidental deletion (05:26), so the recovered database should contain all 22 original transaction rows.

Create a `recovery.signal` file in the data directory to tell PostgreSQL to start in recovery mode rather than as a normal primary:

```bash
sudo -u postgres touch /var/lib/postgresql/16/main/recovery.signal
```

<figure>
  <img src="articles/Database Backup/images/recovery_target_time_9_24_5_20_UTC_initial_snapshot.png" alt="postgresql.conf showing restore_command and recovery_target_time set to 05:20:04">
  <figcaption>Fig. 4 — restore_command and recovery_target_time configured for the 05:20:04 UTC target.</figcaption>
</figure>

Restart the server. It will come up in recovery mode and begin replaying archived WAL:

```bash
sudo systemctl restart postgresql
```

Confirm the server is in recovery:

```sql
SELECT pg_is_in_recovery();
```

A result of `t` confirms the server is still in recovery mode, replaying (or having replayed) WAL up to the target.

## Step 6 — Verify and promote the recovered database

Before trusting the recovered instance, confirm its contents match what's expected for the chosen recovery target:

```sql
SELECT * FROM customers;
SELECT * FROM transactions;
```

<figure>
  <img src="articles/Database Backup/images/initial_snapshot_at_5_20_UTC.png" alt="psql output showing all 6 customers and 22 transactions restored">
  <figcaption>Fig. 5 — Recovered state at target 05:20:04 UTC: all 6 customers and 22 transactions are present, confirming recovery to just before the DELETE.</figcaption>
</figure>

If the data is not as expected, stop the server, remove `recovery.signal`, adjust `recovery_target_time`, and repeat from Step 4 rather than proceeding — do not promote a recovery that hasn't been verified.

If the data matches expectations, the recovered instance can be promoted to a normal, writable primary. By default, `recovery_target_action` is `'pause'`, so PostgreSQL stops applying WAL exactly at the target and waits for a decision. The correct way to exit recovery and make the server writable is `pg_promote()`, not `pg_wal_replay_resume()` — the latter only resumes replaying WAL further, it does not end recovery mode:

```sql
SELECT pg_promote();
```

Confirm promotion succeeded:

```sql
SELECT pg_is_in_recovery();   -- f means the server is no longer in recovery mode
```

> **Read-only until promoted:** while `recovery.signal` is present and the server hasn't been promoted, the database is available only for read-only queries. Writes will be rejected until `pg_promote()` completes.

As an alternative to the pause-and-promote workflow, setting `recovery_target_action = 'promote'` in `postgresql.conf` before starting recovery makes PostgreSQL promote automatically as soon as it reaches the target — useful for scripted or unattended recoveries where the target has already been validated.

## Troubleshooting

**"Requested WAL segment has already been removed" or checkpoint not found.** This usually means the base backup and the archive are out of sync. Compare the checkpoint and timeline information recorded in each location:

```bash
sudo /usr/lib/postgresql/16/bin/pg_controldata /var/lib/postgresql/16/main | grep -E "Latest checkpoint|REDO|WAL file|TimeLine"
sudo /usr/lib/postgresql/16/bin/pg_controldata /var/lib/postgresql/pg_basebackup/data | grep -E "Latest checkpoint|REDO|WAL file|TimeLine"
```

**Permission errors on startup.** Check the server log for the specific error:

```bash
cat /var/log/postgresql/postgresql-16-main.log
```

A typical message looks like:

```text
FATAL: data directory "/var/lib/postgresql/16/main" has invalid permissions
DETAIL: Permissions should be u=rwx (0700) or u=rwx,g=rx (0750).
```

Fix ownership and permissions, then retry:

```bash
sudo chown -R postgres:postgres /var/lib/postgresql/16/main
sudo chmod 700 /var/lib/postgresql/16/main
```

## Understanding timelines

A PostgreSQL timeline is a branch of WAL history created when you promote a database after PITR, allowing the original history and the new recovered history to coexist without their WAL being confused or overwritten. For example, once a recovered database is promoted as the main database, and later another PITR is needed to a different time, data isn't overwritten — instead a new timeline is created for the new target, avoiding collision and confusion.

To see this in practice, suppose the 05:20 recovery target above turns out not to be the one actually needed, and the correct target is instead somewhere between the deletion and the table drop — for example, 06:00 UTC. Stop the server, clear the data directory, restore the base backup again, and set a new target:

```bash
sudo systemctl stop postgresql
rm -rf /var/lib/postgresql/16/main/*
cp -r /var/lib/postgresql/pg_basebackup/data/. /var/lib/postgresql/16/main/
rm -rf /var/lib/postgresql/16/main/pg_wal/*
```

```conf
restore_command = 'cp /var/lib/postgresql/pg_basebackup/archive/%f %p'
recovery_target_time = '2026-09-24 06:00:00'
```

```bash
sudo -u postgres touch /var/lib/postgresql/16/main/recovery.signal
sudo systemctl restart postgresql
```

<figure>
  <img src="articles/Database Backup/images/at_6_00_before_drop.png" alt="postgresql.conf showing recovery_target_time reset to 06:00:00">
  <figcaption>Fig. 6 — Second recovery attempt: recovery_target_time reset to 2026-09-24 06:00:00 on a fresh copy of the base backup.</figcaption>
</figure>

If a previous recovery had paused WAL replay at a target without promoting, resume it with `pg_wal_replay_resume()` before proceeding; here, since the process restarts from a clean copy of the base backup, replay simply runs forward to the new target. Once recovery completes, verify the result and, once satisfied, promote:

```sql
SELECT * FROM customers;
SELECT * FROM transactions;
SELECT pg_promote();
```

<figure>
  <img src="articles/Database Backup/images/data_at_6_00_before_drop.png" alt="psql output showing 14 transaction rows after recovering to 06:00">
  <figcaption>Fig. 7 — Recovered state at 06:00 UTC: 14 transaction rows (customers 5 and 6 already deleted, table not yet dropped).</figcaption>
</figure>

The active timeline after a recovery can be confirmed with:

```sql
SELECT timeline_id FROM pg_control_checkpoint();
```

Because each recovery creates a new timeline, both the 05:20 recovery and the 06:00 recovery remain distinguishable in the archive's history — neither overwrote the other's WAL, and either could be revisited.

## Conclusion

Database Backup and Point-in-Time Recovery turn PostgreSQL's Write-Ahead Log from an internal crash-safety mechanism into a general-purpose recovery tool. A base backup captures a known-good starting state; a continuously archived WAL stream captures everything that happened afterward. Together, they let a database be rolled forward to any moment — not just to the last backup — which is what makes it possible to undo an accidental `DELETE` or a dropped table without losing unrelated work done in between.

This walkthrough covered the full cycle on PostgreSQL 16: enabling WAL archiving, taking a base backup with `pg_basebackup`, simulating data loss, restoring to a chosen target with `restore_command` and `recovery_target_time`, verifying the recovered state before promoting with `pg_promote()`, and finally revisiting the same base backup with a different target to show how PostgreSQL's timeline mechanism keeps multiple recovery attempts from colliding.

The mechanics here are worth understanding even for teams that ultimately adopt a managed backup tool, since pgBackRest, Barman, and similar tools are automating exactly this process under the hood. Knowing what `recovery_target_time`, `recovery.signal`, and timelines actually do makes it far easier to diagnose a recovery that isn't behaving as expected, whether it's driven by hand or by tooling — and the only way to have that confidence when an incident actually happens is to have tested the recovery path before it does.