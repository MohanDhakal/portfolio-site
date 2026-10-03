---
title: "Roles and Privileges Management in PostgreSQL"
description: "Creating and Managing Users and Roles in PostgreSQL with Role-level, Object-level privileges, and Ownership management. "
date: "2026-10-3"
tags:
  - PostgreSQL
  - Authorization
  - Roles
  - Privileges
---

In PostgreSQL, roles are used to manage both users and user groups. A role can log in, own database objects, and receive permissions such as `CONNECT`, `SELECT`, `INSERT`, `UPDATE`, and `EXECUTE`.

## Understanding PostgreSQL Authorization

We can divide PostgreSQL authorization into three levels:

1. **Role-level privileges:** What can this role do at the PostgreSQL level? For example, `LOGIN`, `REPLICATION`, `CREATEDB`, and `CREATEROLE`.
2. **Object-level privileges:** What can this role do with a particular object? For example, `CONNECT`, `USAGE`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `EXECUTE` (for functions and procedures).
3. **Ownership:** Does this role control the object itself? Can it perform operations such as `ALTER` or `DROP` on the object?

## Planning Access Levels

Before assigning privileges, let's first categorize the different levels of database access within an organization and define the responsibilities of each role.

For example, in a fintech organization, database access can be organized into the following roles:

1. Database Administrator
2. Developers
3. Business/Data Analysts

The sections below create each of these roles step by step.

---

## 1. Database Administrator

A DBA can be given administrative privileges over the specific databases they are authorized to manage.

For example, a DBA may be allowed to:

- Connect to the assigned database.
- Create and manage schemas and database objects.
- Create and manage roles within the permitted scope.
- Assign and revoke object-level privileges.
- Manage access to tables, sequences, functions, and other database objects.

The goal is to give the DBA enough administrative control over the database without giving them unrestricted access to the entire PostgreSQL cluster.

To create a database admin, we log in as a superuser and create the admin role with the responsibilities listed above.

### Step 1: Create the admin role group

First, we define a role group. In this case, it is the admin role group.

```sql
CREATE ROLE admin;
```

If you run `\du` in the terminal, you will see that the `admin` role is created, but its attribute says `Cannot login`. This is fine, because a group role is abstract and should not log in as a database user.

A role with no login can act as a user group. Many users can be members of this group and receive all the privileges assigned to it. When a new user is added to the `admin` role, they automatically receive all the object privileges defined for it. However, role attributes such as `CREATEROLE` and `CREATEDB` are **not** passed on directly to members.

### Step 2: Assign role attributes to admin

Let's give the `admin` role its attributes. First, allow `admin` to create other roles, so it can create downstream users with lighter privileges. We also add the `REPLICATION`, `BYPASSRLS`, and `CREATEDB` attributes.

```sql
ALTER ROLE admin CREATEROLE;
ALTER ROLE admin REPLICATION;
ALTER ROLE admin BYPASSRLS;
ALTER ROLE admin CREATEDB;
```

Confirm the attributes of the `admin` role using `\du`. The attributes column should now list all the attributes defined above.

### Step 3: Grant database-level privileges

Now connect to the database as a superuser and run the following commands.

Allow the admin role to connect to the database:

```sql
GRANT CONNECT ON DATABASE db_name TO admin;
```

Allow the admin role to create new objects in the database:

```sql
GRANT CREATE ON DATABASE db_name TO admin;
```

### Step 4: Grant schema-level privileges

Give access to an existing schema. `USAGE` allows access to the objects in the schema, and `CREATE` allows the role to create new objects in it.

```sql
GRANT USAGE, CREATE ON SCHEMA schema_name TO admin;
```

### Step 5: Grant privileges on existing objects

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA schema_name TO admin;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA schema_name TO admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA schema_name TO admin;
```

### Step 6: Create a user and assign the admin role

Now let's create a user and assign the `admin` role to that user to make them an admin.

A user (or member) is just a role with the `LOGIN` attribute.

```sql
CREATE ROLE john LOGIN;
```

Grant the `admin` role to `john`:

```sql
GRANT admin TO john;
```

> **Note:** Although `john` inherits all the object privileges of the `admin` role, role attributes are not automatically inherited by members. To perform operations that need those attributes, the member has to temporarily switch to the role using `SET ROLE admin;`.

Now open a `psql` terminal and confirm the access privileges of the `admin` role. Check the privileges on all tables and sequences in the `public` schema, as shown in the image below.

![Privileges of the admin role on tables and sequences](articles/PostgreSQL/images/roles-management/admin-privileges.png)

The result shows that the `admin` role can insert, update, read, and delete data on all tables currently available in the `public` schema.

### Step 7: Confirm and change ownership

Before proceeding, let's check who currently owns the `fintech` database. Run the following query:

```sql
SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database
WHERE datname = 'fintech';
```

This lists the database name and its owner. Currently, the `fintech` database is owned by the `dba` role, as shown in the image below.

![Current owner of the fintech database](articles/PostgreSQL/images/roles-management/db-owner.png)

We want to change this owner. To change the owner of a database, you must either be the current owner or a superuser. The new owner role must also be allowed to own the database.

Log in as a superuser (`postgres`) and run:

```sql
ALTER DATABASE db_name OWNER TO admin;
```

![Changing the database owner to admin](articles/PostgreSQL/images/roles-management/alter-owner.png)

> **Note:** Changing the ownership to the `admin` role does not directly give ownership rights to its members. So `john` cannot perform ownership actions directly. However, after running `SET ROLE admin;`, `john` can perform actions that need ownership privileges.

---

## 2. Developers

Developers need access to the database objects required to build and maintain applications.

They may be allowed to:

- Connect to the assigned database.
- Read existing database objects.
- Insert, update, and delete data where required.
- Create or modify database objects where their responsibilities require it.

Developer access should generally be limited to the databases and objects needed for their development work.

Before creating a role for developers, we have to decide what kind of privileges they should have. Developers generally do not need role-level privileges, but they may need object-level permissions, and ownership of the objects they create.

To assign privileges or roles to developers, first log in as an admin user:

```bash
psql -U john -d fintech
```

```sql
SET ROLE admin;
```

### Step 1: Create the developers group role

```sql
CREATE ROLE developers;
```

### Step 2: Create the developer users

```sql
CREATE ROLE ram LOGIN;
CREATE ROLE shyam LOGIN;
```

### Step 3: Create schemas

To give developers access to a specific set of schemas, we create two schemas for different purposes. Run these as the admin:

```sql
CREATE SCHEMA dev;        -- schema for developers
CREATE SCHEMA reporting;  -- schema for analysts
```

### Step 4: Grant the required privileges to developers

```sql
GRANT CONNECT ON DATABASE db_name TO developers;
GRANT CREATE ON DATABASE db_name TO developers;
GRANT TEMPORARY ON DATABASE db_name TO developers;   -- allows temporary table creation

GRANT USAGE ON SCHEMA dev TO developers;             -- gives access to the schema
GRANT CREATE ON SCHEMA dev TO developers;            -- allows object creation inside the schema

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dev TO developers;
```

### Step 5: Assign the role to the users

```sql
GRANT developers TO ram;
GRANT developers TO shyam;
```

### Step 6: Test the setup as a developer

Now connect to the `fintech` database as `ram` and perform the following operations.

**1. Create a table**

```sql
CREATE TABLE dev.employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(150)
);
```

**2. Insert some data**

```sql
INSERT INTO dev.employees (name, email)
VALUES
    ('John Doe', 'john@example.com'),
    ('Alice Smith', 'alice@example.com'),
    ('Bob Wilson', 'bob@example.com'),
    ('Mohan Kumar', 'mohan@example.com');
```

**3. Query the data**

```sql
SELECT * FROM dev.employees;
```

> **Note:** A table created by `ram` is also owned by `ram`. This means `shyam` cannot access the table by default. To fix this, you have to explicitly grant access on the table to `shyam`, or grant access to the `developers` role so that all its members get access indirectly.

---

## 3. Business/Data Analysts

Business and data analysts generally need read-only access to data for reporting, analysis, and business decisions.

They may be allowed to:

- Connect to the assigned database.
- Read data from authorized schemas and tables.
- Query views created specifically for reporting or analysis.

They should not normally have privileges to insert, update, or delete data, and they should not have administrative or replication privileges.

### Step 1: Create the analyst role

As an admin, create the `analyst` role. Then grant it `CONNECT` on the database and read-only access to the tables in the `reporting` schema.

```sql
CREATE ROLE analyst;

GRANT CONNECT ON DATABASE db_name TO analyst;     -- fintech database
GRANT USAGE ON SCHEMA reporting TO analyst;       -- reporting schema
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO analyst;
```

### Step 2: Create a user and assign the analyst role

```sql
CREATE ROLE finance LOGIN;
GRANT analyst TO finance;
```

### Step 3: Copy the employees table from `dev` to `reporting`

Now switch to a developer role and copy the `employees` table, along with its data, from the `dev` schema to the `reporting` schema.

**3.1 Dump the table structure and data**

```bash
pg_dump -U postgres -d fintech -t dev.employees --no-owner --no-acl > employees_dump.sql
```

> **Note:** In the dump file, replace the schema name `dev` with `reporting`, because we are restoring the table into a different schema.

**3.2 Restore the table from the dump file**

```bash
psql -U postgres -d fintech < employees_dump.sql
```

**3.3 Grant permission on the new table to the analyst role**

```sql
GRANT SELECT ON TABLE reporting.employees TO analyst;
```

**3.4 Confirm that the user `finance` can read the data**

Connect as `finance` and run:

```sql
SELECT * FROM reporting.employees;
```

This should display all the data added earlier, as shown in the screenshot below.

<figure>
  <img src="articles/PostgreSQL/images/roles-management/analyst-access.png" alt="The finance user reading data from reporting.employees">
  <figcaption>Fig. 1 — A The finance user reading data from reporting.employees.</figcaption>
</figure>

---

## Conclusion

Roles are the foundation of access control in PostgreSQL. A role can act as a user or as a group, and understanding the three levels of authorization (role-level privileges, object-level privileges, and ownership) makes it much easier to design a secure setup.

In this article, we created three roles for a fintech database:

- **Admin:** manages roles, schemas, and objects, but without unrestricted access to the whole cluster.
- **Developers:** can build and change objects in their own schema.
- **Analysts:** have read-only access to the reporting schema.

The key points to remember:

- Create group roles without `LOGIN`, and create separate login roles for real users.
- Members inherit object privileges from their group roles, but not role attributes such as `CREATEROLE` or `CREATEDB`. Use `SET ROLE` when those are needed.
- Ownership is separate from privileges. Objects belong to the role that created them, so grant access to a group role rather than to individual users.
- Always follow the principle of least privilege. Give each role only the access it needs.