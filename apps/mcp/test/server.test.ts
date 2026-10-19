import { describe, expect, it } from "vitest";

import { createServer, SERVER_NAME } from "../src/server.js";

describe("createServer", () => {
  it("creates a server instance", () => {
    expect(SERVER_NAME).toBe("seenit");
    expect(createServer()).toBeDefined();
  });
});
