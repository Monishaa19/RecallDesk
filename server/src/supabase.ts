import type { NextFunction, Request, Response } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, isSupabaseConfigured } from "./config.js";
import { HttpError } from "./errors.js";

export interface AuthedRequest extends Request {
  db: SupabaseClient;
  userId: string;
}

/**
 * Every request gets a Supabase client that acts *as the signed-in user*
 * (anon key + the user's JWT). Postgres Row Level Security therefore enforces
 * data isolation for every query; no service-role key is used anywhere.
 */
export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!isSupabaseConfigured) {
      throw new HttpError(503, "The database isn't configured on the server. Set SUPABASE_URL and SUPABASE_ANON_KEY.", "not_configured");
    }
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new HttpError(401, "Please sign in.", "unauthorized");

    const db = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, "Your session has expired. Please sign in again.", "unauthorized");

    const authed = req as AuthedRequest;
    authed.db = db;
    authed.userId = data.user.id;
    next();
  } catch (err) {
    next(err);
  }
}

/** Access the authenticated context attached by `requireUser`. */
export function auth(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}
