plugins {
    java
    id("org.springframework.boot") version "4.1.2"
    id("io.spring.dependency-management") version "1.1.7"
}

java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }

repositories { mavenCentral() }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-api:3.2.0")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("com.github.victools:jsonschema-generator:5.0.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    // ContractsTest writes these. Declared, so an edited or deleted file reruns the test.
    outputs.dir("contracts")
}
