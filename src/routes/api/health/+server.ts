import { APP_VERSION } from "$lib/app-meta";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () =>
  json({ status: "ok", version: APP_VERSION }, { status: 200 });

export const HEAD: RequestHandler = () =>
  new Response(null, {
    status: 200,
    headers: { "x-app-version": APP_VERSION },
  });
