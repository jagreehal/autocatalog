package payments;

/** A payment settled with the card network. */
public record PaymentCompleted(String paymentId, double amount, String currency) {}
