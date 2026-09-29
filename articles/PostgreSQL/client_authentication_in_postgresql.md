---
title: "Client Authentication in PostgreSQL"
description: "How pg_hba.conf controls who can connect to PostgreSQL, over which channel, and with what proof of identity — understaning with examples."
date: "2026-09-29"
tags:
  - PostgreSQL
  - Authentication
  - Security
---

# Client Authentication in PostgreSQL 16

Before a client can touch anything in a PostgreSQL database, it first has to establish a connection — and PostgreSQL decides whether that connection is even allowed before a single query runs. This is **host-based authentication**: a set of rules that determine which clients may connect, which databases and roles they may connect to, and what they must prove about their identity to do so.

Those rules live in a single file, `pg_hba.conf` ("host-based authentication"), typically found at:

```text
/etc/postgresql/<version>/main/pg_hba.conf
```

The exact path can vary by OS and installation method, but the format and behavior described here are the same everywhere.

## Two kinds of connection

PostgreSQL distinguishes between two channels a client can connect through:

- **TCP/IP connections** — a remote (or local) client connecting over the network, identified by an IP address. These can optionally be encrypted with SSL/TLS.
- **Unix-domain socket connections** — a client connecting from a process running on the same machine as the server, without going over the network at all. On most Linux installations this happens through a socket file such as `/var/run/postgresql/.s.PGSQL.5432`.

## Decoding component of pg_hba.conf rule

Every rule in `pg_hba.conf` is made up of five fields:

| Field        | Meaning |
|--------------|---------|
| **TYPE**     | How the client is connecting. Common values: `local` (Unix-domain socket), `host` (TCP/IP, with or without SSL), `hostssl` (TCP/IP, SSL required), `hostnossl` (TCP/IP, SSL forbidden). |
| **DATABASE** | Which database the rule applies to — either a specific `database_name`, or `all` to match every database. |
| **USER**     | Which PostgreSQL role the rule applies to. In PostgreSQL, "user" and "role" are effectively the same thing — a user is simply a role that has been granted login privilege. |
| **ADDRESS**  | The client IP range the rule applies to (only relevant for `host`-type rules). `192.168.24.3/32` matches exactly that one address; `192.168.24.0/24` matches the whole range from `192.168.24.0` to `192.168.24.255`. |
| **METHOD**   | How PostgreSQL should authenticate the client. Common values: `trust` (no password required at all), `scram-sha-256` (password-based authentication), and `peer` (Unix-socket only — PostgreSQL compares the connecting OS username against the requested PostgreSQL role, and allows the connection only if they match). |

PostgreSQL reads these rules **top to bottom** and uses the *first* one that matches a given connection attempt.

## A typical default configuration

A freshly installed PostgreSQL cluster usually ships with rules along these lines:

```conf
# TYPE   DATABASE   USER      ADDRESS           METHOD

# Database administrative login by Unix-domain socket
local    all        postgres                    peer

# IPv4 local connections
host     all        all       127.0.0.1/32       scram-sha-256

# IPv6 local connections
host     all        all       ::1/128            scram-sha-256

# Replication connections, e.g. for WAL streaming
host     replication all      192.168.24.3/32    scram-sha-256
```

<figure>
  <img src="articles/PostgreSQL/images/client-authentication/rule_for_unix_domain_socket.png" alt="pg_hba.conf showing the TYPE, DATABASE, USER, ADDRESS, and METHOD columns with default rules">
  <figcaption>Fig. 1 — A pg_hba.conf file with its default Unix-socket and local rules.</figcaption>
</figure>

## Walking through it: connecting as different users

The clearest way to see these rules in action is to try connecting a few different ways and watch which rule fires each time.

### Attempt 1 — connecting as an OS user with no matching role

Logged in as the OS user `mohan`, running `psql` against the local Unix socket:

```bash
psql -U mohan
```

```text
psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed:
FATAL:  Peer authentication failed for user "mohan"
```

<figure>
  <img src="articles/PostgreSQL/images/client-authentication/login_as_os_user.png" alt="Terminal showing peer authentication failed for user mohan">
  <figcaption>Fig. 2 — Peer authentication fails because no PostgreSQL role named "mohan" exists.</figcaption>
</figure>

This is `pg_hba.conf`'s first rule in action: PostgreSQL checks the first matching line, `local all postgres peer`, which only allows the `postgres` role — `mohan` doesn't match, so PostgreSQL moves on. The next rules apply to TCP/IP connections, not the Unix socket being used here, so nothing else matches either, and the connection is rejected. The `peer` method never gets a chance to compare usernames, because there's no PostgreSQL role called `mohan` for it to compare against in the first place.

There are two ways to fix this: create a PostgreSQL role named `mohan`, or connect as a role that already exists.

### Attempt 2 — connecting as the existing postgres role

```bash
sudo -u postgres psql -U postgres
```

Here, the OS user is switched to `postgres` first (via `sudo -u postgres`), and the PostgreSQL role requested is also `postgres` — so the `local all postgres peer` rule matches cleanly, `peer` authentication succeeds because the OS username and the requested role agree, and no password is needed.

<figure>
  <img src="articles/PostgreSQL/images/client-authentication/unix_domain_socket_postgres_user.png" alt="Terminal showing successful login as the postgres role via peer authentication">
  <figcaption>Fig. 3 — Logging in as the postgres role over the Unix-domain socket, authenticated via peer.</figcaption>
</figure>

Once connected, it's worth confirming exactly who you're logged in as and what's visible:

```sql
SELECT current_user;
\l
```

<figure>
  <img src="articles/PostgreSQL/images/client-authentication/connected_as_postgres_user.png" alt="psql output showing current_user as postgres and a list of databases including fintech, postgres, template0, and template1">
  <figcaption>Fig. 4 — Confirming the session is authenticated as postgres, and listing the available databases.</figcaption>
</figure>

### Attempt 3 — connecting as a role with no matching OS account

Now suppose a `dba` role already exists in PostgreSQL, but there's no OS-level user called `dba` on the machine. `peer` authentication can't work here — it depends on an OS username matching a PostgreSQL role name, and no OS process is ever going to run as `dba`. This is exactly the situation `host`-based rules exist for: connect over TCP/IP instead, and authenticate with the password that was set when the role was created.

```bash
psql -h 127.0.0.1 -p 5432 -U dba -d fintech
```

```text
Password for user dba:
SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)
fintech=>
```

<figure>
  <img src="articles/PostgreSQL/images/client-authentication/dba_user_login_with_password.png" alt="Terminal showing a successful TCP/IP login as the dba role with a password prompt and SSL connection details">
  <figcaption>Fig. 5 — Host-based authentication over TCP/IP: the dba role connects with a password, over an SSL-encrypted connection.</figcaption>
</figure>

This time, the `host all all 127.0.0.1/32 scram-sha-256` rule is what matches — the connection is coming in over TCP/IP to the loopback address, so PostgreSQL prompts for a password and verifies it using `scram-sha-256` rather than comparing OS usernames.

## Not to Forget

- **Rule order matters.** PostgreSQL evaluates `pg_hba.conf` top to bottom and stops at the first match — a rule further down the file will never be reached if an earlier, broader rule already matched.
- **`peer` only works for Unix-domain sockets**, and only when the OS username matches the PostgreSQL role name exactly. It's convenient for local administrative access, but it isn't a general-purpose authentication method.
- **`host` rules are what remote (and password-based local) clients need**, and pairing them with `scram-sha-256` means credentials are never sent in a recoverable form over the wire.
- **A role failing to log in isn't necessarily "wrong credentials."** As the `mohan` example shows, the more common cause is simply that no rule in `pg_hba.conf` matches the connection attempt the way you expected it to — reading the file top to bottom, the same way PostgreSQL does, is usually the fastest way to find out why.