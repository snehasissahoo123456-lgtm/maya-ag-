import test from "node:test";
import assert from "node:assert/strict";
import { createCEORunRepository } from "./create-ceo-run-repository.ts";
import { FileCEORunRepository } from "./file-ceo-run-repository.ts";
import { SupabaseCEORunRepository } from "./supabase-ceo-run-repository.ts";

test("CEO run repository factory defaults to file storage", () => {
  const previous = process.env.MAYA_STORAGE_DRIVER;
  delete process.env.MAYA_STORAGE_DRIVER;
  try { assert.ok(createCEORunRepository() instanceof FileCEORunRepository); }
  finally { if (previous === undefined) delete process.env.MAYA_STORAGE_DRIVER; else process.env.MAYA_STORAGE_DRIVER = previous; }
});

test("CEO run repository factory requires Supabase credentials when selected", () => {
  const previous = { driver: process.env.MAYA_STORAGE_DRIVER, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.MAYA_STORAGE_DRIVER = "supabase"; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try { assert.throws(() => createCEORunRepository(), /requires SUPABASE_URL/i); }
  finally {
    if (previous.driver === undefined) delete process.env.MAYA_STORAGE_DRIVER; else process.env.MAYA_STORAGE_DRIVER = previous.driver;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test("CEO run repository factory selects Supabase with complete server credentials", () => {
  const previous = { driver: process.env.MAYA_STORAGE_DRIVER, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.MAYA_STORAGE_DRIVER = "supabase"; process.env.SUPABASE_URL = "https://maya-test.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-key";
  try { assert.ok(createCEORunRepository() instanceof SupabaseCEORunRepository); }
  finally {
    if (previous.driver === undefined) delete process.env.MAYA_STORAGE_DRIVER; else process.env.MAYA_STORAGE_DRIVER = previous.driver;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});
