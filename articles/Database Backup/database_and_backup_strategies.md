---
title: "Database and Different Backup Strategies"
description: "Part 1 — Database and Backup Strategies to Handle Different Kinds of Database Failure."
date: "2026-09-21"
tags:
  - PostgreSQL
  - Backup
---

## Overview

This is the first article in a series on logical and physical backups in PostgreSQL. Before running any backup command, we need a shared foundation: what a relational database is, where it is used, and what can go wrong with it. With that in place, the two backup strategies read as answers to specific problems rather than abstract terms.

**In this article:**

- What a relational (SQL) database is and where it is used
- Six situations that call for a backup or recovery
- Logical versus physical backups and when to choose each

---

## 1. What is a Database?

According to IBM, a database is a digital repository for storing, managing and securing organized collections of data. A database system has two parts:

- **The physical hardware** where the data lives
- **The software**, called the Database Management System (DBMS), that organizes the data and controls access to it

PostgreSQL, MySQL, MongoDB and Oracle are all examples of a DBMS.

---

## 2. Relational Databases

There are many kinds of databases, but this series focuses on the **relational database**, also known as a **SQL database**. It stores data in tables of rows and columns, separates data by entity, and links the entities so they can be combined into one complete picture.

A fintech system, for example, might keep customers in one table and their transactions in another. The two are linked by a shared column called a **foreign key**: each transaction carries the `customer_id` of the customer who made it.


### Why Consistency Matters

Relational databases are chosen where data has a defined structure and integrity and consistency are non-negotiable. Take a QR payment: money must leave the payer's account and arrive in the receiver's account. Either both steps happen or neither does, even when thousands of payments arrive at the same moment. This all-or-nothing behavior comes from **ACID transactions**.

### What Does ACID Mean?

| Property | Definition |
|---|---|
| **Atomicity** | A transaction happens fully or not at all |
| **Consistency** | Data always moves from one valid state to another |
| **Isolation** | Concurrent transactions do not interfere with each other |
| **Durability** | Once committed, data survives a crash |

### Where SQL Databases Are Used

- **Fintech and banking** — Accounts, balances and transactions depend on ACID guarantees, clear relationships and auditability.
- **E-commerce** — Customers, orders, payments and order tracking need reliable, efficient reads and writes.
- **ERP and business systems** — Employees, suppliers, payroll, invoices and accounting are tightly related, and SQL can report across all of them.
- **Healthcare and airline or hotel booking** — Patient records, seats and rooms cannot be lost, duplicated or double-booked.

In all these domain, losing or corrupting data is costly. That is why backup and recovery planning is a core part of running a database, not an afterthought.

---

## 3. When Things Go Wrong

Suppose our PostgreSQL database is set up properly and running smoothly. Then one of the following happens, or we need to do one of the following:

| # | Situation | What it means in practice |
|---|---|---|
| 1 | **Sync a local table to production** | You created and tested a table locally and want the same table on the production database server. |
| 2 | **Migrate to a newer version** | You want to move your data to a newer PostgreSQL version. |
| 3 | **Accidental table deletion** | You forgot to add a proper `WHERE` clause before running a `DELETE`, and now you need to recover the table with its data. |
| 4 | **Crash during transactions** | The server crashes while transactions are being processed, leaving data files inconsistent or damaged. |
| 5 | **Data-centre or infrastructure disaster** | A data centre catches fire or floods, or public unrest damages the infrastructure. The hardware, and everything on it, is gone. |
| 6 | **Admin drops a table in production** | A developer logs in as an admin by mistake and drops a table. The system goes down, every user is affected, and the data must come back exactly as it was just before the mistake. |

We can divide these six situations into two groups:

- **The first three** are about moving, copying or selectively restoring data while the rest of the system stays healthy.
- **The last three** are about losing or damaging the database itself and bringing back a working system.

That split maps directly onto the two backup strategies below.

---

## 4. Two Kinds of Backup

PostgreSQL offers two families of backup and restore: **logical backup** and **physical backup**. Each was designed for different use cases, and a mature production setup usually uses both.

### Logical Backup

A logical backup is a copy of a database's **logical content** — meaning its tables, schemas and data — exported as an SQL script or an archive file. Because it describes the content and not the storage files, it is portable and flexible. In PostgreSQL this is the job of tools such as `pg_dump`.

**Key strengths:**

- **Selective restoration** — A single table, a schema or specific objects can be restored without touching the rest of the database.
- **Minimal or no downtime** — A selective restore can run while the database stays online.
- **Granular control** — It suits migrations, copies between servers and partial restores.

Situations **1, 2 and 3** fit here. Sending a tested table to production, moving to a newer version and bringing back an accidentally emptied table all mean taking specific objects out of a backup and loading them into a database, without caring about the storage files underneath. For situation 3, we restore the table from the latest dump file.

**Where logical backups fall short:**

- **Slow restores at scale** — The database has to replay every statement in the dump and rebuild every index, so a large database with many tables can take a very long time. Rebuilding a whole lost server this way is slow.
- **Fixed recovery point** — A dump restores the data as it was when the dump was taken. Changes made afterwards, such as rows updated after last night's dump in situation 3, are not recovered. A logical backup cannot take us to an exact moment in time.
- **Cluster-wide objects** — Roles and similar cluster-level objects are not part of a single-database dump and must be saved separately, for example with `pg_dumpall --globals-only`.

### Physical Backup

A physical backup copies the database's **actual files on disk**. In PostgreSQL that means the data directory plus the **write-ahead log (WAL)**, the continuous record of every change (other database systems call similar files redo logs). These backups are usually kept in cloud or offline storage so they survive the loss of the main site.

The main advantage is **point-in-time recovery (PITR)**. Starting from a full copy of the data files and replaying the archived WAL up to a chosen moment, we can rebuild the database exactly as it was at that moment — for example, one second before a table was dropped. The files can be copied while the database is running (a **hot backup**) or while it is stopped (a **cold backup**).

Situations **4, 5 and 6** belong here. After a crash that leaves files damaged, a physical backup brings back a healthy copy of the data files. After the loss of a whole site, an off-site copy of the files and WAL lets us rebuild the system elsewhere. After an admin drops a table, PITR takes the database back to the moment just before the mistake. Unlike a dump, it recovers up to the last archived WAL and not just the last backup, so almost nothing that was committed is lost.

### Important Note on Crash
PostgreSQL already replays its WAL automatically after a simple crash, so most clean crashes recover on their own. A physical backup becomes essential when the crash leaves files damaged or the storage itself is lost.

---

## 5. Matching Each Situation to a Strategy


The table below puts the two strategies side by side.

| | Logical Backup | Physical Backup |
|---|---|---|
| **What is copied** | Tables, schemas and data, as an SQL script or archive file | The data files and WAL archive on disk |
| **PostgreSQL tools** | `pg_dump`, `pg_dumpall` | `pg_basebackup`, WAL archiving |
| **Granularity** | A single table, a schema or the whole database | The whole database cluster |
| **Restore speed on large data** | Slow: statements are replayed and indexes rebuilt | Typically much faster: files are copied back, then WAL is replayed |
| **Recovery point** | The moment the dump was taken | Any chosen moment (PITR), up to the last archived WAL |
| **Across versions or servers** | Flexible, ideal for migrations | Needs a compatible PostgreSQL major version and platform |
| **Best for** | Migrations, copies, restoring a table or schema | Disaster recovery, crash recovery, undoing major mistakes |

---

## 6. Conclusion

Relational databases hold data where accuracy and consistency matter most, which makes recovering from failure a core responsibility. The six situations we looked at come in two kinds. Some only ask us to move or restore a part of the data. Others threaten the survival of the whole system.

- **Logical backups** answer the first kind. They are portable and selective, and they can bring back a deleted table from a dump file, but they restore slowly at scale and only to the moment the dump was taken.
- **Physical backups** answer the second kind. They copy the real files, restore faster and enable point-in-time recovery, but they are less flexible and tied to the same PostgreSQL major version.

Neither strategy is better in every case. The right choice depends on the problem in front of you, and a solid production setup usually combines both.

---

## Test Restores

> A backup we have never restored is only a hope.

Whichever strategy we choose, practice the restore regularly on a separate server and time it, so we know it works before you need it.

---

## What Comes Next

In the next articles we will use a PostgreSQL database to see each strategy in action:

1. Take a logical backup and restore a deleted table from it.
2. Set up physical backups with WAL archiving and perform a point-in-time recovery.

We will walk through the same situations listed here.

---

*Part 1 of the "Database Backup and Recovery with PostgreSQL" series.*