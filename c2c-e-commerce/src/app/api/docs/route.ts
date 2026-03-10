import { NextResponse } from "next/server";
// Import the statically generated spec so the API route works in the
// standalone production build (where .ts source files are not present).
import swaggerSpec from "@/lib/swagger-spec.json";

export async function GET() {
  return NextResponse.json(swaggerSpec);
}
