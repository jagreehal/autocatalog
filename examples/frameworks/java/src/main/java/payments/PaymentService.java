package payments;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.servers.Server;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** A payments service: one HTTP endpoint and one event. */
@SpringBootApplication
@RestController
@Tag(name = "payments")
@OpenAPIDefinition(info = @Info(title = "PaymentService", version = "1.0.0"), servers = @Server(url = "/"))
public class PaymentService {
    public record Payment(String paymentId, String status) {}

    @GetMapping("/payments/{id}")
    public Payment getPayment(@PathVariable String id) {
        return new Payment(id, "completed");
    }

    public static void main(String[] args) {
        SpringApplication.run(PaymentService.class, args);
    }
}
