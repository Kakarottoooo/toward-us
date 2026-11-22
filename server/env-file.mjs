import { homedir } from "node:os";
import { resolve } from "node:path";

// Which local secrets file the server loads at start. Hosted deployments set values in the environment instead.
// Test runs (NODE_ENV=test or TOWARD_US_TEST set) never fall back to the owner's home secrets file, so a test server
// cannot reach a paid model, email, SMS or push service with real keys; an explicitly set TOWARD_US_ENV_FILE still loads.
export function localEnvFile(env = process.env, home = homedir()) {
  if (env.TOWARD_US_ENV_FILE) return env.TOWARD_US_ENV_FILE;
  if (env.NODE_ENV === "test" || env.TOWARD_US_TEST) return "";
  return resolve(home, ".pinky.env");
}
