using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Schema;
using Microsoft.AspNetCore.Mvc.Testing;

/// <summary>Writes the service's contracts to contracts/. CI fails if they are stale.</summary>
public class ContractsTest
{
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web) {
        RespectNullableAnnotations = true,
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict,
        TypeInfoResolver = new System.Text.Json.Serialization.Metadata.DefaultJsonTypeInfoResolver(),
    };

    [Fact]
    public async Task Contracts()
    {
        using var factory = new WebApplicationFactory<Program>();
        var openapi = await factory.CreateClient().GetStringAsync("/openapi/v1.json", TestContext.Current.CancellationToken);
        Write("contracts/openapi.json", JsonNode.Parse(openapi)!);

        var schema = Web.GetJsonSchemaAsNode(typeof(PaymentCompleted), new() { TreatNullObliviousAsNonNullable = true });
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema";
        schema["x-autocatalog"] = new JsonObject
        {
            ["id"] = "payment.completed",
            ["version"] = "1.0.0",
            ["domain"] = "payments",
            ["producers"] = new JsonArray("PaymentService"),
            ["consumers"] = new JsonArray("LedgerService"),
        };
        Write("contracts/events/payment.completed.json", schema);
    }

    // Paths are relative to the example root, not the test's bin/ folder.
    static void Write(string path, JsonNode json, [CallerFilePath] string source = "")
    {
        var full = Path.Combine(Path.GetDirectoryName(source)!, "../..", path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, json.ToJsonString(new() { WriteIndented = true }) + "\n");
    }
}
