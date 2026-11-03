// A payments service: one HTTP endpoint and one event.
using Microsoft.AspNetCore.OpenApi;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi(options => options.AddDocumentTransformer((document, _, _) =>
{
    document.Info = new() { Title = "PaymentService", Version = "1.0.0" };
    document.Servers = [];
    return Task.CompletedTask;
}));

var app = builder.Build();
app.MapOpenApi();
app.MapGet("/payments/{id}", (string id) => new Payment(id, "completed"))
    .WithName("getPayment")
    .WithSummary("Get a payment")
    .WithTags("payments");
app.Run();

public record Payment(string PaymentId, string Status);

/// <summary>A payment settled with the card network.</summary>
public record PaymentCompleted(string PaymentId, double Amount, string Currency);

public partial class Program;
