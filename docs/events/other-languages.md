---
title: Events from Rust, Go, Java and .NET
owner: Maintainers
summary: Write the schemas from a test with each language's own generator, commit them, and scan them like any JSON Schema.
tags:
  - events
related:
  - docs/events/json-schema
  - docs/events/openapi
  - docs/drift-ci
---

autocatalog reads contract files, so a service in any language joins the
catalog once its schemas are on disk. Rust, Go, Java and .NET each have a
generator that writes JSON Schema from a type and OpenAPI from routes. Call
them from a test that writes `contracts/`, and commit what it writes:

```text
contracts/
  openapi.json                      the HTTP API, for the site's API reference
  events/payment.completed.json     one JSON Schema per event
```

`x-autocatalog` names the event: id, version, domain, producers and consumers,
as in [JSON Schema](/docs/events/json-schema). Where the generator can't add it
easily, put the same block in a sidecar file beside the schema,
`payment.completed.autocatalog.json`.

CI runs the test and fails if it changed anything, so the committed files
always match the code:

```yaml
- run: cargo test --test contracts # or go test, ./gradlew test, dotnet test
- run: git diff --exit-code contracts/
- run: npx autocatalog drift --base-ref origin/main --root .
```

[`examples/frameworks/`](https://github.com/jagreehal/autocatalog/tree/main/examples/frameworks)
has the same payments service in all four languages. CI checks that each one
produces the same catalog.

## Rust

[schemars](https://docs.rs/schemars) for events, and
[openapi-axum](https://github.com/jagreehal/openapi-axum) or
[utoipa](https://docs.rs/utoipa) for the API.

```rust
#[derive(Serialize, JsonSchema)]
#[schemars(extend("x-autocatalog" = {
    "id": "payment.completed",
    "version": "1.0.0",
    "domain": "payments",
    "producers": ["PaymentService"],
    "consumers": ["LedgerService"]
}))]
#[serde(rename_all = "camelCase")]
pub struct PaymentCompleted {
    pub payment_id: String,
    pub amount: f64,
    pub currency: String,
}

// tests/contracts.rs
#[test]
fn contracts() {
    let (_, openapi) = payments::app().split();
    write("contracts/openapi.json", &openapi);
    write("contracts/events/payment.completed.json", &schemars::schema_for!(PaymentCompleted));
}
```

## Go

[invopop/jsonschema](https://github.com/invopop/jsonschema) for events, and
[huma](https://huma.rocks) for the API. Fields without `omitempty` are
required.

```go
func (PaymentCompleted) JSONSchemaExtend(s *jsonschema.Schema) {
	s.Extras = map[string]any{"x-autocatalog": map[string]any{
		"id": "payment.completed", "version": "1.0.0", "domain": "payments",
		"producers": []string{"PaymentService"}, "consumers": []string{"LedgerService"},
	}}
}

func TestContracts(t *testing.T) {
	write(t, "contracts/openapi.json", New(http.NewServeMux()).OpenAPI())
	r := jsonschema.Reflector{DoNotReference: true}
	write(t, "contracts/events/payment.completed.json", r.Reflect(&PaymentCompleted{}))
}
```

## Java

[victools/jsonschema-generator](https://github.com/victools/jsonschema-generator)
for events, and [springdoc](https://springdoc.org) for a Spring Boot API. The
test starts the app and saves `/v3/api-docs`. Pin `servers` with
`@OpenAPIDefinition`, or the random test port ends up in the file. Declare
`contracts/` as an output of the test task, `tasks.test { outputs.dir("contracts") }`,
or Gradle skips the test as up to date and a stale file passes. The event
metadata lives in a sidecar.

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ContractsTest {
    @Value("${local.server.port}") int port;

    @Test
    void contracts() throws Exception {
        write("contracts/openapi.json", get("http://localhost:" + port + "/v3/api-docs"));

        var config = new SchemaGeneratorConfigBuilder(SchemaVersion.DRAFT_2020_12, OptionPreset.PLAIN_JSON);
        config.forFields().withRequiredCheck(field -> true); // every record component
        var schema = new SchemaGenerator(config.build()).generateSchema(PaymentCompleted.class);
        write("contracts/events/payment.completed.json", schema.toPrettyString());
    }
}
```

```json
// contracts/events/payment.completed.autocatalog.json
{
  "id": "payment.completed",
  "version": "1.0.0",
  "domain": "payments",
  "producers": ["PaymentService"],
  "consumers": ["LedgerService"]
}
```

## .NET

`JsonSchemaExporter` from System.Text.Json for events, and
`Microsoft.AspNetCore.OpenApi` for a minimal API. Neither needs a third-party
package. Turn on `RespectNullableAnnotations` and strict number handling, or
the web defaults widen every number to `["string", "number"]`.

```csharp
static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web)
{
    RespectNullableAnnotations = true,
    NumberHandling = JsonNumberHandling.Strict,
    TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
};

[Fact]
public async Task Contracts()
{
    using var factory = new WebApplicationFactory<Program>();
    Write("contracts/openapi.json", JsonNode.Parse(await factory.CreateClient().GetStringAsync("/openapi/v1.json"))!);

    var schema = Web.GetJsonSchemaAsNode(typeof(PaymentCompleted), new() { TreatNullObliviousAsNonNullable = true });
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema";
    schema["x-autocatalog"] = new JsonObject { ["id"] = "payment.completed", ["version"] = "1.0.0", /* … */ };
    Write("contracts/events/payment.completed.json", schema);
}
```

## Build output

The scanner skips `target/`, `bin/`, `obj/` and `build/`. A schema copied into
build output isn't read twice.
