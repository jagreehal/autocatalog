// Package payments is a payments service: one HTTP endpoint and one event.
package payments

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/invopop/jsonschema"
)

// PaymentCompleted is a payment settled with the card network.
type PaymentCompleted struct {
	PaymentID string  `json:"paymentId"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
}

// JSONSchemaExtend names the event for autocatalog.
func (PaymentCompleted) JSONSchemaExtend(s *jsonschema.Schema) {
	s.Extras = map[string]any{"x-autocatalog": map[string]any{
		"id":        "payment.completed",
		"version":   "1.0.0",
		"domain":    "payments",
		"producers": []string{"PaymentService"},
		"consumers": []string{"LedgerService"},
	}}
}

type Payment struct {
	PaymentID string `json:"paymentId"`
	Status    string `json:"status"`
}

type getPaymentInput struct {
	ID string `path:"id"`
}

type getPaymentOutput struct {
	Body Payment
}

// New registers the service's routes and returns its API.
func New(mux *http.ServeMux) huma.API {
	api := humago.New(mux, huma.DefaultConfig("PaymentService", "1.0.0"))
	huma.Register(api, huma.Operation{
		OperationID: "get-payment",
		Method:      http.MethodGet,
		Path:        "/payments/{id}",
		Summary:     "Get a payment",
		Tags:        []string{"payments"},
	}, func(_ context.Context, in *getPaymentInput) (*getPaymentOutput, error) {
		return &getPaymentOutput{Body: Payment{PaymentID: in.ID, Status: "completed"}}, nil
	})
	return api
}
