import { NextResponse } from "next/server";
import { deleteAllScores, deleteScore, insertScore, listScores } from "@/lib/db";

export const dynamic = "force-dynamic";

function fail(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status });
}

/** The whole board, fastest first. */
export async function GET() {
  try {
    return NextResponse.json({ board: await listScores() });
  } catch (err) {
    return fail(err);
  }
}

/** Saves one finished run; returns the new board and where the run landed. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(new Error("Invalid JSON"), 400);
  }

  const name = String(body.name ?? "").trim().slice(0, 20) || "ANON";
  const timeMs = Number(body.timeMs);
  const target = Math.round(Number(body.target));
  const peakRate = Number(body.peakRate) || 0;
  const countMode = body.countMode === "cycle" ? "cycle" : "swap";

  if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > 24 * 3600 * 1000) {
    return fail(new Error("Invalid time"), 400);
  }
  if (!Number.isFinite(target) || target < 1 || target > 999) {
    return fail(new Error("Invalid target"), 400);
  }

  try {
    const entry = await insertScore({ name, timeMs, target, peakRate, countMode });
    const board = await listScores();
    const rank = board.findIndex((e) => e.id === entry.id) + 1;
    return NextResponse.json({ entry, board, rank: rank || board.length + 1 });
  } catch (err) {
    return fail(err);
  }
}

/** `?id=…` removes one row; no id clears the board. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id) await deleteScore(id);
    else await deleteAllScores();
    return NextResponse.json({ board: await listScores() });
  } catch (err) {
    return fail(err);
  }
}
