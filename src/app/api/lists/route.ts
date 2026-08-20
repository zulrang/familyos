import { handleCreateList, handleGetLists } from "@/lists/lists-http";

export async function GET(request: Request) {
  return handleGetLists(request);
}

export async function POST(request: Request) {
  return handleCreateList(request);
}
