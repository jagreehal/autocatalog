---
name: money-check
description: Check a diff for float arithmetic on amounts and missing idempotency keys.
---

Look for `parseFloat` and `Number(` on amounts, and for handlers without an idempotency key.
