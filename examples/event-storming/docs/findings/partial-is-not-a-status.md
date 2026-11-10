---
title: Partial isn't its own status
owner: Catalogue
nature: question
status: draft
date: 2026-11-09
flow: catalogue-import
step: partial
---

A partial import is stored as `complete` with the message "Partially complete".
Reports and filters can't tell it apart from a clean import without checking
the message text.

**Decide:** add a partially complete status?
