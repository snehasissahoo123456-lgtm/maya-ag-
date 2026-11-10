import test from "node:test";
import assert from "node:assert/strict";
import { createTaskRepository } from "./create-task-repository.ts";
import { FileTaskRepository } from "./file-task-repository.ts";
import { SupabaseTaskRepository } from "./supabase-task-repository.ts";

test("task repository factory defaults to file storage", () => {
  const previous = process.env.MAYA_STORAGE_DRIVER;
  delete process.env.MAYA_STORAGE_DRIVER;
  try { assert.ok(createTaskRepository() instanceof FileTaskRepository); }
  finally { if (previous === undefined) delete process.env.MAYA_STORAGE_DRIVER; else process.env.MAYA_STORAGE_DRIVER = previous; }
});

test("task repository factory rejects incomplete Supabase configuration", () => {
  const previous = { driver: process.env.MAYA_STORAGE_DRIVER, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.MAYA_STORAGE_DRIVER = "supabase"; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try { assert.throws(() => createTaskRepository(), /requires SUPABASE_URL/); }
  finally {
    if (previous.driver === undefined) delete process.env.MAYA_STORAGE_DRIVER; else process.env.MAYA_STORAGE_DRIVER = previous.driver;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test("task repository factory selects Supabase only with complete server credentials", () => {
  const previous = { driver: process.env.MAYA_STORAGE_DRIVER, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.MAYA_STORAGE_DRIVER = "supabase"; process.env.SUPABASE_URL = "https://maya-test.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-test-key";
  try { assert.ok(createTaskRepository() instanceof SupabaseTaskRepository); }
  finally {
    if (previous.driver === undefined) delete process.env.MAYA_STORAGE_DRIVER; else process.env.MAYA_STORAGE_DRIVER = previous.driver;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});
