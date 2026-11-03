package payments;

import com.github.victools.jsonschema.generator.OptionPreset;
import com.github.victools.jsonschema.generator.SchemaGenerator;
import com.github.victools.jsonschema.generator.SchemaGeneratorConfigBuilder;
import com.github.victools.jsonschema.generator.SchemaVersion;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

/** Writes the service's contracts to contracts/. CI fails if they are stale. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ContractsTest {
    @Value("${local.server.port}")
    int port;

    @Test
    void contracts() throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v3/api-docs")).build();
        var openapi = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()).body();
        write("contracts/openapi.json", openapi);

        var config = new SchemaGeneratorConfigBuilder(SchemaVersion.DRAFT_2020_12, OptionPreset.PLAIN_JSON);
        // Every record component is part of the payload.
        config.forFields().withRequiredCheck(field -> true);
        var schema = new SchemaGenerator(config.build()).generateSchema(PaymentCompleted.class);
        write("contracts/events/payment.completed.json", schema.toPrettyString());
    }

    static void write(String path, String json) throws Exception {
        Files.createDirectories(Path.of(path).getParent());
        Files.writeString(Path.of(path), json.strip() + "\n");
    }
}
