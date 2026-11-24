export async function register(): Promise<void> {
  // Validate config when the server starts, not while `next build` runs
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    await import("./instrumentation-node");
  }
}
