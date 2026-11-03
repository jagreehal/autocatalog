package payments

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/invopop/jsonschema"
)

// TestContracts writes the service's contracts to contracts/. CI fails if they are stale.
func TestContracts(t *testing.T) {
	write(t, "contracts/openapi.json", New(http.NewServeMux()).OpenAPI())
	r := jsonschema.Reflector{DoNotReference: true}
	write(t, "contracts/events/payment.completed.json", r.Reflect(&PaymentCompleted{}))
}

func write(t *testing.T, path string, v any) {
	t.Helper()
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}
