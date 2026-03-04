// -----------------------------------------------------------------------------
// Bootstrap Independent AI Server
// -----------------------------------------------------------------------------
process.env.AI_ENGINE_MODE = "independent";
await import("../../server/ai_server.js");

