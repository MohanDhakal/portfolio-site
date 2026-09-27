---
title: "Logical Backup Postgresql-Part2"
description: "Part 2 — Hands-On Logical Backup: Same-Server Restore, Cross-Version Migration, and Selective Table Restore."
date: "2026-09-23"
tags:
  - PostgreSQL
  - Backup
---
# Overview

In Part 1 we established that a **logical backup** is a file containing a series of SQL commands that recreate database objects as they were at the time of the backup. We also identified three situations where a logical backup is the right tool:

1. **Sync a local table to production**
2. **Migrate to a newer version**
3. **Recover an accidental deletion of a table**

In this article, we put all three into practice using `pg_dump` and `psql` running inside Docker containers. By the end, you will have restored a database on the same server, migrated a database across major PostgreSQL versions, and performed a selective single-table restore — the same technique used to recover from an accidental `DELETE`.

---

## Prerequisites

- Docker installed and running
- Two PostgreSQL containers: one running PostgreSQL 13 and one running PostgreSQL 18

Throughout this article:

- The **PostgreSQL 13 container** is named `postgres-13` and represents the **local** environment.
- The **PostgreSQL 18 container** is named `postgres-18` and represents the **production** environment.

---

## Setting Up the Sample Data

We will create two related tables in the default `public` schema of the `postgres` database:

- `customers(id, name)`
- `transactions(id, customer_id, transaction_status, transaction_type, amount)`

### Step 1: Connect to the Container

```bash
docker exec -it postgres-13 psql postgres -U postgres
```

### Step 2: Create the `customers` Table

```sql
CREATE TABLE customers
(
    id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  VARCHAR(100)
);
```

### Step 3: Create the `transactions` Table

```sql
CREATE TABLE transactions
(
    id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_status  VARCHAR(2),
    transaction_type    VARCHAR(2),
    amount              DECIMAL(8,2),
    customer_id         INT,
    CONSTRAINT fk_customers
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
);
```

### Step 4: Insert Sample Customers

```sql
INSERT INTO customers(name)
VALUES
    ('John Doe'),
    ('Mark Zuckerberg'),
    ('Sam Altman'),
    ('Bill Gates');
```

### Step 5: Insert Sample Transactions

Five transactions for each of the four customers, twenty in total:

```sql
INSERT INTO transactions
    (transaction_status, transaction_type, amount, customer_id)
VALUES
    ('TS', 'CR', 1250.50, 1),
    ('TF', 'DR',  450.75, 1),
    ('TP', 'CR', 3200.00, 1),
    ('TS', 'DR',  875.25, 1),
    ('TF', 'CR', 1500.80, 1),

    ('TF', 'DR',  650.00, 2),
    ('TP', 'CR', 2100.45, 2),
    ('TS', 'CR',  980.25, 2),
    ('TF', 'DR', 1750.00, 2),
    ('TP', 'DR',  425.90, 2),

    ('TP', 'CR', 5000.00, 3),
    ('TS', 'DR', 1250.75, 3),
    ('TF', 'CR',  750.50, 3),
    ('TS', 'DR',  320.25, 3),
    ('TP', 'CR', 1850.00, 3),

    ('TS', 'DR',  950.40, 4),
    ('TF', 'CR', 2750.00, 4),
    ('TP', 'DR',  600.65, 4),
    ('TS', 'CR', 4100.25, 4),
    ('TF', 'DR',  825.00, 4);
```

We now have a working database with structured, related data ready to back up.

---

## Exercise 1: Restore One Database into Another on the Same Server

**Scenario covered:** *Sync a local table to production* (in its simplest form — copying an entire database between two databases on the same server).

We will create a new database called `fintech` and populate it with everything currently in the `postgres` database. This is a pipeline pattern: `pg_dump` streams SQL to standard output, and `psql` reads it from standard input.

### Step 1: Create the `fintech` Database

```bash
docker exec postgres-13 createdb -U postgres fintech
```

### Step 2: Dump and Restore in One Pipeline

```bash
docker exec postgres-13 pg_dump -U postgres -d postgres \
  | docker exec -i postgres-13 psql -U postgres -d fintech
```

This does three things in a single command:

1. `pg_dump -U postgres -d postgres` dumps the `postgres` database as SQL.
2. The pipe (`|`) forwards that SQL stream to the next command.
3. `psql -U postgres -d fintech` replays the SQL into the `fintech` database.

### Step 3: Verify

```bash
docker exec -it postgres-13 psql -U postgres -d fintech
```

```sql
\dt
SELECT COUNT(*) FROM customers;
SELECT COUNT(*) FROM transactions;
```

Both tables should be present with the same row counts as the source.

---

## Exercise 2: Migrate the Database to a Newer PostgreSQL Version

**Scenario covered:** *Migrate to a newer version.*

We now have `fintech` in **PostgreSQL 13** and want to move it to **PostgreSQL 18**. Logical backups shine here because the dump is portable SQL — it is not tied to the on-disk format of any single major version.

### Step 1: Dump the `fintech` Database to a File

```bash
docker exec -i postgres-13 pg_dump -U postgres -d fintech > fintech_all_dump.sql
```

This writes the entire logical content of `fintech` — schemas, tables, data, constraints, indexes — into a single SQL file on the host machine.

### Step 2: Create the Target Database on PostgreSQL 18

```bash
docker exec postgres-18 createdb -U postgres fintech
```

### Step 3: Restore the Dump into PostgreSQL 18

```bash
docker exec -i postgres-18 psql -U postgres -X --set ON_ERROR_STOP=on -d fintech < fintech_all_dump.sql
```

Two important flags:

- `-X` — ignores any user-level `psqlrc` file, so the restore behaves the same everywhere.
- `--set ON_ERROR_STOP=on` — aborts immediately on the first error instead of continuing silently, which is what you want during a migration.

### Step 4: Verify the Migration

```bash
docker exec -it postgres-18 psql -U postgres
```

```sql
\c fintech
\dt
SELECT * FROM customers;
SELECT * FROM transactions;
```

You should see both tables and all rows present in PostgreSQL 18 — the migration is complete.

---

## Exercise 3: Selective Restore — Push a Single Table to Production

**Scenario covered:** *Sync a local table to production.*

At this point, both environments are in sync. Now imagine you add a new table in your **local** environment (PostgreSQL 13) and want to push only that table to **production** (PostgreSQL 18), without touching the rest of the database.

### Step 1: Create a New Table Locally

Add a customer address table in the PostgreSQL 13 `fintech` database:

```sql
CREATE TABLE customer_address (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    country      VARCHAR(100),
    city         VARCHAR(100),
    address1     VARCHAR(255),
    address2     VARCHAR(255),
    customer_id  INTEGER,
    CONSTRAINT fk_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
);
```

### Step 2: Dump Only This Table (Schema Only)

```bash
docker exec -i postgres-13 pg_dump -U postgres -d fintech \
  -t customer_address --schema-only > customer_address_dump.sql
```

Key flags:

- `-t customer_address` — restricts the dump to a single table.
- `--schema-only` — exports only the table definition (no `INSERT` statements).

### Step 3: Restore the Table into Production

```bash
docker exec -i postgres-18 psql -U postgres -d fintech < customer_address_dump.sql
```

### Step 4: Verify

```bash
docker exec -it postgres-18 psql -U postgres -d fintech
```

```sql
\dt
```

The `customer_address` table should now exist in the PostgreSQL 18 `fintech` database, while every other table remains untouched.

This pattern is safe for live production systems because it adds a new object without disturbing existing data.

---

## Bonus: Recovering an Accidentally Deleted Table

**Scenario covered:** *Recover an accidental deletion of a table.*

The previous exercise used `--schema-only`, which exports structure but no data. That is ideal for pushing a brand-new empty table to production. But what if the goal is the opposite — bringing back a table that was **emptied or dropped** after the last dump, along with its rows?

The answer is the same `pg_dump -t` pattern, **without** `--schema-only`:

```bash
docker exec -i postgres-13 pg_dump -U postgres -d fintech \
  -t customers > customers_with_data.sql

docker exec -i postgres-13 psql -U postgres -d fintech < customers_with_data.sql
```

This dump contains both the `CREATE TABLE` statement and the `INSERT` statements that rebuild every row, so you can recover the table and its data in one shot.

**Remember the limits of this approach** (as covered in Part 1): the table is restored to the state it was in **at the moment the dump was taken**. Any rows inserted or updated after that dump are not recovered. For point-in-time recovery to an exact moment, you need a **physical backup**, which is the topic of Part 3.

---

## Summary

In this article we used one tool — `pg_dump` — to solve three different problems:

| Situation | Command pattern | Key flag |
|---|---|---|
| **Sync local table to production** | `pg_dump -t <table> --schema-only` piped into `psql` | `-t`, `--schema-only` |
| **Migrate to a newer version** | `pg_dump -d <db> > file.sql`, then restore on the new server | none |
| **Recover a deleted table** | `pg_dump -t <table>` (with data) piped into `psql` | `-t` |

The common thread is portability. A logical backup is plain SQL, so it can be replayed into any compatible database — the same server, a different database on that server, or a completely different PostgreSQL major version on a different host.

---

## What Comes Next

Logical backups are powerful but have two fundamental limits: they restore only to the moment of the dump, and they replay every SQL statement and rebuild every index, which becomes slow on large datasets.

In **Part 3**, we switch to **physical backups**. We will set up `pg_basebackup` with WAL archiving and perform a **point-in-time recovery** — restoring a database to the exact second before a mistake, so that almost nothing committed is lost.

---

*Part 2 of the "Database Backup and Recovery with PostgreSQL" series.*