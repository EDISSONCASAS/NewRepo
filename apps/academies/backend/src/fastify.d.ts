import type { User } from "./db.js";

declare module "fastify" {
  interface FastifyRequest {
    academyUser: User | null;
  }
}