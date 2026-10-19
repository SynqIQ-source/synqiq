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
    <div role="group" aria-label="Room" className="flex max-w-full flex-wrap gap-0.5 rounded-lg bg-muted p-1">
      {rooms.map((room) => {
        const active = room.id === selectedRoomId;
        return (
          <button
            key={room.id}
            type="button"
            onClick={() => selectRoom(room.id)}
            aria-pressed={active}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {room.name}
          </button>
        );
      })}
    </div>
  );
}
