import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "sentire-cloud" },
  redact: {
    paths: ["password", "*.password", "secret", "*.secret", "token", "*.token", "headers.authorization", "headers.cookie"],
    censor: "[redacted]",
  },
});
