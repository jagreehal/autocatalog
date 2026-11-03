//! Writes the service's contracts to `contracts/`. CI fails if they are stale.

use std::fs;

fn write(path: &str, value: &impl serde::Serialize) {
    let json = serde_json::to_string_pretty(value).unwrap() + "\n";
    fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
    fs::write(path, json).unwrap();
}

#[test]
fn contracts() {
    let (_, mut openapi) = payments_rust::app().split();
    openapi.info = utoipa::openapi::Info::new("PaymentService", "1.0.0");
    write("contracts/openapi.json", &openapi);
    write(
        "contracts/events/payment.completed.json",
        &schemars::schema_for!(payments_rust::PaymentCompleted),
    );
}
