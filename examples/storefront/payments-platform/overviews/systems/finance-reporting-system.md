---
name: Finance Reporting System
summary: Internal system that produces month-end finance reports. It works on its own, with no connections to other systems.
owner: payments-platform
---

## Overview

The **Finance Reporting System** produces month-end finance reports for the finance team. It is self-contained: it has no relationships with other systems and no actors, so its context diagram shows the system on its own.

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services that make up this system.

## What's inside

| Component                    | Type    | Responsibility                      |
| ---------------------------- | ------- | ----------------------------------- |
| [[service\|Ledger Exporter]] | Service | Builds the month-end ledger export. |
