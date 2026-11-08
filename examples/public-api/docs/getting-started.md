---
title: Getting started
owner: developer-relations
summary: Your first request, from an API key to a balance.
audience: [public]
sidebar:
  order: 1
---

1. [Register for an API key](https://example.com/register).
2. [Authenticate](./authentication.md) to get a token.
3. Call [`GET /v1/balances`](/apis/public-api/openapi/) with it.

```bash
curl https://api.example.com/v1/balances -H "Authorization: Bearer $TOKEN"
```
