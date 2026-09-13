---
name: setup
description: Establish DocGov documentation governance in this repository — infer the project mode and layout, create the taxonomy namespaces, install agent documentation rules, and build the initial registry and graph. Use when a repository has no .docgov/config.yaml yet.
disable-model-invocation: true
allowed-tools: Bash(docgov *) Read Write Edit
argument-hint: "[--mode solo|team|enterprise|open-source] [--layout full|compact]"
---

# Establish governance

## Current repository

!`docgov tools --json 2>/dev/null || echo '{}'`

## What to do

1. **Run `docgov setup $ARGUMENTS`.** It infers mode from the repository (a LICENSE plus
   CONTRIBUTING means open-source; CODEOWNERS means team) and layout from document count.
   Report what it inferred and why, in one line each.

2. **Confirm the inferences with the user before anything else.** These two choices shape
   everything afterwards and are annoying to change later:
   - `mode` decides how much blocks. `solo` blocks three rules; `enterprise` blocks twelve.
   - `layout` decides where documents live. `compact` is right for most repositories;
     `full` (the numbered `00-canonical` … `99-archive` tree) earns its overhead at roughly
     25+ documents or when several teams own different parts of the tree.

   If the repository is small, say so and recommend `compact` + `solo`. Documentation
   architecture astronautics is a real failure mode and this is where it starts.

3. **Set up domains if the codebase has obvious ones.** Look at the top-level source
   layout. If there are clear bounded areas (`src/auth/`, `src/billing/`, `src/licensing/`),
   add them to `.docgov/config.yaml`:

   ```yaml
   domains:
     licensing:
       paths: ["src/licensing/**", "migrations/*licen*"]
       owner: platform
   ```

   Domains are what make `docgov brief <domain>` and invariant injection work. Without
   them most of DocGov's value stays switched off. This is the highest-leverage thing to
   get right during setup.

4. **Then run `/docgov:review`** if documentation already exists, or `/docgov:create` for
   the first document if not.

## Do not

Do not create documents during init. Do not populate empty namespaces with placeholder
files — an empty namespace is a namespace, a file full of `TODO` is debt.
