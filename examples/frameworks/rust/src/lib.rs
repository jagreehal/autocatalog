//! A payments service: one HTTP endpoint and one event.

use axum::{Json, extract::Path};
use openapi_axum::{ApiResponse, ApiRouter, Rejection, route, routes};
use schemars::JsonSchema;
use serde::Serialize;
use utoipa::ToSchema;

/// A payment settled with the card network.
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

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub payment_id: String,
    pub status: String,
}

#[derive(Serialize, ToSchema)]
pub struct ErrorBody {
    pub message: String,
}

#[derive(ApiResponse)]
pub enum ApiError {
    /// The request was invalid.
    #[status(BAD_REQUEST)]
    BadRequest(ErrorBody),
}

impl From<Rejection> for ApiError {
    fn from(r: Rejection) -> Self {
        Self::BadRequest(ErrorBody { message: r.message })
    }
}

#[route(GET, "/payments/{id}", tag = "payments")]
/// Get a payment.
async fn get_payment(Path(id): Path<String>) -> Result<Json<Payment>, ApiError> {
    Ok(Json(Payment { payment_id: id, status: "completed".into() }))
}

pub fn app() -> ApiRouter {
    ApiRouter::new().routes(routes![get_payment])
}
