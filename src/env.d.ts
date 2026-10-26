/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    adminEmail?: string;
    cfContext?: { waitUntil(p: Promise<unknown>): void };
  }
}
declare const __BUILD_ID__: string;
