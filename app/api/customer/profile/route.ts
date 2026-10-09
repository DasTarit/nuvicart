import { NextResponse } from "next/server";
import { getProfile, updateProfile } from "@/features/customer/service";

function fail(e: unknown) {
  const unauth = e instanceof Error && e.message === "UNAUTHENTICATED";
  return NextResponse.json(
    { error: unauth ? "UNAUTHENTICATED" : "PROFILE_REQUEST_FAILED" },
    { status: unauth ? 401 : 500 }
  );
}

export async function GET() {
  try {
    return NextResponse.json({ profile: await getProfile() });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(request: Request) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const displayName = b.displayName == null ? null : String(b.displayName).trim();
  const phone = b.phone == null ? null : String(b.phone).trim();

  if (displayName !== null && (displayName.length < 2 || displayName.length > 80)) {
    return NextResponse.json({ error: "INVALID_NAME" }, { status: 400 });
  }
  if (phone !== null && phone.length > 30) {
    return NextResponse.json({ error: "INVALID_PHONE" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      profile: await updateProfile({ displayName: displayName || null, phone: phone || null }),
    });
  } catch (e) {
    return fail(e);
  }
}