import { RoomClient } from "./RoomClient";

// Next.js 16: route params are async.
export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  // Share codes are uppercase; normalize so lower-cased URLs still resolve.
  return <RoomClient code={code.toUpperCase()} />;
}
