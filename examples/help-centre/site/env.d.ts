// Who is reading, as the middleware sets it for every page and the assistant.
declare namespace App {
  interface Locals {
    reader?: import('./readers.ts').Reader | undefined;
  }
}
