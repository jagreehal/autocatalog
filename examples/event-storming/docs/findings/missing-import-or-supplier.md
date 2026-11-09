---
title: Missing import or supplier vanishes silently
owner: Catalogue
nature: question
status: draft
date: 2026-11-09
flow: catalogue-import
step: import-not-found
---

Both lookups throw before the error handling starts, so the status is never
updated, nobody is told, and the final save never runs. From the user's side
the import just sits there.

**Decide:** should these end as "Catalogue import errored", like every other failure?
