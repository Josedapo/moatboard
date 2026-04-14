import { handlers } from "@/auth";

export const { GET, POST } = handlers;

// Needed for NextAuth to work with Neon adapter (uses node APIs, not edge)
export const runtime = "nodejs";
