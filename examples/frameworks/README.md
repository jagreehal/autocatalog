# Frameworks

The same payments service in Rust (axum), Go (huma), Java (Spring Boot) and
.NET 10 (minimal API). Each one has a test that writes `contracts/openapi.json`
and `contracts/events/payment.completed.json`.

```bash
pnpm verify:frameworks          # all four
pnpm verify:frameworks rust go  # some
```

For each language this runs the contract test and fails if it changed the
committed contracts. It then scans them and checks the catalog against
`expected.json`, and checks that drift catches a renamed field. With no local
JDK, the Java build runs in an `eclipse-temurin:21` container.

See [Events from Rust, Go, Java and .NET](../../docs/events/other-languages.md).
