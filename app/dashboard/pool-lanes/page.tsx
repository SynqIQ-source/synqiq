import { ClassesView, type ClassesSearchParams } from "../classes/classes-view";

// Pool lane reservations for the ops team: the Classes list, lanes only.
// Every staff member can see it (same as Classes); each lane opens the
// shared roster page.
export default async function PoolLanesPage({ searchParams }: { searchParams: ClassesSearchParams }) {
  return <ClassesView searchParams={searchParams} lanes />;
}
