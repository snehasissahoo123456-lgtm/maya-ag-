import test from "node:test";
import assert from "node:assert/strict";
import { createConversationRepository } from "./create-conversation-repository.ts";
import { ConversationStore } from "./conversation-store.ts";
import { SupabaseConversationStore } from "./supabase-conversation-store.ts";

test("defaults to file storage and requires server credentials for Supabase", () => {
  const previous = { driver: process.env.MAYA_STORAGE_DRIVER, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  try {
    process.env.MAYA_STORAGE_DRIVER = "file";
    assert.ok(createConversationRepository() instanceof ConversationStore);
    process.env.MAYA_STORAGE_DRIVER = "supabase";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(() => createConversationRepository(), /requires SUPABASE_URL/);
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-test-secret";
    assert.ok(createConversationRepository() instanceof SupabaseConversationStore);
  } finally {
    if (previous.driver === undefined) delete process.env.MAYA_STORAGE_DRIVER; else process.env.MAYA_STORAGE_DRIVER = previous.driver;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});
