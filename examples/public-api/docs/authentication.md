---
title: Authentication
owner: developer-relations
summary: Every request carries a bearer token.
audience: [public]
sidebar:
  order: 2
---

Send your API key as a bearer token in the `Authorization` header. A missing or
revoked key answers `401`.
