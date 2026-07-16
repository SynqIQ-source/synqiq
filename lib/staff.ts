import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type StaffOption = {
  id: string;
  display_name: string;
};

export async function getActiveStaff(): Promise<StaffOption[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, display_name")
    .eq("active", true)
    .order("display_name")
    .returns<StaffOption[]>();

  if (error) {
    throw new Error(`Failed to load staff: ${error.message}`);
  }

  return data ?? [];
}
