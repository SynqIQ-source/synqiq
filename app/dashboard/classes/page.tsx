import { requireModule } from "@/lib/modules";
import { ClassesView, type ClassesSearchParams } from "./classes-view";

export default async function ClassesPage({ searchParams }: { searchParams: ClassesSearchParams }) {
  // Part of the group fitness module: 404 when the studio doesn't have it.
  await requireModule("group_fitness");
  return <ClassesView searchParams={searchParams} />;
}
