import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  approveDeveloperChange,
  createDeveloperChangeRequest,
  recordDeveloperReview,
  submitDeveloperChange,
} from "./developer-change-control.ts";
import type { DeveloperChangeRepository } from "./developer-change-store.ts";

type AuthenticatedRequest = Request & { authSession?: { user?: { id?: string; role?: string } } };

function founderId(req: Request): string | null {
  const user = (req as AuthenticatedRequest).authSession?.user;
  return user?.role === "Founder" && typeof user.id === "string" && user.id.trim() ? user.id : null;
}

function reviewerId(req: Request): string | null {
  const user = (req as AuthenticatedRequest).authSession?.user;
  return (user?.role === "CTO" || user?.role === "Admin") && typeof user.id === "string" && user.id.trim() ? user.id : null;
}

function publicChange(change: Awaited<ReturnType<DeveloperChangeRepository["get"]>> extends infer T ? Exclude<T, null> : never) {
  const { patch: _patch, ...metadata } = change;
  return metadata;
}

/**
 * Founder-owned draft and approval API plus an independently authenticated reviewer
 * action. Reviewer sessions can review only the single-Founder record by ID; they
 * cannot list, read full patch content, create, approve or delete Founder changes.
 * Patch application, sandbox execution and deployment remain unavailable here.
 */
export function createDeveloperChangeRouter(repository: DeveloperChangeRepository): express.Router {
  const router = express.Router();

  router.get("/", async (req: Request, res: Response) => {
    const owner = founderId(req);
    if (!owner) return res.status(401).json({ success: false, error: "Verified Founder session required." });
    const rawLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 500) {
      return res.status(400).json({ success: false, error: "limit must be an integer from 1 to 500." });
    }
    try {
      const changes = await repository.list({ founderId: owner, limit: rawLimit });
      return res.json({ success: true, changes: changes.map(change => publicChange(change)) });
    } catch (error) {
      return res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Unable to list Developer changes." });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    const owner = founderId(req);
    if (!owner) return res.status(401).json({ success: false, error: "Verified Founder session required." });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ success: false, error: "A Developer change object is required." });
    }
    const allowed = new Set(["title", "objective", "workspaceId", "files", "patch", "diffSha256"]);
    if (Object.keys(body).some(key => !allowed.has(key))) {
      return res.status(400).json({ success: false, error: "Unexpected fields are not allowed. Founder identity and lifecycle state are server-controlled." });
    }
    try {
      const change = createDeveloperChangeRequest({
        id: "dev-change-" + randomUUID(),
        founderId: owner,
        title: body.title,
        objective: body.objective,
        workspaceId: body.workspaceId,
        files: body.files,
        patch: body.patch,
        diffSha256: body.diffSha256,
      });
      const saved = await repository.create(change);
      return res.status(201).json({ success: true, change: saved });
    } catch (error) {
      return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Unable to create Developer change." });
    }
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const owner = founderId(req);
    if (!owner) return res.status(401).json({ success: false, error: "Verified Founder session required." });
    const change = await repository.get({ changeId: req.params.id, founderId: owner });
    return change ? res.json({ success: true, change }) : res.status(404).json({ success: false, error: "Developer change not found." });
  });

  router.post("/:id/submit", async (req: Request, res: Response) => {
    const owner = founderId(req);
    if (!owner) return res.status(401).json({ success: false, error: "Verified Founder session required." });
    try {
      const current = await repository.get({ changeId: req.params.id, founderId: owner });
      if (!current) return res.status(404).json({ success: false, error: "Developer change not found." });
      const submitted = await repository.update(submitDeveloperChange(current));
      return res.json({ success: true, change: publicChange(submitted) });
    } catch (error) {
      return res.status(409).json({ success: false, error: error instanceof Error ? error.message : "Unable to submit Developer change." });
    }
  });

  router.post("/:id/review", async (req: Request, res: Response) => {
    const reviewer = reviewerId(req);
    if (!reviewer) return res.status(403).json({ success: false, error: "Independent CTO/Admin reviewer session required." });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => !["decision", "notes"].includes(key)) ||
        !["approved", "changes_requested"].includes(body.decision) ||
        typeof body.notes !== "string" || body.notes.length > 4000) {
      return res.status(400).json({ success: false, error: "Review requires decision approved|changes_requested and notes up to 4,000 characters. Reviewer identity is session-controlled." });
    }
    try {
      // This deployment currently has one Founder identity. The reviewer is never
      // allowed to supply or override the owning Founder ID.
      const current = await repository.get({ changeId: req.params.id, founderId: "founder-primary" });
      if (!current) return res.status(404).json({ success: false, error: "Developer change not found." });
      const reviewed = await repository.update(recordDeveloperReview(current, {
        reviewerId: reviewer, decision: body.decision, notes: body.notes,
      }));
      return res.json({ success: true, change: publicChange(reviewed) });
    } catch (error) {
      return res.status(409).json({ success: false, error: error instanceof Error ? error.message : "Unable to review Developer change." });
    }
  });

  router.post("/:id/approve", async (req: Request, res: Response) => {
    const owner = founderId(req);
    if (!owner) return res.status(403).json({ success: false, error: "Only the owning Founder can approve a reviewed change." });
    try {
      const current = await repository.get({ changeId: req.params.id, founderId: owner });
      if (!current) return res.status(404).json({ success: false, error: "Developer change not found." });
      const approved = await repository.update(approveDeveloperChange(current, owner));
      return res.json({ success: true, change: publicChange(approved) });
    } catch (error) {
      return res.status(409).json({ success: false, error: error instanceof Error ? error.message : "Unable to approve Developer change." });
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const owner = founderId(req);
    if (!owner) return res.status(401).json({ success: false, error: "Verified Founder session required." });
    try {
      const deleted = await repository.delete({ changeId: req.params.id, founderId: owner });
      return deleted ? res.json({ success: true, deleted: req.params.id }) : res.status(404).json({ success: false, error: "Developer change not found." });
    } catch (error) {
      return res.status(409).json({ success: false, error: error instanceof Error ? error.message : "Unable to delete Developer change." });
    }
  });

  return router;
}
