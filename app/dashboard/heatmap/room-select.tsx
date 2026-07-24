"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Room = { id: string; name: string };

type RoomSelectProps = {
  rooms: Room[];
  selectedRoomId: string;
};

export function RoomSelect({ rooms, selectedRoomId }: RoomSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectRoom(roomId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("room", roomId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Room
      </span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {rooms.map((room) => (
          <button
            key={room.id}
            type="button"
            onClick={() => selectRoom(room.id)}
            aria-pressed={room.id === selectedRoomId}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              room.id === selectedRoomId
                ? "border-primary bg-primary text-white"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {room.name}
          </button>
        ))}
      </div>
    </div>
  );
}
