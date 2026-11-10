---
name: Carrier Adapter
summary: Translates Acme Inc shipment requests into the external carrier's format and sends them to create a shipment.
owner: fulfilment-platform
---

## Overview

The **Carrier Adapter** is the anti-corruption layer between Acme Inc and its carriers. It takes a shipment request from the [[service|Shipping API]], maps it to the external [[system|carrier]]'s API, and sends a [[event|fulfilment/create-shipment]] to dispatch the parcel.

The carrier exposes a SOAP API, so the adapter keeps the carrier's WSDL and the XML Schema for its messages as specifications. You can read them under **API & Contracts** in the sidebar.
